# pydantic-ai-full-stack

Full-stack chat app around a Pydantic AI agent. `PLAN.md` is the design (decisions, run lifecycle, roadmap); `README.md` has setup and status. Status: phases 1 and 2 done (backend + frontend); the gateway spike waits for a `backend/.env`. Phase 3 (human in the loop) next.

- UI polish: `UI_PLAN.md` (all 8 steps done; its *Step notes* record the design decisions and open follow-ups).
- Composer settings: `COMPOSER_PLAN.md` (moves the MCP, model and thinking pickers from the header into the composer: `+` menu and a footer line; all 3 steps done).
- Checks: `make check` (both sides), `make e2e` (Playwright, scripted model), `make fixtures` after a stream change.
- Frontend: Vite + React + TS strict, pnpm (`npx -y pnpm@11.28.2` if not on PATH), Biome, Vitest. Run frontend commands from `frontend/`.
- Backend: Python 3.12+, managed with uv. Run backend commands from `backend/` (`uv sync`, `uv run …`).
- Models are reached only through the AI gateway (LiteLLM, OpenAI chat-completions interface) via `LiteLLMProvider`. Never add a direct provider client or provider-native tools.
- Check Pydantic AI / Harness APIs against the installed packages in `backend/.venv` before relying on them; both move fast and Harness is 0.x.
- The server owns history through our `ConversationStore` subclass; never trust or replay client-sent history.
- One agent is built at startup with every toolset and capability; per-conversation settings only filter (keeps phase 5 Temporal additive). No `run(toolsets=…)` / `run(capabilities=…)`.
- Deps stay a small serializable dataclass: no DB handles or live objects.
- Tests use `TestModel` / `FunctionModel`, never a real model.
- MCP tools are only reachable from code mode (`run_code`, metadata `code_mode=True`); web and artifact tools stay direct calls. A new MCP server goes in `backend/mcp.json` (and an example in `mcp.example.json`), never in code.
- Artifact cards render from the `create_artifact` / `update_artifact` tool output; `data-artifact` only invalidates queries. Keep the chart schema in sync with the frontend's pinned `vega-lite`.
- `backend/.env`, `backend/data/` and `backend/mcp.json` are gitignored.
- No code imported from other experiments: copy and adapt.
