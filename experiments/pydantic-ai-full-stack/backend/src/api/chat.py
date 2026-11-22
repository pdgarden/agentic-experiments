"""Chat runs: start (POST), resume (GET stream), cancel, continue after a crash."""

from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic_ai.ui.vercel_ai._event_stream import VERCEL_AI_DSP_HEADERS

from src.runs.chat import ChatError
from src.runs.manager import RunBuffer
from src.services import get_services

router = APIRouter(prefix="/api/chat", tags=["chat"])

_SSE_HEADERS = {**VERCEL_AI_DSP_HEADERS, "Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _sse(buffer: RunBuffer) -> StreamingResponse:
    async def body() -> AsyncIterator[str]:
        async for chunk in buffer.subscribe():
            yield chunk

    return StreamingResponse(body(), media_type="text/event-stream", headers=_SSE_HEADERS)


def _http_error(e: ChatError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.detail)


@router.post("", summary="Send the new turn (last message only) and stream the run")
async def post_chat(request: Request) -> StreamingResponse:
    try:
        buffer = await get_services().chat.start(await request.body())
    except ChatError as e:
        raise _http_error(e)
    return _sse(buffer)


@router.get("/{conversation_id}/stream", summary="Resume the active or recently finished run", response_model=None)
async def resume_stream(conversation_id: str) -> Response:
    buffer = get_services().runs.get(conversation_id)
    if buffer is None:
        return Response(status_code=204)
    return _sse(buffer)


@router.post("/{conversation_id}/cancel", summary="Stop the active run; what it completed is kept")
async def cancel(conversation_id: str) -> dict[str, bool]:
    return {"cancelled": get_services().runs.cancel(conversation_id)}


@router.post("/{conversation_id}/continue", summary="Continue an interrupted conversation from its last saved step")
async def continue_run(conversation_id: str) -> StreamingResponse:
    try:
        buffer = await get_services().chat.continue_run(conversation_id)
    except ChatError as e:
        raise _http_error(e)
    return _sse(buffer)
