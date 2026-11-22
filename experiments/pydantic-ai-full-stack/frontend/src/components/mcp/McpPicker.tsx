import { ChevronDown, Plug } from "lucide-react";
import { Popover } from "radix-ui";
import type { ConversationSettings, McpServerInfo } from "@/api/types";
import { Button } from "@/components/ui/button";

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

interface McpPickerProps {
  servers: McpServerInfo[];
  settings: ConversationSettings;
  onChange: (settings: ConversationSettings) => void;
}

/** Which MCP servers this chat may use. Servers that failed or are disabled can't be picked. */
export function McpPicker({ servers, settings, onChange }: McpPickerProps) {
  if (servers.length === 0) return null;
  const enabled = servers.filter(
    (s) => s.status === "connected" && settings.mcp_servers.includes(s.name),
  ).length;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="outline" size="sm" aria-label="MCP servers">
          <Plug /> MCP {enabled}/{servers.length}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-72 rounded-md border bg-popover p-2 text-sm text-popover-foreground shadow-md"
        >
          <p className="px-1 pb-2 text-xs text-muted-foreground">
            Tools of the servers you pick are callable from code mode.
          </p>
          <ul className="space-y-1">
            {servers.map((server) => {
              const usable = server.status === "connected";
              return (
                <li key={server.name}>
                  <label
                    className="flex items-start gap-2 rounded px-1 py-1 hover:bg-accent has-[:disabled]:opacity-60"
                    data-testid="mcp-option"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={!usable}
                      checked={usable && settings.mcp_servers.includes(server.name)}
                      onChange={(e) =>
                        onChange(withServer(settings, servers, server.name, e.target.checked))
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-xs">{server.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {usable
                          ? (server.description ?? `${server.tools.length} tools`)
                          : server.status}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
