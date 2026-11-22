"""Runs decoupled from HTTP requests: one background task per run, writing encoded SSE chunks into a buffer.

The POST that starts a run and every resume (`GET /api/chat/{id}/stream`) subscribe to the same buffer:
replay from the start, then tail. A buffer is dropped `ttl` seconds after its run ends.
"""

import asyncio
import contextlib
import functools
import logging
from collections.abc import AsyncIterator, Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any

from pydantic_ai import CancellationToken
from pydantic_ai.ui.vercel_ai.response_types import BaseChunk, DataChunk

logger = logging.getLogger(__name__)

SDK_VERSION = 7
_CLOSING_CHUNKS = frozenset({"finish", "abort", "error"})
_SAVED_CHUNKS = frozenset({"data-conversation-saved", "data-run-stopped"})
"""Chunks sent once the run's turn is in the conversation store (normal end, or our cancel handler)."""


def encode_chunk(chunk: BaseChunk) -> str:
    return f"data: {chunk.encode(SDK_VERSION)}\n\n"


@dataclass
class RunBuffer:
    run_id: str
    conversation_id: str
    chunks: list[str] = field(default_factory=list[str])
    done: bool = False
    accepts_side_chunks: bool = True
    """False once the stream's closing chunk is in: a `data-*` part after `finish` would be dropped by the SDK."""
    saved: bool = False
    """True once the run's turn is in the conversation store: history then has it, nothing to resume."""
    pending_user_message: dict[str, Any] | None = None
    """The user message that started the run, as sent, so a reload shows it before the turn is saved."""
    _changed: asyncio.Condition = field(default_factory=asyncio.Condition)

    async def append(self, chunk: str) -> None:
        async with self._changed:
            self.chunks.append(chunk)
            self._changed.notify_all()

    async def append_side_chunk(self, chunk: DataChunk) -> bool:
        """Add a chunk from outside the run (e.g. `data-title`) if the stream is still open."""
        if self.done or not self.accepts_side_chunks:
            return False
        await self.append(encode_chunk(chunk))
        return True

    async def close(self) -> None:
        async with self._changed:
            self.done = True
            self._changed.notify_all()

    def _has_news(self, index: int) -> bool:
        return index < len(self.chunks) or self.done

    async def subscribe(self) -> AsyncIterator[str]:
        index = 0
        while True:
            async with self._changed:
                await self._changed.wait_for(functools.partial(self._has_news, index))
                pending = self.chunks[index:]
                done = self.done
            for chunk in pending:
                yield chunk
            index += len(pending)
            if done and index >= len(self.chunks):
                return


@dataclass
class ActiveRun:
    buffer: RunBuffer
    token: CancellationToken
    task: asyncio.Task[None] | None = None


class RunAlreadyActive(Exception):
    pass


class RunManager:
    def __init__(self, *, ttl_seconds: float = 60.0) -> None:
        self._ttl = ttl_seconds
        self._runs: dict[str, ActiveRun] = {}
        self._tasks: set[asyncio.Task[Any]] = set()

    def is_active(self, conversation_id: str) -> bool:
        run = self._runs.get(conversation_id)
        return run is not None and not run.buffer.done

    def in_flight(self, conversation_id: str) -> RunBuffer | None:
        """The active run whose turn is not saved yet: the client should resume its stream."""
        run = self._runs.get(conversation_id)
        if run is None or run.buffer.done or run.buffer.saved:
            return None
        return run.buffer

    def get(self, conversation_id: str) -> RunBuffer | None:
        run = self._runs.get(conversation_id)
        return run.buffer if run else None

    def start(
        self,
        conversation_id: str,
        run_id: str,
        stream_factory: Callable[[CancellationToken], AsyncIterator[BaseChunk]],
        *,
        on_finished: Callable[[], Coroutine[Any, Any, None]] | None = None,
        pending_user_message: dict[str, Any] | None = None,
    ) -> RunBuffer:
        if self.is_active(conversation_id):
            raise RunAlreadyActive(conversation_id)
        buffer = RunBuffer(run_id=run_id, conversation_id=conversation_id, pending_user_message=pending_user_message)
        run = ActiveRun(buffer=buffer, token=CancellationToken())
        self._runs[conversation_id] = run
        run.task = self.spawn(self._drive(run, stream_factory(run.token), on_finished))
        return run.buffer

    def spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
        """Keep a reference to background tasks so they are not garbage collected mid-flight."""
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def _drive(
        self,
        run: ActiveRun,
        stream: AsyncIterator[BaseChunk],
        on_finished: Callable[[], Coroutine[Any, Any, None]] | None,
    ) -> None:
        buffer = run.buffer
        try:
            async for chunk in stream:
                chunk_type = getattr(chunk, "type", None)
                if chunk_type in _CLOSING_CHUNKS:
                    buffer.accepts_side_chunks = False
                if chunk_type in _SAVED_CHUNKS:
                    buffer.saved = True
                await buffer.append(encode_chunk(chunk))
        except Exception:  # the adapter turns run errors into error chunks; this is a bug in our own code
            logger.exception("run %s crashed", buffer.run_id)
            buffer.accepts_side_chunks = False
            await buffer.append('data: {"type":"error","errorText":"Internal error"}\n\n')
        finally:
            await buffer.close()
            if on_finished is not None:
                try:
                    await on_finished()
                except Exception:
                    logger.exception("on_finished failed for run %s", buffer.run_id)
            self.spawn(self._expire(run))

    async def _expire(self, run: ActiveRun) -> None:
        await asyncio.sleep(self._ttl)
        if self._runs.get(run.buffer.conversation_id) is run:
            del self._runs[run.buffer.conversation_id]

    def cancel(self, conversation_id: str) -> bool:
        run = self._runs.get(conversation_id)
        if run is None or run.buffer.done:
            return False
        run.token.cancel()
        return True

    async def shutdown(self) -> None:
        for run in self._runs.values():
            if not run.buffer.done:
                run.token.cancel()
        tasks = list(self._tasks)
        for task in tasks:
            if not task.done() and task.get_coro().__name__ == "_expire":  # pyright: ignore[reportOptionalMemberAccess]
                task.cancel()
        with contextlib.suppress(Exception):
            await asyncio.gather(*tasks, return_exceptions=True)
