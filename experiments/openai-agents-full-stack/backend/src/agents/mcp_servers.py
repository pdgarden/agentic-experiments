"""MCP servers from ``backend/mcp.json``, the usual ``{"mcpServers": {...}}`` shape.

Each entry is a stdio server (``command``) or a Streamable HTTP server
(``url``). ``${VAR}`` in ``env`` and ``headers`` values is read from the
environment, so tokens stay in ``backend/.env`` rather than in the JSON. The
app connects them once, in its lifespan, and every run shares them.
"""

import json
import logging
import os
import re
from collections.abc import AsyncGenerator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Any, Literal

from agents.mcp import (
    MCPServer,
    MCPServerManager,
    MCPServerStdio,
    MCPServerStdioParams,
    MCPServerStreamableHttp,
)
from dotenv import dotenv_values
from mcp.types import CallToolResult
from pydantic import BaseModel, ConfigDict, Discriminator, Tag, ValidationError

from src.agents.tool_errors import tool_error
from src.settings import BACKEND_DIR, Settings

logger = logging.getLogger(__name__)

_VAR = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


class McpConfigError(Exception):
    pass


class McpToolError(Exception):
    """A tool result the server flagged with ``isError``."""


def _raise_if_error(result: CallToolResult) -> CallToolResult:
    """The SDK passes ``isError`` results to the model as plain output; raising
    sends them through ``failure_error_function`` instead, so the UI flags them.
    """
    if result.is_error:
        text = "\n".join(block.text for block in result.content if block.type == "text")
        raise McpToolError(text or "the tool reported an error")
    return result


class _StdioServer(MCPServerStdio):
    async def call_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any] | None,
        meta: dict[str, Any] | None = None,
    ) -> CallToolResult:
        return _raise_if_error(await super().call_tool(tool_name, arguments, meta))


class _HttpServer(MCPServerStreamableHttp):
    async def call_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any] | None,
        meta: dict[str, Any] | None = None,
    ) -> CallToolResult:
        return _raise_if_error(await super().call_tool(tool_name, arguments, meta))


class _ServerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True


class StdioServerConfig(_ServerConfig):
    type: Literal["stdio"] = "stdio"
    command: str
    args: list[str] = []
    env: dict[str, str] = {}
    cwd: str | None = None


class HttpServerConfig(_ServerConfig):
    type: Literal["http"] = "http"
    url: str
    headers: dict[str, str] = {}


def _server_kind(value: Any) -> str | None:
    """The ``type``, or ``stdio`` / ``http`` from whether it has a command or a URL."""
    if not isinstance(value, dict):
        return None
    entry: dict[str, Any] = value  # pyright: ignore[reportUnknownVariableType]
    kind = entry.get("type")
    if isinstance(kind, str):
        return kind
    return "http" if "url" in entry and "command" not in entry else "stdio"


type ServerConfig = Annotated[
    Annotated[StdioServerConfig, Tag("stdio")]
    | Annotated[HttpServerConfig, Tag("http")],
    Discriminator(_server_kind),
]


class McpConfig(BaseModel):
    mcpServers: dict[str, ServerConfig] = {}  # the file's own camelCase key


def _expand(value: str, env: Mapping[str, str], where: str) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in env:
            raise McpConfigError(f"{where}: environment variable {name} is not set")
        return env[name]

    return _VAR.sub(replace, value)


def _expand_all(
    values: dict[str, str], env: Mapping[str, str], where: str
) -> dict[str, str]:
    return {key: _expand(value, env, f"{where}.{key}") for key, value in values.items()}


type McpServerKind = Literal["stdio", "http"]
type McpServerStatus = Literal["connected", "failed", "disabled"]


class McpToolInfo(BaseModel):
    name: str  # as the server names it; the agent sees ``mcp_<server>__<name>``
    description: str | None = None


class McpServerInfo(BaseModel):
    """A configured server as the UI lists it."""

    name: str
    type: McpServerKind
    status: McpServerStatus
    tools: list[McpToolInfo] = []
    error: str | None = None


@dataclass(frozen=True)
class McpServers:
    """The connected servers, for the agent, and every configured one, for the UI."""

    active: list[MCPServer] = field(default_factory=list[MCPServer])
    info: list[McpServerInfo] = field(default_factory=list[McpServerInfo])


