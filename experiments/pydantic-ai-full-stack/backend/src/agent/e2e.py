"""The scripted model behind `MODEL_OVERRIDE=e2e`: deterministic, streams, thinks, and calls tools on cue.

- `slow` in the prompt makes it slow; thinking is streamed when the run asks for it.
- `chart` / `document` -> `create_artifact` (a bar chart / a Markdown note), then a short reply.
- `compute` -> `run_code` (`sum(range(10))`), then the result in the reply.
- Otherwise it echoes `You said: …`.
"""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import (
    AgentInfo,
    DeltaThinkingCalls,
    DeltaThinkingPart,
    DeltaToolCall,
    DeltaToolCalls,
    FunctionModel,
)

SLOW_MARKER = "slow"
TITLE_PREFIX = "Write a short title"

CHART_SPEC: dict[str, Any] = {
    "mark": "bar",
    "data": {"values": [{"team": "A", "wins": 3}, {"team": "B", "wins": 5}, {"team": "C", "wins": 2}]},
    "encoding": {"x": {"field": "team", "type": "nominal"}, "y": {"field": "wins", "type": "quantitative"}},
}


def _last_prompt(messages: list[ModelMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, ModelRequest):
            for part in message.parts:
                if isinstance(part, UserPromptPart):
                    content = part.content
                    return content if isinstance(content, str) else " ".join(c for c in content if isinstance(c, str))
    return ""


def _tool_returns(messages: list[ModelMessage]) -> list[ToolReturnPart]:
    """Results of the tool calls answered in the latest request (this turn's tool round)."""
    if not messages or not isinstance(messages[-1], ModelRequest):
        return []
    return [p for p in messages[-1].parts if isinstance(p, ToolReturnPart)]


def _scripted_tool_call(prompt: str) -> tuple[str, dict[str, Any]] | None:
    lowered = prompt.lower()
    if "chart" in lowered:
        return "create_artifact", {"kind": "chart", "title": "Wins by team", "content": json.dumps(CHART_SPEC)}
    if "document" in lowered:
        return "create_artifact", {"kind": "text", "title": "Notes", "content": "# Notes\n\nA scripted document."}
    if "compute" in lowered:
        return "run_code", {"code": "sum(range(10))"}
    return None


def _reply(messages: list[ModelMessage]) -> str | tuple[str, dict[str, Any]]:
    """Text to answer with, or a tool call to make first."""
    prompt = _last_prompt(messages)
    returns = _tool_returns(messages)
    if returns:
        result = returns[0]
        if result.tool_name == "run_code":
            return f"The result is {result.model_response_str()}."
        return "Here it is."
    call = _scripted_tool_call(prompt)
    if call is not None:
        return call
    return f"You said: {prompt}"


async def _stream(
    messages: list[ModelMessage], info: AgentInfo
) -> AsyncIterator[str | DeltaThinkingCalls | DeltaToolCalls]:
    if info.instructions and info.instructions.startswith(TITLE_PREFIX):
        yield "E2E title"
        return
    if info.model_request_parameters.thinking:
        yield {0: DeltaThinkingPart(content="Thinking about it.")}
    reply = _reply(messages)
    if isinstance(reply, tuple):
        name, args = reply
        yield {1: DeltaToolCall(name=name, json_args=json.dumps(args))}
        return
    prompt = _last_prompt(messages)
    words = reply.split(" ")
    if SLOW_MARKER in prompt:
        words = words + ["tick"] * 40
    for word in words:
        if SLOW_MARKER in prompt:
            await asyncio.sleep(0.1)
        yield word + " "


def _respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    if info.instructions and info.instructions.startswith(TITLE_PREFIX):
        return ModelResponse(parts=[TextPart(content="E2E title")])
    reply = _reply(messages)
    if isinstance(reply, tuple):
        return ModelResponse(parts=[ToolCallPart(tool_name=reply[0], args=reply[1])])
    return ModelResponse(parts=[TextPart(content=reply)])


def scripted_model() -> FunctionModel:
    return FunctionModel(_respond, stream_function=_stream, model_name="e2e", profile={"supports_thinking": True})
