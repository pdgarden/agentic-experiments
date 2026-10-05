# openai-agents-full-stack

Full-stack chat app around an openai-agents SDK agent. `PLAN.md` is the design (contract, data model, roadmap); `README.md` has setup, run commands and the file layout. v1a (backend) is done; the frontend (v1b) goes in `frontend/`.

- Backend: Python 3.12+, managed with uv. Run backend commands from `backend/` (`uv sync`, `uv run …`), or use the `Makefile` targets from this folder.
- Imports are absolute from the `src` package (`from src.events import …`); relative imports are banned by ruff. `src/agents/` is our package; the SDK is the top-level `agents`.
- `events.py` is the API contract. Change it deliberately: the frontend types are generated from `/openapi.json`, and `tests/fixtures/events/` must be re-recorded (`make fixtures`).
- SDK stream types are handled only in `src/runs/mapping.py`; they never reach the API.
- Schema changes are new numbered files in `src/store/migrations/`; never edit an applied one, never touch the SDK's `agent_sessions` / `agent_messages` tables.
- Tests use `agents.testing.ScriptedModel` (helpers in `tests/fakes.py`), never a real model.
- `backend/.env` and `backend/data/` are gitignored.
- Before finishing a change, run `make check` (or from `backend/`: `uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest -q`).
