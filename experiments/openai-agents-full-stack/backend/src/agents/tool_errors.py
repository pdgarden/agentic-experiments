"""Marking tool outputs as errors without changing what the model sees.

The SDK turns a tool exception into a plain string for the model, so nothing
on the output item says it failed. ``ToolErrorText`` is a ``str`` subclass:
the model gets the text unchanged, and the event mapper checks its type to
emit ``tool_result{is_error: true}``.
"""

from typing import Any

from agents import RunContextWrapper


class ToolErrorText(str):
    """A tool output that reports a failure."""


def tool_error(ctx: RunContextWrapper[Any], error: Exception) -> str:  # noqa: ARG001
    """``failure_error_function`` for every tool: report the error, flagged."""
    return ToolErrorText(f"{type(error).__name__}: {error}")
