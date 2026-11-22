import os
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

from src.app import create_app  # noqa: E402
from src.services import Services, get_services  # noqa: E402
from src.settings import Settings  # noqa: E402
from src.store.conversations import SqliteConversationStore  # noqa: E402
from src.store.db import Database  # noqa: E402


@pytest.fixture
async def db() -> AsyncIterator[Database]:
    database = await Database.open(":memory:")
    yield database
    await database.close()


@pytest.fixture
async def sqlite_store(db: Database) -> SqliteConversationStore:
    return SqliteConversationStore(db)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,  # pyright: ignore[reportCallIssue]
        env="test",
        data_dir=tmp_path / "data",
        models_file=Path(__file__).parent / "models.json",
        mcp_config_path=tmp_path / "no-mcp.json",
        tavily_api_key="",
        frontend_dist=tmp_path / "no-dist",
        langfuse_public_key="",
        langfuse_secret_key="",
        model_override="e2e",
        run_buffer_ttl_seconds=5,
    )


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
def services(app: FastAPI) -> Services:  # noqa: ARG001
    return get_services()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
