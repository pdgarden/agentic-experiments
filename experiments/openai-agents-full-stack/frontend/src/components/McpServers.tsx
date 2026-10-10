import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plug } from "lucide-react";
import { mcpServersQuery } from "@/api/queries";
import type { McpServerInfo } from "@/api/types";
import { Badge } from "@/components/ui/badge";

/** The MCP servers in `backend/mcp.json`, as the backend connected them at startup. */
export function McpServers() {
  const servers = useQuery(mcpServersQuery);
  const connected = servers.data?.filter((server) => server.status === "connected").length ?? 0;
  return (
    <details className="group border-t text-sm" data-testid="mcp-servers">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 select-none hover:bg-sidebar-accent">
        <Plug className="size-4 text-muted-foreground" />
        <span className="flex-1">MCP servers</span>
        {servers.data && (
          <span className="text-xs text-muted-foreground">
            {connected}/{servers.data.length}
          </span>
        )}
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="max-h-72 space-y-1 overflow-y-auto px-2 pb-3">
        {servers.isError && (
          <p className="px-2 text-xs text-destructive">Could not load MCP servers.</p>
        )}
        {servers.data?.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">
            None configured in <code>backend/mcp.json</code>.
          </p>
        )}
        {servers.data?.map((server) => (
          <Server key={server.name} server={server} />
        ))}
      </div>
    </details>
  );
}

function Server({ server }: { server: McpServerInfo }) {
  return (
    <details
      className="group/server rounded-md"
      data-testid="mcp-server"
      data-status={server.status}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 select-none hover:bg-sidebar-accent">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{server.name}</span>
        <StatusBadge server={server} />
      </summary>
      <div className="space-y-1 px-2 pt-1 pb-2 text-xs">
        <p className="text-muted-foreground">{server.type}</p>
        {server.error && <p className="break-words text-destructive">{server.error}</p>}
        {server.tools.length > 0 && (
          <ul className="space-y-1" aria-label={`${server.name} tools`}>
            {server.tools.map((tool) => (
              <li key={tool.name}>
                <span className="font-mono">{tool.name}</span>
                {tool.description && (
                  <span className="block text-muted-foreground">{tool.description}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function StatusBadge({ server }: { server: McpServerInfo }) {
  switch (server.status) {
    case "connected":
      return (
        <Badge variant="secondary">
          {server.tools.length} {server.tools.length === 1 ? "tool" : "tools"}
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">failed</Badge>;
    case "disabled":
      return <Badge variant="outline">disabled</Badge>;
  }
}
