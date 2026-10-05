# openai-agents-full-stack — design plan

Plan for a local, single-user, full-stack AI agent app. v1a (backend) and v1b (frontend) are implemented; the sandbox protocol is next.

## Goals

- Chat with an openai-agents SDK agent from a web UI, with streamed responses and visible tool calls.
- Persist conversations in SQLite; a page reload resumes a run in progress.
- Leave room for later additions without large rewrites: artifacts, a code sandbox, multiple agents, human approval of tool calls.

### Non-goals (local, single-user)

- Auth, multi-tenancy, `user_id` columns.
- Deployment, Docker, production CORS, rate limiting beyond basic retries.
- Multiple server processes: runs, locks and live fan-out live in one process.
- CI is optional; local `make check` + pre-commit is the gate.

## Stack

### Backend

- Python 3.12+, managed with **uv**
- **FastAPI** (+ uvicorn)
- **openai-agents** SDK
  - Model config copied from `openai-agents-streamlit`: `OpenAIChatCompletionsModel` with `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `MODEL_ID`
  - `ModelSettings(include_usage=True)`: streamed chat completions report no usage without it
- **SQLite** via `aiosqlite`, WAL mode, one file `data/app.db`
  - SDK `AsyncSQLiteSession` (`agents.extensions.memory`) for the agent's input-item history: the model's memory only
  - Own tables for app data (sessions, runs, events, later artifacts)
- **Migrations**: numbered `.sql` files + a `PRAGMA user_version` runner (~30 lines, no SQLAlchemy). Never touches SDK-owned tables (`agent_sessions`, `agent_messages`).
- **pydantic-settings** for config (`.env`, gitignored)
- **SSE**: FastAPI's native `EventSourceResponse` (`fastapi.sse`, with keepalive pings); each event sent with `id: <seq>`
- **Langfuse** / OpenInference tracing: `setup_observability` copied from `openai-agents-streamlit`, enabled only when Langfuse keys are set (tests and fresh clones run without them)

### Frontend

- **Vite + React + TypeScript** (strict). No Next.js: FastAPI is the only server.
- **pnpm**, Node version pinned (`.nvmrc` + `engines`)
- **Tailwind + shadcn/ui** for components
- **TanStack Query** for server state (session list, history)
- Chat UI: hand-rolled stream client + an events → parts reducer. (assistant-ui would need an external-store adapter around our own event protocol; not worth it.)
- `react-markdown` + syntax highlighting, **sanitized** (model/tool output is untrusted)
- Generated TS types (`openapi-typescript` or `@hey-api/openapi-ts`)
  - Caveat: the SSE endpoint does not expose the event union in OpenAPI. Publish it explicitly (`openapi_extra` / a schema-only route, or TS generated from `TypeAdapter(Event).json_schema()`), otherwise the main contract stays untyped.

### Running

- Dev: Vite dev server with a proxy to FastAPI (no CORS config needed)
- Local "prod": `make run` builds the frontend and FastAPI serves the static files + API on one URL

## Architecture

### Layout

```
experiments/openai-agents-full-stack/
├── README.md, CLAUDE.md, PLAN.md, Makefile
├── backend/
│   ├── pyproject.toml, uv.lock
│   ├── src/
│   │   ├── api/          # FastAPI routers (sessions, runs)
│   │   ├── agents/       # agent registry + factories, tools (run_python)
│   │   ├── runs/         # run task, SDK → event mapping, live fan-out
│   │   ├── sandbox/      # Sandbox protocol + implementations (later)
│   │   ├── store/        # SQLite access, migrations/*.sql
│   │   ├── events.py     # stream event union (the API contract)
│   │   ├── parts.py      # message part union
│   │   └── settings.py
│   └── tests/            # fakes.py (ScriptedModel helpers), store, mapping, API + stream tests
└── frontend/
    ├── package.json
    └── src/
        ├── api/          # generated types + thin client + SSE reader
        ├── chat/         # events → parts reducer (live + history)
        ├── components/   # Chat, MessageParts, SessionList
        └── ...
