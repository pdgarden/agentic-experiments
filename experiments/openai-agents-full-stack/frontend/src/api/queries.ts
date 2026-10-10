import { queryOptions } from "@tanstack/react-query";
import { api } from "@/api/client";

export const queryKeys = {
  sessions: ["sessions"] as const,
  session: (id: string) => ["sessions", id] as const,
  mcpServers: ["mcp-servers"] as const,
};

export const sessionsQuery = queryOptions({
  queryKey: queryKeys.sessions,
  queryFn: api.listSessions,
});

export const sessionQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.session(id), queryFn: () => api.getSession(id) });

// Servers connect when the backend starts, so the list only changes on a restart.
export const mcpServersQuery = queryOptions({
  queryKey: queryKeys.mcpServers,
  queryFn: api.listMcpServers,
  staleTime: Number.POSITIVE_INFINITY,
});
