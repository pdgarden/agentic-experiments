"""Services shared by the routers, built once in the app's lifespan."""

from dataclasses import dataclass
from typing import Annotated, cast

from fastapi import Depends, HTTPException, Request

from src.agents.mcp_servers import McpServerInfo
from src.runs.sdk_sessions import SdkSessions
from src.runs.service import RunService
from src.store.repo import SessionRecord, Store


@dataclass(frozen=True)
class Services:
    store: Store
    runs: RunService
    sdk_sessions: SdkSessions
    mcp_servers: list[McpServerInfo]


def get_services(request: Request) -> Services:
    return cast(Services, request.app.state.services)


ServicesDep = Annotated[Services, Depends(get_services)]


async def get_session_or_404(session_id: str, services: ServicesDep) -> SessionRecord:
    session = await services.store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


SessionDep = Annotated[SessionRecord, Depends(get_session_or_404)]
