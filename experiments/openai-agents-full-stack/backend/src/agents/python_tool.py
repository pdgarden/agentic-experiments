"""A ``run_python`` tool backed by Monty, Pydantic's sandboxed Python interpreter.

Code runs in ``monty`` worker subprocesses with no filesystem, network or
environment access, under time and memory limits. Starting the worker pool
takes about a second, so one pool is started lazily on the first call and kept
for the life of the process; each call then checks out a fresh sandbox.

Copied from ``openai-agents-streamlit`` (experiments share no code). Errors in
the snippet come back as ``ToolErrorText`` so the UI can flag them.
"""

import asyncio

from agents.decorators import tool
from pydantic_monty import AsyncMonty, CollectString, MontyError, ResourceLimits

from src.agents.tool_errors import ToolErrorText, tool_error

LIMITS: ResourceLimits = {
    "max_feed_duration_secs": 5.0,
    "max_memory": 64 * 1024 * 1024,
}
MAX_OUTPUT_CHARS = 10_000

_pool: AsyncMonty | None = None
_pool_lock = asyncio.Lock()


async def _get_pool() -> AsyncMonty:
    """The shared pool, started on the calling loop the first time.

    The pool's worker I/O binds to the loop that entered it, so every call must
    come from that same loop: the server's single event loop.
    """
    global _pool
    async with _pool_lock:
        if _pool is None:
            pool = AsyncMonty(request_timeout=30)
            await pool.__aenter__()
            _pool = pool
    return _pool


async def close_sandbox() -> None:
    """Shut down the worker pool, if it was started."""
    global _pool
    if _pool is not None:
        pool, _pool = _pool, None
        await pool.__aexit__(None, None, None)


def _truncate(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    dropped = len(text) - MAX_OUTPUT_CHARS
    return f"{text[:MAX_OUTPUT_CHARS]}\n… [truncated {dropped} chars]"


@tool(failure_error_function=tool_error)
async def run_python(code: str) -> str:
    """Run a Python snippet in a sandbox and return its printed output and result.

    The value of the last expression is returned, like in a REPL. Each call
    starts from a clean state: nothing persists between calls. Only part of the
    standard library is available (e.g. math, json, re, datetime, collections,
    itertools, random), with no third-party packages and no file or network
    access; use it for computation and data manipulation. Execution is limited
    to 5 seconds and 64 MB.

    Args:
        code: Python source to execute.
    """
    pool = await _get_pool()
    output = CollectString(max_bytes=1024 * 1024)
    async with pool.checkout(limits=LIMITS) as session:
        try:
            result = await session.feed_run(code, print_callback=output)
        except MontyError as error:
            display = getattr(error, "display", None)
            message = display() if callable(display) else str(error)
            text = _truncate(f"{output.output}{type(error).__name__}:\n{message}")
            return ToolErrorText(text)

    parts: list[str] = []
    if output.output:
        parts.append(f"stdout:\n{output.output}")
    if result is not None:
        parts.append(f"result:\n{result!r}")
    return _truncate("\n".join(parts) or "(no output)")
