"""Agents are built by name, so any run can be rebuilt from what is stored.

A session records its ``current_agent``; each run rebuilds that agent from
here. Factories take the model as an argument so tests can inject a scripted
one. An agent's ``name`` is its registry key: ``result.last_agent.name`` after
a handoff is then directly the next run's agent.
"""

from collections.abc import Callable

from agents import Agent, Model, ModelSettings, OpenAIChatCompletionsModel
from agents.mcp import MCPServer
from openai import AsyncOpenAI

from src.agents.artifact_tools import create_chart, update_chart
from src.agents.python_tool import run_python
from src.runs.context import RunContext
from src.settings import Settings

type AgentFactory = Callable[[Model, list[MCPServer]], Agent[RunContext]]

DEFAULT_AGENT = "assistant"

# Streamed chat completions report no usage unless asked to.
_MODEL_SETTINGS = ModelSettings(include_usage=True)


def _assistant(model: Model, mcp_servers: list[MCPServer]) -> Agent[RunContext]:
    return Agent[RunContext](
        name="assistant",
        instructions=(
            "You are a helpful assistant."
        ),
        model=model,
        model_settings=_MODEL_SETTINGS,
        tools=[run_python, create_chart, update_chart],
        mcp_servers=mcp_servers,
        # MCP tools are named mcp_<server>__<tool>: no clashes between servers,
        # and the tool card shows where a call went.
        mcp_config={"include_server_in_tool_names": True},
    )


AGENTS: dict[str, AgentFactory] = {
    "assistant": _assistant,
}


def build_agent(
    name: str, model: Model, mcp_servers: list[MCPServer] | None = None
) -> Agent[RunContext]:
    """The named agent, or the default one if that name is no longer registered.

    ``mcp_servers`` are already connected; agents share them across runs.
    """
    factory = AGENTS.get(name, AGENTS[DEFAULT_AGENT])
    return factory(model, mcp_servers or [])


def build_model(settings: Settings) -> Model:
    """The real model, over the configured OpenAI-compatible endpoint.

    Call it from the server's event loop: the client's connection pool binds
    to the loop it first runs on.
    """
    client = AsyncOpenAI(
        base_url=settings.openai_base_url or None,
        api_key=settings.openai_api_key.get_secret_value(),
        max_retries=settings.openai_max_retries,
    )
    return OpenAIChatCompletionsModel(model=settings.model_id, openai_client=client)
