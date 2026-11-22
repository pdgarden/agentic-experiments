"""`SqliteConversationStore`: Pydantic AI's `ConversationStore` on the app database.

Records go to `conversation_records` (queryable columns + the rest of the record as JSON), messages to
`conversation_entries` (a tree: each entry points at its parent). `read_history` walks a branch with one
recursive CTE instead of one query per entry.
"""

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from pydantic import TypeAdapter
from pydantic_ai.conversation_store import (
    ConversationConflict,
    ConversationDetails,
    ConversationEntry,
    ConversationRecord,
    ConversationStore,
)
from pydantic_ai.messages import ModelMessage

from src.store.db import Database

_record_adapter = TypeAdapter(ConversationRecord)
_message_adapter: TypeAdapter[ModelMessage] = TypeAdapter(ModelMessage)


def _now() -> str:
    return datetime.now(UTC).isoformat()


class SqliteConversationStore(ConversationStore):
    """Entries are kept on delete when another record's history still reaches them; otherwise they are deleted."""

    def __init__(self, db: Database) -> None:
        self._db = db

    # --- rows <-> records -------------------------------------------------------------------------------

    @staticmethod
    def _record_from_row(row: Any) -> ConversationRecord:
        record = _record_adapter.validate_json(row["record"])
        record.title = row["title"]
        record.metadata = json.loads(row["metadata"]) if row["metadata"] is not None else None
        return record

    @staticmethod
    def _entry_from_row(row: Any) -> ConversationEntry:
        return ConversationEntry(
            id=row["id"], parent_id=row["parent_id"], message=_message_adapter.validate_json(row["message"])
        )

    # --- primitives --------------------------------------------------------------------------------------

    async def read_record(self, conversation_id: str) -> ConversationRecord | None:
        async with self._db.reading() as conn:
            cur = await conn.execute("SELECT * FROM conversation_records WHERE conversation_id = ?", (conversation_id,))
            row = await cur.fetchone()
        return self._record_from_row(row) if row else None

    async def read_records(self, *, scope: str | None = None, limit: int | None = None) -> Sequence[ConversationRecord]:
        sql = "SELECT * FROM conversation_records"
        params: list[Any] = []
        if scope is not None:
            sql += " WHERE scope = ?"
            params.append(scope)
        sql += " ORDER BY updated_at DESC"
        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)
        async with self._db.reading() as conn:
            cur = await conn.execute(sql, params)
            rows = await cur.fetchall()
        return [self._record_from_row(r) for r in rows]

    async def write_record(
        self,
        record: ConversationRecord,
        *,
        new_entries: Sequence[ConversationEntry] = (),
        expected_revision: str | None,
    ) -> None:
        cid = record.conversation_id
        async with self._db.transaction() as conn:
            cur = await conn.execute("SELECT revision FROM conversation_records WHERE conversation_id = ?", (cid,))
            row = await cur.fetchone()
            if (row["revision"] if row else None) != expected_revision:
                raise ConversationConflict(cid)
            new_ids = {e.id for e in new_entries}
            if record.head_id is not None and record.head_id not in new_ids:
                cur = await conn.execute("SELECT 1 FROM conversation_entries WHERE id = ?", (record.head_id,))
                if await cur.fetchone() is None:
                    raise ConversationConflict(cid)
            await conn.executemany(
                "INSERT OR IGNORE INTO conversation_entries (id, parent_id, message) VALUES (?, ?, ?)",
                [(e.id, e.parent_id, _message_adapter.dump_json(e.message).decode()) for e in new_entries],
            )
            record_json = _record_adapter.dump_json(record).decode()
            updated_at = record.updated_at.isoformat()
            if row is None:
                await conn.execute(
                    "INSERT INTO conversation_records (conversation_id, revision, head_id, scope, title, metadata,"
                    " updated_at, created_at, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        cid,
                        record.revision,
                        record.head_id,
                        record.scope,
                        record.title,
                        json.dumps(record.metadata) if record.metadata is not None else None,
                        updated_at,
                        _now(),
                        record_json,
                    ),
                )
            else:
                # Title and metadata are only changed by `write_details`, so a save never undoes an update.
                await conn.execute(
                    "UPDATE conversation_records SET revision = ?, head_id = ?, scope = ?, updated_at = ?, record = ?"
                    " WHERE conversation_id = ?",
                    (record.revision, record.head_id, record.scope, updated_at, record_json, cid),
                )

    async def write_details(
        self,
        conversation_id: str,
        details: ConversationDetails,
        *,
        expected_revision: str,
        expected: ConversationDetails | None = None,
    ) -> ConversationRecord:
        async with self._db.transaction() as conn:
            cur = await conn.execute("SELECT * FROM conversation_records WHERE conversation_id = ?", (conversation_id,))
            row = await cur.fetchone()
            if row is None or row["revision"] != expected_revision:
                raise ConversationConflict(conversation_id)
            stored = self._record_from_row(row)
            if expected and any(getattr(stored, key) != value for key, value in expected.items()):
                raise ConversationConflict(conversation_id)
            if "title" in details:
                stored.title = details["title"]
                await conn.execute(
                    "UPDATE conversation_records SET title = ? WHERE conversation_id = ?",
                    (stored.title, conversation_id),
                )
            if "metadata" in details:
                stored.metadata = details["metadata"]
                await conn.execute(
                    "UPDATE conversation_records SET metadata = ? WHERE conversation_id = ?",
                    (json.dumps(stored.metadata) if stored.metadata is not None else None, conversation_id),
                )
        return stored

    async def delete_record(self, conversation_id: str, *, expected_revision: str) -> None:
        async with self._db.transaction() as conn:
            cur = await conn.execute(
                "SELECT revision FROM conversation_records WHERE conversation_id = ?", (conversation_id,)
            )
            row = await cur.fetchone()
            if row is None or row["revision"] != expected_revision:
                raise ConversationConflict(conversation_id)
            await conn.execute("DELETE FROM conversation_records WHERE conversation_id = ?", (conversation_id,))
            # Keep every entry a remaining record's head or branch reaches; delete the rest.
            cur = await conn.execute("SELECT head_id, record FROM conversation_records")
            roots: list[str] = []
            for r in await cur.fetchall():
                if r["head_id"]:
                    roots.append(r["head_id"])
                roots.extend(json.loads(r["record"]).get("branches") or [])
            await conn.execute("CREATE TEMP TABLE IF NOT EXISTS _roots (id TEXT PRIMARY KEY)")
            await conn.execute("DELETE FROM _roots")
            await conn.executemany("INSERT OR IGNORE INTO _roots (id) VALUES (?)", [(r,) for r in roots])
            await conn.execute(
                """
                WITH RECURSIVE reachable(id) AS (
                    SELECT id FROM _roots
                    UNION
                    SELECT e.parent_id FROM conversation_entries e JOIN reachable r ON e.id = r.id
                    WHERE e.parent_id IS NOT NULL
                )
                DELETE FROM conversation_entries WHERE id NOT IN (SELECT id FROM reachable)
                """
            )
            await conn.execute("DELETE FROM _roots")

    async def read_entry(self, entry_id: str) -> ConversationEntry:
        async with self._db.reading() as conn:
            cur = await conn.execute("SELECT * FROM conversation_entries WHERE id = ?", (entry_id,))
            row = await cur.fetchone()
        if row is None:
            raise LookupError(entry_id)
        return self._entry_from_row(row)

    async def read_history(self, head_id: str | None, *, limit: int | None = None) -> list[ConversationEntry]:
        if head_id is None or limit == 0:
            return []
        async with self._db.reading() as conn:
            cur = await conn.execute(
                """
                WITH RECURSIVE chain(id, parent_id, message, depth) AS (
                    SELECT id, parent_id, message, 0 FROM conversation_entries WHERE id = ?
                    UNION ALL
                    SELECT e.id, e.parent_id, e.message, c.depth + 1
                    FROM conversation_entries e JOIN chain c ON e.id = c.parent_id
                    WHERE ? IS NULL OR c.depth + 1 < ?
                )
                SELECT id, parent_id, message FROM chain ORDER BY depth DESC
                """,
                (head_id, limit, limit),
            )
            rows = await cur.fetchall()
        if not rows:
            raise LookupError(head_id)
        entries = [self._entry_from_row(r) for r in rows]
        if limit is None and entries[0].parent_id is not None:
            raise LookupError(entries[0].parent_id)  # a broken chain: an entry was released under us
        return entries
