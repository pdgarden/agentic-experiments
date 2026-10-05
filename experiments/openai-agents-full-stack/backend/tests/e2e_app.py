"""The app with a scripted model, for the frontend's Playwright test.

No network, no real LLM: every message makes the model call ``run_python`` with
``6 * 7``, then answer with the tool's output. A message containing "slowly"
holds the answer for a moment, to test resuming a run after a reload. Run with
``DB_PATH=<tmp>/app.db uv run uvicorn tests.e2e_app:create_e2e_app --factory``;
it serves ``frontend/dist`` like ``make run``.
"""

import asyncio
import json
from typing import Any, cast

from agents import set_tracing_disabled
from agents.testing import ModelCall, ModelStep, ScriptedModel
from fastapi import FastAPI

from src.app import create_app
from src.settings import Settings
from tests.fakes import call, say

set_tracing_disabled(True)

# Enough scripted turns for any number of messages in one test run.
_TURNS = 1000
_SLOW_S = 2.0


async def _reply(model_call: ModelCall) -> ModelStep:
    raw: object = model_call.input
    items = cast("list[Any]", raw) if isinstance(raw, list) else []
    last = (
        cast("dict[str, Any]", items[-1])
        if items and isinstance(items[-1], dict)
        else {}
    )
    if last.get("type") == "function_call_output":
        if "slowly" in json.dumps(items):
            await asyncio.sleep(_SLOW_S)
        return say(f"The tool said: {json.dumps(str(last.get('output', '')))}")
    return call("run_python", {"code": "6 * 7"}, call_id=f"call_{len(items)}")


def create_e2e_app() -> FastAPI:
    settings = Settings(_env_file=None, model_id="scripted")  # pyright: ignore[reportCallIssue]
    model = ScriptedModel([ModelStep.respond(_reply) for _ in range(_TURNS)])
    return create_app(settings, model=model)
