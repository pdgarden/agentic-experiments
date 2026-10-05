"""Runs as a resource: started by a request, executed by an in-process task.

A run outlives the request that started it and any client watching it. Each
event is appended to the ``events`` table, then fanned out to subscribers;
``stream`` replays from the table and then tails live events.
"""

import asyncio
import logging
from collections.abc import AsyncIterator

import openai
from agents import (
    InputGuardrailTripwireTriggered,
    MaxTurnsExceeded,
    Model,
    OutputGuardrailTripwireTriggered,
    Runner,
    RunResultStreaming,
)

from src.agents.registry import build_agent
from src.events import (
    Error,
    ErrorCode,
    Event,
    FinalRunStatus,
    RunFinished,
    RunStarted,
    Usage,
    UserMessage,
)
from src.parts import InputPart, input_text
from src.runs.live import LiveRun, LiveRuns
from src.runs.mapping import EventMapper
from src.runs.sdk_sessions import SdkSessions
from src.settings import Settings
from src.store.repo import RunRecord, SessionRecord, Store

logger = logging.getLogger(__name__)

TITLE_MAX_CHARS = 60
_SHUTDOWN_GRACE_S = 5.0


class RunTimeout(Exception):
    pass


class _Recorder:
    """Stamps events with the run's envelope, persists them, then publishes."""

    def __init__(self, store: Store, live: LiveRun) -> None:
        self._store = store
        self._live = live
        self._seq = 0

    async def emit(self, event: Event) -> None:
        self._seq += 1
        stamped = event.model_copy(
            update={"run_id": self._live.run_id, "seq": self._seq}
        )
        await self._store.append_event(stamped)
        self._live.publish(stamped)


def _title(parts: list[InputPart]) -> str:
    text = " ".join(input_text(parts).split())
    if len(text) <= TITLE_MAX_CHARS:
        return text
    return text[: TITLE_MAX_CHARS - 1].rstrip() + "…"


def _classify(error: Exception) -> tuple[ErrorCode, str]:
    if isinstance(error, MaxTurnsExceeded):
        return "max_turns", str(error)
    if isinstance(
        error, InputGuardrailTripwireTriggered | OutputGuardrailTripwireTriggered
    ):
        return "guardrail", f"Guardrail triggered: {type(error).__name__}"
    if isinstance(error, RunTimeout):
        return "timeout", str(error)
    if isinstance(error, openai.APIError):
        return "model_error", f"{type(error).__name__}: {error.message}"
    return "internal", f"{type(error).__name__}: {error}"


def _usage(result: RunResultStreaming) -> Usage:
    usage = result.context_wrapper.usage
    return Usage(
        requests=usage.requests,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        total_tokens=usage.total_tokens,
    )