```

### Extension points (the parts that are expensive to change later)

1. **Messages are lists of typed parts, not strings.**
   v1: `Part = TextPart | ToolPart`. `ToolPart` merges call and result (`call_id`, `name`, `args`, `status: running|ok|error`, `result`) because the UI renders them as one card.
   Later: `ArtifactRefPart`, `FilePart`, … New capability = new part type. Frontend renders through a per-type renderer registry and ignores unknown types.

2. **Stream events are a versioned discriminated union** (Pydantic, exported to TS).
   Envelope: `{v, run_id, seq, type, ...}`; versioning lives on the envelope, not on each event.
   v1:
   - `run_started`
   - `user_message`
   - `text_delta` (with `segment_id`, so text interrupted by tool calls becomes separate parts)
   - `tool_call`, `tool_result` (linked by `call_id`, `is_error` on the result)
   - `agent_changed`
   - `run_finished` (`status`, `usage`)
   - `error`

   Later: `artifact_created`, `artifact_updated`, `sandbox_stdout`, `approval_required`.
   SDK event types never reach the frontend; `Runner.run_streamed` events are mapped in one module.

3. **Runs are a resource, decoupled from the HTTP request — from v1.**
   - `POST /sessions/{id}/runs` → `201 {run_id}`; the run executes as an in-process `asyncio` task.
   - The task appends each event to the `events` table (`run_id`, `seq`, `type`, `payload`), then fans it out to in-memory subscribers.
   - `GET /runs/{id}/events?after=<seq>` replays from the DB, then tails live events; it closes after `run_finished`. Works with `EventSource`, so reload/reconnect resumes for free.
   - Closing the tab does not stop a run; `POST /runs/{id}/cancel` does (`result.cancel()`).
   - On startup, runs left `running` are marked `interrupted`.
   - The task always drains the SDK stream (an undrained stream stalls the SDK run loop and leaves the session half-written; see `openai-agents-streamlit`'s `start_turn`).
   - Enables human-in-the-loop later: pause on `approval_required`, persist `result.to_state()`, resume via `POST /runs/{id}/approve` with `RunState` (needs agents rebuildable by name, see 6).

4. **Artifacts are stored outside messages** (later).
   Table `artifacts` (`id`, `session_id`, `kind`, `version`, `title`, `created_at`), content in DB or `data/artifacts/`. Created/updated by tools; the stream carries references and updates only. UI shows them in a side panel fetched by id. Versioning comes naturally.

5. **Sandbox behind a protocol** (later).
   v1 ships `run_python`, copied (not imported) from `openai-agents-streamlit/src/python_sandbox.py` (Monty). Later: a `Sandbox` protocol with `run(code)` and file operations, one working directory per session; swap for Docker or a hosted sandbox without touching agent code.

6. **Agent registry + factory.**
   Agents are built by named factories. Each session records `current_agent`, updated from `result.last_agent` at the end of a run, so a handoff carries over to the next message. Handoffs surface as `agent_changed` events.

7. **Migrations from day one.**

### Data model (v1)

Events are the only source of UI history; there is no `messages` table. The frontend folds a run's events into parts with the same reducer it uses while streaming.

| Table | Columns |
| --- | --- |
| `sessions` | `id`, `title`, `current_agent`, `created_at`, `updated_at` |
| `runs` | `id`, `session_id`, `input` (JSON parts), `status` (`running` / `succeeded` / `failed` / `cancelled` / `interrupted`), `started_at`, `ended_at`, `usage` (JSON), `error` |
| `events` | `run_id`, `seq`, `type`, `payload` (JSON), `created_at`; PK `(run_id, seq)` |
| SDK tables | managed by `AsyncSQLiteSession` (agent input history) |

- Delete is a hard delete: cascade to runs and events, and `clear_session()` the SDK session.
- `text_delta` events are persisted as they arrive (fine at local scale).

### API (v1)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sessions` | List sessions |
| `POST` | `/api/sessions` | Create session |
| `GET` | `/api/sessions/{id}` | Session + its runs with events (frontend folds them) |
| `PATCH` | `/api/sessions/{id}` | Rename |
| `DELETE` | `/api/sessions/{id}` | Delete (hard) |
| `POST` | `/api/sessions/{id}/runs` | Start a run → `201 {run_id}` |
| `GET` | `/api/runs/{id}/events?after=` | SSE: replay + live tail |
| `POST` | `/api/runs/{id}/cancel` | Cancel a running run |

- Concurrency: one active run per session; a second `POST …/runs` gets `409`.
- Title: auto-set from the first user message (truncated, no LLM call); renamable.

