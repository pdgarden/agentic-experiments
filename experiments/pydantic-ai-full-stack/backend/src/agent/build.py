"""`build_agent()`: the one agent the app runs, built at startup with everything it may ever use.

Per-conversation choices only filter (see PLAN.md, *Temporal-ready from day one*). The model is passed per
run as a catalogue id string, resolved by `ResolveModelId`; thinking comes in per-run `model_settings`.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Any, cast

from pydantic_ai import Agent
from pydantic_ai.capabilities import AbstractCapability, ResolveModelId
from pydantic_ai.models import Model, ModelResolutionContext
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.profiles import ModelProfile
from pydantic_ai.providers.litellm import LiteLLMProvider
from pydantic_ai.settings import ModelSettings
from pydantic_ai.toolsets import AbstractToolset
from pydantic_ai_harness import CodeMode
from pydantic_ai_harness.code_mode import CodeModeResourceLimits
from pydantic_ai_harness.step_persistence import StepPersistence, StepStore

from src.agent.catalogue import Catalogue, ThinkingLevel

INSTRUCTIONS = """\
You are a helpful assistant in a chat app. Answer clearly and concisely; use Markdown when it helps \
(lists, tables, code blocks). When the user attaches files, read them before answering.

Tools, when you have them:
- Search the web for recent or niche facts, then fetch the pages you rely on; cite their URLs.
- `run_code` runs Python in a sandbox (a subset of Python, no installed packages). Use it for exact \
arithmetic and data processing. Tools of connected MCP servers are only callable from inside `run_code`, \
as async functions: gather and aggregate data there and return only what you need.
- Put charts and long documents in artifacts (`create_artifact`) rather than in the reply; revise them \
with `update_artifact`. Chart data must be inline: aggregate it before charting."""


@dataclass
class ConversationSettings:
    """What a conversation chose: stored in the record's `metadata`, copied into deps for each run."""

    model_id: str
    thinking: ThinkingLevel = "off"
    mcp_servers: list[str] = field(default_factory=list[str])
    skills: list[str] = field(default_factory=list[str])

    @classmethod
    def from_metadata(cls, metadata: dict[str, Any] | None, *, default_model: str) -> "ConversationSettings":
        data: dict[str, Any] = (metadata or {}).get("settings") or {}
        return cls(
            model_id=str(data.get("model_id", default_model)),
            thinking=data.get("thinking", "off"),
            mcp_servers=[str(s) for s in data.get("mcp_servers", [])],
            skills=[str(s) for s in data.get("skills", [])],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_id": self.model_id,
            "thinking": self.thinking,
            "mcp_servers": self.mcp_servers,
            "skills": self.skills,
        }


@dataclass
class Deps:
    """Small and serializable on purpose: no DB handles or live objects."""

    conversation_id: str
    settings: ConversationSettings


class GatewayModels:
    """Catalogue id -> `OpenAIChatModel` on the LiteLLM gateway, built lazily and cached."""

    def __init__(self, catalogue: Catalogue, *, gateway_url: str, api_key: str) -> None:
        self.catalogue = catalogue
        self._provider = LiteLLMProvider(api_base=gateway_url, api_key=api_key or None)
        self._models: dict[str, Model] = {}
        self.override: Model | None = None
        """Set by e2e mode: every catalogue id resolves to this model."""

    def get(self, model_id: str) -> Model | None:
        entry = self.catalogue.get(model_id)
        if entry is None:
            return None
        if self.override is not None:
            return self.override
        if model_id not in self._models:
            self._models[model_id] = OpenAIChatModel(
                entry.litellm_name, provider=self._provider, profile=cast(ModelProfile, entry.profile_dict())
            )
        return self._models[model_id]

    def resolve(self, _ctx: ModelResolutionContext[Deps], model_id: str) -> Model | None:
        return self.get(model_id)


def run_model_settings(catalogue: Catalogue, settings: ConversationSettings) -> ModelSettings:
    return ModelSettings(thinking=catalogue.thinking_setting(settings.model_id, settings.thinking))


@dataclass
class CodeModeLimits:
    max_seconds: float = 10.0
    max_memory_bytes: int = 128 * 1024 * 1024
    max_tool_calls: int = 25


CODE_MODE_SELECTOR = {"code_mode": True}
"""Tools whose metadata matches run inside `run_code` (MCP tools); the others stay direct calls."""


def build_agent(
    models: GatewayModels,
    *,
    step_store: StepStore,
    toolsets: list[AbstractToolset[Deps]] | None = None,
    capabilities: list[AbstractCapability[Deps]] | None = None,
    code_mode: CodeModeLimits | None = None,
) -> Agent[Deps, str]:
    """Every toolset and capability the app may use, each with a stable id; conversations only filter them."""
    limits = code_mode or CodeModeLimits()
    resource_limits = CodeModeResourceLimits(
        max_duration_seconds=limits.max_seconds, max_memory=limits.max_memory_bytes
    )
    agent = Agent[Deps, str](
        None,
        name="chat_agent",
        deps_type=Deps,
        instructions=INSTRUCTIONS,
        toolsets=toolsets or [],
        capabilities=[
            ResolveModelId(models.resolve),
            *(capabilities or []),
            CodeMode(
                tools=CODE_MODE_SELECTOR,
                resource_limits=resource_limits,
                max_tool_calls=limits.max_tool_calls,
            ),
            StepPersistence(store=step_store, capture_frontier=True),
        ],
    )

    @agent.instructions
    def today() -> str:  # pyright: ignore[reportUnusedFunction]
        return f"Today is {date.today().isoformat()}."

    return agent
