import asyncio
import json
import os
from pathlib import Path

import httpx
from agents.testing import ModelStep, ScriptedModel

from src.events import Error, Event, RunFinished, TextDelta, ToolResult
from src.settings import Settings
from tests.conftest import load_fixture, parse_sse, shape, start_run, stream
from tests.fakes import USAGE, blocked, call, say

FIXTURES = Path(__file__).parent / "fixtures" / "events"


async def new_session(http: httpx.AsyncClient) -> str:
    response = await http.post("/api/sessions", json={})
    assert response.status_code == 201
    return response.json()["id"]


async def wait_until_running(model: ScriptedModel) -> None:
    """Until the scripted model has been called, i.e. the run is in flight."""
    for _ in range(200):
        if model.calls:
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the model was never called")


async def test_run_with_tool_call(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    model.extend([call("run_python", {"code": "6 * 7"}), say("The answer is 42.")])
    session_id = await new_session(client)

    run_id = await start_run(client, session_id, "What is 6 times 7?")
    events = await stream(client, run_id)

    assert [e.seq for e in events] == list(range(1, len(events) + 1))
    kinds = [e.type for e in events if e.type != "text_delta"]
    assert kinds == [
        "run_started",
        "user_message",
        "tool_call",
        "tool_result",
        "run_finished",
    ]
    tool_result = next(e for e in events if isinstance(e, ToolResult))
    assert "42" in tool_result.result and not tool_result.is_error
    text = "".join(e.delta for e in events if isinstance(e, TextDelta))
    assert text == "The answer is 42."
    finished = events[-1]
    assert isinstance(finished, RunFinished)
    assert finished.status == "succeeded"
    assert finished.usage is not None
    assert finished.usage.total_tokens == 2 * USAGE.total_tokens

    detail = (await client.get(f"/api/sessions/{session_id}")).json()
    assert detail["session"]["title"] == "What is 6 times 7?"
    (run,) = detail["runs"]
    assert run["status"] == "succeeded"
    assert run["usage"]["requests"] == 2
    assert len(run["events"]) == len(events)

    _check_fixture("tool_roundtrip.json", events)


def _check_fixture(name: str, events: list[Event]) -> None:
    """Recorded event sequences, shared with the frontend reducer tests.

    Regenerate with ``UPDATE_FIXTURES=1``.
    """
    recorded = shape(events)
    path = FIXTURES / name
    if os.environ.get("UPDATE_FIXTURES") or not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(recorded, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    assert recorded == load_fixture(path)


async def test_history_carries_over_to_next_run(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    model.extend([say("Hello Ada."), say("You are Ada.")])
    session_id = await new_session(client)

    await stream(client, await start_run(client, session_id, "I am Ada."))
    await stream(client, await start_run(client, session_id, "Who am I?"))

    last_input = json.dumps(model.calls[-1].input)
    assert "I am Ada." in last_input and "Hello Ada." in last_input
    detail = (await client.get(f"/api/sessions/{session_id}")).json()
    assert [r["status"] for r in detail["runs"]] == ["succeeded", "succeeded"]


async def test_replay_after_and_last_event_id(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    model.extend([say("Hi.")])
    session_id = await new_session(client)
    run_id = await start_run(client, session_id, "hi")
    everything = await stream(client, run_id)

    tail = await stream(client, run_id, after=2)
    assert [e.seq for e in tail] == [e.seq for e in everything[2:]]

    response = await client.get(
        f"/api/runs/{run_id}/events", headers={"Last-Event-ID": "3"}
    )
    ids = [message_id for message_id, _ in parse_sse(response.text)]
    assert ids == [str(e.seq) for e in everything[3:]]


async def test_live_tail_then_finish(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    gate = asyncio.Event()
    model.extend([blocked(gate, say("Done."))])
    session_id = await new_session(client)
    run_id = await start_run(client, session_id, "slow")
    await wait_until_running(model)

    watcher = asyncio.create_task(stream(client, run_id))
    await asyncio.sleep(0.05)
    assert not watcher.done()  # tailing a live run
    gate.set()
    events = await asyncio.wait_for(watcher, timeout=5)

    assert [e.seq for e in events] == list(range(1, len(events) + 1))
    assert isinstance(events[-1], RunFinished) and events[-1].status == "succeeded"


async def test_one_run_at_a_time_and_cancel(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    gate = asyncio.Event()
    model.extend([blocked(gate, say("never sent")), say("Fresh start.")])
    session_id = await new_session(client)
    run_id = await start_run(client, session_id, "slow")
    await wait_until_running(model)

    second = await client.post(
        f"/api/sessions/{session_id}/runs",
        json={"parts": [{"type": "text", "text": "again"}]},
    )
    assert second.status_code == 409

    assert (await client.post(f"/api/runs/{run_id}/cancel")).status_code == 202
    events = await stream(client, run_id)
    assert isinstance(events[-1], RunFinished) and events[-1].status == "cancelled"
    assert (await client.post(f"/api/runs/{run_id}/cancel")).status_code == 409

    # The session is usable again after a cancel.
    events = await stream(client, await start_run(client, session_id, "hello"))
    assert isinstance(events[-1], RunFinished) and events[-1].status == "succeeded"


async def test_model_error_fails_the_run(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    model.extend([ModelStep.raise_error(RuntimeError("provider down"))])
    session_id = await new_session(client)

    events = await stream(client, await start_run(client, session_id, "hi"))

    error = next(e for e in events if isinstance(e, Error))
    assert error.code == "internal" and "provider down" in error.message
    assert isinstance(events[-1], RunFinished) and events[-1].status == "failed"
    detail = (await client.get(f"/api/sessions/{session_id}")).json()
    assert "provider down" in detail["runs"][0]["error"]


async def test_max_turns(
    client: httpx.AsyncClient, model: ScriptedModel, settings: Settings
) -> None:
    turns = settings.max_turns
    model.extend(
        [call("run_python", {"code": "1"}, call_id=f"c{i}") for i in range(turns)]
    )
    session_id = await new_session(client)

    events = await stream(client, await start_run(client, session_id, "loop"))

    error = next(e for e in events if isinstance(e, Error))
    assert error.code == "max_turns"
    assert isinstance(events[-1], RunFinished) and events[-1].status == "failed"
    assert events[-1].usage is not None and events[-1].usage.requests == turns


async def test_timeout(
    client: httpx.AsyncClient, model: ScriptedModel, settings: Settings
) -> None:
    settings.run_timeout_s = 0.2
    model.extend([blocked(asyncio.Event(), say("never"))])
    session_id = await new_session(client)

    events = await stream(client, await start_run(client, session_id, "hang"))

    error = next(e for e in events if isinstance(e, Error))
    assert error.code == "timeout"
    assert isinstance(events[-1], RunFinished) and events[-1].status == "failed"


async def test_session_endpoints(client: httpx.AsyncClient) -> None:
    session_id = await new_session(client)
    assert [s["id"] for s in (await client.get("/api/sessions")).json()] == [session_id]

    renamed = await client.patch(f"/api/sessions/{session_id}", json={"title": "Plan"})
    assert renamed.json()["title"] == "Plan"
    assert (
        await client.patch(f"/api/sessions/{session_id}", json={"title": ""})
    ).status_code == 422

    assert (await client.delete(f"/api/sessions/{session_id}")).status_code == 204
    assert (await client.get(f"/api/sessions/{session_id}")).status_code == 404
    assert (await client.get("/api/runs/nope/events")).status_code == 404
    assert (
        await client.post(
            "/api/sessions/nope/runs", json={"parts": [{"type": "text", "text": "x"}]}
        )
    ).status_code == 404


async def test_delete_stops_running_run(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    model.extend([blocked(asyncio.Event(), say("never"))])
    session_id = await new_session(client)
    run_id = await start_run(client, session_id, "slow")
    await wait_until_running(model)

    assert (await client.delete(f"/api/sessions/{session_id}")).status_code == 204
    assert (await client.get(f"/api/runs/{run_id}/events")).status_code == 404


async def test_interrupted_on_restart(settings: Settings) -> None:
    from src.app import create_app

    model = ScriptedModel([blocked(asyncio.Event(), say("never"))])
    app = create_app(settings, model=model)
    transport = httpx.ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=transport, base_url="http://test") as http,
    ):
        session_id = await new_session(http)
        run_id = await start_run(http, session_id, "slow")
        await wait_until_running(model)
    # Shutdown recorded the run as interrupted; a restart replays that.

    app = create_app(settings, model=ScriptedModel())
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http,
    ):
        events = await stream(http, run_id)
    assert isinstance(events[-1], RunFinished) and events[-1].status == "interrupted"


async def test_openapi_publishes_event_contract(client: httpx.AsyncClient) -> None:
    schema = (await client.get("/openapi.json")).json()
    components = schema["components"]["schemas"]
    assert {"Event", "Part", "TextDelta", "ToolPart", "RunFinished"} <= set(components)
    sse = schema["paths"]["/api/runs/{run_id}/events"]["get"]["responses"]["200"]
    data = sse["content"]["text/event-stream"]["itemSchema"]["properties"]["data"]
    assert data["contentSchema"] == {"$ref": "#/components/schemas/Event"}
    # Envelope fields are required on the wire.
    assert {"v", "run_id", "seq", "type"} <= set(components["TextDelta"]["required"])
