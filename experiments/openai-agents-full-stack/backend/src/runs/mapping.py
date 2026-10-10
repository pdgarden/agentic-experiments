"""SDK stream events → app events. The only place that knows SDK event types."""

from typing import Any, cast

from agents import (
    AgentUpdatedStreamEvent,
    RawResponsesStreamEvent,
    StreamEvent,
    ToolCallItem,
    ToolCallOutputItem,
)

from src.agents.tool_errors import ToolErrorText
from src.events import AgentChanged, Event, TextDelta, ToolCall, ToolResult


class EventMapper:
    """Stateful translator for one run.

    It tracks the current text segment, so text interrupted by a tool call or
    an agent change becomes separate parts, and the current agent, so the SDK's
    initial ``agent_updated`` event is not reported as a change.
    """

    def __init__(self, agent: str) -> None:
        self.agent = agent
        self._segments = 0
        self._segment_open = False

    def map(self, event: StreamEvent) -> list[Event]:
        if isinstance(event, RawResponsesStreamEvent):
            data = event.data
            if data.type == "response.output_text.delta" and data.delta:
                return [TextDelta(segment_id=self._segment_id(), delta=data.delta)]
            return []

        if isinstance(event, AgentUpdatedStreamEvent):
            name = event.new_agent.name
            if name == self.agent:
                return []
            self.agent = name
            self._segment_open = False
            return [AgentChanged(agent=name)]

        item = event.item
        if event.name == "tool_called" and isinstance(item, ToolCallItem):
            self._segment_open = False
            return [
                ToolCall(
                    call_id=_call_id(item.raw_item),
                    name=item.tool_name or "tool",
                    args=_arguments(item.raw_item),
                )
            ]
        if event.name == "tool_output" and isinstance(item, ToolCallOutputItem):
            self._segment_open = False
            output: object = item.output
            return [
                ToolResult(
                    call_id=item.call_id or "",
                    result=_output_text(output),
                    is_error=isinstance(output, ToolErrorText),
                )
            ]
        return []

    def _segment_id(self) -> str:
        if not self._segment_open:
            self._segments += 1
            self._segment_open = True
        return f"s{self._segments}"


def _field(raw: object, name: str) -> object:
    if isinstance(raw, dict):
        return cast("dict[str, Any]", raw).get(name)
    return getattr(raw, name, None)


def _call_id(raw: object) -> str:
    value = _field(raw, "call_id") or _field(raw, "id")
    return str(value) if value is not None else ""


def _output_text(output: object) -> str:
    """A tool output as text. Function tools return strings; MCP tools return
    ``{"type": "text" | "image", ...}`` items, alone or in a list.
    """
    if isinstance(output, str):
        return output
    if isinstance(output, list):
        items = cast("list[object]", output)
        return "\n".join(_output_text(item) for item in items)
    kind = _field(output, "type")
    if kind == "text":
        return str(_field(output, "text") or "")
    if kind == "image":
        return "[image]"
    return str(output)


def _arguments(raw: object) -> str:
    """The call's argument JSON, from either a dict or a pydantic raw item."""
    value = _field(raw, "arguments")
    return value if isinstance(value, str) else ""