def load_mcp_config(path: Path) -> McpConfig:
    """The parsed file; an empty config if it does not exist."""
    if not path.exists():
        return McpConfig()
    try:
        return McpConfig.model_validate(json.loads(path.read_text()))
    except (json.JSONDecodeError, ValidationError) as error:
        raise McpConfigError(f"Invalid MCP config {path}: {error}") from error


def build_mcp_servers(
    config: McpConfig, env: Mapping[str, str], timeout_s: float
) -> list[MCPServer]:
    """Unconnected SDK servers for the enabled entries, in file order."""
    servers: list[MCPServer] = []
    for name, entry in config.mcpServers.items():
        if not entry.enabled:
            continue
        common: dict[str, Any] = {
            "name": name,
            "cache_tools_list": True,
            "client_session_timeout_seconds": timeout_s,
            "failure_error_function": tool_error,
        }
        if isinstance(entry, StdioServerConfig):
            params: MCPServerStdioParams = {
                "command": entry.command,
                "args": entry.args,
                "env": _expand_all(entry.env, env, f"{name}.env"),
            }
            if entry.cwd:
                params["cwd"] = entry.cwd
            servers.append(_StdioServer(params=params, **common))
        else:
            servers.append(
                _HttpServer(
                    params={
                        "url": entry.url,
                        "headers": _expand_all(entry.headers, env, f"{name}.headers"),
                    },
                    **common,
                )
            )
    return servers


def _environment() -> dict[str, str]:
    """``backend/.env`` values, overridden by the real environment."""
    values = dotenv_values(BACKEND_DIR / ".env")
    env = {key: value for key, value in values.items() if value is not None}
    return env | dict(os.environ)


def _describe(error: BaseException) -> str:
    return str(error) or type(error).__name__


async def _connected_info(server: MCPServer, kind: McpServerKind) -> McpServerInfo:
    """The server and its tools, which ``cache_tools_list`` keeps for the agent."""
    try:
        tools = await server.list_tools()
    except Exception as error:
        logger.warning("MCP server %r: listing tools failed: %s", server.name, error)
        return McpServerInfo(
            name=server.name, type=kind, status="connected", error=_describe(error)
        )
    return McpServerInfo(
        name=server.name,
        type=kind,
        status="connected",
        tools=[McpToolInfo(name=t.name, description=t.description) for t in tools],
    )


@asynccontextmanager
async def connected_mcp_servers(settings: Settings) -> AsyncGenerator[McpServers]:
    """The configured servers that connected; the rest are logged and skipped.

    ``info`` lists every configured server, tools included, for the UI.
    A broken config file raises ``McpConfigError``: better to fail at startup
    than to run with tools silently missing.
    """
    config = load_mcp_config(settings.mcp_config_path)
    servers = build_mcp_servers(config, _environment(), settings.mcp_timeout_s)
    if not servers:
        yield McpServers(info=_info(config, {}, {}))
        return
    async with MCPServerManager(
        servers, drop_failed_servers=True, connect_in_parallel=True
    ) as manager:
        failed = {server.name: _describe(e) for server, e in manager.errors.items()}
        for name, error in failed.items():
            logger.warning("MCP server %r skipped: %s", name, error)
        active = manager.active_servers
        if active:
            logger.info("MCP servers connected: %s", ", ".join(s.name for s in active))
        kinds: dict[str, McpServerKind] = {
            name: entry.type for name, entry in config.mcpServers.items()
        }
        connected = {
            server.name: await _connected_info(server, kinds[server.name])
            for server in active
        }
        yield McpServers(active=active, info=_info(config, connected, failed))


def _info(
    config: McpConfig, connected: dict[str, McpServerInfo], failed: dict[str, str]
) -> list[McpServerInfo]:
    """Every configured server, in file order."""
    info: list[McpServerInfo] = []
    for name, entry in config.mcpServers.items():
        if name in connected:
            info.append(connected[name])
        elif not entry.enabled:
            info.append(McpServerInfo(name=name, type=entry.type, status="disabled"))
        else:
            # Not connected and no error recorded still means the agent lacks it.
            error = failed.get(name, "did not connect")
            info.append(
                McpServerInfo(name=name, type=entry.type, status="failed", error=error)
            )
    return info
