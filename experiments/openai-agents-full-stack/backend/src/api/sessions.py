from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from src.agents.registry import DEFAULT_AGENT
from src.api.deps import ServicesDep, SessionDep
from src.events import Event
from src.store.repo import RunRecord, SessionRecord

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionCreate(BaseModel):
    title: str = Field(default="", max_length=200)


class SessionUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class RunWithEvents(RunRecord):
    events: list[Event]


class SessionDetail(BaseModel):
    session: SessionRecord
    runs: list[RunWithEvents]


@router.get("")
async def list_sessions(services: ServicesDep) -> list[SessionRecord]:
    return await services.store.list_sessions()


@router.post("", status_code=201)
async def create_session(body: SessionCreate, services: ServicesDep) -> SessionRecord:
    return await services.store.create_session(DEFAULT_AGENT, title=body.title.strip())


@router.get("/{session_id}")
async def get_session(session: SessionDep, services: ServicesDep) -> SessionDetail:
    """The session and its runs, each with its events, for the frontend to fold."""
    runs = await services.store.list_runs(session.id)
    events = await services.store.events_by_run(session.id)
    return SessionDetail(
        session=session,
        runs=[
            RunWithEvents(**run.model_dump(), events=events.get(run.id, []))
            for run in runs
        ],
    )


@router.patch("/{session_id}")
async def rename_session(
    body: SessionUpdate, session: SessionDep, services: ServicesDep
) -> SessionRecord:
    renamed = await services.store.rename_session(session.id, body.title.strip())
    if renamed is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return renamed


@router.delete("/{session_id}", status_code=204)
async def delete_session(session: SessionDep, services: ServicesDep) -> Response:
    """Hard delete: stops its runs, then removes runs, events and SDK history."""
    await services.runs.stop_session_runs(session.id)
    await services.store.delete_session(session.id)
    await services.sdk_sessions.delete(session.id)
    return Response(status_code=204)
