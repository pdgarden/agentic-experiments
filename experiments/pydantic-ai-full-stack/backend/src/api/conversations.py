"""Conversations: settings upsert, list, rename, delete, and the history as AI SDK UI messages."""

import contextlib
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from pydantic_ai.conversation import Conversation
from pydantic_ai.conversation_store import ConversationConflict, ConversationRecord
from pydantic_ai.ui.vercel_ai import VercelAIAdapter

from src.agent.build import ConversationSettings
from src.agent.catalogue import ThinkingLevel
from src.runs.manager import SDK_VERSION
from src.runs.step_cleanup import delete_step_runs
from src.services import get_services

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


class SettingsBody(BaseModel):
    model_id: str
    thinking: ThinkingLevel = "off"
    mcp_servers: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)


class UnresolvedTool(BaseModel):
    tool_call_id: str | None
    tool_name: str | None


class Interrupted(BaseModel):
    run_id: str
    at: str
    unresolved_tools: list[UnresolvedTool]


class ConversationOut(BaseModel):
    id: str
    title: str | None
    updated_at: str
    settings: SettingsBody
    interrupted: Interrupted | None = None
    running: bool = False


class MessagesOut(BaseModel):
    messages: list[dict[str, Any]]
    """History as AI SDK v7 UI messages, plus the in-flight run's user message if there is one."""
    active_run: bool
    """A run is streaming and its turn is not saved yet: resume `GET /api/chat/{id}/stream`."""


class RenameBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)


def _out(record: ConversationRecord) -> ConversationOut:
    services = get_services()
    metadata = record.metadata or {}
    settings = ConversationSettings.from_metadata(metadata, default_model=services.catalogue.default_model)
    interrupted = metadata.get("interrupted")
    return ConversationOut(
        id=record.conversation_id,
        title=record.title,
        updated_at=record.updated_at.isoformat(),
        settings=SettingsBody(**settings.to_dict()),
        interrupted=Interrupted.model_validate(interrupted) if interrupted else None,
        running=services.runs.is_active(record.conversation_id),
    )


@router.get("", summary="Conversations, most recent first")
async def list_conversations() -> list[ConversationOut]:
    return [_out(r) for r in await get_services().store.list_conversations()]


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: str) -> ConversationOut:
    record = await get_services().store.read_record(conversation_id)
    if record is None:
        raise HTTPException(404, "Unknown conversation")
    return _out(record)


@router.put("/{conversation_id}", summary="Create the conversation or update its settings (idempotent)")
async def put_conversation(conversation_id: str, body: SettingsBody) -> ConversationOut:
    services = get_services()
    if services.catalogue.get(body.model_id) is None:
        raise HTTPException(422, f"Unknown model {body.model_id!r}")
    unknown = sorted(set(body.mcp_servers) - set(services.mcp.names))
    if unknown:
        raise HTTPException(422, f"Unknown MCP server(s): {', '.join(unknown)}")
    store = services.store
    if await store.read_record(conversation_id) is None:
        with contextlib.suppress(ConversationConflict):  # created concurrently by another PUT
            await store.save(Conversation(conversation_id=conversation_id))
    record = await store.read_record(conversation_id)
    assert record is not None
    metadata: dict[str, Any] = dict(record.metadata or {})
    metadata["settings"] = body.model_dump()
    return _out(await store.update(conversation_id, metadata=metadata))


@router.patch("/{conversation_id}", summary="Rename")
async def rename(conversation_id: str, body: RenameBody) -> ConversationOut:
    store = get_services().store
    if await store.read_record(conversation_id) is None:
        raise HTTPException(404, "Unknown conversation")
    return _out(await store.update(conversation_id, title=body.title.strip()))


@router.delete("/{conversation_id}", status_code=204, summary="Delete the conversation, its files and its runs")
async def delete(conversation_id: str) -> None:
    services = get_services()
    if services.runs.is_active(conversation_id):
        raise HTTPException(409, "Stop the active run first")
    await services.store.delete(conversation_id)
    await services.files.delete_for_conversation(conversation_id)
    delete_step_runs(services.settings.steps_db, conversation_id)


@router.get("/{conversation_id}/messages", summary="History as AI SDK v7 UI messages")
async def messages(conversation_id: str) -> MessagesOut:
    services = get_services()
    # Read before the history: a save in between at worst shows the prompt twice (never drops it).
    in_flight = services.runs.in_flight(conversation_id)
    conversation = await services.store.load(conversation_id)
    if conversation is None:
        raise HTTPException(404, "Unknown conversation")
    ui_messages = VercelAIAdapter.dump_messages(conversation.messages, sdk_version=SDK_VERSION)
    dumped = [m.model_dump(mode="json", by_alias=True, exclude_none=True) for m in ui_messages]
    if in_flight is not None and in_flight.pending_user_message is not None:
        dumped.append(in_flight.pending_user_message)
    return MessagesOut(messages=dumped, active_run=in_flight is not None)
