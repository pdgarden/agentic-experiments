import json
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, DeltaToolCalls, FunctionModel


def user_message(text: str, *, message_id: str = "u1", files: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    parts: list[dict[str, Any]] = [{"type": "text", "text": text}]
    parts += files or []
    return {"id": message_id, "role": "user", "parts": parts}


def chat_body(conversation_id: str, *messages: dict[str, Any]) -> dict[str, Any]:
    return {"trigger": "submit-message", "id": conversation_id, "messages": list(messages)}


def parse_sse(text: str) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for block in text.split("\n\n"):
        if not block.startswith("data: "):
            continue
        payload = block.removeprefix("data: ")
        if payload == "[DONE]":
            chunks.append({"type": "[DONE]"})
        else:
            chunks.append(json.loads(payload))
    return chunks


async def create_conversation(
    client: httpx.AsyncClient, conversation_id: str, *, model_id: str = "gpt", thinking: str = "off"
) -> None:
    r = await client.put(f"/api/conversations/{conversation_id}", json={"model_id": model_id, "thinking": thinking})
    assert r.status_code == 200, r.text


async def chat(client: httpx.AsyncClient, conversation_id: str, text: str, **kw: Any) -> list[dict[str, Any]]:
    r = await client.post("/api/chat", json=chat_body(conversation_id, user_message(text, **kw)))
    assert r.status_code == 200, r.text
    return parse_sse(r.text)


def text_of(chunks: list[dict[str, Any]]) -> str:
    return "".join(c["delta"] for c in chunks if c["type"] == "text-delta")


def streaming(respond: Callable[[list[ModelMessage], AgentInfo], ModelResponse]) -> FunctionModel:
    """A `FunctionModel` that also streams (the adapter always streams): text parts as text, tool calls as deltas."""

    async def stream(messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[str | DeltaToolCalls]:
        for index, part in enumerate(respond(messages, info).parts):
            if isinstance(part, TextPart):
                yield part.content
            elif isinstance(part, ToolCallPart):
                yield {index: DeltaToolCall(name=part.tool_name, json_args=part.args_as_json_str())}

    return FunctionModel(respond, stream_function=stream)
