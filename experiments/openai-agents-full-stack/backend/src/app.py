"""FastAPI app: the API under ``/api`` and, when built, the frontend at ``/``.

Run with ``uvicorn src.app:create_app --factory``.
"""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from agents import Model
from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles

from src.agents.mcp_servers import connected_mcp_servers
from src.agents.python_tool import close_sandbox
from src.agents.registry import build_model
from src.api import runs, sessions
from src.api.contract import install_contract
from src.api.deps import Services
from src.observability import setup_observability
from src.runs.sdk_sessions import SdkSessions
from src.runs.service import RunService
from src.settings import Settings
from src.store.db import connect
from src.store.repo import Store

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, model: Model | None = None) -> FastAPI:
    """Build the app; tests pass their own settings and a scripted ``model``."""
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        conn = await connect(settings.db_path)
        store = Store(conn)
        interrupted = await store.interrupt_running_runs()
        if interrupted:
            logger.warning(
                "Marked %d unfinished run(s) as interrupted", len(interrupted)
            )

        if model is None:
            setup_observability(settings)
        sdk_sessions = SdkSessions(settings.db_path)
        try:
            async with connected_mcp_servers(settings) as mcp_servers:
                run_service = RunService(
                    store,
                    sdk_sessions,
                    model or build_model(settings),
                    settings,
                    mcp_servers,
                )
                app.state.services = Services(
                    store=store, runs=run_service, sdk_sessions=sdk_sessions
                )
                try:
                    yield
                finally:
                    # Runs stop before their MCP servers disconnect.
                    await run_service.shutdown()
        finally:
            await sdk_sessions.close()
            await close_sandbox()
            await conn.close()

    app = FastAPI(title="openai-agents-full-stack", lifespan=lifespan)
    api = APIRouter(prefix="/api")
    api.include_router(sessions.router)
    api.include_router(runs.router)
    app.include_router(api)
    install_contract(app)

    if settings.frontend_dist.is_dir():
        app.mount(
            "/", StaticFiles(directory=settings.frontend_dist, html=True), name="ui"
        )
    return app
