"""Artifacts and their immutable versions (`artifacts`, `artifact_versions`); deleted with their conversation."""

import json
import uuid
from datetime import UTC, datetime

import aiosqlite

from src.artifacts.models import (
    ArtifactDetail,
    ArtifactKind,
    ArtifactRecord,
    ArtifactVersion,
    ArtifactVersionInfo,
    ChartContent,
    TextContent,
    content_adapter,
)
from src.store.db import Database


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _record(row: aiosqlite.Row) -> ArtifactRecord:
    return ArtifactRecord(
        id=row["id"],
        conversation_id=row["conversation_id"],
        kind=row["kind"],
        title=row["title"],
        latest_version=row["latest_version"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class ArtifactStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def create(
        self,
        conversation_id: str,
        kind: ArtifactKind,
        title: str,
        content: ChartContent | TextContent,
        run_id: str | None,
    ) -> ArtifactRecord:
        """A new artifact with `content` as its version 1."""
        artifact_id = uuid.uuid4().hex
        now = _now()
        async with self._db.transaction() as conn:
            await conn.execute(
                "INSERT INTO artifacts (id, conversation_id, kind, title, latest_version, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, 1, ?, ?)",
                (artifact_id, conversation_id, kind, title, now, now),
            )
            await self._insert_version(conn, artifact_id, 1, run_id, title, content, now)
        return ArtifactRecord(
            id=artifact_id,
            conversation_id=conversation_id,
            kind=kind,
            title=title,
            latest_version=1,
            created_at=now,
            updated_at=now,
        )

    async def add_version(
        self,
        artifact_id: str,
        conversation_id: str,
        content: ChartContent | TextContent,
        run_id: str | None,
        *,
        title: str | None = None,
    ) -> ArtifactRecord | None:
        """Append a version; `None` if the conversation has no such artifact. The kind cannot change."""
        now = _now()
        async with self._db.transaction() as conn:
            async with conn.execute(
                "SELECT * FROM artifacts WHERE id = ? AND conversation_id = ?", (artifact_id, conversation_id)
            ) as cur:
                row = await cur.fetchone()
            if row is None:
                return None
            record = _record(row)
            if record.kind != content.kind:
                raise ValueError(f"Artifact {artifact_id} is a {record.kind}, not a {content.kind}.")
            version = record.latest_version + 1
            new_title = title or record.title
            await conn.execute(
                "UPDATE artifacts SET latest_version = ?, title = ?, updated_at = ? WHERE id = ?",
                (version, new_title, now, artifact_id),
            )
            await self._insert_version(conn, artifact_id, version, run_id, new_title, content, now)
        return record.model_copy(update={"latest_version": version, "title": new_title, "updated_at": now})

    @staticmethod
    async def _insert_version(
        conn: aiosqlite.Connection,
        artifact_id: str,
        version: int,
        run_id: str | None,
        title: str,
        content: ChartContent | TextContent,
        now: str,
    ) -> None:
        await conn.execute(
            "INSERT INTO artifact_versions (artifact_id, version, run_id, title, content, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (artifact_id, version, run_id, title, content.model_dump_json(), now),
        )

    async def list_for_conversation(self, conversation_id: str) -> list[ArtifactRecord]:
        """Most recently updated first."""
        async with (
            self._db.reading() as conn,
            conn.execute(
                "SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY updated_at DESC, created_at DESC",
                (conversation_id,),
            ) as cur,
        ):
            return [_record(r) for r in await cur.fetchall()]

    async def get(self, artifact_id: str) -> ArtifactDetail | None:
        async with self._db.reading() as conn:
            async with conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)) as cur:
                row = await cur.fetchone()
            if row is None:
                return None
            async with conn.execute(
                "SELECT version, title, created_at FROM artifact_versions WHERE artifact_id = ? ORDER BY version",
                (artifact_id,),
            ) as cur:
                versions = [
                    ArtifactVersionInfo(version=r["version"], title=r["title"], created_at=r["created_at"])
                    for r in await cur.fetchall()
                ]
        return ArtifactDetail(**_record(row).model_dump(), versions=versions)

    async def get_version(self, artifact_id: str, version: int) -> ArtifactVersion | None:
        async with (
            self._db.reading() as conn,
            conn.execute(
                "SELECT v.version, v.title, v.content, v.created_at, a.kind FROM artifact_versions v"
                " JOIN artifacts a ON a.id = v.artifact_id WHERE v.artifact_id = ? AND v.version = ?",
                (artifact_id, version),
            ) as cur,
        ):
            row = await cur.fetchone()
        if row is None:
            return None
        return ArtifactVersion(
            artifact_id=artifact_id,
            version=row["version"],
            title=row["title"],
            created_at=row["created_at"],
            kind=row["kind"],
            content=content_adapter.validate_python(json.loads(row["content"])),
        )
