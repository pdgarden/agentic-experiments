import asyncio
import os
from pathlib import Path

import nest_asyncio
from agents import (
    Agent,
    OpenAIChatCompletionsModel,
    Runner,
)
from agents.decorators import tool
from agents.extensions.memory import AsyncSQLiteSession
from dotenv import load_dotenv
from langfuse import get_client
from openai import AsyncOpenAI
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor

# Setup

nest_asyncio.apply()  # pyright: ignore[reportUnknownMemberType]
dotenv_path = Path(__file__).parents[1] / ".env"
load_dotenv(dotenv_path)
OpenAIAgentsInstrumentor().instrument()


langfuse = get_client()
# Verify connection
if langfuse.auth_check():
    print("Langfuse client is authenticated and ready!")
else:
    print("Authentication failed. Please check your credentials and host.")


# Model
model_id = os.environ["MODEL_ID"]
client = AsyncOpenAI(
    base_url=os.getenv("OPENAI_BASE_URL"), api_key=os.getenv("OPENAI_API_KEY")
)
model = OpenAIChatCompletionsModel(model=model_id, openai_client=client)

# Tools


@tool
def divide(a: float, b: float) -> float:
    return a / b


agent = Agent(
    name="Helping Agent",
    instructions="You are a Helping Agent",
    model=model,
    tools=[divide],
)


async def main():
    session = AsyncSQLiteSession(
        "session_id_0",
        db_path=Path(__file__).parents[1] / "data" / "conversations.db",
    )
    result = await Runner.run(agent, "What was my previous message?", session=session)
    print(result.final_output)
    await session.close()


if __name__ == "__main__":
    asyncio.run(main())
