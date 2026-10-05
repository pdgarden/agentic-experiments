# One image: the built frontend served by the FastAPI backend on :8000.

# --- Frontend: build frontend/dist ---
FROM node:24-slim AS web
WORKDIR /app/frontend
RUN corepack enable pnpm
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack install && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# --- Backend: runtime dependencies only ---
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/src ./src
COPY --from=web /app/frontend/dist /app/frontend/dist

ENV PATH="/app/backend/.venv/bin:$PATH" \
    DB_PATH=/data/app.db \
    FRONTEND_DIST=/app/frontend/dist
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "src.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
