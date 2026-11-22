# pydantic-ai-full-stack — design plan

A local, single-user, full-stack agent app built on Pydantic AI (+ Pydantic AI Harness), to see how far
the framework goes compared with `openai-agents-full-stack`. Status: **phases 1 and 2 done** (backend + frontend),
except the gateway spike, which waits for a gateway (`backend/.env`). See `README.md` for the current layout
and API, and *Phase 1 notes* / *Phase 2 notes* below for where the code settled differently from this plan.

Versions at planning time: `pydantic-ai-slim` 2.71, `pydantic-ai-harness` 0.71, FastAPI 0.165, Langfuse 5.2,
Vercel AI SDK v7. API names below were checked against the installed packages.

## Goals

Features, in roadmap order (phase in brackets):

| Feature | How (Pydantic AI piece) | Phase |
| --- | --- | --- |
| Model + thinking choice per conversation | `LiteLLMProvider` on the AI gateway; per-run `model_settings={'thinking': level}`, stored on the conversation | 1 |
| Streaming UI | `VercelAIAdapter(sdk_version=7)` ↔ Vercel AI SDK v7 `useChat` + AI Elements | 1 |
| Persistent conversations (SQLite) | Own SQLite `ConversationStore` subclass; the server holds the history | 1 |
| Crash recovery of the in-flight turn | Harness `StepPersistence` + `SqliteStepStore` | 1 |
| Read attachments | Uploaded files → `BinaryContent`; files stored in `data/files/` | 1 |
| Monitoring | Langfuse over OpenTelemetry (`Agent.instrument_all()` + Langfuse OTel exporter) | 1 |
| Web search / web fetch | `WebSearch(native=False, local=tavily_search_tool(...))` + `WebFetch(native=False, local=True)` | 2 |
| Code mode | Harness `CodeMode` (Monty sandbox; tool calls routed through Python) | 2 |
| Artifacts (chart, text) | Our tools, validated server-side, versioned table; `CustomEvent`s → AI SDK `data-*` parts | 2 |
| MCP servers chosen from a predefined list | `mcp.json` catalogue → one `MCPToolset` per server, filtered per conversation | 2 |
| User approval (guardrails) | `requires_approval=True` / `ApprovalRequiredToolset` → `DeferredToolRequests` → AI SDK approval parts | 3 |
| Ask user (multiple choice) | Harness `AskUser(answerer=None)` → deferred call, answered with `addToolOutput` | 3 |
| Tool search | `defer_loading=True` on long-tail tools (MCP tools mostly) + `search_tools` | 4 |
| Skills that unlock tools | Harness `Skills` (`SKILL.md` folders) + capabilities with `defer_loading` / `load_capability` | 4 |
| Context compression | Harness `SummarizingCompaction` + `ReportContextUsage` | 4 |
| Durable execution | Temporal (`TemporalDurability`, `PydanticAIWorkflow`) | 5 |
| Subagents | Harness `SubAgents` | 6 |

### Non-goals

