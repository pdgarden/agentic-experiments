"""Agent, model and observability setup shared by every front end."""

import os
from pathlib import Path

from agents import (
    Agent,
    OpenAIChatCompletionsModel,
)
from agents.decorators import tool
from dotenv import load_dotenv
from langfuse import get_client
from openai import AsyncOpenAI
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor

from src.python_sandbox import run_python

DB_PATH = Path(__file__).parents[1] / "data" / "conversations.db"
DOTENV_PATH = Path(__file__).parents[1] / ".env"


def setup_observability() -> None:
    """Load the environment and wire the agents SDK to Langfuse.

    Idempotent: ``OpenAIAgentsInstrumentor`` is a process-wide singleton whose
    ``instrument()`` returns early when already instrumented, so a second call
    neither fails nor duplicates spans.
    """
    load_dotenv(DOTENV_PATH)
    OpenAIAgentsInstrumentor().instrument()

    langfuse = get_client()
    if langfuse.auth_check():
        print("Langfuse client is authenticated and ready!")
    else:
        print("Authentication failed. Please check your credentials and host.")


@tool
def divide(a: float, b: float) -> float:
    return a / b


def build_agent() -> Agent[None]:
    """Build the agent.

    Call this from the thread whose event loop will run the agent: the
    ``AsyncOpenAI`` client holds an httpx connection pool bound to that loop.
    """
    client = AsyncOpenAI(
        base_url=os.getenv("OPENAI_BASE_URL"), api_key=os.getenv("OPENAI_API_KEY")
    )
    model = OpenAIChatCompletionsModel(
        model=os.environ["MODEL_ID"], openai_client=client
    )
    return Agent(
        name="Helping Agent",
        instructions="You are a Helping Agent",
        model=model,
        tools=[divide, run_python],
    )
