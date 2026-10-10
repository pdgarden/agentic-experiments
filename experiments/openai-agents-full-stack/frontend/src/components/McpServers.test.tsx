import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import type { McpServerInfo } from "@/api/types";
import { McpServers } from "@/components/McpServers";

vi.mock("@/api/client", () => ({ api: { listMcpServers: vi.fn() } }));

const mocked = vi.mocked(api);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <McpServers />
    </QueryClientProvider>,
  );
}

const servers: McpServerInfo[] = [
  {
    name: "fetch",
    type: "stdio",
    status: "connected",
    tools: [{ name: "fetch", description: "Fetch a URL." }],
  },
  { name: "broken", type: "http", status: "failed", tools: [], error: "connection refused" },
  { name: "off", type: "stdio", status: "disabled", tools: [] },
];

describe("McpServers", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lists each server with its status, tools and error", async () => {
    mocked.listMcpServers.mockResolvedValue(servers);
    renderPanel();

    expect(await screen.findByText("1/3")).toBeInTheDocument();
    const rows = screen.getAllByTestId("mcp-server");
    expect(rows.map((row) => row.dataset.status)).toEqual(["connected", "failed", "disabled"]);
    const [fetch, broken, off] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(fetch).getByText("1 tool")).toBeInTheDocument();
    expect(within(fetch).getByRole("list", { name: "fetch tools" })).toHaveTextContent(
      "Fetch a URL.",
    );
    expect(within(broken).getByText("connection refused")).toBeInTheDocument();
    expect(within(off).getByText("disabled")).toBeInTheDocument();
  });

  it("says when none are configured", async () => {
    mocked.listMcpServers.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText(/None configured/)).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });
});
