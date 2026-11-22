"""Crash recovery: on startup, save what runs that never ended had completed, and flag their conversations.

A run with no `run_completed` / `run_failed` event was cut off by a crash. Its latest snapshot (settled or not)
goes into the conversation store, the tool calls that started but never finished are listed on the
conversation's `interrupted` metadata, and a `run_failed` event is appended so the run isn't recovered twice.
Tool calls are never retried here: the UI lists them and the user decides (*Continue*).
"""

import logging
from datetime import UTC, datetime

from pydantic_ai.conversation import Conversation
from pydantic_ai.conversation_store import ConversationConflict, ConversationStore
from pydantic_ai_harness.step_persistence import StepEvent, StepStore
from pydantic_ai_harness.step_persistence.recovery import inspect_recovery

logger = logging.getLogger(__name__)

_ENDED = frozenset({"run_completed", "run_failed"})
RECOVERED_ERROR = "interrupted: recovered after a server restart"


async def recover_interrupted_runs(step_store: StepStore, store: ConversationStore) -> list[str]:
    """Returns the ids of the conversations that were flagged interrupted."""
    flagged: list[str] = []
    for run in await step_store.list_runs():
        events = await step_store.list_events(run_id=run.run_id)
        if any(e.kind in _ENDED for e in events) or run.conversation_id is None:
            continue
        conversation_id = run.conversation_id
        inspection = await inspect_recovery(store=step_store, run_id=run.run_id)
        record = await store.read_record(conversation_id)
        if record is not None:
            snapshot = inspection.latest
            if snapshot is not None:
                try:
                    await store.save(
                        Conversation(
                            conversation_id=conversation_id, messages=snapshot.messages, revision=record.revision
                        )
                    )
                except ConversationConflict:
                    logger.warning("%s changed since run %s; snapshot not saved", conversation_id, run.run_id)
            metadata = dict((await store.read_record(conversation_id) or record).metadata or {})
            metadata["interrupted"] = {
                "run_id": run.run_id,
                "at": datetime.now(UTC).isoformat(),
                "unresolved_tools": [
                    {"tool_call_id": e.tool_call_id, "tool_name": e.tool_name} for e in inspection.unresolved
                ],
            }
            await store.update(conversation_id, metadata=metadata)
            flagged.append(conversation_id)
        await step_store.append_event(
            StepEvent(
                run_id=run.run_id,
                kind="run_failed",
                step_index=max((e.step_index for e in events), default=0),
                conversation_id=conversation_id,
                error=RECOVERED_ERROR,
            )
        )
    return flagged
