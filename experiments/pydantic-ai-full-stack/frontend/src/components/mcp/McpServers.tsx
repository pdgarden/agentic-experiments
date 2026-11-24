import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plug } from "lucide-react";
import { mcpServersQuery } from "@/api/queries";
import type { McpServerInfo } from "@/api/types";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/utils";

/** The MCP servers in `backend/mcp.json`, as the backend connected them at startup. */
export function McpServers() {
  const servers = useQuery(mcpServersQuery);
  const connected = servers.data?.filter((server) => server.status === "connected").length ?? 0;
  return (
    <details className="group border-t text-sm" data-testid="mcp-servers">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 select-none hover:bg-sidebar-accent/60">
        <Plug className="size-4 text-muted-foreground" />
        <span className="flex-1">MCP servers</span>
        {servers.data && (
          <span className="text-xs text-muted-foreground">
            {connected}/{servers.data.length}
          </span>
        )}
        <ChevronRight className="size-4 text-muted-foreground group-open:rotate-90 motion-safe:transition-transform" />
      </summary>
      <div className="max-h-72 space-y-1 overflow-y-auto px-2 pb-3">
        {servers.isError && (
          <Alert size="sm" className="mx-1">
            Could not load MCP servers.
          </Alert>
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
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 select-none hover:bg-sidebar-accent/60"
        title={statusDetail(server)}
      >
        <span className={cn("size-2 shrink-0 rounded-full", dotClass[server.status])} aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{server.name}</span>
        <StatusText server={server} />
      </summary>
      <div className="space-y-1 px-2 pt-1 pb-2 text-xs">
        <p className="text-muted-foreground">
          {server.description ? `${server.description} · ${server.type}` : server.type}
        </p>
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

const dotClass: Record<McpServerInfo["status"], string> = {
  connected: "bg-success",
  failed: "bg-destructive",
  disabled: "bg-muted-foreground/40",
};

function statusDetail(server: McpServerInfo): string {
  switch (server.status) {
    case "connected":
      return `Connected · ${toolCount(server)}`;
    case "failed":
      return server.error ? `Failed: ${server.error}` : "Failed";
    case "disabled":
      return "Disabled";
  }
}

const toolCount = (server: McpServerInfo) =>
  `${server.tools.length} ${server.tools.length === 1 ? "tool" : "tools"}`;

/** The dot shows the status; the word stays for screen readers, the detail is in the tooltip. */
function StatusText({ server }: { server: McpServerInfo }) {
  return server.status === "connected" ? (
    <span className="text-xs text-muted-foreground tabular-nums">{toolCount(server)}</span>
  ) : (
    <span className="sr-only">{server.status}</span>
  );
}
