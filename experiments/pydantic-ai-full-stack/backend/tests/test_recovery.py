"""Cancel mid-tool-call, and crash recovery from the step store."""

import asyncio
import json
import sqlite3
from collections.abc import AsyncIterator

import httpx
import pytest
from pydantic_ai import Tool
from pydantic_ai.conversation import Conversation
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, DeltaToolCalls, FunctionModel

from src.agent.build import ConversationSettings, Deps
from src.app import create_app
from src.services import Services, get_services
from src.settings import Settings
from tests.helpers import chat_body, create_conversation, parse_sse, user_message


def _tool_then_text(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    if any(isinstance(p, ToolReturnPart) for p in last.parts):
        return ModelResponse(parts=[TextPart(content="done after tool")])
    return ModelResponse(parts=[ToolCallPart(tool_name="side_effect", args={"x": 1}, tool_call_id="call-1")])


async def test_cancel_mid_tool_call(client: httpx.AsyncClient, services: Services) -> None:
    started = asyncio.Event()

    async def side_effect(x: int) -> str:
        started.set()
        await asyncio.sleep(30)
        return f"ran {x}"

    await create_conversation(client, "c1")
    model = tool_model()
    with services.chat.agent.override(model=model, tools=[Tool(side_effect)]):
        body = json.dumps(chat_body("c1", user_message("use the tool"))).encode()
        buffer = await services.chat.start(body)
        await asyncio.wait_for(started.wait(), 5)
        assert services.runs.cancel("c1")
        chunks = parse_sse("".join([c async for c in buffer.subscribe()]))
    assert any(c["type"] == "abort" for c in chunks)
    conversation = await services.store.load("c1")
    assert conversation is not None
    # What the store holds after a cancel mid-tool-call: the prompt, the call, and the empty request the
    # tool's result would have gone into, marked interrupted. The tool is not re-run on the next turn.
    assert [m.kind for m in conversation.messages] == ["request", "response", "request"]
    call = conversation.messages[1].parts[0]
    assert isinstance(call, ToolCallPart) and call.tool_name == "side_effect"
    pending = conversation.messages[2]
    assert isinstance(pending, ModelRequest) and pending.parts == [] and pending.state == "interrupted"

    ran: list[int] = []

    def side_effect_fast(x: int) -> str:
        ran.append(x)
        return "ok"

    with services.chat.agent.override(model=tool_model(), tools=[Tool(side_effect_fast, name="side_effect")]):
        body = json.dumps(chat_body("c1", user_message("anything else?", message_id="u2"))).encode()
        buffer = await services.chat.start(body)
        chunks = parse_sse("".join([c async for c in buffer.subscribe()]))
    assert not any(c["type"] == "error" for c in chunks), chunks
    assert ran == []  # the cancelled call is closed out, never replayed


async def _stream_tool_then_text(messages: list[ModelMessage], _info: AgentInfo) -> AsyncIterator[str | DeltaToolCalls]:
    if any(isinstance(p, ToolReturnPart) for p in messages[-1].parts):
        yield "done after tool"
    else:
        yield {0: DeltaToolCall(name="side_effect", json_args='{"x": 1}', tool_call_id="call-1")}


def tool_model() -> FunctionModel:
    return FunctionModel(_tool_then_text, stream_function=_stream_tool_then_text)


class Crash(BaseException):
    """Stands in for the process dying mid-tool-call."""


async def test_crash_recovery_flags_and_continues(settings: Settings) -> None:
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        services = get_services()
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        await create_conversation(client, "c1")

        async def side_effect(x: int) -> str:
            raise Crash(x)

        model = tool_model()
        loaded = await services.store.load("c1")
        assert loaded is not None
        with services.chat.agent.override(model=model, tools=[Tool(side_effect)]), pytest.raises(Crash):
            await services.chat.agent.run(
                "use the tool",
                conversation=loaded,
                model="gpt",
                deps=Deps(conversation_id="c1", settings=ConversationSettings(model_id="gpt")),
            )
        # nothing reached the conversation store: the adapter saves only finished runs
        conversation = await services.store.load("c1")
        assert conversation is not None and conversation.messages == []
        # The harness writes `run_failed` even for a BaseException; a killed process writes nothing. Drop it.
        with sqlite3.connect(settings.steps_db) as conn:
            conn.execute("DELETE FROM events WHERE kind IN ('run_failed', 'run_completed')")

    # restart: recovery saves what the run completed and flags the conversation
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        services = get_services()
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        info = (await client.get("/api/conversations/c1")).json()
        assert info["interrupted"] is not None
        assert [t["tool_name"] for t in info["interrupted"]["unresolved_tools"]] == ["side_effect"]
        messages = (await client.get("/api/conversations/c1/messages")).json()["messages"]
        assert messages[0]["role"] == "user"

        # Continue: a run with no new user message; the flag is cleared
        with services.chat.agent.override(model=tool_model(), tools=[Tool(lambda x: f"ok {x}", name="side_effect")]):  # pyright: ignore[reportUnknownLambdaType, reportUnknownArgumentType]
            buffer = await services.chat.continue_run("c1")
            chunks = parse_sse("".join([c async for c in buffer.subscribe()]))
        assert any(c["type"] == "text-delta" and "done after tool" in c["delta"] for c in chunks), chunks
        info = (await client.get("/api/conversations/c1")).json()
        assert info["interrupted"] is None

    # a third start does not flag it again
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        assert (await client.get("/api/conversations/c1")).json()["interrupted"] is None


async def test_cancelled_run_is_not_flagged_after_restart(settings: Settings) -> None:
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        services = get_services()
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        await create_conversation(client, "c1")
        buffer = await services.chat.start(json.dumps(chat_body("c1", user_message("slow please"))).encode())
        await asyncio.sleep(0.3)
        services.runs.cancel("c1")
        _ = [c async for c in buffer.subscribe()]
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        assert (await client.get("/api/conversations/c1")).json()["interrupted"] is None


async def test_unused_conversation_api(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "c1")
    assert (await client.patch("/api/conversations/c1", json={"title": "Renamed"})).json()["title"] == "Renamed"
    assert (await client.delete("/api/conversations/c1")).status_code == 204
    assert (await client.get("/api/conversations/c1")).status_code == 404
    assert (await client.put("/api/conversations/c2", json={"model_id": "nope"})).status_code == 422
    _ = Conversation
