"""Configuration, read from the environment and ``backend/.env``."""

from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Model, over any OpenAI-compatible chat completions endpoint.
    model_id: str = ""
    openai_base_url: str | None = None
    openai_api_key: SecretStr = SecretStr("")
    openai_max_retries: int = 2

    db_path: Path = BACKEND_DIR / "data" / "app.db"
    frontend_dist: Path = BACKEND_DIR.parent / "frontend" / "dist"

    max_turns: int = 10
    run_timeout_s: float = 300.0

    # MCP servers; a missing file means none.
    mcp_config_path: Path = BACKEND_DIR / "mcp.json"
    mcp_timeout_s: float = 30.0

    # Tracing is enabled only when both keys are set.
    langfuse_public_key: str | None = None
    langfuse_secret_key: SecretStr | None = None
    langfuse_base_url: str | None = None

    @property
    def langfuse_enabled(self) -> bool:
        return bool(self.langfuse_public_key and self.langfuse_secret_key)