- Auth, multi-tenancy (the store's `scope` stays `None`).
- Multiple server processes before phase 5: runs, cancel and live fan-out live in one process.
- Any model access other than the AI gateway (LiteLLM, OpenAI chat-completions interface). Hence no
  provider-native tools (native web search, code execution): that interface does not carry them.
- Docker before the app is feature-complete.
- Evals (real-model quality runs) for now; revisit once phase 4 is done.

## Stack

### Backend

- Python 3.12+, **uv**, **FastAPI** + uvicorn, **pydantic-settings** (`backend/.env`, gitignored).
- **Pydantic AI** (`pydantic-ai-slim[openai,litellm,mcp,ui,tavily,web-fetch]`) + **pydantic-ai-harness**.
  The `logfire` extra currently in `pyproject.toml` goes: Langfuse is the only monitoring backend.
- **Model**: `OpenAIChatModel(litellm_name, provider=LiteLLMProvider(api_base=GATEWAY_URL, api_key=…), profile=…)`.
  - `LiteLLMProvider` infers the profile from vendor-prefixed names (`anthropic/…`, `gemini/…`); gateway
    aliases get explicit overrides from the catalogue.
  - The catalogue lives in `models.json`, one entry per selectable model: UI id and label, LiteLLM model
    name, `thinking` support (`true` / `false`), `context_window`, and optional `profile` overrides
    (`openai_chat_thinking_field`, `openai_chat_send_back_thinking_parts`,
    `openai_chat_thinking_requires_field_on_tool_calls`). It also names a `utility_model` (cheap, fast)
    used for titles and compaction summaries.
  - Thinking: the unified `thinking` model setting (`False`, `'low'`, `'medium'`, `'high'`, …), passed per
    run; LiteLLM maps it to Anthropic/Gemini thinking budgets. The UI only offers levels for models whose
    catalogue entry has `thinking: true`.
- **SQLite** via `aiosqlite`, WAL. `data/app.db` holds app tables (numbered `.sql` migrations +
  `PRAGMA user_version`); `data/steps.db` belongs to `SqliteStepStore` (its own schema, table names such
  as `runs` / `events` would collide with ours).
- **Langfuse**: Pydantic AI emits OpenTelemetry GenAI spans; Langfuse 5 is an OTel backend. Set up the
  Langfuse client (it registers its span processor), then `Agent.instrument_all(InstrumentationSettings(...))`.
  Enabled only when the Langfuse keys are set. One trace per run, tagged with `conversation_id`.

### Frontend

- **Vite + React + TypeScript** strict, pnpm 11, Node 24, Tailwind + shadcn/ui (same toolchain as
  `openai-agents-full-stack`; no Next.js, FastAPI is the only server).
- **Vercel AI SDK v7**: `@ai-sdk/react` `useChat` with `DefaultChatTransport` pointed at our API.
  - `prepareSendMessagesRequest` sends only the **last** message + the chat id (the server owns
    history). Settings never travel with messages (see *Conversations and settings*).
  - `resume: true` + `prepareReconnectToStreamRequest` → `GET /api/chat/{id}/stream`.
  - Tool approvals and ask-user answers use the SDK's approval-response and tool-output helpers, and
    `sendAutomaticallyWhen` resubmits once every pending call is answered. (v7 keeps the v6 names:
    `addToolApprovalResponse` / `addToolOutput`.)
  - `onData` handles our `data-*` parts and the adapter's transient `data-conversation-saved`.
- **AI Elements**-style components in `src/components/ai-elements/`: conversation, message, reasoning,
  tool, prompt input. Written locally (small equivalents) rather than pulled with the AI Elements CLI,
  which would bring its own markdown/highlighting stack next to ours. Markdown stays sanitized.
- **TanStack Query** for conversations, artifacts, MCP catalogue, model catalogue.
- Vega-Lite charts (lazy, no URLs, interpreter mode), as in `openai-agents-full-stack`.

## Architecture

### Layout

```
experiments/pydantic-ai-full-stack/
├── README.md, CLAUDE.md, PLAN.md, Makefile
├── backend/
│   ├── pyproject.toml, uv.lock, models.json, mcp.json (gitignored), skills/
│   ├── src/
│   │   ├── app.py, settings.py, observability.py
│   │   ├── api/          # routers: chat (stream + resume + cancel), conversations, artifacts, files, catalogue
│   │   ├── agent/        # build_agent(): model catalogue, toolsets, capabilities, instructions
│   │   ├── tools/        # web, artifacts, ...
│   │   ├── runs/         # background run task, live chunk buffer + fan-out, cancel, crash recovery
│   │   ├── store/        # SQLite ConversationStore subclass, app tables, migrations/*.sql
│   │   └── artifacts/    # validation (vega-lite schema vendored), models
│   └── tests/            # TestModel / FunctionModel, store, API + stream tests
└── frontend/src/
    ├── api/              # REST client + types
    ├── chat/             # useChat wiring, transport, data-part handlers
    └── components/       # ai-elements/, ui/ (shadcn), artifacts panel, sidebar, settings
```

### Key design decisions

1. **The server owns history, through Pydantic AI's `ConversationStore`.**
   - The `VercelAIAdapter` instance gets `conversation_store=SqliteConversationStore(...)`: it loads the
     history, adds the client's new turn, runs the agent, saves only the new messages, and checks that
     approvals / tool results answer a call the stored record is actually waiting on. Client-sent
     history is never trusted.
   - Our subclass implements the abstract primitives (`read_record`, `read_records`, `write_record`,
     `delete_record`, `read_entry`) and overrides `read_history` with a recursive CTE (the default
     fetches one entry at a time). Two tables: `conversation_records` (head, branches, usage, pending
     `deferred_tool_requests`, title, metadata, revision) and `conversation_entries` (`id`, `parent_id`,
     message JSON via `ModelMessagesTypeAdapter`).
   - Writes use `expected_revision`; `ConversationConflict` maps to `409`.
   - Entries form a tree: when compaction rewrites history, `save` branches off automatically and keeps
     the old branch.
   - History for the UI: `GET /api/conversations/{id}/messages` →
     `VercelAIAdapter.dump_messages(history, sdk_version=7)`, which emits `approval-requested` for
     unanswered deferred calls, so a reload shows pending approvals and questions.
   - Conversation settings (model id, thinking level, enabled MCP servers, enabled skills) live in the
     record's `metadata`.

2. **Runs are decoupled from the HTTP request** (same lesson as `openai-agents-full-stack`).
   - We do not use `dispatch_request` (its response is tied to the request). `POST /api/chat` builds
     `VercelAIAdapter(agent, run_input, sdk_version=7, conversation_store=…, allowed_file_url_schemes=frozenset())`,
     then a background task runs `adapter.encode_stream(adapter.run_stream(deps=…, model=…,
     model_settings=…, cancellation_token=…))` into an in-memory buffer. The POST response and every
     resume subscribe to that buffer.
   - Details in *Run lifecycle* below.

3. **Temporal-ready from day one, without Temporal.** So phase 5 is additive:
   - `build_agent()` builds **one agent at startup** with every toolset and capability it may ever use,
     each with a stable `id` (MCP servers from the catalogue, web tools, artifacts, code mode, skills).
   - Per-conversation choices **filter**, never add: a `PrepareTools` capability (or the toolsets'
     `filtered()`) reads `ctx.deps.settings` to hide MCP servers / tools the conversation did not enable.
     No `run(toolsets=...)` / `run(capabilities=...)` with executing toolsets.
   - Model per run passed as a **model-name string** resolved by a `ResolveModelId` capability (Temporal
     requires registered models or strings); thinking level passed as `model_settings`.
   - Deps are a small serializable dataclass (`conversation_id`, settings) — no DB handle or live objects
     in deps; tools reach services through module-level singletons set up in the lifespan.
   - Human-in-the-loop goes through deferred tools (`DeferredToolRequests` saved in the record), not
     in-process waits, so a pause survives restarts already.

4. **Streaming contract = AI SDK UI message stream protocol (v7).** No hand-written event union.
   Things the protocol does not cover are `CustomEvent` subclasses, which the adapter forwards as
   `data-<name>` parts: `data-artifact` (id + version), `data-context-usage` (from
   `ReportContextUsage`), `data-compaction`, `data-title`, `data-run-interrupted`. Stream events are
   recorded as JSON fixtures in `backend/tests/fixtures/` and replayed in frontend tests.

5. **Artifacts stored outside messages**, as in `openai-agents-full-stack`: `artifacts` +
   immutable `artifact_versions` tables, kinds `chart` (Vega-Lite, inline data only, schema-validated)
   and `text` (markdown/plain). Tools `create_artifact` / `update_artifact` return a short text to the model
   and emit `data-artifact`; the UI side panel fetches content by id.

6. **Attachments**: the composer uploads to `POST /api/files` (size and MIME allowlist: images, PDF,
   text/CSV) and the message references the file id. The backend resolves it to `BinaryContent` before
   the run. `allowed_file_url_schemes=frozenset()`: the default (`http`, `https`) would let a client make
   the server fetch arbitrary URLs. Text-like files the model cannot read natively are inlined as text.

### Conversations and settings

- `PUT /api/conversations/{id}` is an idempotent upsert of the settings (model id, thinking level, MCP
  servers, skills). The id comes from the client (AI SDK chat id). A new chat keeps draft settings in
  the UI and calls `PUT` before its first send; the picker calls it on every change afterwards.
- `POST /api/chat` carries only the chat id and the last message; it answers `404` for an unknown
  conversation and reads the settings from the record. Settings changed mid-run apply to the next run.
- `GET /api/conversations` (list), `PATCH …/{id}` (rename), `DELETE …/{id}` (also deletes its artifacts,
  files and step-store runs).
- **Title**: when the first run starts, a parallel task asks the `utility_model` for a title from the
  first user message. The record gets the first 60 characters of that message immediately; the
  generated title replaces it when ready and is sent as a transient `data-title` part if the run is
  still streaming (otherwise the sidebar picks it up on its next refetch, triggered on stream finish).

### Run lifecycle

- **One active run per conversation**: a second `POST /api/chat` gets `409`.
- **Buffer**: each run has a buffer of encoded SSE chunks with sequence numbers, fanned out to every
  subscriber (several tabs on one conversation all see the same stream). It is dropped 60 s after the
  run ends.
- **Resume** (`GET /api/chat/{id}/stream`): an active or recently finished run → replay the buffer from
  the start, then tail. Nothing → `204`. The UI resumes only when `/messages` says `active_run` (the run's
  turn is not saved yet); `/messages` then also returns that run's user message, so a reload shows the
  prompt while the reply streams. Resuming a finished run would duplicate its saved reply.
- **Cancel** (`POST /api/chat/{id}/cancel`) → `CancellationToken`. The run keeps what it completed: the
  partial assistant turn is saved and the stream ends with a transient `data-run-stopped` then the
  adapter's `abort` chunk (not `finish`); the UI marks the message as stopped (live only: a reload shows
  the saved partial turn without the mark). Closing the tab does not stop a run. A test pins down exactly what the store holds after a
  cancel mid-text and mid-tool-call.
