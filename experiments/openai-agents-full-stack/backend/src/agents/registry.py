"""Agents are built by name, so any run can be rebuilt from what is stored.

A session records its ``current_agent``; each run rebuilds that agent from
here. Factories take the model as an argument so tests can inject a scripted
one. An agent's ``name`` is its registry key: ``result.last_agent.name`` after
a handoff is then directly the next run's agent.
"""

from collections.abc import Callable

from agents import Agent, Model, ModelSettings, OpenAIChatCompletionsModel
from openai import AsyncOpenAI

from src.agents.python_tool import run_python
from src.settings import Settings

type AgentFactory = Callable[[Model], Agent[None]]

DEFAULT_AGENT = "assistant"

# Streamed chat completions report no usage unless asked to.
_MODEL_SETTINGS = ModelSettings(include_usage=True)


def _assistant(model: Model) -> Agent[None]:
    return Agent(
        name="assistant",
        instructions=(
            "You are a helpful assistant. Use the run_python tool for any"
            " computation or data manipulation instead of doing it in your head."
        ),
        model=model,
        model_settings=_MODEL_SETTINGS,
        tools=[run_python],
    )


AGENTS: dict[str, AgentFactory] = {
    "assistant": _assistant,
}


def build_agent(name: str, model: Model) -> Agent[None]:
    """The named agent, or the default one if that name is no longer registered."""
    factory = AGENTS.get(name, AGENTS[DEFAULT_AGENT])
    return factory(model)


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
