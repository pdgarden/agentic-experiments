"""The model catalogue and the MCP servers, as the pickers need them."""

from fastapi import APIRouter
from pydantic import BaseModel

from src.agent.catalogue import THINKING_LEVELS, ThinkingLevel
from src.agent.mcp import McpServerInfo
from src.services import get_services

router = APIRouter(prefix="/api", tags=["catalogue"])


class ModelOut(BaseModel):
    id: str
    label: str
    thinking_levels: list[ThinkingLevel]
    context_window: int | None


class ModelCatalogueOut(BaseModel):
    default_model: str
    models: list[ModelOut]


@router.get("/models")
async def models() -> ModelCatalogueOut:
    catalogue = get_services().catalogue
    return ModelCatalogueOut(
        default_model=catalogue.default_model,
        models=[
            ModelOut(
                id=m.id,
                label=m.label,
                thinking_levels=list(THINKING_LEVELS) if m.thinking else ["off"],
                context_window=m.context_window,
            )
            for m in catalogue.models
        ],
    )


@router.get("/mcp-servers", summary="Every server in mcp.json, with its status and tools")
async def mcp_servers() -> list[McpServerInfo]:
    return get_services().mcp.info
