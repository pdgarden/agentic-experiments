"""A tiny stdio MCP server for tests: `python tests/mcp_test_server.py`."""

from mcp.server.mcpserver import MCPServer

server = MCPServer("test")


@server.tool()
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


if __name__ == "__main__":
    server.run("stdio")
