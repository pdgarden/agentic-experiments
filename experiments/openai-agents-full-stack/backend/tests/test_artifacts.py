import asyncio
import copy
import itertools
import json
import re
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from agents import Agent, Runner
from agents.testing import ModelCall, ModelStep, ScriptedModel

from src.agents.artifact_tools import create_chart, update_chart
from src.artifacts.chart import MAX_SPEC_BYTES, ChartSpecError, validate_chart_spec
from src.artifacts.models import ChartContent
from src.artifacts.output import ArtifactOutput, ArtifactRef
from src.events import ArtifactCreated, ArtifactUpdated, Event, ToolResult
from src.parts import TextPart
from src.runs.context import RunContext
from src.runs.mapping import EventMapper
from src.store.db import connect
from src.store.repo import Store
from tests.conftest import check_fixture, new_session, start_run, stream
from tests.fakes import call, say, scripted


def bar_chart(rows: int = 3, mark: str = "bar") -> dict[str, Any]:
    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "data": {"values": [{"season": 2000 + i, "pts": 20 + i} for i in range(rows)]},
        "mark": mark,
        "encoding": {
            "x": {"field": "season", "type": "ordinal"},
            "y": {"field": "pts", "type": "quantitative"},
        },
    }


@pytest.fixture
async def store(tmp_path: Path):
    conn = await connect(tmp_path / "app.db")
    yield Store(conn)
    await conn.close()


# Validation


def test_valid_spec_is_returned_parsed() -> None:
    spec = bar_chart()
    assert validate_chart_spec(json.dumps(spec)) == spec


def test_layered_spec_is_valid() -> None:
    spec = bar_chart()
    layered = {
        "data": spec["data"],
        "encoding": spec["encoding"],
        "layer": [{"mark": "line"}, {"mark": "point"}],
    }
    assert validate_chart_spec(json.dumps(layered))["layer"]


@pytest.mark.parametrize(
    ("spec", "where"),
    [
        ({"data": {"url": "https://example.com/x.csv"}}, "spec.data.url"),
        (
            {"layer": [{"data": {"url": "data.json"}, "mark": "line"}]},
            "spec.layer[0].data.url",
        ),
        (
            {"mark": {"type": "image"}, "encoding": {"url": {"field": "u"}}},
            "spec.encoding.url",
        ),
    ],
)
def test_urls_are_rejected_anywhere(spec: dict[str, Any], where: str) -> None:
    with pytest.raises(ChartSpecError, match=f"found a URL at {re.escape(where)}"):
        validate_chart_spec(json.dumps(spec))


def test_inline_rows_may_have_a_url_column() -> None:
    spec = bar_chart()
    spec["data"]["values"] = [{"season": 2001, "pts": 1, "url": "https://x"}]
    assert validate_chart_spec(json.dumps(spec))


def test_schema_error_says_where_and_what_is_allowed() -> None:
    with pytest.raises(ChartSpecError) as caught:
        validate_chart_spec(json.dumps(bar_chart(mark="barr")))
    message = str(caught.value)
    assert message.startswith("Invalid Vega-Lite spec: at spec.mark:")
    assert '"bar"' in message and '"line"' in message
    assert len(message) < 500


@pytest.mark.parametrize(
    ("raw", "message"),
    [("{nope", "not valid JSON"), ("[1, 2]", "must be a JSON object")],
)
def test_not_a_json_object(raw: str, message: str) -> None:
    with pytest.raises(ChartSpecError, match=message):
        validate_chart_spec(raw)


