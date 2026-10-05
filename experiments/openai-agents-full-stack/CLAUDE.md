# openai-agents-full-stack

Full-stack chat app around an openai-agents SDK agent. `PLAN.md` is the design (contract, data model, roadmap); `README.md` has setup, run commands and the file layout. v1a (backend) and v1b (frontend, in `frontend/`) are done.

- Backend: Python 3.12+, managed with uv. Run backend commands from `backend/` (`uv sync`, `uv run …`), or use the `Makefile` targets from this folder.
- Imports are absolute from the `src` package (`from src.events import …`); relative imports are banned by ruff. `src/agents/` is our package; the SDK is the top-level `agents`.
- `events.py` is the API contract. Change it deliberately: the frontend types are generated from `/openapi.json`, and `tests/fixtures/events/` must be re-recorded (`make fixtures`).
- SDK stream types are handled only in `src/runs/mapping.py`; they never reach the API.
- Schema changes are new numbered files in `src/store/migrations/`; never edit an applied one, never touch the SDK's `agent_sessions` / `agent_messages` tables.
- Tests use `agents.testing.ScriptedModel` (helpers in `tests/fakes.py`), never a real model.
- `backend/.env` and `backend/data/` are gitignored.
- Frontend: Vite + React + TypeScript strict, pnpm 11 (pinned via `packageManager`; pnpm 12 does not run under this corepack). Run frontend commands from `frontend/` (`pnpm …`). Imports use the `@/` alias for `src/`.
- TypeScript stays on 5.x: `openapi-typescript` needs its JS compiler API, which TS 7 does not ship.
- `frontend/src/api/schema.gen.ts` is generated (`make gen-types`); never edit it by hand. `make check` fails when it is stale.
- Stream events are folded only in `frontend/src/chat/reducer.ts`, for history and live runs alike. Its tests run against every file in `backend/tests/fixtures/events/`.
- A new part type gets a renderer in `frontend/src/components/MessageParts.tsx`; unknown types render nothing. Markdown from the model is untrusted: keep `rehype-sanitize` and never allow raw HTML.
- shadcn/ui components live in `frontend/src/components/ui/`; `cn` is in `src/utils.ts` (not `src/lib/`, which the repo's root `.gitignore` ignores). After `shadcn add`, check that its imports use `@/utils` and that it added no stray packages.
- Before finishing a change, run `make check` (backend and frontend). Run `make e2e` after UI or stream changes.
- Docker: `make docker` builds `Dockerfile` (Node stage for `frontend/dist`, then the backend with `uv sync --frozen --no-dev`) and runs it via `compose.yaml` with `backend/.env`. Both lockfiles must be current; new runtime files outside `backend/src` or `frontend/` need a `COPY`.
