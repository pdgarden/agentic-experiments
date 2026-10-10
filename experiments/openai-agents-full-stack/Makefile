BACKEND := backend
FRONTEND := frontend
UV := cd $(BACKEND) && uv run
PNPM := cd $(FRONTEND) && pnpm

.DEFAULT_GOAL := help
.PHONY: help install dev dev-api dev-web build run check check-backend check-frontend check-types \
	cov e2e fixtures openapi gen-types docker docker-down

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-15s %s\n", $$1, $$2}'

install: ## Install backend and frontend dependencies
	cd $(BACKEND) && uv sync
	$(PNPM) install

dev: ## API on :8000 and Vite on :5173 (proxying /api), both with reload
	@$(MAKE) -j2 --no-print-directory dev-api dev-web

dev-api: ## Run the API with auto-reload on http://127.0.0.1:8000
	$(UV) uvicorn src.app:create_app --factory --reload --port 8000

dev-web: ## Run the Vite dev server on http://127.0.0.1:5173
	$(PNPM) dev

build: ## Build the frontend into frontend/dist
	$(PNPM) build

run: build ## Build the frontend, then serve it and the API on http://127.0.0.1:8000
	$(UV) uvicorn src.app:create_app --factory --port 8000

docker: ## Build the image and run the app in Docker on http://127.0.0.1:8000 (needs backend/.env)
	docker compose up --build

docker-down: ## Stop the Docker app (data stays in the volume; add -v to drop it)
	docker compose down

check: check-backend check-frontend ## All checks: backend, frontend, generated types up to date

check-backend: ## Ruff, ruff format --check, pyright strict, pytest
	$(UV) ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest -q

check-frontend: check-types ## Biome, tsc --strict, Vitest
	$(PNPM) lint && pnpm typecheck && pnpm test

check-types: ## Fail if frontend/src/api/schema.gen.ts is stale (fix: make gen-types)
	@$(MAKE) -s --no-print-directory openapi > $(FRONTEND)/openapi.json
	@$(PNPM) exec openapi-typescript openapi.json -o node_modules/.cache/schema.gen.ts
	@cmp -s $(FRONTEND)/src/api/schema.gen.ts $(FRONTEND)/node_modules/.cache/schema.gen.ts \
		|| (echo "frontend/src/api/schema.gen.ts is stale: run make gen-types" && exit 1)

cov: ## Tests with coverage, backend and frontend
	$(UV) pytest -q --cov --cov-report=term-missing
	$(PNPM) cov

e2e: ## Playwright happy path against the backend with a scripted model
	$(PNPM) e2e

fixtures: ## Re-record the event fixtures shared with the frontend reducer tests
	cd $(BACKEND) && UPDATE_FIXTURES=1 uv run pytest -q tests/test_api.py tests/test_artifacts.py

openapi: ## Print the OpenAPI schema, including the stream event contract
	@$(UV) python -c "import json; from src.app import create_app; print(json.dumps(create_app().openapi(), indent=2))"

gen-types: ## Regenerate the frontend's API types from the OpenAPI schema
	@$(MAKE) -s --no-print-directory openapi > $(FRONTEND)/openapi.json
	$(PNPM) gen-types
