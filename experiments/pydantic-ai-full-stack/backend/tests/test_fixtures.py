"""Record the streams the frontend tests replay (`backend/tests/fixtures/`).

`UPDATE_FIXTURES=1 uv run pytest tests/test_fixtures.py` (or `make fixtures`) rewrites them. Otherwise each test
checks that the recorded fixture still has the chunk types the backend sends now, so a protocol change fails here
instead of leaving the frontend tests on a stale stream.
"""

import json
import os
from pathlib import Path
from typing import Any

import httpx

from src.services import Services
from tests.helpers import chat_body, create_conversation, parse_sse, user_message

FIXTURES = Path(__file__).parent / "fixtures"
UPDATE = os.environ.get("UPDATE_FIXTURES") == "1"
# Sent from the title task, racing the run: present or not depending on timing.
_RACY = {"data-title"}


def _types(sse: str) -> list[str]:
    return [c["type"] for c in parse_sse(sse) if c["type"] not in _RACY]


def _check_or_record(name: str, sse: str) -> None:
    path = FIXTURES / name
    if UPDATE or not path.exists():
        FIXTURES.mkdir(exist_ok=True)
        path.write_text(sse)
        return
    assert _types(path.read_text()) == _types(sse), f"{name} is stale: run `make fixtures`"


def _check_or_record_json(name: str, data: Any) -> None:
    path = FIXTURES / name
    if UPDATE or not path.exists():
        FIXTURES.mkdir(exist_ok=True)
        path.write_text(json.dumps(data, indent=2) + "\n")
        return
    recorded = json.loads(path.read_text())
    assert recorded.keys() == data.keys(), f"{name} is stale: run `make fixtures`"


async def test_record_chat(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "fixture-chat")
    r = await client.post("/api/chat", json=chat_body("fixture-chat", user_message("Hello there")))
    assert r.status_code == 200
    _check_or_record("chat.sse", r.text)
    messages = (await client.get("/api/conversations/fixture-chat/messages")).json()
    _check_or_record_json("messages.json", messages)


async def test_record_chat_with_thinking(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "fixture-thinking", model_id="claude-sonnet", thinking="high")
    r = await client.post("/api/chat", json=chat_body("fixture-thinking", user_message("Think first")))
    assert r.status_code == 200
    assert any(c["type"] == "reasoning-delta" for c in parse_sse(r.text))
    _check_or_record("chat_thinking.sse", r.text)


async def test_record_cancelled_chat(client: httpx.AsyncClient, services: Services) -> None:
    await create_conversation(client, "fixture-stopped")
    body = json.dumps(chat_body("fixture-stopped", user_message("slow please"))).encode()
    buffer = await services.chat.start(body)
    chunks: list[str] = []
    deltas = 0
    async for chunk in buffer.subscribe():
        chunks.append(chunk)
        if '"text-delta"' in chunk:
            deltas += 1
            if deltas == 3:
                services.runs.cancel("fixture-stopped")
    sse = "".join(chunks)
    assert any(c["type"] == "data-run-stopped" for c in parse_sse(sse))
    _check_or_record("chat_stopped.sse", sse)


async def test_record_chart_artifact(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "fixture-chart")
    r = await client.post("/api/chat", json=chat_body("fixture-chart", user_message("Draw a chart")))
    assert r.status_code == 200
    assert any(c["type"] == "data-artifact" for c in parse_sse(r.text))
    _check_or_record("chat_artifact.sse", r.text)


async def test_record_code_mode(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "fixture-code")
    r = await client.post("/api/chat", json=chat_body("fixture-code", user_message("compute something")))
    assert r.status_code == 200
    _check_or_record("chat_code.sse", r.text)
