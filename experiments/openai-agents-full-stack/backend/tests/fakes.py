"""Deterministic model for tests: no network, no real LLM.

Built on the SDK's ``agents.testing.ScriptedModel``, which already
synthesizes the Responses-API stream events (``response.output_text.delta``,
function-call items, ``response.completed``) from scripted output items, so
the run loop sees exactly what a real streaming model would send.
"""

import asyncio
from collections.abc import Mapping
from typing import Any

from agents import Usage
from agents.testing import (
    ModelCall,
    ModelStep,
    ScriptedModel,
    assistant_message,
    function_call,
)

USAGE = Usage(requests=1, input_tokens=10, output_tokens=5, total_tokens=15)


def say(text: str) -> ModelStep:
    """One model turn that answers with ``text``."""
    return ModelStep(output=[assistant_message(text)], usage=USAGE)


def call(name: str, args: Mapping[str, Any], call_id: str = "call_1") -> ModelStep:
    """One model turn that calls a tool."""
    return ModelStep(output=[function_call(name, args, call_id=call_id)], usage=USAGE)


def blocked(gate: asyncio.Event, then: ModelStep) -> ModelStep:
    """A turn that waits for ``gate`` before answering: a run kept in flight."""

    async def respond(_call: ModelCall) -> ModelStep:
        await gate.wait()
        return then

    return ModelStep.respond(respond)


def scripted(*steps: ModelStep) -> ScriptedModel:
    return ScriptedModel(steps)
