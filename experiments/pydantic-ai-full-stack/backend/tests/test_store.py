"""The SQLite store behaves like Pydantic AI's `InMemoryConversationStore` on the same operations."""

from typing import Any

import pytest
from pydantic_ai import Agent
from pydantic_ai.conversation import Conversation
from pydantic_ai.conversation_store import ConversationConflict, ConversationStore, InMemoryConversationStore
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models.test import TestModel

from src.store.conversations import SqliteConversationStore


def _texts(messages: list[ModelMessage]) -> list[str]:
    out: list[str] = []
    for m in messages:
        for p in m.parts:
            content: Any = getattr(p, "content", None)
            if isinstance(content, str):
                out.append(content)
    return out


async def _scenario(store: ConversationStore) -> dict[str, Any]:
    agent = Agent(TestModel(custom_output_text="ok"))
    conv = Conversation(conversation_id="c1")
    r1 = await agent.run("hello", conversation=conv)
    await store.save(r1)
    loaded = await store.load("c1")
    assert loaded is not None
    r2 = await agent.run("again", conversation=loaded)
    await store.save(r2)
    await store.update("c1", title="T", metadata={"model_id": "x"})
    after = await store.load("c1")
    assert after is not None
    # a rewritten history branches off and keeps the old branch
    rewritten = Conversation(
        conversation_id="c1",
        messages=[
            ModelRequest(parts=[UserPromptPart(content="hello")]),
            ModelResponse(parts=[TextPart(content="summary")]),
        ],
        revision=after.revision,
    )
    await store.save(rewritten)
    branched = await store.load("c1")
    assert branched is not None
    records = await store.list_conversations()
    limited = await store.load("c1", limit=1)
    assert limited is not None
    return {
        "after": _texts(after.messages),
        "branched": _texts(branched.messages),
        "branches": len(records[0].branches),
        "title": records[0].title,
        "metadata": records[0].metadata,
        "limited": _texts(limited.messages),
    }


async def test_matches_in_memory(sqlite_store: SqliteConversationStore) -> None:
    assert await _scenario(sqlite_store) == await _scenario(InMemoryConversationStore())


async def test_conflict_on_stale_revision(sqlite_store: SqliteConversationStore) -> None:
    agent = Agent(TestModel())
    r1 = await agent.run("hi", conversation=Conversation(conversation_id="c"))
    await sqlite_store.save(r1)
    stale = await sqlite_store.load("c")
    fresh = await sqlite_store.load("c")
    assert stale is not None and fresh is not None
    await sqlite_store.save(await agent.run("one", conversation=fresh))
    with pytest.raises(ConversationConflict):
        await sqlite_store.save(await agent.run("two", conversation=stale))


async def test_delete_keeps_shared_entries(sqlite_store: SqliteConversationStore) -> None:
    agent = Agent(TestModel())
    await sqlite_store.save(await agent.run("hi", conversation=Conversation(conversation_id="a")))
    entries = await sqlite_store.load_entries("a")
    assert entries
    await sqlite_store.fork("a", new_conversation_id="b")
    await sqlite_store.delete("a")
    assert await sqlite_store.load("a") is None
    forked = await sqlite_store.load("b")
    assert forked is not None and _texts(forked.messages)[0] == "hi"
    await sqlite_store.delete("b")
    with pytest.raises(LookupError):
        await sqlite_store.read_entry(entries[0].id)
