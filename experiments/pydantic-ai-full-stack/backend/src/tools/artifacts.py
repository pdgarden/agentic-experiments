"""`create_artifact` / `update_artifact`: content is validated before it is stored; a bad one comes back as a retry.

The tools return the artifact reference (id, version, kind, title), which is also what the UI reads from the
tool part to render the artifact card, live and after a reload. They also emit `ArtifactEvent`, forwarded by the
adapter as a `data-artifact` part, so an open artifacts panel refreshes as soon as a version is written.
"""

from dataclasses import dataclass
from typing import TypedDict

from pydantic_ai import CustomEvent, ModelRetry, RunContext
from pydantic_ai.toolsets import FunctionToolset
from pydantic_ai.ui.vercel_ai.response_types import DataChunk

from src.agent.build import Deps
from src.artifacts.models import ArtifactKind, ArtifactRecord, clean_title, parse_content
from src.store.artifacts import ArtifactStore

ARTIFACTS_TOOLSET_ID = "artifacts"


@dataclass(kw_only=True)
class ArtifactEvent(CustomEvent, name="artifact"):
    artifact_id: str
    version: int
    kind: ArtifactKind
    title: str
    created: bool

    def to_payload(self) -> DataChunk:
        """Transient: a notification for the open UI, not a message part (the tool part carries the reference)."""
        data = {"artifact_id": self.artifact_id, "version": self.version, "kind": self.kind, "title": self.title}
        return DataChunk(type="data-artifact", data={**data, "created": self.created}, transient=True)


class ArtifactRef(TypedDict):
    artifact_id: str
    version: int
    kind: ArtifactKind
    title: str
    note: str


async def _written(ctx: RunContext[Deps], record: ArtifactRecord, *, created: bool) -> ArtifactRef:
    await ctx.emit(
        ArtifactEvent(
            artifact_id=record.id,
            version=record.latest_version,
            kind=record.kind,
            title=record.title,
            created=created,
        )
    )
    return ArtifactRef(
        artifact_id=record.id,
        version=record.latest_version,
        kind=record.kind,
        title=record.title,
        note="Shown to the user in this message and in the artifacts panel; do not repeat its content.",
    )


def artifact_toolset(store: ArtifactStore) -> FunctionToolset[Deps]:
    # A chart spec can take a few fixes: each invalid one comes back to the model as a retry.
    toolset = FunctionToolset[Deps](id=ARTIFACTS_TOOLSET_ID, max_retries=3)

    @toolset.tool
    async def create_artifact(ctx: RunContext[Deps], kind: ArtifactKind, title: str, content: str) -> ArtifactRef:
        """Create an artifact (a chart or a document) shown to the user beside the chat and saved with it.

        Use it for anything the user may want to keep, reuse or revise: charts, reports, long documents, code files.

        Args:
            kind: "chart" for a Vega-Lite chart, "text" for a Markdown document.
            title: A short title.
            content: For "chart", a Vega-Lite v6 spec as a JSON string, with the rows inline in
                "data": {"values": [...]} (URLs are rejected). For "text", the Markdown document.
        """
        try:
            parsed = parse_content(kind, content)
            record = await store.create(ctx.deps.conversation_id, kind, clean_title(title), parsed, ctx.run_id)
        except ValueError as e:
            raise ModelRetry(str(e))
        return await _written(ctx, record, created=True)

    @toolset.tool
    async def update_artifact(
        ctx: RunContext[Deps], artifact_id: str, content: str, title: str | None = None
    ) -> ArtifactRef:
        """Save a new version of an artifact of this chat (same kind), e.g. to change a chart type or edit a document.

        Args:
            artifact_id: The id returned by create_artifact.
            content: The full new content, in the artifact's format (see create_artifact).
            title: A new title, or null to keep the current one.
        """
        current = await store.get(artifact_id)
        if current is None or current.conversation_id != ctx.deps.conversation_id:
            raise ModelRetry(f"No artifact {artifact_id!r} in this chat.")
        try:
            parsed = parse_content(current.kind, content)
            new_title = clean_title(title) if title is not None else None
            record = await store.add_version(artifact_id, ctx.deps.conversation_id, parsed, ctx.run_id, title=new_title)
        except ValueError as e:
            raise ModelRetry(str(e))
        if record is None:  # deleted in between
            raise ModelRetry(f"No artifact {artifact_id!r} in this chat.")
        return await _written(ctx, record, created=False)

    return toolset
