BACKEND := backend
FRONTEND := frontend
# pnpm from PATH, else the pinned version through npx.
PNPM_BIN := $(shell command -v pnpm >/dev/null 2>&1 && echo pnpm || echo npx -y pnpm@11.28.2)
UV := cd $(BACKEND) && uv run
PNPM := cd $(FRONTEND) && $(PNPM_BIN)

.DEFAULT_GOAL := help
.PHONY: help install dev dev-api dev-web build run check check-backend check-frontend cov e2e fixtures

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-15s %s\n", $$1, $$2}'

install: ## Install backend and frontend dependencies, and Playwright's Chromium
	cd $(BACKEND) && uv sync
	$(PNPM) install
	$(PNPM) exec playwright install chromium

dev: ## API on :8000 and Vite on :5173 (proxying /api), both with reload (needs backend/.env)
	@$(MAKE) -j2 --no-print-directory dev-api dev-web

dev-api: ## Run the API with auto-reload on http://127.0.0.1:8000
	$(UV) uvicorn src.app:create_app --factory --reload --port 8000

dev-web: ## Run the Vite dev server on http://127.0.0.1:5173
	$(PNPM) dev

build: ## Build the frontend into frontend/dist
	$(PNPM) build

run: build ## Build the frontend, then serve it and the API on http://127.0.0.1:8000
	$(UV) uvicorn src.app:create_app --factory --port 8000

check: check-backend check-frontend ## All checks, backend and frontend

check-backend: ## Ruff, ruff format --check, pyright strict, pytest
	$(UV) ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest -q

check-frontend: ## Biome, tsc --strict, Vitest
	$(PNPM) lint && $(PNPM_BIN) typecheck && $(PNPM_BIN) test

cov: ## Tests with coverage, backend and frontend
	$(UV) pytest -q --cov --cov-report=term-missing
	$(PNPM) cov

e2e: ## Build, then Playwright against the real backend with the scripted model (ENV=test MODEL_OVERRIDE=e2e)
	$(PNPM) e2e

fixtures: ## Re-record the SSE fixtures the frontend tests replay (backend/tests/fixtures/)
	cd $(BACKEND) && UPDATE_FIXTURES=1 uv run pytest -q tests/test_fixtures.py
