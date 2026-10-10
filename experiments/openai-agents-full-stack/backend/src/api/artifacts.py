from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.api.deps import ServicesDep, SessionDep
from src.artifacts.models import (
    ArtifactRecord,
    ArtifactVersionInfo,
    ArtifactVersionRecord,
)

router = APIRouter(tags=["artifacts"])


class ArtifactDetail(ArtifactRecord):
    versions: list[ArtifactVersionInfo]


async def get_artifact_or_404(
    artifact_id: str, services: ServicesDep
) -> ArtifactRecord:
    artifact = await services.store.get_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return artifact


ArtifactDep = Annotated[ArtifactRecord, Depends(get_artifact_or_404)]


@router.get("/sessions/{session_id}/artifacts")
async def list_session_artifacts(
    session: SessionDep, services: ServicesDep
) -> list[ArtifactRecord]:
    """The session's artifacts, newest first, without content."""
    return await services.store.list_artifacts(session.id)


@router.get("/artifacts/{artifact_id}")
async def get_artifact(artifact: ArtifactDep, services: ServicesDep) -> ArtifactDetail:
    """The artifact and its versions, oldest first, without content."""
    versions = await services.store.list_artifact_versions(artifact.id)
    return ArtifactDetail(**artifact.model_dump(), versions=versions)


@router.get("/artifacts/{artifact_id}/versions/{version}")
async def get_artifact_version(
    artifact: ArtifactDep, version: int, services: ServicesDep
) -> ArtifactVersionRecord:
    """One version with its content. Versions never change once written."""
    record = await services.store.get_artifact_version(artifact.id, version)
    if record is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return record
