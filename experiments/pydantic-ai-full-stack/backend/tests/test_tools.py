"""Phase 2 tools through the real app: artifacts, code mode, web tools (registration only, never the network)."""

import json
from typing import Any

import httpx
import pytest
from pydantic_ai.conversation import Conversation
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from src.agent.e2e import CHART_SPEC, TITLE_PREFIX
from src.artifacts.chart import ChartSpecError
from src.artifacts.models import ChartContent, TextContent, parse_content
from src.services import Services
from src.settings import Settings
from src.store.artifacts import ArtifactStore
from src.store.conversations import SqliteConversationStore
from src.store.db import Database
from src.tools.web import web_capabilities
from tests.helpers import chat, create_conversation, streaming, text_of


def _tool_chunks(chunks: list[dict[str, Any]], chunk_type: str) -> list[dict[str, Any]]:
    return [c for c in chunks if c["type"] == chunk_type]


async def test_chart_artifact_is_created_streamed_and_reloadable(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "c1")
    chunks = await chat(client, "c1", "make a chart")

    [call] = _tool_chunks(chunks, "tool-input-available")
    assert call["toolName"] == "create_artifact"
    [event] = _tool_chunks(chunks, "data-artifact")
    assert event["data"] == {
        "artifact_id": event["data"]["artifact_id"],
        "version": 1,
        "kind": "chart",
        "title": "Wins by team",
        "created": True,
    }
    [output] = _tool_chunks(chunks, "tool-output-available")
    artifact_id = output["output"]["artifact_id"]
    assert artifact_id == event["data"]["artifact_id"] and output["output"]["version"] == 1
    assert text_of(chunks).strip() == "Here it is."

    listed = (await client.get("/api/conversations/c1/artifacts")).json()
    assert [(a["id"], a["kind"], a["latest_version"]) for a in listed] == [(artifact_id, "chart", 1)]
    detail = (await client.get(f"/api/artifacts/{artifact_id}")).json()
    assert [v["version"] for v in detail["versions"]] == [1]
    version = (await client.get(f"/api/artifacts/{artifact_id}/versions/1")).json()
    assert version["content"] == {"kind": "chart", "spec": CHART_SPEC}
    assert (await client.get(f"/api/artifacts/{artifact_id}/versions/2")).status_code == 404

    # after a reload the card comes from the tool part: its output carries the reference
    messages = (await client.get("/api/conversations/c1/messages")).json()["messages"]
    tool_parts = [p for m in messages for p in m["parts"] if p["type"] == "tool-create_artifact"]
    assert tool_parts[0]["state"] == "output-available"
    assert tool_parts[0]["output"]["artifact_id"] == artifact_id


async def test_text_artifact(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "c1")
    chunks = await chat(client, "c1", "write a document")
    [output] = _tool_chunks(chunks, "tool-output-available")
    version = (await client.get(f"/api/artifacts/{output['output']['artifact_id']}/versions/1")).json()
    assert version["content"]["kind"] == "text" and version["content"]["text"].startswith("# Notes")


async def test_artifacts_are_deleted_with_their_conversation(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "c1")
    chunks = await chat(client, "c1", "make a chart")
    artifact_id = _tool_chunks(chunks, "tool-output-available")[0]["output"]["artifact_id"]
    assert (await client.delete("/api/conversations/c1")).status_code == 204
    assert (await client.get(f"/api/artifacts/{artifact_id}")).status_code == 404


async def test_code_mode_runs_python(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "c1")
    chunks = await chat(client, "c1", "compute it")
    [call] = _tool_chunks(chunks, "tool-input-available")
    assert call["toolName"] == "run_code" and call["input"]["code"] == "sum(range(10))"
    [output] = _tool_chunks(chunks, "tool-output-available")
    assert output["output"] == 45
    assert text_of(chunks).strip() == "The result is 45."


