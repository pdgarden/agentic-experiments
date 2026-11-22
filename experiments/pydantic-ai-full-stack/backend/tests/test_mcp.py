"""MCP catalogue: config parsing, connection with failures tolerated, per-conversation filtering through code mode.

Uses `tests/mcp_test_server.py` over stdio, never a real server.
"""

import json
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo

from src.agent.e2e import TITLE_PREFIX
from src.agent.mcp import McpConfigError, McpServers, load_mcp_config
from src.app import create_app
from src.services import Services, get_services
from src.settings import Settings
from tests.helpers import chat, create_conversation, streaming

TEST_SERVER = str(Path(__file__).parent / "mcp_test_server.py")


def _write(path: Path, servers: dict[str, Any]) -> Path:
    path.write_text(json.dumps({"mcpServers": servers}))
    return path


def test_config_parsing(tmp_path: Path) -> None:
    assert load_mcp_config(tmp_path / "absent.json").mcpServers == {}
    config = load_mcp_config(
        _write(
            tmp_path / "ok.json",
            {"local": {"command": "uv", "args": ["run", "x.py"]}, "remote": {"url": "https://x/mcp", "enabled": False}},
        )
    )
    assert {n: s.kind for n, s in config.mcpServers.items()} == {"local": "stdio", "remote": "http"}
    bad_configs: list[dict[str, Any]] = [
        {"Bad-Name": {"command": "x"}},
        {"both": {"command": "x", "url": "https://x"}},
        {"neither": {}},
        {"typo": {"command": "x", "argz": []}},
    ]
    for bad in bad_configs:
        with pytest.raises(McpConfigError):
            load_mcp_config(_write(tmp_path / "bad.json", bad))


async def test_connect_tolerates_failures(tmp_path: Path) -> None:
    path = _write(
        tmp_path / "mcp.json",
        {
            "calc": {"command": sys.executable, "args": [TEST_SERVER], "description": "Adds numbers"},
            "broken": {"command": sys.executable, "args": ["-c", "import sys; sys.exit(1)"]},
            "secret": {"url": "https://example.invalid/mcp", "headers": {"Authorization": "Bearer ${MISSING_TOKEN}"}},
            "off": {"command": "nope", "enabled": False},
        },
    )
    servers = await McpServers.connect(path, timeout=10, env={})
    try:
        status = {s.name: s.status for s in servers.info}
        assert status == {"calc": "connected", "broken": "failed", "secret": "failed", "off": "disabled"}
        calc = next(s for s in servers.info if s.name == "calc")
        assert [t.name for t in calc.tools] == ["add"] and calc.description == "Adds numbers"
        secret = next(s for s in servers.info if s.name == "secret")
        assert secret.error is not None and "MISSING_TOKEN" in secret.error
        assert list(servers.connected) == ["calc"]
        assert servers.names == ["calc", "broken", "secret", "off"]
    finally:
        await servers.aclose()


@pytest.fixture
async def mcp_app(settings: Settings, tmp_path: Path) -> AsyncIterator[FastAPI]:
    config = _write(tmp_path / "mcp.json", {"calc": {"command": sys.executable, "args": [TEST_SERVER]}})
    application = create_app(settings.model_copy(update={"mcp_config_path": config}))
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def mcp_client(mcp_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mcp_app), base_url="http://test") as c:
        yield c


def _code_mode_model(offered: list[list[str]]) -> Any:
    """Calls the MCP tool from `run_code`, then reports the result (or the retry); records each request's tools."""

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if info.instructions and info.instructions.startswith(TITLE_PREFIX):
            return ModelResponse(parts=[TextPart("Title")])
        offered.append(sorted(t.name for t in info.function_tools))
        last = messages[-1]
        returns = [p for p in last.parts if isinstance(p, ToolReturnPart)] if isinstance(last, ModelRequest) else []
        if returns:
            return ModelResponse(parts=[TextPart(f"Got {returns[0].model_response_str()}")])
        return ModelResponse(parts=[ToolCallPart("run_code", {"code": "await calc_add(a=2, b=3)"})])

    return streaming(respond)


async def test_mcp_tools_run_through_code_mode_when_enabled(mcp_client: httpx.AsyncClient) -> None:
    services: Services = get_services()
    servers = (await mcp_client.get("/api/mcp-servers")).json()
    assert [(s["name"], s["status"], [t["name"] for t in s["tools"]]) for s in servers] == [
        ("calc", "connected", ["add"])
    ]

    r = await mcp_client.put("/api/conversations/c1", json={"model_id": "gpt", "mcp_servers": ["nope"]})
    assert r.status_code == 422

    offered: list[list[str]] = []
    services.models.override = _code_mode_model(offered)

    # enabled: callable from run_code, never offered as a direct tool
    r = await mcp_client.put("/api/conversations/c1", json={"model_id": "gpt", "mcp_servers": ["calc"]})
    assert r.status_code == 200 and r.json()["settings"]["mcp_servers"] == ["calc"]
    chunks = await chat(mcp_client, "c1", "add")
    outputs = [c for c in chunks if c["type"] == "tool-output-available"]
    assert outputs[0]["output"] == 5
    assert "calc_add" not in offered[0] and "run_code" in offered[0]

    # not enabled: run_code cannot see it
    await create_conversation(mcp_client, "c2")
    chunks = await chat(mcp_client, "c2", "add")
    [error] = [c for c in chunks if c["type"] == "tool-output-error"]
    assert "Unknown function: calc_add" in error["errorText"]
