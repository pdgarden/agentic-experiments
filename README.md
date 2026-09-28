# Agentic experiments

Experiments with agentic tools and frameworks, mostly using the openai-agents SDK.

A small chat agent (a `divide` tool, plus `run_python`, which runs code in the
[Monty](https://github.com/pydantic/monty) sandbox) over an OpenAI-compatible endpoint, with
conversations persisted to SQLite and traces sent to Langfuse.

## Setup

Requires [uv](https://docs.astral.sh/uv/) and Python 3.12+.

```bash
uv sync
```

Create a `.env` at the repo root:

```dotenv
MODEL_ID=...
OPENAI_BASE_URL=...
OPENAI_API_KEY=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=...
```

## Run

Chat UI — pick a past conversation in the sidebar or start a new one; replies stream
and tool calls are shown inline:

```bash
uv run streamlit run src/app.py
```

One-shot script, for a single turn against a stored conversation:

```bash
uv run python -m src.simple_agent
```

## Layout

| Path | Role |
| --- | --- |
| `src/agent_config.py` | Agent, model and Langfuse setup |
| `src/agent_runtime.py` | Background event loop, turn streaming, conversation listing |
| `src/python_sandbox.py` | `run_python` tool backed by the Monty sandbox |
| `src/app.py` | Streamlit chat UI |
| `src/simple_agent.py` | Minimal one-shot example |
| `data/conversations.db` | Conversation history (gitignored) |

## Checks

```bash
uv run ruff check src && uv run ruff format --check src && uv run pyright src
```