- **Crash recovery** (`StepPersistence` with `SqliteStepStore('data/steps.db')`, run id = adapter
  `run_id`, `conversation_id` set):
  - Snapshots are taken at each settled step, plus a ledger of tool effects (started / completed).
  - On startup, `runs/recovery.py` lists runs with no end event. For each, it saves the latest
    snapshot's new messages into the conversation store (so the completed steps are kept), records
    which tool calls started but never completed (`inspect_recovery`), and flags the conversation
    `interrupted` in its metadata.
  - The UI shows an "interrupted" banner with **Continue**: `POST /api/chat/{id}/continue` (the AI SDK
    can't send an empty turn), internally the same adapter run with `messages=[]`, so the model picks up
    from the last saved step. The UI drops that response body and follows the run through `/stream`. Tool calls that may or may not have run
    are listed in the banner, never silently retried.
  - Phase 5 re-evaluates whether `StepPersistence` stays once Temporal handles in-step recovery.

### Model gateway: thinking compatibility

The phase 1 spike checks, per model in the catalogue, through `VercelAIAdapter`: streamed text, tool
calls, streamed thinking (`ThinkingPart` → reasoning parts), and a **second turn with tool calls after
thinking** (Claude rejects it if thinking signatures are not passed back). If a model fails, apply the
first step that works, then record the result in its catalogue entry and in *Spike results* below:

1. **Profile overrides**: set `openai_chat_thinking_field` to the field LiteLLM actually returns
   (`reasoning_content` or similar), `openai_chat_send_back_thinking_parts='field'`, and
   `openai_chat_thinking_requires_field_on_tool_calls` if the backend rejects tool turns without it.
2. **Signature round-trip**: if LiteLLM returns Anthropic `thinking_blocks` (with `signature`) that the
   chat model drops, a small `OpenAIChatModel` subclass maps them to `ThinkingPart(signature=…)` and back.
   It lives in `src/agent/gateway_model.py`, with tests on recorded gateway payloads.
3. **Display-only thinking**: `openai_chat_send_back_thinking_parts=False`, if the backend accepts tool
   turns without prior thinking. The user still sees reasoning; the model does not see its own.
4. **No thinking**: `thinking: false` for that model. The picker hides levels; everything else works.

## Phases

### Phase 1 — Core chat

- Spike first (half a day): the gateway compatibility checks above, on every catalogue model.
- Backend skeleton: settings, migrations, SQLite `ConversationStore` (+ tests that it behaves like
  `InMemoryConversationStore`), `models.json` catalogue, `build_agent()`.
- `POST /api/chat` with the background run, buffer, resume, cancel, crash recovery; conversations
  endpoints, messages endpoint, model catalogue endpoint, titles.
- Model + thinking selector per conversation; thinking streamed as reasoning parts.
- Attachments (upload + read).
- Langfuse.
- Frontend: sidebar (conversations), chat with AI Elements, model/thinking picker, attachments,
  reload resumes a running stream, stopped / interrupted states.

### Phase 2 — Tools

- Web search and fetch through the core capabilities, local mode only (the gateway carries no native
  tools): `WebSearch(native=False, local=tavily_search_tool(api_key))` (Tavily key in `.env`) and
  `WebFetch(native=False, local=True, blocked_domains=[…])` (HTML → markdown, size-limited). Tool names
  `tavily_search` / `web_fetch`; `max_uses` etc. are native-only, so limits come from Harness tool budgets
  if needed.
- Harness `CodeMode` with resource limits; code + output rendered in a tool card.
- Artifacts (chart, text) + side panel with versions.
- MCP: `mcp.json` catalogue (stdio + Streamable HTTP, `${VAR}` expansion). Servers are entered once in
  the lifespan (`async with agent`), which keeps stdio processes alive until shutdown. A server that
  fails to start is logged, marked `failed`, and the app runs without it (no auto-reconnect).
  Per-conversation selection in the UI; `GET /api/mcp-servers` shows status and tools.

### Phase 3 — Human in the loop

- Approval: `requires_approval=True` on side-effecting tools; MCP servers flagged in `mcp.json` with
  `"approval": "always"` are wrapped in `ApprovalRequiredToolset`; `ApprovalRequired` for conditional
  cases. Harness `Permissions` only if rule-based policy is worth it. UI: approve / deny with reason.
- Ask user: Harness `AskUser(answerer=None)`; the run pauses with `DeferredToolRequests`, the UI renders
  the questions (choices + "other" free text) and answers with a tool output. The adapter accepts a
  result only for a call the record is waiting on. Free text is length-capped and checked with
  `check_response` server-side.
- Both survive a backend restart (pending requests are in the record).

### Phase 4 — Scaling context

- Tool search: `defer_loading=True` on MCP tools and rarely used tools; `search_tools` advertised.
  A test checks that tools hidden by the per-conversation filter are not discoverable through
  `search_tools`.
- Skills: `backend/skills/<name>/SKILL.md`; Harness `Skills` loads them as deferred capabilities; a
  skill can bring its own toolset, hidden until `load_capability`. Enabled skills per conversation.
- Compaction: `SummarizingCompaction(model=<utility_model>, max_fraction=…)`, with the context window
  taken from the model profile (`context_window`, filled from `models.json`). Old turns are summarized,
  not dropped; the store keeps the pre-compaction branch. `ReportContextUsage` → context meter in the
  UI; `data-compaction` marks where the summary starts.

### Phase 5 — Temporal

- `temporal server start-dev` in `make dev`; a worker process (`src/worker.py`).
- `TemporalDurability` on the agent; one workflow per run (`PydanticAIWorkflow`), model calls, tool
  calls, MCP calls and compaction summaries as activities.
- Streaming side channel: the activity's `event_stream_handler` publishes events to the API process
  (HTTP callback or SQLite outbox polled by the run buffer); the API keeps serving the same SSE.
- Cancel → workflow cancellation; approvals/ask-user → still deferred tool results (a new workflow per
  resume), or signals if long-lived workflows prove simpler.
- Measure: what broke, what the extra moving parts cost, whether `StepPersistence` alone (phase 1) or
  DBOS would have been enough.

### Phase 6 — Subagents

- Harness `SubAgents` (research subagent with web tools); delegation shown as nested tool cards.

## Best practices

| Area | Backend | Frontend |
| --- | --- | --- |
| Lint / format | ruff (rules from `openai-agents-full-stack`) | Biome |
| Types | pyright strict | `tsc --strict` |
| Tests | pytest + httpx; `TestModel` / `FunctionModel`, never a real model | Vitest + Testing Library |
| E2E | — | one Playwright happy path |
| Gate | `make check` | same |

- E2E runs the real backend with `MODEL_OVERRIDE=e2e` (settings flag, refused unless `ENV=test`), which
  swaps every catalogue model for a scripted `FunctionModel`.
- No code imported from other experiments (repo rule): copy and adapt.

## Open questions

- Phase 5: one workflow per run vs. one long-lived workflow per conversation (signals for messages).

## Phase 1 notes

Where the code settled differently from (or more precisely than) the sections above:

- **Cancel mid-tool-call** stores `[request, response(tool call), request(parts=[], state='interrupted')]`;
  the next turn runs without replaying the tool (pinned in `tests/test_recovery.py`).
- **Attachments are inlined into stored history**: images/PDFs become `BinaryContent` (data URLs),
  text-like files an `<attachment name="…">` text part. So `/messages` returns data URLs for images, and
  text attachments reload as text (the UI shows them as a file chip again). Revisit if history gets heavy.
- **Thinking with `FunctionModel`** only reaches the model through `model_request_parameters.thinking`,
  and only with `profile={'supports_thinking': True}`.
- **Harness `StepPersistence` writes `run_failed` even for a `BaseException`**, so the crash test deletes
  that event row to simulate a killed process. `capture_frontier=True`, so a crash before the first
  settled step still keeps the user's prompt.
- Step-store cleanup on delete uses the Harness SQLite schema directly (fragile across Harness upgrades).
- `pydantic-ai-slim` extras: `logfire` removed; `tavily` / `web-fetch` come with phase 2.
- Stream fixtures: `backend/tests/test_fixtures.py` records `chat.sse`, `chat_thinking.sse`,
  `chat_stopped.sse` and `messages.json`; the frontend tests replay them (`make fixtures`).

## Phase 2 notes

- **Code mode** (`pydantic_ai_harness.CodeMode`) folds only tools whose metadata has `code_mode=True`: the
  MCP tools. Web (`web_fetch`, `tavily_search`) and artifact tools stay direct calls (their own tool cards,
  artifact events). `run_code` exists even with no MCP server (plain Python sandbox). Limits come from
  settings (`code_mode_max_seconds`, `_max_memory_bytes`, `_max_tool_calls`).
- **MCP**: own loader `src/agent/mcp.py` rather than `load_mcp_toolsets` (we need `enabled`, `description`,
  status, and `${VAR}` from `backend/.env`). Each server is entered alone in the lifespan under
  `asyncio.timeout` (not `wait_for`: anyio scopes must enter and exit in the same task); a failure marks it
  `failed` and the app keeps running. The agent only gets connected servers, each
  `MCPToolset(id=name).prefixed(name).with_metadata(code_mode=True).filtered(name in deps.settings.mcp_servers)`,
  so tools are called from `run_code` as `<server>_<tool>`. `PUT /api/conversations/{id}` 422s on an
  unknown server name. A new chat starts with every connected server.
- **Web**: `WebSearch(native=False, local=tavily_search_tool(...))` only when `TAVILY_API_KEY` is set (tool
  name `tavily_search`); `WebFetch(native=False, local=web_fetch_tool(...))` always (SSRF-safe, 40k chars).
- **Artifacts**: `create_artifact(kind: chart|text, title, content: str)` / `update_artifact(artifact_id,
  content, title?)` (FunctionToolset id `artifacts`, `max_retries=3`, invalid content → `ModelRetry`). They
  return `{artifact_id, version, kind, title, note}` and the UI renders the card from that tool output, so
  it works live and after a reload; the transient `data-artifact` event only refreshes queries. Tables in
  migration `002_artifacts.sql`, cascading on conversation delete. Chart validation is copied from
  openai-agents (vendored `vega-lite.v6.schema.json`; the frontend pins `vega-lite@6.5.0`).
- `build_agent()` takes `toolsets`, `capabilities` and `code_mode` from `services.py` (avoids an import
  cycle).
- e2e runs with `MCP_CONFIG_PATH` pointing at a missing file and no Tavily key, so local config stays out.
  Fixtures `chat_artifact.sse` and `chat_code.sse` join the recorded streams.

## Spike results

To fill in during phase 1: per catalogue model, which gateway compatibility step was needed.
