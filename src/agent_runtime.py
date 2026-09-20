"""UI-agnostic runtime: one background event loop, turns delivered as events.

Streamlit is synchronous and re-runs its script on every interaction, while the
agents SDK is asynchronous and holds loop-bound resources (the httpx connection
pool inside ``AsyncOpenAI``, the aiosqlite connection and locks inside
``AsyncSQLiteSession``). So we own a single event loop on a daemon thread for
the lifetime of the process and hand results back over a ``queue.Queue``.
"""

import asyncio
import json
import queue
import sqlite3
import threading
from collections.abc import Coroutine
from concurrent.futures import Future
from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypeVar, cast

from agents import (
    Agent,
    RawResponsesStreamEvent,
    RunItemStreamEvent,
    Runner,
    ToolCallItem,
    ToolCallOutputItem,
)
from agents.extensions.memory import AsyncSQLiteSession
from agents.items import TResponseInputItem

from src.agent_config import DB_PATH, build_agent

T = TypeVar("T")


# Events emitted while a turn is running.


@dataclass(frozen=True, slots=True)
class TextDelta:
    text: str


@dataclass(frozen=True, slots=True)
class ToolCall:
    call_id: str
    name: str
    arguments: str


@dataclass(frozen=True, slots=True)
class ToolOutput:
    call_id: str
    output: str


@dataclass(frozen=True, slots=True)
class TurnDone:
    final_output: str


@dataclass(frozen=True, slots=True)
class TurnFailed:
    error: BaseException


type TurnEvent = TextDelta | ToolCall | ToolOutput | TurnDone | TurnFailed
type TurnQueue = queue.Queue[TurnEvent | None]


# Items replayed from a stored conversation.


@dataclass(frozen=True, slots=True)
class UserText:
    text: str


@dataclass(frozen=True, slots=True)
class AssistantText:
    text: str


type HistoryEntry = UserText | AssistantText | ToolCall | ToolOutput


@dataclass(frozen=True, slots=True)
class SessionInfo:
    session_id: str
    updated_at: str

    @property
    def label(self) -> str:
        try:
            when = datetime.fromisoformat(self.updated_at).strftime("%d %b %H:%M")
        except ValueError:
            when = self.updated_at
        return f"{self.session_id} · {when}"


def list_sessions() -> list[SessionInfo]:
    """Past conversations, most recently updated first.

    Read with a plain synchronous connection: the database is in WAL mode, so
    this never blocks the agent loop's writer. A session that has not stored a
    message yet has no row, since the SDK inserts it together with the items.
    """
    if not DB_PATH.exists():
        return []

    # Not opened read-only: SQLite needs write access to the -shm file of a
    # WAL database, even to read it.
    connection = sqlite3.connect(DB_PATH)
    try:
        rows = connection.execute(
            "SELECT session_id, updated_at FROM agent_sessions ORDER BY updated_at DESC"
        ).fetchall()
    except sqlite3.OperationalError:  # table not created yet
        return []
    finally:
        connection.close()

    return [
        SessionInfo(str(session_id), str(updated_at)) for session_id, updated_at in rows
    ]


