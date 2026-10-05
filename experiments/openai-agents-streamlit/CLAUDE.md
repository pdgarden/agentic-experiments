# openai-agents-streamlit

Chat agent built on the openai-agents SDK, with a Streamlit UI. See `README.md` for setup, run commands and the file layout.

- Python 3.12+, managed with uv. Run every command from this folder (`uv sync`, `uv run …`).
- Imports are absolute from the `src` package (`from src.agent_config import …`); relative imports are banned by ruff.
- `.env` and `data/` (SQLite conversation history) live in this folder and are gitignored.
- Before finishing a change, run: `uv run ruff check src && uv run ruff format --check src && uv run pyright src`
