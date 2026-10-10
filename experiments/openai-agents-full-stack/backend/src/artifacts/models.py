"""Artifacts: session objects the agent creates and revises through tools.

An artifact has a ``kind`` and a list of immutable versions; each version's
``content`` is shaped by the kind. Only charts exist for now: a new kind is a
new member of ``ArtifactContent`` and of the table's ``CHECK``.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter

type ArtifactKind = Literal["chart"]


class ChartContent(BaseModel):
    """A Vega-Lite spec with inline data, validated by ``src.artifacts.chart``."""

    kind: Literal["chart"] = "chart"
    spec: dict[str, Any]


# One member for now; the discriminator keeps the stored JSON self-describing.
type ArtifactContent = Annotated[ChartContent, Field(discriminator="kind")]

content_adapter: TypeAdapter[ArtifactContent] = TypeAdapter(ArtifactContent)


class ArtifactRecord(BaseModel):
    id: str
    session_id: str
    kind: ArtifactKind
    title: str
    latest_version: int
    created_at: str
    updated_at: str


class ArtifactVersionInfo(BaseModel):
    """A version without its content, for listing."""

    artifact_id: str
    version: int
    run_id: str
    title: str
    created_at: str


class ArtifactVersionRecord(ArtifactVersionInfo):
    content: ArtifactContent
