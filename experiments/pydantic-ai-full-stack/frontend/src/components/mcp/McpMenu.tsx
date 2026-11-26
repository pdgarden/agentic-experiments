import { Plug } from "lucide-react";
import type { ConversationSettings, McpServerInfo } from "@/api/types";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

/** The settings with `name` enabled or not, keeping the catalogue's order. */
export function withServer(
  settings: ConversationSettings,
  servers: McpServerInfo[],
  name: string,
  enabled: boolean,
): ConversationSettings {
  const chosen = new Set(settings.mcp_servers);
  if (enabled) chosen.add(name);
  else chosen.delete(name);
  return { ...settings, mcp_servers: servers.map((s) => s.name).filter((n) => chosen.has(n)) };
}

interface McpMenuProps {
  servers: McpServerInfo[];
  settings: ConversationSettings;
  onChange: (settings: ConversationSettings) => void;
}

/**
 * The composer `+` menu's "MCP servers" sub-menu: which servers this chat may use. Servers that
 * failed or are disabled can't be picked.
 */
export function McpMenu({ servers, settings, onChange }: McpMenuProps) {
  if (servers.length === 0) return null;
  const enabled = servers.filter(
    (s) => s.status === "connected" && settings.mcp_servers.includes(s.name),
  ).length;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger title={`MCP servers: ${enabled} of ${servers.length} enabled`}>
        <Plug />
        MCP servers
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {enabled}/{servers.length}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72">
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
          Tools are callable from code mode
        </p>
        {servers.map((server) => {
          const usable = server.status === "connected";
          return (
            <DropdownMenuCheckboxItem
              key={server.name}
              data-testid="mcp-option"
              disabled={!usable}
              checked={usable && settings.mcp_servers.includes(server.name)}
              onCheckedChange={(checked) =>
                onChange(withServer(settings, servers, server.name, checked))
              }
              // Stay open so several servers can be ticked in a row.
              onSelect={(event) => event.preventDefault()}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs">{server.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {usable ? (server.description ?? `${server.tools.length} tools`) : server.status}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
