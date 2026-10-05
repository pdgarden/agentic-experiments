"""App data access: sessions, runs and their events.

The agent's own input-item history lives in the SDK's tables, see
``src.runs.sdk_sessions``; this module never reads or writes them.
"""

import sqlite3
import uuid
from datetime import UTC, datetime

import aiosqlite
from pydantic import BaseModel, TypeAdapter

from src.events import (
    Event,
    FinalRunStatus,
    RunFinished,
    RunStatus,
    Usage,
    event_adapter,
)
from src.parts import InputPart

_input_adapter: TypeAdapter[list[InputPart]] = TypeAdapter(list[InputPart])


class RunConflict(Exception):
    """The session already has a running run."""


class SessionRecord(BaseModel):
    id: str
    title: str
    current_agent: str
    created_at: str
    updated_at: str


class RunRecord(BaseModel):
    id: str
    session_id: str
    input: list[InputPart]
    status: RunStatus
    started_at: str
    ended_at: str | None
    usage: Usage | None
    error: str | None


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def new_id() -> str:
    return uuid.uuid4().hex


def _session(row: aiosqlite.Row) -> SessionRecord:
    return SessionRecord(
        id=row["id"],
        title=row["title"],
        current_agent=row["current_agent"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _run(row: aiosqlite.Row) -> RunRecord:
    usage = row["usage"]
    return RunRecord(
        id=row["id"],
        session_id=row["session_id"],
        input=_input_adapter.validate_json(row["input"]),
        status=row["status"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        usage=Usage.model_validate_json(usage) if usage else None,
        error=row["error"],
    )


class Store:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    async def _rows(
        self, sql: str, parameters: tuple[object, ...] = ()
    ) -> list[aiosqlite.Row]:
        """Run a query and fetch every row in one step on the connection's thread.

        Coroutines share this connection. A cursor iterated across awaits keeps a
        WAL read snapshot open, so a write interleaved on the same connection
        fails at once with "database is locked" once another connection (the SDK
        session's) has committed: ``busy_timeout`` does not apply to that case.
        """
        return list(await self._conn.execute_fetchall(sql, parameters))

    # Sessions

    async def create_session(self, agent: str, title: str = "") -> SessionRecord:
        stamp = now()
        record = SessionRecord(
            id=new_id(),
            title=title,
            current_agent=agent,
            created_at=stamp,
            updated_at=stamp,
        )
        await self._conn.execute(
            "INSERT INTO sessions (id, title, current_agent, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (record.id, record.title, agent, stamp, stamp),
        )
        return record

    async def list_sessions(self) -> list[SessionRecord]:
        rows = await self._rows("SELECT * FROM sessions ORDER BY updated_at DESC, id")
        return [_session(row) for row in rows]

    async def get_session(self, session_id: str) -> SessionRecord | None:
        rows = await self._rows("SELECT * FROM sessions WHERE id = ?", (session_id,))
        return _session(rows[0]) if rows else None

    async def rename_session(self, session_id: str, title: str) -> SessionRecord | None:
        await self._conn.execute(
            "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
            (title, now(), session_id),
        )
        return await self.get_session(session_id)

    async def set_title_if_empty(self, session_id: str, title: str) -> None:
        await self._conn.execute(
            "UPDATE sessions SET title = ? WHERE id = ? AND title = ''",
            (title, session_id),
        )

    async def set_current_agent(self, session_id: str, agent: str) -> None:
        await self._conn.execute(
            "UPDATE sessions SET current_agent = ?, updated_at = ? WHERE id = ?",
            (agent, now(), session_id),
        )

    async def delete_session(self, session_id: str) -> bool:
        """Hard delete; runs and events go with it (``ON DELETE CASCADE``)."""
        cursor = await self._conn.execute(
            "DELETE FROM sessions WHERE id = ?", (session_id,)
        )
        return cursor.rowcount > 0

    # Runs

    async def create_run(self, session_id: str, parts: list[InputPart]) -> RunRecord:
        """Insert a ``running`` run; raise ``RunConflict`` if one is active."""
        stamp = now()
        record = RunRecord(
            id=new_id(),
            session_id=session_id,
            input=parts,
            status="running",
            started_at=stamp,
            ended_at=None,
            usage=None,
            error=None,
        )
        try:
            await self._conn.execute(
                "INSERT INTO runs (id, session_id, input, status, started_at)"
                " VALUES (?, ?, ?, 'running', ?)",
                (
                    record.id,
                    session_id,
                    _input_adapter.dump_json(parts).decode(),
                    stamp,
                ),
            )
        except sqlite3.IntegrityError as error:
            # The partial unique index one_running_run_per_session.
            if "UNIQUE constraint failed: runs.session_id" in str(error):
                raise RunConflict(session_id)
            raise
        await self._conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?", (stamp, session_id)
        )
        return record

    async def get_run(self, run_id: str) -> RunRecord | None:
        rows = await self._rows("SELECT * FROM runs WHERE id = ?", (run_id,))
        return _run(rows[0]) if rows else None

    async def list_runs(self, session_id: str) -> list[RunRecord]:
        rows = await self._rows(
            "SELECT * FROM runs WHERE session_id = ? ORDER BY started_at, id",
            (session_id,),
        )
        return [_run(row) for row in rows]

    async def finish_run(
        self,
        run_id: str,
        status: FinalRunStatus,
        *,
        usage: Usage | None = None,
        error: str | None = None,
    ) -> None:
        await self._conn.execute(
            "UPDATE runs SET status = ?, ended_at = ?, usage = ?, error = ?"
            " WHERE id = ?",
            (
                status,
                now(),
                usage.model_dump_json() if usage else None,
                error,
                run_id,
            ),
        )

    async def interrupt_running_runs(self) -> list[str]:
        """Close runs left ``running`` by a previous process.

        Each gets a final ``run_finished{status: interrupted}`` event, so its
        event log reads as complete to the frontend.
        """
        rows = [
            (str(row[0]), int(row[1]))
            for row in await self._rows(
                "SELECT r.id, (SELECT COALESCE(MAX(e.seq), 0) FROM events e"
                " WHERE e.run_id = r.id) FROM runs r WHERE r.status = 'running'"
            )
        ]
        for run_id, last_seq in rows:
            await self.append_event(
                RunFinished(run_id=run_id, seq=last_seq + 1, status="interrupted")
            )
            await self.finish_run(run_id, "interrupted")
        return [run_id for run_id, _ in rows]

    # Events

    async def append_event(self, event: Event) -> None:
        await self._conn.execute(
            "INSERT INTO events (run_id, seq, type, payload, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (event.run_id, event.seq, event.type, event.model_dump_json(), now()),
        )

    async def list_events(self, run_id: str, after: int = 0) -> list[Event]:
        rows = await self._rows(
            "SELECT payload FROM events WHERE run_id = ? AND seq > ? ORDER BY seq",
            (run_id, after),
        )
        return [event_adapter.validate_json(row[0]) for row in rows]

    async def events_by_run(self, session_id: str) -> dict[str, list[Event]]:
        """Every event of a session's runs, grouped by run, in order."""
        grouped: dict[str, list[Event]] = {}
        rows = await self._rows(
            "SELECT e.run_id, e.payload FROM events e JOIN runs r ON r.id = e.run_id"
            " WHERE r.session_id = ? ORDER BY e.run_id, e.seq",
            (session_id,),
        )
        for row in rows:
            grouped.setdefault(row[0], []).append(event_adapter.validate_json(row[1]))
        return grouped
