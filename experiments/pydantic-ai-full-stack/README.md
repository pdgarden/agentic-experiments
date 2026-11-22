# pydantic-ai-full-stack

A local, single-user chat app around a Pydantic AI agent (+ Pydantic AI Harness): FastAPI backend,
SQLite persistence through Pydantic AI's `ConversationStore`, Vercel AI SDK v7 frontend. Built to
compare with [openai-agents-full-stack](../openai-agents-full-stack/). Design and roadmap:
[PLAN.md](PLAN.md).

## Status

| Area | State |
| --- | --- |
| Phase 1 backend | Done: conversations, model + thinking per conversation, background runs with resume / cancel, crash recovery, attachments, titles, Langfuse wiring. |
| Phase 1 frontend | Done: sidebar (rename, delete), model + thinking picker, streaming chat with collapsible reasoning, attachments, reload resumes a running stream, stopped and interrupted states. |
| Gateway spike | **Not run yet**: needs a `backend/.env` pointing at a LiteLLM gateway. `models.json` entries are placeholders until then; results go in *Spike results* in `PLAN.md`. |
| Langfuse | Wired, not yet tried against a live Langfuse. |
| Phase 2 | Done: web search (Tavily, with a key) and fetch, code mode (`run_code`, MCP tools callable from it), chart / text artifacts with versions and a side panel, MCP servers from `backend/mcp.json` with a per-chat picker and a status list. Not yet tried against a real model. |
| Phases 3–6 | Not started. |

## Setup

Requires [uv](https://docs.astral.sh/uv/), Python 3.12+, Node 24 and pnpm 11 (the Makefile falls
back to `npx pnpm@11.28.2` when pnpm is not on `PATH`).

```bash
make install                      # uv sync, pnpm install, Playwright's Chromium
cp backend/.env.example backend/.env   # then set GATEWAY_URL / GATEWAY_API_KEY
make dev                          # API on :8000, Vite on :5173 (open this one)
make run                          # or: build the frontend and serve everything on :8000
```

Models are reached only through the AI gateway (LiteLLM, OpenAI chat-completions interface). The
selectable models are in `backend/models.json`.

Optional tools: set `TAVILY_API_KEY` in `backend/.env` for web search (`web_fetch` needs no key), and
copy `backend/mcp.example.json` to `backend/mcp.json` for MCP servers (`${VAR}` in `env` / `headers` is
read from `backend/.env`). A server that fails to start is shown as `failed` and the app runs without it.

## Checks

| Command | What |
| --- | --- |
| `make check` | Backend: ruff, ruff format, pyright strict, pytest. Frontend: Biome, `tsc`, Vitest. |
| `make e2e` | Builds the frontend, then Playwright against the real backend with a scripted model (`ENV=test MODEL_OVERRIDE=e2e`, `backend/src/agent/e2e.py`) on a throwaway data dir. |
| `make fixtures` | Re-records the SSE streams the frontend tests replay (`backend/tests/fixtures/`). Without it, `tests/test_fixtures.py` fails when the stream's chunk types change. |
| `make cov` | Tests with coverage. |

## Layout

### Backend (`backend/src/`)

| File | What it does |
| --- | --- |
| `settings.py` | pydantic-settings, reads `backend/.env`. `MODEL_OVERRIDE=e2e` is refused unless `ENV=test`. Data in `data/app.db`, `data/steps.db`, `data/files/`. |
| `agent/catalogue.py` | Loads and validates `models.json` (`default_model`, `utility_model`, models with `litellm_name`, `thinking`, `context_window`, `profile` overrides). |
| `agent/build.py` | `ConversationSettings` (record metadata), `Deps` (serializable), `GatewayModels` (catalogue id → `OpenAIChatModel` on `LiteLLMProvider`), `build_agent()`: one agent with `ResolveModelId` + `StepPersistence`. |
| `agent/e2e.py` | Scripted `FunctionModel`: echoes `You said: …`, thinks when thinking is on, `slow` in the prompt makes it slow, `chart` / `document` → `create_artifact`, `compute` → `run_code`. |
| `agent/mcp.py` | Loads `mcp.json`, connects each server alone in the lifespan with a timeout (`connected` / `failed` / `disabled`), exposes connected ones as prefixed, code-mode-only toolsets filtered by the conversation's `mcp_servers`. |
| `tools/web.py` | `WebSearch` (Tavily, local) when a key is set, `WebFetch` (local, SSRF-safe, 40k chars) always. |
| `tools/artifacts.py` | `create_artifact` / `update_artifact`: validate content (`ModelRetry` on errors), store a new version, emit `data-artifact`, return `{artifact_id, version, kind, title, note}`. |
| `artifacts/` | Artifact models and Vega-Lite v6 validation (vendored schema). |
| `services.py` | Builds the app's services in the lifespan: stores, MCP servers, toolsets / capabilities, the agent with code-mode limits. |
| `store/` | aiosqlite (WAL, numbered migrations), `SqliteConversationStore` (recursive-CTE history), uploaded files, artifacts and their versions. |
| `runs/manager.py` | One background task per run; encoded SSE chunks with replay + fan-out; 409 while a run is active; cancel; buffer dropped 60 s after the run. |
| `runs/chat.py` | Starts runs through `VercelAIAdapter(sdk_version=7, conversation_store=…)`, resolves attachments, saves the partial turn on cancel, generates titles. |
| `runs/recovery.py` | On startup, saves the latest snapshot of runs a crash interrupted and flags the conversation `interrupted`. |
| `api/` | Routers (below); `app.py` serves `frontend/dist` when it exists. |

