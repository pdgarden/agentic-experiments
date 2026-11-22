"""Langfuse over OpenTelemetry: the Langfuse client registers its span processor, Pydantic AI emits GenAI spans."""

import logging

from pydantic_ai import Agent
from pydantic_ai.models.instrumented import InstrumentationSettings

from src.settings import Settings

logger = logging.getLogger(__name__)


def setup_observability(settings: Settings) -> bool:
    if not settings.langfuse_enabled:
        return False
    from langfuse import Langfuse

    Langfuse(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        base_url=settings.langfuse_host,
        environment=settings.env,
    )
    Agent.instrument_all(InstrumentationSettings())
    logger.info("Langfuse tracing enabled (%s)", settings.langfuse_host)
    return True


def shutdown_observability(enabled: bool) -> None:
    if enabled:
        from langfuse import get_client

        get_client().flush()