### Robustness

- `max_turns`, and an overall run timeout wrapping the task (`asyncio.timeout`)
- Handle `MaxTurnsExceeded`, guardrail tripwires, timeouts, OpenAI errors/retries → `error` event + `run_finished{status: failed}`, shown in the UI
- Tool errors are surfaced as `tool_result` with `is_error`, not swallowed
- Record token usage per run (requires `include_usage`, see Stack)
- Explicit cancel; interrupted-run recovery on startup

## Best practices

| Area | Backend | Frontend |
| --- | --- | --- |
| Lint / format | ruff (rules copied from `openai-agents-streamlit`) | Biome |
| Types | pyright strict | `tsc --strict` |
| Unit tests | pytest + httpx `AsyncClient` | Vitest + Testing Library |
| E2E | — | one Playwright happy-path test |
| Gate | `make check` + pre-commit | same |

- **Typed API contract** generated from OpenAPI + the event schema — the main source of bug prevention.
- **No real LLM in unit tests**: the SDK's `agents.testing.ScriptedModel` returns scripted text and tool calls → fast, deterministic, free. It already synthesizes the Responses-API stream events, so `tests/fakes.py` only holds small step helpers.
- **Event fixtures**: record event sequences once; test the backend mapper and the frontend reducer against them.
- **Coverage**: ~80% on backend logic (store, event mapping, run task, routes) and on the frontend reducer; no target on UI components.
- **Evals are separate from tests**: small prompt set with expected behaviour, run on demand against the real model.
- **One-command workflows**: `make dev`, `make check`, `make run`, `make gen-types`.
- No code shared with other experiments (repo rule): copy code and config, don't import.

## v1b notes (as built)

- Types: `openapi-typescript` → `frontend/src/api/schema.gen.ts`, plus `openapi-fetch` for the REST client. TypeScript is pinned to 5.x (TS 7 has no JS compiler API, which `openapi-typescript` needs); pnpm to 11 (pnpm 12 does not run under the installed corepack).
- Stream client: `EventSource` with `?after=<lastSeq>`; it closes itself on `run_finished` (otherwise `EventSource` reconnects forever) and drops events at or below the last seq, so replay overlap is harmless.
- Reducer (`src/chat/reducer.ts`): `RunView` per run, with `parts: Part | AgentPart`. `AgentPart` is UI-only and marks a handoff. Text deltas join by `segment_id`; results attach to calls by `call_id`; events of unknown type or version only advance `lastSeq`. A stored run's record status and error back up an event log that stops early.
- Session state merges loaded history with live events by keeping the view with the higher `lastSeq`. One `useChat` hook subscribes to the session's single running run from its `lastSeq`, so a reload resumes the run without extra code.
- A tool card whose call never got a result shows "no result" once the run has ended (the reducer keeps the event-derived `running`).
- Routing: the selected session is in the URL hash. A new chat is created on its first message.
- Backend fix found by the e2e test: store reads iterated their cursor across awaits on the shared connection, so an event insert interleaved with a read failed with "database is locked" after the SDK session's connection committed (a stale WAL snapshot; `busy_timeout` does not help). Reads now fetch in one step (`Store._rows`); `test_reads_do_not_hold_a_snapshot_across_awaits` covers it.
- E2E: `backend/tests/e2e_app.py` builds the app with a scripted model (tool call, then the tool's output as the answer; "slowly" delays the answer so a test can reload mid-run). Playwright starts it on a temp DB, serving `frontend/dist`.

## Roadmap

1. **v1a — backend**: migrations, sessions CRUD, runs as tasks with event persistence + SSE replay/tail + cancel, `run_python`, optional Langfuse, FakeModel tests. Testable with `curl`.
2. **v1b — frontend**: generated types, SSE client + reducer, chat UI + session list, resume on reload, Playwright happy path.
3. **Sandbox**: `Sandbox` protocol in front of the Monty code, `sandbox_stdout` events, per-session workdir.
4. **Artifacts**: table + storage, tools to create/update, side panel UI, versions.
5. **Human-in-the-loop**: `approval_required` event, persisted run state, approve/reject endpoint.
6. **Multiple agents**: registry UI, handoffs.

## Open questions

- Coalesce `text_delta` events before persisting, if the DB grows?
- HITL run state: a `runs.state` column, or a separate table?
