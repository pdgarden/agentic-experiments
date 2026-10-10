import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from agents import set_tracing_disabled
from agents.testing import ScriptedModel

from src.app import create_app
from src.events import Event, event_adapter
from src.settings import Settings

set_tracing_disabled(True)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,  # pyright: ignore[reportCallIssue]
        db_path=tmp_path / "app.db",
        frontend_dist=tmp_path / "no-frontend",
        mcp_config_path=tmp_path / "mcp.json",  # absent: no MCP servers
        model_id="scripted",
        run_timeout_s=5,
    )


@pytest.fixture
def model() -> ScriptedModel:
    """Tests enqueue the steps they need: ``model.extend([...])``."""
    return ScriptedModel()


@pytest.fixture
async def client(
    settings: Settings, model: ScriptedModel
) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings, model=model)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http,
    ):
        yield http


def parse_sse(body: str) -> list[tuple[str | None, Event]]:
    """``(id, event)`` for every message of an SSE body; comments are skipped."""
    messages: list[tuple[str | None, Event]] = []
    for block in body.split("\n\n"):
        fields: dict[str, str] = {}
        for line in block.splitlines():
            if line.startswith(":") or ":" not in line:
                continue
            key, _, value = line.partition(":")
            fields[key] = value.removeprefix(" ")
        if "data" in fields:
            messages.append(
                (fields.get("id"), event_adapter.validate_json(fields["data"]))
            )
    return messages


async def start_run(http: httpx.AsyncClient, session_id: str, text: str) -> str:
    response = await http.post(
        f"/api/sessions/{session_id}/runs",
        json={"parts": [{"type": "text", "text": text}]},
    )
    assert response.status_code == 201, response.text
    return response.json()["run_id"]


async def stream(http: httpx.AsyncClient, run_id: str, after: int = 0) -> list[Event]:
    response = await http.get(f"/api/runs/{run_id}/events", params={"after": after})
    assert response.status_code == 200
    return [event for _, event in parse_sse(response.text)]


def shape(events: list[Event]) -> list[dict[str, Any]]:
    """Events without the run-specific envelope, for comparing to fixtures."""
    return [
        event.model_dump(mode="json", exclude={"run_id", "session_id"})
        for event in events
    ]


def load_fixture(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