### Frontend (`frontend/src/`)

| Path | What it does |
| --- | --- |
| `api/` | REST client, types, TanStack Query keys. |
| `chat/useConversationChat.ts` | `useChat` + `DefaultChatTransport`: sends only the last message, resumes from `GET /api/chat/{id}/stream`, handles `data-title` / `data-conversation-saved` / `data-run-stopped` / `data-artifact`, stop and continue. |
| `components/ai-elements/` | Conversation scroller, message, reasoning, tool card (`run_code` shows its Python), prompt input (small local equivalents of AI Elements). |
| `components/artifacts/` | `ArtifactCard` (in the message, the version it wrote), `ArtifactPanel` (beside the chat, latest version, older ones on demand), `ArtifactView` (Markdown, or Vega loaded lazily). |
| `components/mcp/` | `McpPicker` (per-chat servers, header), `McpServers` (status and tools, sidebar). |
| `components/` | `ChatView` (draft vs. existing chat, header pickers, artifact panel), `Composer` (uploads), `MessageParts`, `ModelPicker`, `Sidebar`, `InterruptedBanner`, `Markdown` (sanitized). |
| `App.tsx`, `useHashConversation.ts` | The open conversation is the URL hash; a new chat gets a client-made id that becomes the conversation id on first send. |

## HTTP API

| Method + path | Notes |
| --- | --- |
| `GET /api/models` | `{default_model, models: [{id, label, thinking_levels, context_window}]}`; `thinking_levels` is `["off"]` without thinking. |
| `GET /api/conversations` | Most recent first: `{id, title, updated_at, settings, interrupted, running}`. |
| `GET /api/conversations/{id}` | Same shape; 404 if unknown. |
| `PUT /api/conversations/{id}` | Idempotent upsert of `{model_id, thinking, mcp_servers, skills}`. The UI calls it before a new chat's first send and on every picker change. 422 for an unknown model or MCP server. |
| `PATCH /api/conversations/{id}` | Rename `{title}`. |
| `DELETE /api/conversations/{id}` | 204; 409 while a run is active. Deletes files and step-store runs too. |
| `GET /api/conversations/{id}/messages` | `{messages, active_run}`: history as AI SDK v7 `UIMessage[]`. While a run is in flight and unsaved, `active_run` is true and `messages` ends with that run's user message (as sent); the client then resumes the stream. |
| `POST /api/chat` | AI SDK body `{trigger, id, messages}`; only the last message is used. SSE (`x-vercel-ai-ui-message-stream: v1`). 404 unknown conversation, 409 run active, 422 bad body or attachment. |
| `GET /api/chat/{id}/stream` | Replays the active or recently finished run from its start, then tails; 204 when there is none. |
| `POST /api/chat/{id}/cancel` | `{cancelled}`. The stream then ends with `data-run-stopped` + `abort`; the partial turn is saved. |
| `POST /api/chat/{id}/continue` | Continues an interrupted conversation; same SSE (the UI drops this body and follows the run through `/stream`). |
| `POST /api/files` | Multipart `file` (+ `conversation_id`) → `{id, url, filename, media_type, size}`; 415 / 413. A message's file part must use that `url`. |
| `GET /api/files/{id}` | The file. |
| `GET /api/mcp-servers` | Every server in `mcp.json`: `{name, type, status, description, tools: [{name, description}], error}`. |
| `GET /api/conversations/{id}/artifacts` | Newest first: `{id, conversation_id, kind, title, latest_version, created_at, updated_at}`. |
| `GET /api/artifacts/{id}` | Same, plus `versions: [{version, title, created_at}]` (no content). |
| `GET /api/artifacts/{id}/versions/{v}` | One version with `content`: `{kind: "chart", spec}` or `{kind: "text", text}`. |

Stream parts beyond the standard protocol: `data-conversation-saved` (from the adapter),
`data-title` (transient), `data-run-stopped` (transient), `data-artifact` (transient,
`{artifact_id, version, kind, title, created}`: refreshes queries only; the card is rendered from the
`create_artifact` / `update_artifact` tool output, so it survives a reload).

## Notes

- Tests that need a run in flight drive `services.chat.start()` and `RunBuffer.subscribe()` directly:
  `httpx.ASGITransport` buffers whole responses.
- Step-store cleanup on delete uses the Harness SQLite schema directly (fragile across Harness upgrades).
- Text attachments are inlined into the stored prompt, so after a reload they come back as text; the
  UI turns `<attachment name="…">` blocks back into a file chip.
