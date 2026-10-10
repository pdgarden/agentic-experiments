import json
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest
from agents.mcp import MCPServerStdio, MCPServerStreamableHttp
from agents.testing import ScriptedModel

from src.agents.mcp_servers import (
    McpConfigError,
    build_mcp_servers,
    load_mcp_config,
)
from src.events import ToolCall, ToolResult
from src.settings import Settings
from tests.conftest import start_run, stream
from tests.fakes import call, say

TEST_SERVER = Path(__file__).parent / "mcp_test_server.py"


def write_config(path: Path, servers: dict[str, Any]) -> Path:
    path.write_text(json.dumps({"mcpServers": servers}))
    return path


async def new_session(http: httpx.AsyncClient) -> str:
    response = await http.post("/api/sessions", json={})
    return response.json()["id"]


# --- Config ---------------------------------------------------------------


def test_missing_file_means_no_servers(tmp_path: Path) -> None:
    config = load_mcp_config(tmp_path / "mcp.json")
    assert build_mcp_servers(config, {}, 30) == []


def test_kind_inferred_and_disabled_skipped(tmp_path: Path) -> None:
    path = write_config(
        tmp_path / "mcp.json",
        {
            "local": {"command": "uvx", "args": ["mcp-server-fetch"]},
            "remote": {"url": "https://example.com/mcp"},
            "off": {"command": "nope", "enabled": False},
        },
    )
    servers = build_mcp_servers(load_mcp_config(path), {}, 30)
    assert [s.name for s in servers] == ["local", "remote"]
    assert isinstance(servers[0], MCPServerStdio)
    assert isinstance(servers[1], MCPServerStreamableHttp)


def test_env_and_headers_are_expanded(tmp_path: Path) -> None:
    path = write_config(
        tmp_path / "mcp.json",
        {
            "local": {"command": "x", "env": {"TOKEN": "${A}"}},
            "remote": {
                "url": "https://example.com/mcp",
                "headers": {"Authorization": "Bearer ${B}"},
            },
        },
    )
    local, remote = build_mcp_servers(load_mcp_config(path), {"A": "a", "B": "b"}, 30)
    assert isinstance(local, MCPServerStdio)
    assert local.params.env is not None and local.params.env["TOKEN"] == "a"
    assert isinstance(remote, MCPServerStreamableHttp)
    assert remote.params.get("headers") == {"Authorization": "Bearer b"}


def test_unknown_variable_is_an_error(tmp_path: Path) -> None:
    path = write_config(
        tmp_path / "mcp.json", {"local": {"command": "x", "env": {"T": "${MISSING}"}}}
    )
    with pytest.raises(McpConfigError, match="MISSING"):
        build_mcp_servers(load_mcp_config(path), {}, 30)


@pytest.mark.parametrize(
    "content", ["{not json", '{"mcpServers": {"bad": {"command": 1}}}']
)
def test_invalid_file_names_the_path(tmp_path: Path, content: str) -> None:
    path = tmp_path / "mcp.json"
    path.write_text(content)
    with pytest.raises(McpConfigError, match=str(path)):
        load_mcp_config(path)


# --- Runs with a real stdio server ------------------------------------------


@pytest.fixture
def settings(settings: Settings) -> Settings:
    """The test server, one that cannot start and a disabled one."""
    write_config(
        settings.mcp_config_path,
        {
            "test": {"command": sys.executable, "args": [str(TEST_SERVER)]},
            "broken": {"command": "/nonexistent/mcp-server"},
            "off": {"url": "https://example.com/mcp", "enabled": False},
        },
    )
    return settings


async def test_mcp_tool_result(client: httpx.AsyncClient, model: ScriptedModel) -> None:
    model.extend([call("mcp_test__add", {"a": 2, "b": 3}), say("5")])
    run_id = await start_run(client, await new_session(client), "2 + 3?")
    events = await stream(client, run_id)

    tool_call = next(e for e in events if isinstance(e, ToolCall))
    assert tool_call.name == "mcp_test__add"
    result = next(e for e in events if isinstance(e, ToolResult))
    assert result.result == "5" and not result.is_error
    assert events[-1].type == "run_finished"


async def test_mcp_tool_error_is_flagged(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    model.extend([call("mcp_test__fail", {}), say("It failed.")])
    run_id = await start_run(client, await new_session(client), "fail")
    events = await stream(client, run_id)

    result = next(e for e in events if isinstance(e, ToolResult))
    assert result.is_error
    assert "this tool always fails" in result.result


async def test_failed_server_is_skipped(
    client: httpx.AsyncClient, model: ScriptedModel
) -> None:
    model.extend([say("hi")])
    await stream(client, await start_run(client, await new_session(client), "hi"))

    tools = {tool.name for tool in model.calls[0].tools}
    assert tools == {"run_python", "mcp_test__add", "mcp_test__fail"}


async def test_mcp_servers_are_listed(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/mcp-servers")
    assert response.status_code == 200
    test, broken, off = response.json()

    assert test["name"] == "test" and test["type"] == "stdio"
    assert test["status"] == "connected" and test["error"] is None
    assert {t["name"]: t["description"] for t in test["tools"]} == {
        "add": "Add two integers.",
        "fail": "Always fails.",
    }
    assert broken["name"] == "broken" and broken["status"] == "failed"
    assert broken["error"] and broken["tools"] == []
    assert off == {
        "name": "off",
        "type": "http",
        "status": "disabled",
        "tools": [],
        "error": None,
    }
