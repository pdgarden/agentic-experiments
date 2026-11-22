import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ConversationSettings, McpServerInfo } from "@/api/types";
import { withServer } from "@/components/mcp/McpPicker";
import { McpServers } from "@/components/mcp/McpServers";
import { json, mcpServer, mockApi, renderWithClient } from "@/test/server";

const servers = [mcpServer("a"), mcpServer("b"), mcpServer("c")] as McpServerInfo[];
const settings: ConversationSettings = {
  model_id: "m",
  thinking: "off",
  mcp_servers: ["c"],
  skills: [],
};

describe("withServer", () => {
  it("adds a server in catalogue order", () => {
    expect(withServer(settings, servers, "a", true).mcp_servers).toEqual(["a", "c"]);
  });

  it("removes a server, and drops names the catalogue no longer has", () => {
    const stale = { ...settings, mcp_servers: ["gone", "a", "c"] };
    expect(withServer(stale, servers, "c", false).mcp_servers).toEqual(["a"]);
  });
});

describe("McpServers", () => {
  it("lists each server with its status, tools and error", async () => {
    mockApi({
      "GET /api/mcp-servers": () =>
        json([
          mcpServer("nba", { description: "NBA stats" }),
          mcpServer("broken", { status: "failed", tools: [], error: "Timed out" }),
          mcpServer("off", { status: "disabled", tools: [] }),
        ]),
    });
    renderWithClient(<McpServers />);
    const list = screen.getByTestId("mcp-servers");
    expect(await within(list).findByText("1/3")).toBeInTheDocument();

    const [nba, broken, off] = await screen.findAllByTestId("mcp-server");
    expect(nba).toHaveAttribute("data-status", "connected");
    expect(nba).toHaveTextContent("1 tool");
    expect(within(nba as HTMLElement).getByRole("list", { name: "nba tools" })).toHaveTextContent(
      "games",
    );
    expect(broken).toHaveTextContent("failed");
    expect(broken).toHaveTextContent("Timed out");
    expect(off).toHaveTextContent("disabled");
  });

  it("says when none are configured", async () => {
    mockApi({ "GET /api/mcp-servers": () => json([]) });
    renderWithClient(<McpServers />);
    expect(await screen.findByText(/None configured/)).toBeInTheDocument();
  });
});
