"""FastAPI app factory: `uvicorn src.app:create_app --factory`."""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.api import artifacts, catalogue, chat, conversations, files
from src.observability import setup_observability, shutdown_observability
from src.runs.recovery import recover_interrupted_runs
from src.services import start_services, stop_services
from src.settings import Settings, get_settings

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
        tracing = setup_observability(settings)
        services = await start_services(settings)
        flagged = await recover_interrupted_runs(services.step_store, services.store)
        if flagged:
            logger.warning("flagged %d interrupted conversation(s): %s", len(flagged), ", ".join(flagged))
        try:
            yield
        finally:
            await stop_services(services)
            shutdown_observability(tracing)

    app = FastAPI(title="pydantic-ai-full-stack", lifespan=lifespan)
    for router in (chat.router, conversations.router, files.router, catalogue.router, artifacts.router):
        app.include_router(router)

    @app.get("/api/health", tags=["meta"])
    async def health() -> dict[str, str]:  # pyright: ignore[reportUnusedFunction]
        return {"status": "ok"}

    dist = settings.frontend_dist
    if (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str) -> FileResponse:  # pyright: ignore[reportUnusedFunction]
            candidate = (dist / path).resolve()
            if path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app