def _script(*steps: list[ToolCallPart] | str) -> FunctionModel:
    """A model that plays `steps` in order, one per model request of the chat agent."""
    remaining = list(steps)

    def respond(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if info.instructions and info.instructions.startswith(TITLE_PREFIX):  # the title task shares the model
            return ModelResponse(parts=[TextPart("Title")])
        step = remaining.pop(0)
        return ModelResponse(parts=[TextPart(step)] if isinstance(step, str) else list(step))

    return streaming(respond)


async def test_update_artifact_adds_a_version_and_bad_content_is_retried(
    client: httpx.AsyncClient, services: Services
) -> None:
    await create_conversation(client, "c1")
    chunks = await chat(client, "c1", "make a chart")
    artifact_id = _tool_chunks(chunks, "tool-output-available")[0]["output"]["artifact_id"]

    line = json.dumps({**CHART_SPEC, "mark": "line"})
    remote = json.dumps({"mark": "bar", "data": {"url": "https://example.com/data.json"}})
    services.models.override = _script(
        [ToolCallPart("update_artifact", {"artifact_id": artifact_id, "content": remote})],
        [ToolCallPart("update_artifact", {"artifact_id": "nope", "content": line})],
        [ToolCallPart("update_artifact", {"artifact_id": artifact_id, "content": line, "title": "As a line"})],
        "Updated.",
    )
    chunks = await chat(client, "c1", "as a line please", message_id="u2")
    errors = _tool_chunks(chunks, "tool-output-error")
    assert "Data must be inline" in errors[0]["errorText"]
    assert "No artifact 'nope'" in errors[1]["errorText"]
    [event] = _tool_chunks(chunks, "data-artifact")
    assert event["data"]["version"] == 2 and event["data"]["created"] is False

    detail = (await client.get(f"/api/artifacts/{artifact_id}")).json()
    assert detail["title"] == "As a line" and [v["title"] for v in detail["versions"]] == ["Wins by team", "As a line"]
    v1 = (await client.get(f"/api/artifacts/{artifact_id}/versions/1")).json()
    v2 = (await client.get(f"/api/artifacts/{artifact_id}/versions/2")).json()
    assert v1["content"]["spec"]["mark"] == "bar" and v2["content"]["spec"]["mark"] == "line"


async def test_artifacts_of_another_conversation_cannot_be_updated(
    client: httpx.AsyncClient, services: Services
) -> None:
    await create_conversation(client, "c1")
    chunks = await chat(client, "c1", "make a chart")
    artifact_id = _tool_chunks(chunks, "tool-output-available")[0]["output"]["artifact_id"]
    await create_conversation(client, "c2")
    services.models.override = _script(
        [ToolCallPart("update_artifact", {"artifact_id": artifact_id, "content": json.dumps(CHART_SPEC)})],
        "No.",
    )
    chunks = await chat(client, "c2", "update it")
    assert "No artifact" in _tool_chunks(chunks, "tool-output-error")[0]["errorText"]
    assert (await client.get(f"/api/artifacts/{artifact_id}")).json()["latest_version"] == 1


def test_parse_content() -> None:
    assert isinstance(parse_content("chart", json.dumps(CHART_SPEC)), ChartContent)
    assert isinstance(parse_content("text", "hello"), TextContent)
    with pytest.raises(ValueError, match="must not be empty"):
        parse_content("text", "  ")
    with pytest.raises(ChartSpecError, match="not valid JSON"):
        parse_content("chart", "{")
    with pytest.raises(ChartSpecError, match="Invalid Vega-Lite spec"):
        parse_content("chart", json.dumps({"mark": "nonsense"}))
    nested = {"layer": [{"mark": "image", "encoding": {"url": {"value": "https://x"}}}]}
    with pytest.raises(ChartSpecError, match="inline"):
        parse_content("chart", json.dumps(nested))
    # a `url` column inside inline rows is data, not a fetch
    rows = {**CHART_SPEC, "data": {"values": [{"url": "https://x", "n": 1}]}}
    assert isinstance(parse_content("chart", json.dumps(rows)), ChartContent)


async def test_store_keeps_kind_and_scopes_by_conversation(db: Database, sqlite_store: SqliteConversationStore) -> None:
    await sqlite_store.save(Conversation(conversation_id="c1"))
    store = ArtifactStore(db)
    record = await store.create("c1", "text", "T", TextContent(text="a"), None)
    with pytest.raises(ValueError, match="is a text"):
        await store.add_version(record.id, "c1", ChartContent(spec={}), None)
    assert await store.add_version(record.id, "other", TextContent(text="b"), None) is None
    updated = await store.add_version(record.id, "c1", TextContent(text="b"), "run-1")
    assert updated is not None and updated.latest_version == 2 and updated.title == "T"


def test_web_capabilities(settings: Settings) -> None:
    names = [type(c).__name__ for c in web_capabilities(settings)]
    assert names == ["WebFetch"]  # no Tavily key: no search
    keyed = settings.model_copy(update={"tavily_api_key": "tvly-test"})
    assert [type(c).__name__ for c in web_capabilities(keyed)] == ["WebSearch", "WebFetch"]


async def test_agent_offers_phase_2_tools(client: httpx.AsyncClient, services: Services) -> None:
    offered: list[str] = []

    def respond(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        offered.extend(t.name for t in info.function_tools)
        return ModelResponse(parts=[TextPart("ok")])

    services.models.override = streaming(respond)
    await create_conversation(client, "c1")
    await chat(client, "c1", "hi")
    assert sorted(offered) == ["create_artifact", "run_code", "update_artifact", "web_fetch"]
