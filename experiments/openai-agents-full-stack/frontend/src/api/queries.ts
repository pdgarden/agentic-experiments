import { queryOptions } from "@tanstack/react-query";
import { api } from "@/api/client";

export const queryKeys = {
  sessions: ["sessions"] as const,
  session: (id: string) => ["sessions", id] as const,
  mcpServers: ["mcp-servers"] as const,
  sessionArtifacts: (sessionId: string) => ["sessions", sessionId, "artifacts"] as const,
  artifact: (id: string) => ["artifacts", id] as const,
  artifactVersion: (id: string, version: number) => ["artifacts", id, "versions", version] as const,
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

export const sessionArtifactsQuery = (sessionId: string) =>
  queryOptions({
    queryKey: queryKeys.sessionArtifacts(sessionId),
    queryFn: () => api.listArtifacts(sessionId),
  });

export const artifactQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.artifact(id), queryFn: () => api.getArtifact(id) });

// A version never changes once written.
export const artifactVersionQuery = (id: string, version: number) =>
  queryOptions({
    queryKey: queryKeys.artifactVersion(id, version),
    queryFn: () => api.getArtifactVersion(id, version),
    staleTime: Number.POSITIVE_INFINITY,
  });
