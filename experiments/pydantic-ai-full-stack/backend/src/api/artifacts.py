"""Artifacts: a conversation's list, one artifact with its versions, one version's content."""

from fastapi import APIRouter, HTTPException

from src.artifacts.models import ArtifactDetail, ArtifactRecord, ArtifactVersion
from src.services import get_services

router = APIRouter(prefix="/api", tags=["artifacts"])


@router.get("/conversations/{conversation_id}/artifacts", summary="The conversation's artifacts, newest first")
async def list_artifacts(conversation_id: str) -> list[ArtifactRecord]:
    return await get_services().artifacts.list_for_conversation(conversation_id)


@router.get("/artifacts/{artifact_id}", summary="An artifact and its versions (without content)")
async def get_artifact(artifact_id: str) -> ArtifactDetail:
    detail = await get_services().artifacts.get(artifact_id)
    if detail is None:
        raise HTTPException(404, "Unknown artifact")
    return detail


@router.get("/artifacts/{artifact_id}/versions/{version}", summary="One version's content")
async def get_artifact_version(artifact_id: str, version: int) -> ArtifactVersion:
    found = await get_services().artifacts.get_version(artifact_id, version)
    if found is None:
        raise HTTPException(404, "Unknown artifact version")
    return found
