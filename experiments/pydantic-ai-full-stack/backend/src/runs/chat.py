"""Starting runs: read the conversation's settings, resolve attachments, build the adapter, hand it to the runs."""

import base64
import contextlib
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from pydantic_ai import Agent, CancellationToken
from pydantic_ai.conversation import Conversation
from pydantic_ai.conversation_store import ConversationConflict, ConversationStore
from pydantic_ai.exceptions import RunCancelled
from pydantic_ai.ui.vercel_ai import VercelAIAdapter
from pydantic_ai.ui.vercel_ai.request_types import (
    FileUIPart,
    RequestData,
    SubmitMessage,
    TextUIPart,
    UIMessage,
    UIMessagePart,
)
from pydantic_ai.ui.vercel_ai.response_types import BaseChunk, DataChunk

from src.agent.build import ConversationSettings, Deps, GatewayModels, run_model_settings
from src.agent.catalogue import Catalogue
from src.runs.manager import SDK_VERSION, RunBuffer, RunManager
from src.store.files import TEXT_MEDIA_TYPES, FileStore

logger = logging.getLogger(__name__)

FILE_URL_PREFIX = "/api/files/"
TITLE_PLACEHOLDER_CHARS = 60


class ChatError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class ChatService:
    agent: Agent[Deps, str]
    store: ConversationStore
    files: FileStore
    runs: RunManager
    catalogue: Catalogue
    models: GatewayModels
    title_agent: Agent[None, str]

    async def settings_for(self, conversation_id: str) -> tuple[ConversationSettings, dict[str, Any], str | None]:
        record = await self.store.read_record(conversation_id)
        if record is None:
            raise ChatError(404, "Unknown conversation")
        metadata = dict(record.metadata or {})
        settings = ConversationSettings.from_metadata(metadata, default_model=self.catalogue.default_model)
        if self.catalogue.get(settings.model_id) is None:
            settings.model_id = self.catalogue.default_model
        return settings, metadata, record.title

    async def start(self, body: bytes) -> RunBuffer:
        try:
            run_input = VercelAIAdapter[Deps, str].build_run_input(body)
        except ValueError as e:
            raise ChatError(422, f"Invalid chat request: {e}")
        if len(run_input.messages) > 1:
            # The server owns history: only the new turn is accepted.
            run_input.messages = run_input.messages[-1:]
        return await self._start(run_input)

    async def continue_run(self, conversation_id: str) -> RunBuffer:
        """Pick up from the last saved step (after a crash): a run with no new user message."""
        return await self._start(SubmitMessage(id=conversation_id, messages=[]))

    async def _start(self, run_input: RequestData) -> RunBuffer:
        conversation_id = run_input.id
        settings, metadata, title = await self.settings_for(conversation_id)
        if self.runs.is_active(conversation_id):
            raise ChatError(409, "A run is already active for this conversation")
        first_text = _first_user_text(run_input.messages)
        last = run_input.messages[-1] if run_input.messages else None
        pending = None
        if last is not None and last.role == "user":  # as sent (file URLs, not inlined data): shown on reload
            pending = last.model_dump(mode="json", by_alias=True, exclude_none=True)
        run_input.messages = [await self._resolve_files(m, conversation_id) for m in run_input.messages]

        if metadata.pop("interrupted", None) is not None:
            await self.store.update(conversation_id, metadata=metadata)

        adapter = VercelAIAdapter[Deps, str](
            self.agent,
            run_input,
            sdk_version=SDK_VERSION,
            conversation_store=self.store,
            allowed_file_url_schemes=frozenset(),
        )
        run_id = str(uuid.uuid4())
        deps = Deps(conversation_id=conversation_id, settings=settings)

        def stream(token: CancellationToken) -> AsyncIterator[BaseChunk]:
            return self._traced(
                adapter.run_stream(
                    deps=deps,
                    model=settings.model_id,
                    model_settings=run_model_settings(self.catalogue, settings),
                    cancellation_token=token,
                    run_id=run_id,
                    metadata={"conversation_id": conversation_id},
                    on_cancel=self._save_cancelled(conversation_id),
                ),
                conversation_id,
            )

        buffer = self.runs.start(conversation_id, run_id, stream, pending_user_message=pending)
        if title is None and first_text:
            self.runs.spawn(self._title(conversation_id, first_text, buffer))
        return buffer

    async def _traced(self, stream: AsyncIterator[BaseChunk], conversation_id: str) -> AsyncIterator[BaseChunk]:
        """One Langfuse trace per run, grouped into a session per conversation."""
        try:
            from langfuse import propagate_attributes
        except ImportError:  # pragma: no cover
            propagate = contextlib.nullcontext()
        else:
            propagate = propagate_attributes(session_id=conversation_id, trace_name="chat_run")
        with propagate:
            async for chunk in stream:
                yield chunk

    def _save_cancelled(self, conversation_id: str):  # noqa: ANN202
        """Keep what a cancelled run completed: the adapter saves only finished runs."""

        async def on_cancel(cancelled: RunCancelled) -> AsyncIterator[BaseChunk]:
            messages = cancelled.all_messages()
            for _ in range(3):
                record = await self.store.read_record(conversation_id)
                if record is None:
                    break
                try:
                    await self.store.save(
                        Conversation(conversation_id=conversation_id, messages=messages, revision=record.revision)
                    )
                    break
                except ConversationConflict:
                    continue
            yield DataChunk(type="data-run-stopped", data={"conversation_id": conversation_id}, transient=True)

        return on_cancel

    async def _resolve_files(self, message: UIMessage, conversation_id: str) -> UIMessage:
        """File parts reference uploads by URL (`/api/files/<id>`); turn them into inline content for the model."""
        if message.role != "user":
            return message
        parts: list[UIMessagePart] = []
        for part in message.parts:
            if not isinstance(part, FileUIPart):
                parts.append(part)
                continue
            if not part.url.startswith(FILE_URL_PREFIX):
                raise ChatError(422, "Attachments must be uploaded through /api/files first")
            file_id = part.url.removeprefix(FILE_URL_PREFIX)
            stored = await self.files.get(file_id)
            if stored is None or stored.conversation_id not in (None, conversation_id):
                raise ChatError(422, f"Unknown file {file_id}")
            data = self.files.read(file_id)
            if stored.media_type in TEXT_MEDIA_TYPES:
                text = data.decode("utf-8", errors="replace")
                parts.append(TextUIPart(text=f'<attachment name="{stored.filename}">\n{text}\n</attachment>'))
            else:
                url = f"data:{stored.media_type};base64,{base64.b64encode(data).decode()}"
                parts.append(FileUIPart(media_type=stored.media_type, filename=stored.filename, url=url))
        return message.model_copy(update={"parts": parts})

    async def _title(self, conversation_id: str, first_text: str, buffer: RunBuffer) -> None:
        placeholder = " ".join(first_text.split())[:TITLE_PLACEHOLDER_CHARS]
        try:
            await self.store.update(conversation_id, title=placeholder, expected_title=None)
        except ConversationConflict:
            return  # titled since (the user renamed it): leave it
        try:
            model = self.models.get(self.catalogue.utility_model)
            result = await self.title_agent.run(first_text[:2000], model=model)
            title = result.output.strip().strip('"').strip()[:80]
            if not title:
                return
            await self.store.update(conversation_id, title=title, expected_title=placeholder)
        except ConversationConflict:
            return
        except Exception:
            logger.exception("title generation failed for %s", conversation_id)
            return
        await buffer.append_side_chunk(DataChunk(type="data-title", data={"title": title}, transient=True))


def _first_user_text(messages: list[UIMessage]) -> str:
    for message in messages:
        if message.role == "user":
            for part in message.parts:
                if isinstance(part, TextUIPart) and part.text.strip():
                    return part.text
    return ""
