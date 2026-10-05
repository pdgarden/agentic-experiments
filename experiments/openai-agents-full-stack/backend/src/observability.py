"""Optional Langfuse tracing, adapted from ``openai-agents-streamlit``.

Enabled only when the Langfuse keys are set, so tests and fresh clones run
without it. When disabled, SDK tracing is turned off entirely: its default
exporter would otherwise try to send traces to the OpenAI platform.
"""

import logging

from agents import set_tracing_disabled
from langfuse import Langfuse
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor

from src.settings import Settings

logger = logging.getLogger(__name__)


def setup_observability(settings: Settings) -> None:
    """Wire the agents SDK to Langfuse, or disable tracing.

    Idempotent: ``OpenAIAgentsInstrumentor`` is a process-wide singleton whose
    ``instrument()`` returns early when already instrumented. It replaces the
    SDK's trace processors with its own (``exclusive_processor`` defaults to
    true), so nothing goes to the OpenAI exporter either way.
    """
    if not settings.langfuse_enabled or settings.langfuse_secret_key is None:
        set_tracing_disabled(True)
        return

    set_tracing_disabled(False)
    # Registers the global OpenTelemetry provider the instrumentor exports to.
    langfuse = Langfuse(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key.get_secret_value(),
        base_url=settings.langfuse_base_url,
    )
    OpenAIAgentsInstrumentor().instrument()
    if langfuse.auth_check():
        logger.info("Langfuse tracing enabled")
    else:
        logger.warning("Langfuse authentication failed; check keys and base URL")
