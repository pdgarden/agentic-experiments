# openai-agents-full-stack

A local, single-user chat app around an openai-agents SDK agent: FastAPI backend, SQLite
persistence, runs streamed over SSE. Design and roadmap: [PLAN.md](PLAN.md).

**Status: v1a (backend) done.** The frontend (v1b) is next; until then, drive the API with
`curl`.

## Setup

Requires [uv](https://docs.astral.sh/uv/), Python 3.12+ and `make`.

```bash
make install
cp backend/.env.example backend/.env   # then fill in MODEL_ID, OPENAI_BASE_URL, OPENAI_API_KEY
```

Langfuse tracing is enabled only when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set.

## Run

```bash
make dev     # API with reload on http://127.0.0.1:8000 (docs at /docs)
make run     # same without reload; also serves frontend/dist at / once it exists
```

Try a run:

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
`parts.py`) is published in `/openapi.json` for type generation; see `make openapi`.

## Layout

| Path | Role |
| --- | --- |
| `backend/src/events.py` | Stream event union: the API contract |
| `backend/src/parts.py` | Message part union (`TextPart`, `ToolPart`) |
| `backend/src/settings.py` | Config from env and `backend/.env` |
| `backend/src/app.py` | App factory, lifespan, static frontend |
| `backend/src/api/` | Routers (sessions, runs) and the OpenAPI contract patch |
| `backend/src/agents/` | Agent registry + factories, `run_python` (Monty) tool, tool error marking |
| `backend/src/runs/` | Run service (task, persistence, cancel, timeout), SDK → event mapping, live fan-out, SDK sessions |
| `backend/src/store/` | SQLite connection, migration runner, `migrations/*.sql`, repository |
| `backend/tests/` | Scripted-model fakes, store / mapping / API + SSE tests, recorded event fixtures |
| `backend/data/app.db` | App data and SDK history (gitignored) |

## Checks

```bash
make check   # ruff, ruff format --check, pyright strict, pytest
make cov     # tests with coverage
```

Tests never call a real model: they use the SDK's `agents.testing.ScriptedModel`.
`backend/tests/fixtures/events/` holds recorded event sequences for the frontend reducer tests;
re-record with `make fixtures`.