def _content_text(content: object) -> str:
    """Flatten a message ``content`` field, which is a string or a list of parts."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for part in cast("list[Any]", content):
        if isinstance(part, str):
            parts.append(part)
        elif isinstance(part, dict):
            text = cast("dict[str, Any]", part).get("text")
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts)


def classify_history_item(item: TResponseInputItem) -> HistoryEntry | None:
    """Turn a stored item into something renderable, or ``None`` to skip it.

    Check ``type`` before ``role``: an assistant message carries both, while a
    user message carries only ``role``.
    """
    raw = cast("dict[str, Any]", item)
    item_type = raw.get("type")

    if item_type == "function_call":
        return ToolCall(
            call_id=str(raw.get("call_id", "")),
            name=str(raw.get("name", "tool")),
            arguments=str(raw.get("arguments", "")),
        )
    if item_type == "function_call_output":
        return ToolOutput(
            call_id=str(raw.get("call_id", "")),
            output=_content_text(raw.get("output")) or str(raw.get("output", "")),
        )
    if item_type in (None, "message"):
        text = _content_text(raw.get("content"))
        if not text:
            return None
        return AssistantText(text) if raw.get("role") == "assistant" else UserText(text)
    return None


def pretty_json(raw: str) -> str:
    """Best-effort pretty printing of a tool's JSON argument string."""
    try:
        return json.dumps(json.loads(raw), indent=2, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        return raw


class AgentWorker:
    """Owns the agent, its event loop thread and one session per conversation."""

    def __init__(self) -> None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_loop, name="agent-loop", daemon=True
        )
        self._thread.start()
        self._sessions: dict[str, AsyncSQLiteSession] = {}
        self._agent: Agent[None] = self._submit(self._build_agent()).result()

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def _submit(self, coro: Coroutine[Any, Any, T]) -> Future[T]:
        return asyncio.run_coroutine_threadsafe(coro, self._loop)

    async def _build_agent(self) -> Agent[None]:
        # Built on the loop thread so the client's connection pool binds here.
        return build_agent()

    def _session(self, session_id: str) -> AsyncSQLiteSession:
        session = self._sessions.get(session_id)
        if session is None:
            # Never close a cached session: close() is terminal in the SDK.
            session = AsyncSQLiteSession(session_id, db_path=DB_PATH)
            self._sessions[session_id] = session
        return session

    def history(self, session_id: str) -> list[HistoryEntry]:
        """Everything stored for a conversation, ready to render."""
        items = self._submit(self._history(session_id)).result()
        entries = (classify_history_item(item) for item in items)
        return [entry for entry in entries if entry is not None]

    async def _history(self, session_id: str) -> list[TResponseInputItem]:
        return await self._session(session_id).get_items()

    def start_turn(self, session_id: str, prompt: str) -> TurnQueue:
        """Kick off a turn and return the queue its events will arrive on.

        The queue always ends with ``None``. Drain it to the end: the SDK's run
        loop waits on the consumer between turns, so abandoning the stream
        stalls the background task and leaves the session half-written.
        """
        events: TurnQueue = queue.Queue()
        self._submit(self._turn(session_id, prompt, events))
        return events

    async def _turn(self, session_id: str, prompt: str, events: TurnQueue) -> None:
        try:
            session = self._session(session_id)
            result = Runner.run_streamed(self._agent, prompt, session=session)
            async for event in result.stream_events():
                if isinstance(event, RawResponsesStreamEvent):
                    data = event.data
                    if data.type == "response.output_text.delta":
                        events.put(TextDelta(data.delta))
                elif isinstance(event, RunItemStreamEvent):
                    item = event.item
                    if event.name == "tool_called" and isinstance(item, ToolCallItem):
                        events.put(
                            ToolCall(
                                call_id=item.call_id or "",
                                name=item.tool_name or "tool",
                                arguments=_raw_arguments(item),
                            )
                        )
                    elif event.name == "tool_output" and isinstance(
                        item, ToolCallOutputItem
                    ):
                        events.put(ToolOutput(item.call_id or "", str(item.output)))
            # final_output is only set once the stream is exhausted.
            events.put(TurnDone(str(result.final_output)))
        except BaseException as error:  # noqa: BLE001 - surfaced in the UI instead
            events.put(TurnFailed(error))
        finally:
            events.put(None)


def _raw_arguments(item: ToolCallItem) -> str:
    """The tool call's argument JSON, from either a dict or a pydantic raw item."""
    raw = item.raw_item
    if isinstance(raw, dict):
        return str(cast("dict[str, Any]", raw).get("arguments", ""))
    return str(getattr(raw, "arguments", ""))
