"""SQLite connection and the ``PRAGMA user_version`` migration runner.

Migrations are ``migrations/NNN_name.sql`` files applied in order, each in its
own transaction together with the version bump. They never touch the tables
owned by the SDK's ``AsyncSQLiteSession`` (``agent_sessions``,
``agent_messages``), which creates and manages its own schema.
"""

import re
from pathlib import Path

import aiosqlite

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_MIGRATION_NAME = re.compile(r"^(\d+)_\w+\.sql$")


def migration_files() -> list[tuple[int, Path]]:
    found: list[tuple[int, Path]] = []
    for path in MIGRATIONS_DIR.iterdir():
        match = _MIGRATION_NAME.match(path.name)
        if match:
            found.append((int(match.group(1)), path))
    found.sort()
    versions = [version for version, _ in found]
    if versions != list(range(1, len(found) + 1)):
        raise RuntimeError(f"Migrations must be numbered 1..n without gaps: {versions}")
    return found


async def migrate(conn: aiosqlite.Connection) -> int:
    """Apply pending migrations and return the resulting schema version."""
    async with conn.execute("PRAGMA user_version") as cursor:
        row = await cursor.fetchone()
    current = int(row[0]) if row else 0
    for version, path in migration_files():
        if version <= current:
            continue
        # executescript commits any open transaction first, then runs the
        # script as-is: BEGIN/COMMIT make the migration and its bump atomic.
        sql = path.read_text(encoding="utf-8")
        await conn.executescript(
            f"BEGIN;\n{sql}\nPRAGMA user_version = {version};\nCOMMIT;"
        )
        current = version
    return current


async def connect(db_path: Path) -> aiosqlite.Connection:
    """Open the app database in WAL mode, with foreign keys on, and migrate it.

    The connection is in autocommit mode: every statement is its own
    transaction unless wrapped in an explicit ``BEGIN``.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = await aiosqlite.connect(db_path, isolation_level=None)
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode = WAL")
    await conn.execute("PRAGMA foreign_keys = ON")
    await conn.execute("PRAGMA busy_timeout = 5000")
    await migrate(conn)
    return conn
