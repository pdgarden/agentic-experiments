"""Tool outputs that report an artifact write without changing what the model sees.

Same idea as ``ToolErrorText``: ``ArtifactOutput`` is a ``str`` for the model,
and the event mapper reads its ``ref`` to emit ``artifact_created`` or
``artifact_updated`` right after the tool's result. The SDK deep-copies tool
outputs, so the constructor takes only the text and the ref is set after.
"""

from dataclasses import dataclass
from typing import Self

from src.artifacts.models import ArtifactKind


@dataclass(frozen=True)
class ArtifactRef:
    artifact_id: str
    kind: ArtifactKind
    title: str
    version: int
    created: bool


class ArtifactOutput(str):
    ref: ArtifactRef

    @classmethod
    def of(cls, ref: ArtifactRef) -> Self:
        verb = "Created" if ref.created else "Updated"
        output = cls(
            f"{verb} {ref.kind} artifact {ref.artifact_id} (v{ref.version}):"
            f" {ref.title}. It is shown to the user."
        )
        output.ref = ref
        return output
