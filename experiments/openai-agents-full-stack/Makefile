BACKEND := backend
UV := cd $(BACKEND) && uv run

.DEFAULT_GOAL := help
.PHONY: help install dev run check cov fixtures openapi

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

install: ## Install backend dependencies
	cd $(BACKEND) && uv sync

dev: ## Run the API with auto-reload on http://127.0.0.1:8000
	$(UV) uvicorn src.app:create_app --factory --reload --port 8000

run: ## Run the API (and the built frontend, once there is one) without reload
	$(UV) uvicorn src.app:create_app --factory --port 8000

check: ## Lint, format check, type check and tests
	$(UV) ruff check . && uv run ruff format --check . && uv run pyright && uv run pytest -q

cov: ## Tests with coverage
	$(UV) pytest -q --cov --cov-report=term-missing

fixtures: ## Re-record the event fixtures shared with the frontend reducer tests
	cd $(BACKEND) && UPDATE_FIXTURES=1 uv run pytest -q tests/test_api.py

openapi: ## Print the OpenAPI schema, including the stream event contract
	@$(UV) python -c "import json; from src.app import create_app; print(json.dumps(create_app().openapi(), indent=2))"
