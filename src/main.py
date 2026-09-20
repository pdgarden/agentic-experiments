import os
from pathlib import Path
from dotenv import load_dotenv
from agents import (
    Agent,
    Runner,
    AsyncOpenAI,
    OpenAIChatCompletionsModel,
)
import nest_asyncio
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor
from langfuse import get_client
from agents.decorators import tool

nest_asyncio.apply()
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

result = Runner.run_sync(
    agent,
    "What is 4201.1 / 33.1 ? DO NOT overthink. Are the 4 numbers after the comma higher than the current year ? use the tools at your disposal.",
)
print(result.final_output)
