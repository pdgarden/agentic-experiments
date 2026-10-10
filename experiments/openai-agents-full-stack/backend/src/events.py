"""Stream events: the API contract between a run and the frontend.

Every event shares the envelope ``{v, run_id, seq, type}``; versioning lives
on the envelope. SDK event types never leave the backend: ``src.runs.mapping``
is the only module that translates them.

Event bodies are built without an envelope (``run_id=""``, ``seq=0``) and
stamped by the run's recorder, which owns the sequence counter.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from src.artifacts.models import ArtifactKind
from src.parts import InputPart

EVENT_VERSION = 1

type RunStatus = Literal["running", "succeeded", "failed", "cancelled", "interrupted"]
type FinalRunStatus = Literal["succeeded", "failed", "cancelled", "interrupted"]
type ErrorCode = Literal["max_turns", "guardrail", "timeout", "model_error", "internal"]


class Usage(BaseModel):
    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class _Envelope(BaseModel):
    # Defaults exist only so bodies can be built before stamping; on the wire
    # every field is present, so the exported schema marks them required.
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    v: Literal[1] = EVENT_VERSION
    run_id: str = ""
    seq: int = 0


class RunStarted(_Envelope):
    type: Literal["run_started"] = "run_started"
    session_id: str
    agent: str


class UserMessage(_Envelope):
    type: Literal["user_message"] = "user_message"
    parts: list[InputPart]


class TextDelta(_Envelope):
    """A chunk of assistant text.

    Deltas sharing a ``segment_id`` form one text part; a tool call or agent
    change in between starts a new segment.
    """

    type: Literal["text_delta"] = "text_delta"
    segment_id: str
    delta: str


class ToolCall(_Envelope):
    type: Literal["tool_call"] = "tool_call"
    call_id: str
    name: str
    args: str  # the model's raw JSON argument string, possibly invalid


class ToolResult(_Envelope):
    type: Literal["tool_result"] = "tool_result"
    call_id: str
    result: str
    is_error: bool = False


class ArtifactCreated(_Envelope):
    """A tool created an artifact. A reference only: the content is fetched."""

    type: Literal["artifact_created"] = "artifact_created"
    artifact_id: str
    kind: ArtifactKind
    title: str
    version: int


class ArtifactUpdated(_Envelope):
    """A tool saved a new version of an artifact."""

    type: Literal["artifact_updated"] = "artifact_updated"
    artifact_id: str
    kind: ArtifactKind
    title: str
    version: int


class AgentChanged(_Envelope):
    type: Literal["agent_changed"] = "agent_changed"
    agent: str


class RunFinished(_Envelope):
    type: Literal["run_finished"] = "run_finished"
    status: FinalRunStatus
    usage: Usage | None = None


class Error(_Envelope):
    type: Literal["error"] = "error"
    code: ErrorCode
    message: str


type Event = Annotated[
    RunStarted
    | UserMessage
    | TextDelta
    | ToolCall
    | ToolResult
    | ArtifactCreated
    | ArtifactUpdated
    | AgentChanged
    | RunFinished
    | Error,
    Field(discriminator="type"),
]

event_adapter: TypeAdapter[Event] = TypeAdapter(Event)
