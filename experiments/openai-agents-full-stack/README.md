# openai-agents-full-stack

A local, single-user chat app around an openai-agents SDK agent: FastAPI backend, SQLite
persistence, runs streamed over SSE. Design and roadmap: [PLAN.md](PLAN.md).

**Status: v1 done**: backend (v1a) and React frontend (v1b). Next on the roadmap: the sandbox
protocol, then artifacts.

## Setup

Requires [uv](https://docs.astral.sh/uv/), Python 3.12+, Node 24+ (`frontend/.nvmrc`), pnpm and
`make`. pnpm is pinned to 11 by `packageManager` in `frontend/package.json`; `corepack enable pnpm`
provides it.

```bash
make install                           # uv sync + pnpm install
cp backend/.env.example backend/.env   # then fill in MODEL_ID, OPENAI_BASE_URL, OPENAI_API_KEY
```

Langfuse tracing is enabled only when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set.

## Run

```bash
make dev     # API on :8000 + Vite on http://127.0.0.1:5173 (proxies /api), both with reload
make run     # builds frontend/dist, then serves it and the API on http://127.0.0.1:8000
```

Or in Docker (needs only Docker and `backend/.env`):

```bash
make docker        # docker compose up --build: one image, UI + API on http://127.0.0.1:8000
make docker-down   # stop; chats persist in the `data` volume (docker compose down -v drops it)
```

The image builds the frontend in a Node stage and runs the backend with its locked runtime
dependencies; `backend/.env` is passed at run time, never baked in. A model server on the host
is `http://host.docker.internal:<port>/v1` from inside the container, not `localhost`.

The UI lists chats on the left (rename, delete); the selected chat is in the URL hash, so a
reload reopens it and resumes a run still in progress. The first message of a new chat creates
it. Tool calls show as cards with their arguments and result; Stop cancels the run.

Or drive the API directly:

```bash
S=$(curl -s -XPOST localhost:8000/api/sessions -H 'content-type: application/json' -d '{}' | jq -r .id)
R=$(curl -s -XPOST localhost:8000/api/sessions/$S/runs -H 'content-type: application/json' \
  -d '{"parts":[{"type":"text","text":"What is 2**100? Use Python."}]}' | jq -r .run_id)
curl -N localhost:8000/api/runs/$R/events          # replay + live tail, closes after run_finished
curl -s localhost:8000/api/sessions/$S | jq         # the session, its runs and their events
curl -XPOST localhost:8000/api/runs/$R/cancel      # stop a running run
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sessions` | List sessions |
| `POST` | `/api/sessions` | Create session |
| `GET` | `/api/sessions/{id}` | Session + its runs with events |
| `PATCH` | `/api/sessions/{id}` | Rename |
| `DELETE` | `/api/sessions/{id}` | Hard delete (stops its runs, clears agent history) |
| `POST` | `/api/sessions/{id}/runs` | Start a run → `201 {run_id}`; `409` if one is running |
| `GET` | `/api/runs/{id}/events?after=` | SSE: replay after `seq`, then live tail; honours `Last-Event-ID` |
| `POST` | `/api/runs/{id}/cancel` | Cancel → `202`; `409` if not running |

Every SSE message has `id: <seq>` and `data:` one event of the union in
`backend/src/events.py`: `run_started`, `user_message`, `text_delta`, `tool_call`,
`tool_result`, `agent_changed`, `run_finished`, `error`. The union (and the `Part` union from
`parts.py`) is published in `/openapi.json`; `make gen-types` turns it into
`frontend/src/api/schema.gen.ts`, and `make check` fails if that file is stale.

## Layout

| Path | Role |
| --- | --- |
| `Dockerfile`, `compose.yaml` | Single image (frontend build + backend), run with `backend/.env` and a data volume |
| `backend/src/events.py` | Stream event union: the API contract |
| `backend/src/parts.py` | Message part union (`TextPart`, `ToolPart`) |
| `backend/src/settings.py` | Config from env and `backend/.env` |
| `backend/src/app.py` | App factory, lifespan, static frontend |
| `backend/src/api/` | Routers (sessions, runs) and the OpenAPI contract patch |
| `backend/src/agents/` | Agent registry + factories, `run_python` (Monty) tool, tool error marking |
| `backend/src/runs/` | Run service (task, persistence, cancel, timeout), SDK → event mapping, live fan-out, SDK sessions |
| `backend/src/store/` | SQLite connection, migration runner, `migrations/*.sql`, repository |
| `backend/tests/` | Scripted-model fakes, store / mapping / API + SSE tests, recorded event fixtures |
| `backend/tests/e2e_app.py` | The app with a scripted model, for the Playwright test |
| `backend/data/app.db` | App data and SDK history (gitignored) |
| `frontend/src/api/` | Generated types (`schema.gen.ts`), typed REST client, SSE reader, query keys |
| `frontend/src/chat/` | Events → parts reducer, session run state, `useChat` (history + live tail) |
| `frontend/src/components/` | Chat view, composer, per-part renderers (markdown, tool card), session list |
| `frontend/src/components/ui/` | shadcn/ui components (added with `pnpm dlx shadcn add …`) |
| `frontend/e2e/` | Playwright happy path |

## Checks

```bash
make check   # backend: ruff, pyright strict, pytest; frontend: Biome, tsc --strict, Vitest; types fresh
make cov     # tests with coverage, backend and frontend
make e2e     # Playwright: builds the frontend, runs it against the backend with a scripted model
```

Run `pnpm exec playwright install chromium` in `frontend/` once before `make e2e`.

Tests never call a real model: they use the SDK's `agents.testing.ScriptedModel`.
`backend/tests/fixtures/events/` holds recorded event sequences; the frontend reducer tests fold
every file there. Re-record with `make fixtures`.
