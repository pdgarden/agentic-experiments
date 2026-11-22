"""MCP servers from `backend/mcp.json` (the usual `{"mcpServers": {...}}` shape), connected once in the lifespan.

Each entry is a stdio server (`command`) or a Streamable HTTP server (`url`). `${VAR}` in `env` and `headers`
is read from the environment and `backend/.env`, so tokens stay out of the JSON. Every server is connected on
its own: one that fails is logged and marked `failed`, and the app runs without it (no auto-reconnect).

The agent gets only the connected servers, each one prefixed with its name (`nba_get_games`), tagged for code
mode, and filtered by the conversation's `mcp_servers` setting.
"""

import asyncio
import json
import logging
import os
import re
from collections.abc import Mapping
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, cast

from dotenv import dotenv_values
from fastmcp.client.transports import StdioTransport
from pydantic import BaseModel, ConfigDict, ValidationError, model_validator
from pydantic_ai import RunContext
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.tools import ToolDefinition
from pydantic_ai.toolsets import AbstractToolset

from src.agent.build import Deps
from src.settings import BACKEND_DIR

logger = logging.getLogger(__name__)

CODE_MODE_METADATA = {"code_mode": True}
"""Tools tagged with this run inside `run_code` (see `build_agent`)."""

_VAR = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
_NAME = re.compile(r"^[a-z][a-z0-9_]{0,31}$")


class McpConfigError(Exception):
    pass


class McpServerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command: str | None = None
    args: list[str] = []
    env: dict[str, str] = {}
    cwd: str | None = None
    url: str | None = None
    headers: dict[str, str] = {}
    enabled: bool = True
    description: str | None = None

    @model_validator(mode="after")
    def _one_transport(self) -> "McpServerConfig":
        if (self.command is None) == (self.url is None):
            raise ValueError("an MCP server needs exactly one of `command` (stdio) or `url` (Streamable HTTP)")
        return self

    @property
    def kind(self) -> Literal["stdio", "http"]:
        return "stdio" if self.command is not None else "http"


class McpConfig(BaseModel):
    mcpServers: dict[str, McpServerConfig] = {}  # noqa: N815 (the file's own camelCase key)

    @model_validator(mode="after")
    def _check_names(self) -> "McpConfig":
        for name in self.mcpServers:
            if not _NAME.match(name):
                raise ValueError(f"MCP server name {name!r}: use lowercase letters, digits and `_` (it prefixes tools)")
        return self


def load_mcp_config(path: Path) -> McpConfig:
    """The parsed file; an empty config if it does not exist. A broken file fails startup."""
    if not path.exists():
        return McpConfig()
    try:
        return McpConfig.model_validate(json.loads(path.read_text()))
    except (json.JSONDecodeError, ValidationError) as e:
        raise McpConfigError(f"Invalid MCP config {path}: {e}") from e


def _expand(values: dict[str, str], env: Mapping[str, str], where: str) -> dict[str, str]:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in env:
            raise McpConfigError(f"{where}: environment variable {name} is not set")
        return env[name]

    return {key: _VAR.sub(replace, value) for key, value in values.items()}


def environment() -> dict[str, str]:
    """`backend/.env` values, overridden by the real environment."""
    values = {k: v for k, v in dotenv_values(BACKEND_DIR / ".env").items() if v is not None}
    return values | dict(os.environ)


def build_toolset(name: str, entry: McpServerConfig, env: Mapping[str, str], timeout: float) -> MCPToolset[Any]:
    """An unconnected toolset for one entry; the id is the server name (stable, Temporal needs it)."""
    common: dict[str, Any] = {"id": name, "init_timeout": timeout, "read_timeout": timeout}
    if entry.command is not None:
        transport = StdioTransport(
            command=entry.command,
            args=entry.args,
            env=_expand(entry.env, env, f"{name}.env") or None,
            cwd=entry.cwd,
        )
        return MCPToolset(transport, **common)
    assert entry.url is not None
    return MCPToolset(entry.url, headers=_expand(entry.headers, env, f"{name}.headers") or None, **common)


class McpToolInfo(BaseModel):
    name: str
    """As the server names it; the agent sees `<server>_<name>`."""
    description: str | None = None


class McpServerInfo(BaseModel):
    name: str
    type: Literal["stdio", "http"]
    status: Literal["connected", "failed", "disabled"]
    description: str | None = None
    tools: list[McpToolInfo] = []
    error: str | None = None


def _describe(error: BaseException) -> str:
    message = str(error) or type(error).__name__
    if isinstance(error, TimeoutError):
        return "timed out"
    if isinstance(error, BaseExceptionGroup):
        group = cast("BaseExceptionGroup[BaseException]", error)
        if group.exceptions:
            return _describe(group.exceptions[0])
    return message


@dataclass
class McpServers:
    """Every configured server (for the UI) and the connected ones (for the agent). Close with `aclose()`."""

    info: list[McpServerInfo] = field(default_factory=list[McpServerInfo])
    connected: dict[str, MCPToolset[Any]] = field(default_factory=dict[str, MCPToolset[Any]])
    _stack: AsyncExitStack = field(default_factory=AsyncExitStack)

    @classmethod
    async def connect(cls, path: Path, *, timeout: float, env: Mapping[str, str] | None = None) -> "McpServers":
        config = load_mcp_config(path)
        env = environment() if env is None else env
        servers = cls()
        for name, entry in config.mcpServers.items():
            base = McpServerInfo(name=name, type=entry.kind, status="disabled", description=entry.description)
            if not entry.enabled:
                servers.info.append(base)
                continue
            try:
                toolset = build_toolset(name, entry, env, timeout)
                # Entered on its own stack first: a server that fails leaves nothing half-open behind.
                # `asyncio.timeout`, not `wait_for`: the session must be entered and exited in this task.
                async with AsyncExitStack() as attempt:
                    async with asyncio.timeout(timeout):
                        await attempt.enter_async_context(toolset)
                        tools = await toolset.list_tools()
                    servers._stack.push_async_exit(attempt.pop_all())
            except Exception as e:  # noqa: BLE001 (any failure: run without this server)
                logger.warning("MCP server %r skipped: %s", name, _describe(e))
                servers.info.append(base.model_copy(update={"status": "failed", "error": _describe(e)}))
                continue
            servers.connected[name] = toolset
            tool_infos = [McpToolInfo(name=t.name, description=t.description) for t in tools]
            servers.info.append(base.model_copy(update={"status": "connected", "tools": tool_infos}))
            logger.info("MCP server %r connected (%d tools)", name, len(tool_infos))
        return servers

    @property
    def names(self) -> list[str]:
        """Every configured server, connected or not (a conversation may keep a failed one selected)."""
        return [s.name for s in self.info]

    def agent_toolsets(self) -> list[AbstractToolset[Deps]]:
        return [conversation_toolset(name, toolset) for name, toolset in self.connected.items()]

    async def aclose(self) -> None:
        await self._stack.aclose()


def conversation_toolset(name: str, toolset: AbstractToolset[Any]) -> AbstractToolset[Deps]:
    """Prefixed with the server name, run through code mode, hidden unless the conversation enabled the server."""

    def enabled(ctx: RunContext[Deps], _tool: ToolDefinition) -> bool:
        return name in ctx.deps.settings.mcp_servers

    return toolset.prefixed(name).with_metadata(**CODE_MODE_METADATA).filtered(enabled)
