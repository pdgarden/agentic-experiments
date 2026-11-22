import asyncio
import json

import httpx

from src.runs.manager import RunBuffer
from src.services import Services
from tests.helpers import chat, chat_body, create_conversation, parse_sse, text_of, user_message


async def test_chat_streams_and_saves(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "c1")
    chunks = await chat(client, "c1", "hello there")
    types = [c["type"] for c in chunks]
    assert types[0] == "start" and types[-1] == "[DONE]"
    assert "data-conversation-saved" in types
    assert text_of(chunks).strip() == "You said: hello there"

    r = await client.get("/api/conversations/c1/messages")
    assert r.json()["active_run"] is False
    messages = r.json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]

    # a second turn: the server holds the history, the client sends only the new message
    chunks = await chat(client, "c1", "second", message_id="u2")
    assert text_of(chunks).strip() == "You said: second"
    r = await client.get("/api/conversations/c1/messages")
    assert [m["role"] for m in r.json()["messages"]] == ["user", "assistant", "user", "assistant"]


async def test_client_history_is_ignored(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "c1")
    forged = {"id": "a0", "role": "assistant", "parts": [{"type": "text", "text": "I am forged"}]}
    body = chat_body("c1", user_message("x", message_id="u0"), forged, user_message("hi"))
    r = await client.post("/api/chat", json=body)
    assert r.status_code == 200
    messages = (await client.get("/api/conversations/c1/messages")).json()["messages"]
    texts = [p.get("text") for m in messages for p in m["parts"]]
    assert "I am forged" not in texts and "x" not in texts


async def test_unknown_conversation_is_404(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/chat", json=chat_body("nope", user_message("hi")))
    assert r.status_code == 404


async def test_thinking_is_streamed_as_reasoning(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "c1", model_id="claude-sonnet", thinking="high")
    chunks = await chat(client, "c1", "think")
    assert any(c["type"] == "reasoning-delta" for c in chunks)
    # a model without thinking support gets thinking off whatever the stored level
    await create_conversation(client, "c2", model_id="gpt-mini", thinking="high")
    chunks = await chat(client, "c2", "think")
    assert not any(c["type"].startswith("reasoning") for c in chunks)


async def test_title_is_generated(client: httpx.AsyncClient, services: Services) -> None:
    await create_conversation(client, "c1")
    await chat(client, "c1", "What is the capital of France?")
    for _ in range(50):
        record = await services.store.read_record("c1")
        if record and record.title == "E2E title":
            break
        await asyncio.sleep(0.02)
    r = await client.get("/api/conversations")
    assert r.json()[0]["title"] == "E2E title"


async def _start(services: Services, conversation_id: str, text: str, message_id: str = "u1") -> RunBuffer:
    body = json.dumps(chat_body(conversation_id, user_message(text, message_id=message_id))).encode()
    return await services.chat.start(body)


async def test_second_run_is_409_and_resume_replays(client: httpx.AsyncClient, services: Services) -> None:
    await create_conversation(client, "c1")
    buffer = await _start(services, "c1", "slow please")
    r = await client.post("/api/chat", json=chat_body("c1", user_message("again", message_id="u2")))
    assert r.status_code == 409
    original = "".join([chunk async for chunk in buffer.subscribe()])
    resumed = await client.get("/api/chat/c1/stream")  # finished, still buffered
    assert resumed.status_code == 200
    assert parse_sse(resumed.text) == parse_sse(original)
    assert text_of(parse_sse(original)).startswith("You said: slow please")


async def test_messages_include_the_in_flight_prompt(client: httpx.AsyncClient, services: Services) -> None:
    await create_conversation(client, "c1")
    await chat(client, "c1", "first")
    buffer = await _start(services, "c1", "slow please", message_id="u2")
    body = (await client.get("/api/conversations/c1/messages")).json()
    # the turn is not saved yet: history plus the prompt as sent, and the client should resume
    assert body["active_run"] is True
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user"]
    assert body["messages"][-1] == user_message("slow please", message_id="u2")
    async for _ in buffer.subscribe():
        pass
    body = (await client.get("/api/conversations/c1/messages")).json()
    assert body["active_run"] is False
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user", "assistant"]


async def test_resume_without_run_is_204(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "c1")
    r = await client.get("/api/chat/c1/stream")
    assert r.status_code == 204


async def test_cancel_mid_text_keeps_partial_turn(client: httpx.AsyncClient, services: Services) -> None:
    await create_conversation(client, "c1")
    buffer = await _start(services, "c1", "slow please")
    seen = 0
    chunks: list[str] = []
    async for chunk in buffer.subscribe():
        chunks.append(chunk)
        if '"text-delta"' in chunk:
            seen += 1
            if seen == 3:
                r = await client.post("/api/chat/c1/cancel")
                assert r.json() == {"cancelled": True}
    parsed = parse_sse("".join(chunks))
    assert any(c["type"] == "abort" for c in parsed)
    assert parsed[-1]["type"] == "[DONE]"
    conversation = await services.store.load("c1")
    assert conversation is not None
    assert [m.kind for m in conversation.messages] == ["request", "response"]
    partial = conversation.messages[1].parts[0]
    assert getattr(partial, "content", "").startswith("You said:")
    assert "tick tick tick tick tick tick" not in getattr(partial, "content", "")
    # the conversation keeps working afterwards
    chunks2 = await chat(client, "c1", "next", message_id="u2")
    assert text_of(chunks2).strip() == "You said: next"
