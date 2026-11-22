"""App settings, read from the environment and `backend/.env`."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    data_dir: Path = BACKEND_DIR / "data"
    models_file: Path = BACKEND_DIR / "models.json"
    mcp_config_path: Path = BACKEND_DIR / "mcp.json"
    """MCP server catalogue (gitignored); absent means no MCP servers."""
    frontend_dist: Path = BACKEND_DIR.parent / "frontend" / "dist"

    gateway_url: str = "http://localhost:4000"
    gateway_api_key: str = ""

    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"

    tavily_api_key: str = ""
    """Enables the `web_search` tool (Tavily). Without it the agent has no web search."""
    web_fetch_blocked_domains: list[str] = []
    mcp_timeout_seconds: float = 30.0
    """Startup (connect + list tools) and per-request timeout for each MCP server."""

    code_mode_max_seconds: float = 10.0
    code_mode_max_memory_bytes: int = 128 * 1024 * 1024
    code_mode_max_tool_calls: int = 25

    max_upload_bytes: int = 10 * 1024 * 1024
    run_buffer_ttl_seconds: float = 60.0

    model_override: Literal["e2e"] | None = None
    """Swap every catalogue model for a scripted `FunctionModel` (end-to-end tests only)."""

    @model_validator(mode="after")
    def _override_only_in_tests(self) -> "Settings":
        if self.model_override is not None and self.env != "test":
            raise ValueError("MODEL_OVERRIDE is only allowed with ENV=test")
        return self

    @property
    def app_db(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def steps_db(self) -> Path:
        return self.data_dir / "steps.db"

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

    @property
    def langfuse_enabled(self) -> bool:
        return bool(self.langfuse_public_key and self.langfuse_secret_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
