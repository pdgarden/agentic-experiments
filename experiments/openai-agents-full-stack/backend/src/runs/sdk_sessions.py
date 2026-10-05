"""The SDK's ``AsyncSQLiteSession`` per app session: the model's memory only.

It shares the app's database file but owns its own tables and connection.
"""

from pathlib import Path

from agents.extensions.memory import AsyncSQLiteSession


class SdkSessions:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._sessions: dict[str, AsyncSQLiteSession] = {}

    def get(self, session_id: str) -> AsyncSQLiteSession:
        session = self._sessions.get(session_id)
        if session is None:
            # Cached for the process: close() is terminal in the SDK.
            session = AsyncSQLiteSession(session_id, db_path=self._db_path)
            self._sessions[session_id] = session
        return session

    async def delete(self, session_id: str) -> None:
        session = self.get(session_id)
        await session.clear_session()
        await session.close()
        del self._sessions[session_id]

    async def close(self) -> None:
        for session in self._sessions.values():
            await session.close()
        self._sessions.clear()
