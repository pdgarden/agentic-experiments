"""Message parts: a message is a list of typed parts, never a bare string.

A new capability (artifacts, files, …) is a new part type. The frontend folds
stream events into these parts and ignores types it does not know.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

from src.artifacts.models import ArtifactKind


class TextPart(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ToolPart(BaseModel):
    """A tool call and its result, merged because the UI shows them as one card."""

    type: Literal["tool"] = "tool"
    call_id: str
    name: str
    args: str
    status: Literal["running", "ok", "error"]
    result: str | None = None


class ArtifactPart(BaseModel):
    """An artifact version a tool wrote in this message; its content is fetched."""

    type: Literal["artifact"] = "artifact"
    artifact_id: str
    kind: ArtifactKind
    title: str
    version: int


type Part = Annotated[TextPart | ToolPart | ArtifactPart, Field(discriminator="type")]

# What a user can send. Only text for now; files etc. join this union later.
type InputPart = TextPart


def input_text(parts: list[InputPart]) -> str:
    """The model-facing text of a user message."""
    return "\n\n".join(part.text for part in parts)