class RunService:
    def __init__(
        self,
        store: Store,
        sdk_sessions: SdkSessions,
        model: Model,
        settings: Settings,
    ) -> None:
        self._store = store
        self._sdk_sessions = sdk_sessions
        self._model = model
        self._settings = settings
        self._live = LiveRuns()

    async def start(self, session: SessionRecord, parts: list[InputPart]) -> RunRecord:
        """Create a run and start executing it; raise ``RunConflict`` if busy."""
        run = await self._store.create_run(session.id, parts)
        await self._store.set_title_if_empty(session.id, _title(parts))
        live = LiveRun(run_id=run.id, session_id=session.id)
        self._live.add(live)
        live.task = asyncio.create_task(
            self._execute(live, session, run), name=f"run-{run.id}"
        )
        return run

    def cancel(self, run_id: str) -> bool:
        """Request cancellation; ``False`` if the run is not executing."""
        live = self._live.get(run_id)
        if live is None:
            return False
        live.cancel()
        return True

    async def stop_session_runs(self, session_id: str) -> None:
        """Cancel a session's runs and wait for their tasks to record it."""
        runs = self._live.for_session(session_id)
        for live in runs:
            live.cancel()
        await self._wait([live.task for live in runs if live.task is not None])

    async def shutdown(self) -> None:
        """Stop every run; each records itself as ``interrupted``."""
        tasks = [live.task for live in self._live.all() if live.task is not None]
        for task in tasks:
            task.cancel()
        await self._wait(tasks)

    async def _wait(self, tasks: list[asyncio.Task[None]]) -> None:
        if tasks:
            await asyncio.wait(tasks, timeout=_SHUTDOWN_GRACE_S)

    async def stream(self, run_id: str, after: int = 0) -> AsyncIterator[Event]:
        """Events after ``after``: replayed from the table, then live.

        Subscribing before reading the table closes the gap between the two;
        events seen in both are dropped by ``seq``. Ends after ``run_finished``.
        """
        live = self._live.get(run_id)
        queue = live.subscribe() if live is not None else None
        try:
            last = after
            for event in await self._store.list_events(run_id, after):
                yield event
                last = event.seq
                if event.type == "run_finished":
                    return
            if queue is None:
                return
            while (event := await queue.get()) is not None:
                if event.seq <= last:
                    continue
                yield event
                last = event.seq
                if event.type == "run_finished":
                    return
        finally:
            if live is not None and queue is not None:
                live.unsubscribe(queue)

    async def _execute(
        self, live: LiveRun, session: SessionRecord, run: RunRecord
    ) -> None:
        recorder = _Recorder(self._store, live)
        agent = build_agent(session.current_agent, self._model)
        mapper = EventMapper(agent.name)
        status: FinalRunStatus = "failed"
        usage: Usage | None = None
        error_text: str | None = None
        try:
            await recorder.emit(RunStarted(session_id=session.id, agent=agent.name))
            await recorder.emit(UserMessage(parts=run.input))
            result = Runner.run_streamed(
                agent,
                input_text(run.input),
                session=self._sdk_sessions.get(session.id),
                max_turns=self._settings.max_turns,
            )
            live.result = result
            if live.cancel_requested:  # cancelled before the SDK run existed
                result.cancel()
            try:
                await self._consume(result, mapper, recorder)
            finally:
                usage = _usage(result)
            status = "cancelled" if live.cancel_requested else "succeeded"
            await self._store.set_current_agent(session.id, result.last_agent.name)
        except asyncio.CancelledError:
            # Server shutdown: record the run as interrupted, then let the
            # cancellation proceed.
            await self._finish(recorder, live, "interrupted", usage, "server shutdown")
            raise
        except Exception as error:
            code, message = _classify(error)
            if code == "internal":
                logger.exception("Run %s failed", run.id)
            error_text = message
            await self._emit_quietly(recorder, Error(code=code, message=message))
        await self._finish(recorder, live, status, usage, error_text)

    async def _consume(
        self, result: RunResultStreaming, mapper: EventMapper, recorder: _Recorder
    ) -> None:
        """Drain the SDK stream to the end, mapping and recording each event.

        Draining matters: an undrained stream stalls the SDK's run loop and
        leaves the session half-written.
        """
        try:
            async with asyncio.timeout(self._settings.run_timeout_s):
                async for sdk_event in result.stream_events():
                    for event in mapper.map(sdk_event):
                        await recorder.emit(event)
        except TimeoutError:
            result.cancel()
            raise RunTimeout(
                f"Run exceeded {self._settings.run_timeout_s:g}s and was stopped"
            )

    async def _emit_quietly(self, recorder: _Recorder, event: Event) -> None:
        try:
            await recorder.emit(event)
        except Exception:
            logger.exception("Could not record %s event", event.type)

    async def _finish(
        self,
        recorder: _Recorder,
        live: LiveRun,
        status: FinalRunStatus,
        usage: Usage | None,
        error: str | None,
    ) -> None:
        try:
            await self._emit_quietly(recorder, RunFinished(status=status, usage=usage))
            await self._store.finish_run(live.run_id, status, usage=usage, error=error)
        finally:
            live.close()
            self._live.remove(live.run_id)
