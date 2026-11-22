"""Long-lived services, built in the lifespan. Tools reach them through `get_services()`, never through deps."""

from dataclasses import dataclass

from pydantic_ai import Agent
from pydantic_ai_harness.step_persistence import SqliteStepStore, StepStore

from src.agent.build import CodeModeLimits, GatewayModels, build_agent
from src.agent.catalogue import Catalogue, load_catalogue
from src.agent.e2e import scripted_model
from src.agent.mcp import McpServers
from src.runs.chat import ChatService
from src.runs.manager import RunManager
from src.settings import Settings
from src.store.artifacts import ArtifactStore
from src.store.conversations import SqliteConversationStore
from src.store.db import Database
from src.store.files import FileStore
from src.tools.artifacts import artifact_toolset
from src.tools.web import web_capabilities

TITLE_INSTRUCTIONS = (
    "Write a short title (at most 6 words) for a conversation that starts with the user's message below. "
    "Reply with the title only: no quotes, no trailing punctuation."
)


@dataclass
class Services:
    settings: Settings
    db: Database
    catalogue: Catalogue
    models: GatewayModels
    store: SqliteConversationStore
    files: FileStore
    artifacts: ArtifactStore
    mcp: McpServers
    step_store: StepStore
    runs: RunManager
    chat: ChatService


_services: Services | None = None


def get_services() -> Services:
    if _services is None:
        raise RuntimeError("services are not started")
    return _services


async def start_services(settings: Settings, *, step_store: StepStore | None = None) -> Services:
    global _services
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    db = await Database.open(settings.app_db)
    catalogue = load_catalogue(settings.models_file)
    models = GatewayModels(catalogue, gateway_url=settings.gateway_url, api_key=settings.gateway_api_key)
    if settings.model_override == "e2e":
        models.override = scripted_model()
    store = SqliteConversationStore(db)
    files = FileStore(db, settings.files_dir)
    step_store = step_store or SqliteStepStore(database=settings.steps_db)
    artifacts = ArtifactStore(db)
    runs = RunManager(ttl_seconds=settings.run_buffer_ttl_seconds)
    mcp = await McpServers.connect(settings.mcp_config_path, timeout=settings.mcp_timeout_seconds)
    agent = build_agent(
        models,
        step_store=step_store,
        toolsets=[artifact_toolset(artifacts), *mcp.agent_toolsets()],
        capabilities=web_capabilities(settings),
        code_mode=CodeModeLimits(
            max_seconds=settings.code_mode_max_seconds,
            max_memory_bytes=settings.code_mode_max_memory_bytes,
            max_tool_calls=settings.code_mode_max_tool_calls,
        ),
    )
    title_agent: Agent[None, str] = Agent(None, name="title_agent", instructions=TITLE_INSTRUCTIONS)
    chat = ChatService(
        agent=agent,
        store=store,
        files=files,
        runs=runs,
        catalogue=catalogue,
        models=models,
        title_agent=title_agent,
    )
    _services = Services(
        settings=settings,
        db=db,
        catalogue=catalogue,
        models=models,
        store=store,
        files=files,
        artifacts=artifacts,
        mcp=mcp,
        step_store=step_store,
        runs=runs,
        chat=chat,
    )
    return _services


async def stop_services(services: Services) -> None:
    global _services
    await services.runs.shutdown()
    await services.mcp.aclose()
    await services.db.close()
    _services = None
