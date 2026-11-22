"""Attachments: upload (size + MIME allowlist) and download."""

from fastapi import APIRouter, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from src.services import get_services
from src.store.files import ALLOWED_MEDIA_TYPES

router = APIRouter(prefix="/api/files", tags=["files"])


class FileOut(BaseModel):
    id: str
    url: str
    filename: str
    media_type: str
    size: int


@router.post("", summary="Upload an attachment; the message then references its url")
async def upload(file: UploadFile, conversation_id: str | None = Form(default=None)) -> FileOut:
    services = get_services()
    media_type = (file.content_type or "").split(";")[0].strip().lower()
    if media_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(415, f"Unsupported file type {media_type!r}")
    limit = services.settings.max_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File larger than {limit // (1024 * 1024)} MB")
    stored = await services.files.add(
        filename=file.filename or "file", media_type=media_type, data=data, conversation_id=conversation_id
    )
    return FileOut(
        id=stored.id,
        url=f"/api/files/{stored.id}",
        filename=stored.filename,
        media_type=stored.media_type,
        size=stored.size,
    )


@router.get("/{file_id}", response_class=FileResponse)
async def download(file_id: str) -> FileResponse:
    services = get_services()
    stored = await services.files.get(file_id)
    if stored is None:
        raise HTTPException(404, "Unknown file")
    return FileResponse(services.files.path(file_id), media_type=stored.media_type, filename=stored.filename)
