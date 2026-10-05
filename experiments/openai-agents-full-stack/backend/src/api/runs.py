from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field

from src.api.deps import ServicesDep, SessionDep
from src.parts import InputPart
from src.store.repo import RunConflict, RunRecord

router = APIRouter(tags=["runs"])

# The route whose SSE items are documented as ``Event`` in the OpenAPI schema.
EVENTS_ROUTE_NAME = "stream_run_events"


class RunCreate(BaseModel):
    parts: list[InputPart] = Field(min_length=1)


class RunCreated(BaseModel):
    run_id: str


async def get_run_or_404(run_id: str, services: ServicesDep) -> RunRecord:
    run = await services.store.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


RunDep = Annotated[RunRecord, Depends(get_run_or_404)]


@router.post(
    "/sessions/{session_id}/runs",
    status_code=201,
    responses={409: {"description": "The session already has a running run"}},
)
async def start_run(
    body: RunCreate, session: SessionDep, services: ServicesDep
) -> RunCreated:
    try:
        run = await services.runs.start(session, body.parts)
    except RunConflict:
        raise HTTPException(
            status_code=409, detail="This session already has a running run"
        )
    return RunCreated(run_id=run.id)


@router.get(
    "/runs/{run_id}/events",
    response_class=EventSourceResponse,
    name=EVENTS_ROUTE_NAME,
)
async def stream_run_events(
    run: RunDep,
    services: ServicesDep,
    after: Annotated[int, Query(ge=0)] = 0,
    last_event_id: Annotated[str | None, Header()] = None,
) -> AsyncIterator[ServerSentEvent]:
    """Server-sent events of a run: replay after ``after``, then the live tail.

    Each message's ``id`` is the event's ``seq``, so an ``EventSource``
    reconnecting with ``Last-Event-ID`` resumes where it stopped. The stream
    closes after ``run_finished``.
    """
    if last_event_id is not None and last_event_id.isdigit():
        after = max(after, int(last_event_id))
    async for event in services.runs.stream(run.id, after):
        yield ServerSentEvent(data=event, id=str(event.seq))


@router.post(
    "/runs/{run_id}/cancel",
    status_code=202,
    responses={409: {"description": "The run is not running"}},
)
async def cancel_run(run: RunDep, services: ServicesDep) -> Response:
    if not services.runs.cancel(run.id):
        raise HTTPException(status_code=409, detail="Run is not running")
    return Response(status_code=202)
