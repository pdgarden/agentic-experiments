from fastapi import APIRouter

from src.agents.mcp_servers import McpServerInfo
from src.api.deps import ServicesDep

router = APIRouter(prefix="/mcp-servers", tags=["mcp"])


@router.get("")
async def list_mcp_servers(services: ServicesDep) -> list[McpServerInfo]:
    """Every server in ``mcp.json``, as connected at startup, with its tools."""
    return services.mcp_servers
