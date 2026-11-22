"""Artifacts: objects the agent creates and revises through tools, kept outside the message history.

An artifact has a `kind` and immutable versions; each version's `content` is shaped by the kind. A new kind is
a new member of `ArtifactContent`, of `ArtifactKind`, and of the table's `CHECK`.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter

from src.artifacts.chart import validate_chart_spec

ArtifactKind = Literal["chart", "text"]
MAX_TITLE_CHARS = 120
MAX_TEXT_CHARS = 200_000


class ChartContent(BaseModel):
    """A Vega-Lite spec with inline data, validated by `src.artifacts.chart`."""

    kind: Literal["chart"] = "chart"
    spec: dict[str, Any]


class TextContent(BaseModel):
    """A Markdown document (plain text is Markdown too)."""

    kind: Literal["text"] = "text"
    text: str


ArtifactContent = Annotated[ChartContent | TextContent, Field(discriminator="kind")]
content_adapter: TypeAdapter[ChartContent | TextContent] = TypeAdapter(ArtifactContent)


def parse_content(kind: ArtifactKind, raw: str) -> ChartContent | TextContent:
    """Validated content from what the model wrote; `ValueError` says what to fix."""
    if kind == "chart":
        return ChartContent(spec=validate_chart_spec(raw))
    if not raw.strip():
        raise ValueError("Text content must not be empty.")
    if len(raw) > MAX_TEXT_CHARS:
        raise ValueError(f"Text is {len(raw)} characters, over the {MAX_TEXT_CHARS} limit.")
    return TextContent(text=raw)


def clean_title(title: str) -> str:
    cleaned = " ".join(title.split())
    if not cleaned:
        raise ValueError("The title must not be empty.")
    return cleaned[:MAX_TITLE_CHARS]


class ArtifactRecord(BaseModel):
    id: str
    conversation_id: str
    kind: ArtifactKind
    title: str
    latest_version: int
    created_at: str
    updated_at: str


class ArtifactVersionInfo(BaseModel):
    """A version without its content, for listing."""

    version: int
    title: str
    created_at: str


class ArtifactDetail(ArtifactRecord):
    versions: list[ArtifactVersionInfo]


class ArtifactVersion(ArtifactVersionInfo):
    artifact_id: str
    kind: ArtifactKind
    content: ArtifactContent
