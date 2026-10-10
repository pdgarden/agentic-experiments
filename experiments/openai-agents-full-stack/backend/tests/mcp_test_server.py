"""A tiny stdio MCP server for tests: ``uv run python tests/mcp_test_server.py``."""

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

server = MCPServer("test")


@server.tool()
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


@server.tool()
def fail() -> str:
    """Always fails."""
    raise ToolError("this tool always fails")


if __name__ == "__main__":
    server.run("stdio")