def test_size_cap() -> None:
    spec = bar_chart(rows=MAX_SPEC_BYTES // 20)
    with pytest.raises(ChartSpecError, match="KB limit: aggregate"):
        validate_chart_spec(json.dumps(spec))


# Storage


async def test_artifact_versions(store: Store) -> None:
    session = await store.create_session("assistant")
    v1 = ChartContent(spec=bar_chart())
    created = await store.create_artifact(session.id, "chart", "Points", v1, "run-1")
    assert created.latest_version == 1

    v2 = ChartContent(spec=bar_chart(mark="line"))
    updated = await store.add_artifact_version(
        created.id, session.id, v2, "run-2", title="Points (line)"
    )
    assert updated is not None
    assert (updated.latest_version, updated.title) == (2, "Points (line)")
    kept = await store.add_artifact_version(created.id, session.id, v2, "run-3")
    assert kept is not None and kept.title == "Points (line)"

    versions = await store.list_artifact_versions(created.id)
    assert [(v.version, v.run_id, v.title) for v in versions] == [
        (1, "run-1", "Points"),
        (2, "run-2", "Points (line)"),
        (3, "run-3", "Points (line)"),
    ]
    first = await store.get_artifact_version(created.id, 1)
    assert first is not None and first.content == v1
    assert await store.get_artifact_version(created.id, 4) is None
    assert [a.id for a in await store.list_artifacts(session.id)] == [created.id]


async def test_update_is_scoped_to_the_session(store: Store) -> None:
    mine = await store.create_session("assistant")
    other = await store.create_session("assistant")
    content = ChartContent(spec=bar_chart())
    artifact = await store.create_artifact(mine.id, "chart", "Mine", content, "r")

    assert await store.add_artifact_version(artifact.id, other.id, content, "r") is None
    assert await store.add_artifact_version("nope", mine.id, content, "r") is None
    stored = await store.get_artifact(artifact.id)
    assert stored is not None and stored.latest_version == 1


async def test_concurrent_updates_get_distinct_versions(store: Store) -> None:
    session = await store.create_session("assistant")
    content = ChartContent(spec=bar_chart())
    artifact = await store.create_artifact(session.id, "chart", "C", content, "r")

    await asyncio.gather(
        *(
            store.add_artifact_version(artifact.id, session.id, content, "r")
            for _ in range(5)
        )
    )
    versions = await store.list_artifact_versions(artifact.id)
    assert [v.version for v in versions] == [1, 2, 3, 4, 5, 6]


async def test_artifacts_are_deleted_with_their_session(store: Store) -> None:
    session = await store.create_session("assistant")
    content = ChartContent(spec=bar_chart())
    artifact = await store.create_artifact(session.id, "chart", "C", content, "r")

    await store.delete_session(session.id)
    assert await store.get_artifact(artifact.id) is None
    assert await store.list_artifact_versions(artifact.id) == []


# Mapping


def test_artifact_output_survives_a_deep_copy() -> None:
    """The SDK deep-copies tool outputs before they reach the stream."""
    ref = ArtifactRef("a1", "chart", "T", 2, created=False)
    output = copy.deepcopy(ArtifactOutput.of(ref))
    assert isinstance(output, ArtifactOutput) and output.ref == ref


async def test_tool_output_maps_to_result_then_artifact_event(store: Store) -> None:
    session = await store.create_session("assistant")
    run = await store.create_run(session.id, [TextPart(text="plot")])
    model = scripted(
        call("create_chart", {"title": "Points", "spec": json.dumps(bar_chart())}),
        say("Here it is."),
    )
    agent = Agent[RunContext](name="assistant", model=model, tools=[create_chart])
    context = RunContext(session_id=session.id, run_id=run.id, store=store)

    mapper = EventMapper(agent.name)
    result = Runner.run_streamed(agent, "plot", context=context)
    events: list[Event] = []
    async for sdk_event in result.stream_events():
        events.extend(mapper.map(sdk_event))

    kinds = [e.type for e in events if e.type != "text_delta"]
    assert kinds == ["tool_call", "tool_result", "artifact_created"]
    created = next(e for e in events if isinstance(e, ArtifactCreated))
    (artifact,) = await store.list_artifacts(session.id)
    assert (created.artifact_id, created.title, created.version) == (
        artifact.id,
        "Points",
        1,
    )
    result_event = next(e for e in events if isinstance(e, ToolResult))
    assert result_event.result.startswith(f"Created chart artifact {artifact.id} (v1)")


# Through the API


def _created_id(model_call: ModelCall) -> str:
    """The artifact id in the last tool output the model was sent."""
    items = cast("list[dict[str, Any]]", model_call.input)
    output = str(items[-1]["output"])
    match = re.search(r"artifact (\w+) ", output)
    assert match is not None, output
    return match.group(1)


async def test_chart_created_then_updated(
    client: httpx.AsyncClient, model: ScriptedModel, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Fixed ids: the recorded fixture carries the artifact id.
    ids = itertools.count(1)
    monkeypatch.setattr("src.store.repo.new_id", lambda: f"{next(ids):032x}")

    async def update(model_call: ModelCall) -> ModelStep:
        args = {
            "artifact_id": _created_id(model_call),
            "spec": json.dumps(bar_chart(mark="line")),
            "title": "LeBron points (line)",
        }
        return call("update_chart", args, call_id="call_2")

    title = "LeBron points"
    model.extend(
        [
            call("create_chart", {"title": title, "spec": json.dumps(bar_chart())}),
            ModelStep.respond(update),
            say("Here it is, as a line chart."),
        ]
    )
    session_id = await new_session(client)
    events = await stream(client, await start_run(client, session_id, "Plot it"))

    kinds = [e.type for e in events if e.type != "text_delta"]
    assert kinds == [
        "run_started",
        "user_message",
        "tool_call",
        "tool_result",
        "artifact_created",
        "tool_call",
        "tool_result",
        "artifact_updated",
        "run_finished",
    ]
    created = next(e for e in events if isinstance(e, ArtifactCreated))
    updated = next(e for e in events if isinstance(e, ArtifactUpdated))
    artifact_id = created.artifact_id
    assert (created.version, created.title) == (1, title)
    assert (updated.artifact_id, updated.version) == (artifact_id, 2)
    assert updated.title == "LeBron points (line)"

    listed = (await client.get(f"/api/sessions/{session_id}/artifacts")).json()
    assert [(a["id"], a["latest_version"]) for a in listed] == [(artifact_id, 2)]
    detail = (await client.get(f"/api/artifacts/{artifact_id}")).json()
    assert [(v["version"], v["title"]) for v in detail["versions"]] == [
        (1, title),
        (2, "LeBron points (line)"),
    ]
    assert "content" not in detail["versions"][0]
    v1 = (await client.get(f"/api/artifacts/{artifact_id}/versions/1")).json()
    assert v1["content"] == {"kind": "chart", "spec": bar_chart()}
    v2 = (await client.get(f"/api/artifacts/{artifact_id}/versions/2")).json()
    assert v2["content"]["spec"]["mark"] == "line"
    missing = await client.get(f"/api/artifacts/{artifact_id}/versions/3")
    assert missing.status_code == 404

    check_fixture("chart_roundtrip.json", events)


async def test_invalid_spec_goes_back_to_the_model(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    session_id = await new_session(client)
    model.extend(
        [
            call("create_chart", {"title": "x", "spec": '{"data": {"url": "x.csv"}}'}),
            say("Sorry."),
        ]
    )
    events = await stream(client, await start_run(client, session_id, "Plot"))

    result = next(e for e in events if isinstance(e, ToolResult))
    assert result.is_error and "Data must be inline" in result.result
    assert not any(e.type.startswith("artifact_") for e in events)
    assert (await client.get(f"/api/sessions/{session_id}/artifacts")).json() == []


async def test_cannot_update_another_sessions_chart(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    owner = await new_session(client)
    model.extend(
        [
            call("create_chart", {"title": "Mine", "spec": json.dumps(bar_chart())}),
            say("Done."),
        ]
    )
    events = await stream(client, await start_run(client, owner, "Plot"))
    artifact_id = next(e for e in events if isinstance(e, ArtifactCreated)).artifact_id

    intruder = await new_session(client)
    model.extend(
        [
            call(
                "update_chart",
                {
                    "artifact_id": artifact_id,
                    "spec": json.dumps(bar_chart()),
                    "title": None,
                },
            ),
            say("Hm."),
        ]
    )
    events = await stream(client, await start_run(client, intruder, "Change it"))

    result = next(e for e in events if isinstance(e, ToolResult))
    assert result.is_error and "ArtifactNotFound" in result.result
    detail = (await client.get(f"/api/artifacts/{artifact_id}")).json()
    assert detail["latest_version"] == 1


async def test_artifact_routes_404(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/sessions/nope/artifacts")).status_code == 404
    assert (await client.get("/api/artifacts/nope")).status_code == 404
    assert (await client.get("/api/artifacts/nope/versions/1")).status_code == 404


async def test_session_delete_removes_its_artifacts(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    session_id = await new_session(client)
    model.extend(
        [
            call("create_chart", {"title": "C", "spec": json.dumps(bar_chart())}),
            say("Done."),
        ]
    )
    events = await stream(client, await start_run(client, session_id, "Plot"))
    artifact_id = next(e for e in events if isinstance(e, ArtifactCreated)).artifact_id

    assert (await client.delete(f"/api/sessions/{session_id}")).status_code == 204
    assert (await client.get(f"/api/artifacts/{artifact_id}")).status_code == 404


def test_tools_take_the_spec_as_a_string() -> None:
    for tool in (create_chart, update_chart):
        assert tool.params_json_schema["properties"]["spec"]["type"] == "string"
