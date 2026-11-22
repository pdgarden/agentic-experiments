"""The app's SQLite database (`data/app.db`): one connection, WAL, numbered `.sql` migrations."""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


class Database:
    """One shared connection; `transaction()` serialises writers so check-then-write steps are atomic."""

    def __init__(self, conn: aiosqlite.Connection) -> None:
        self.conn = conn
        self._lock = asyncio.Lock()

    @classmethod
    async def open(cls, path: Path | str) -> "Database":
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        conn = await aiosqlite.connect(path)
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.execute("PRAGMA busy_timeout=5000")
        db = cls(conn)
        await db.migrate()
        return db

    async def close(self) -> None:
        await self.conn.close()

    async def migrate(self) -> None:
        async with self.conn.execute("PRAGMA user_version") as cur:
            row = await cur.fetchone()
        version = int(row[0]) if row else 0
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            number = int(path.name.split("_", 1)[0])
            if number <= version:
                continue
            await self.conn.executescript(f"BEGIN;\n{path.read_text()}\nPRAGMA user_version = {number};\nCOMMIT;")

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[aiosqlite.Connection]:
        async with self._lock:
            await self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                await self.conn.rollback()
                raise
            await self.conn.commit()

    @asynccontextmanager
    async def reading(self) -> AsyncGenerator[aiosqlite.Connection]:
        """Reads take the same lock, so they never see a transaction that is still open on the shared connection."""
        async with self._lock:
            yield self.conn
