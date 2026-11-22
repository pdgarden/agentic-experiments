# Agentic experiments

Experiments with agentic tools and frameworks. Each folder under `experiments/` is a
standalone project with its own dependencies, lockfile, `.env` and README.

| Experiment | What it is |
| --- | --- |
| [openai-agents-full-stack](experiments/openai-agents-full-stack/) | Full-stack openai-agents chat app: FastAPI runs streamed over SSE, SQLite event log, Monty sandbox, React + shadcn/ui frontend |
| [openai-agents-streamlit](experiments/openai-agents-streamlit/) | openai-agents SDK chat agent with a Monty Python sandbox, SQLite sessions, Langfuse traces and a Streamlit UI |
| [pydantic-ai-full-stack](experiments/pydantic-ai-full-stack/) | Full-stack Pydantic AI + Harness chat app (phase 1 done): Vercel AI SDK v7 UI, SQLite `ConversationStore`, LiteLLM gateway, Temporal later |
