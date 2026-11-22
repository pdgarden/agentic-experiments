"""Uploaded files: bytes in `data/files/<id>`, a row in `files`."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from src.store.db import Database

ALLOWED_MEDIA_TYPES = frozenset(
    {
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "application/pdf",
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/json",
    }
)
TEXT_MEDIA_TYPES = frozenset({"text/plain", "text/markdown", "text/csv", "application/json"})
"""Inlined into the prompt as text: chat-completions models don't read these as files."""


@dataclass
class StoredFile:
    id: str
    conversation_id: str | None
    filename: str
    media_type: str
    size: int


class FileStore:
    def __init__(self, db: Database, directory: Path) -> None:
        self._db = db
        self._dir = directory
        directory.mkdir(parents=True, exist_ok=True)

    def path(self, file_id: str) -> Path:
        return self._dir / file_id

    async def add(self, *, filename: str, media_type: str, data: bytes, conversation_id: str | None) -> StoredFile:
        file = StoredFile(
            id=uuid.uuid4().hex,
            conversation_id=conversation_id,
            filename=filename,
            media_type=media_type,
            size=len(data),
        )
        self.path(file.id).write_bytes(data)
        async with self._db.transaction() as conn:
            await conn.execute(
                "INSERT INTO files (id, conversation_id, filename, media_type, size, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (file.id, conversation_id, filename, media_type, file.size, datetime.now(UTC).isoformat()),
            )
        return file

    async def get(self, file_id: str) -> StoredFile | None:
        async with self._db.reading() as conn:
            cur = await conn.execute("SELECT * FROM files WHERE id = ?", (file_id,))
            row = await cur.fetchone()
        if row is None:
            return None
        return StoredFile(
            id=row["id"],
            conversation_id=row["conversation_id"],
            filename=row["filename"],
            media_type=row["media_type"],
            size=row["size"],
        )

    def read(self, file_id: str) -> bytes:
        return self.path(file_id).read_bytes()

    async def delete_for_conversation(self, conversation_id: str) -> None:
        async with self._db.transaction() as conn:
            cur = await conn.execute("SELECT id FROM files WHERE conversation_id = ?", (conversation_id,))
            ids = [r["id"] for r in await cur.fetchall()]
            await conn.execute("DELETE FROM files WHERE conversation_id = ?", (conversation_id,))
        for file_id in ids:
            self.path(file_id).unlink(missing_ok=True)
