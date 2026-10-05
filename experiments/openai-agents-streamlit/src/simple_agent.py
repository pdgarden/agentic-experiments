"""Minimal one-shot example: a single turn against a stored conversation."""

import asyncio

from agents import Runner
from agents.extensions.memory import AsyncSQLiteSession

from src.agent_config import DB_PATH, build_agent, setup_observability
from src.python_sandbox import close_sandbox


async def main() -> None:
    setup_observability()
    agent = build_agent()
    session = AsyncSQLiteSession("session_id_0", db_path=DB_PATH)
    result = await Runner.run(agent, "What was my previous message?", session=session)
    print(result.final_output)
    await session.close()
    await close_sandbox()


if __name__ == "__main__":
    # Only needed for this script; the Streamlit app must not inherit the patch,
    # since nest_asyncio replaces asyncio.run with a version that never closes
    # its loop and swaps in the pure-Python Task/Future implementations.
    import nest_asyncio

    nest_asyncio.apply()  # pyright: ignore[reportUnknownMemberType]
    asyncio.run(main())
