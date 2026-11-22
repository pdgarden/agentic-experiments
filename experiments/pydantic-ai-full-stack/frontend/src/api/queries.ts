import { queryOptions } from "@tanstack/react-query";
import { api } from "@/api/client";

export const queryKeys = {
  models: ["models"] as const,
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversations", id] as const,
  messages: (id: string) => ["messages", id] as const,
  mcpServers: ["mcp-servers"] as const,
  artifacts: (conversationId: string) => ["artifacts", "list", conversationId] as const,
  artifact: (id: string) => ["artifacts", "detail", id] as const,
  artifactVersion: (id: string, version: number) => ["artifacts", "version", id, version] as const,
};

export const modelsQuery = queryOptions({
  queryKey: queryKeys.models,
  queryFn: api.models,
  staleTime: Number.POSITIVE_INFINITY,
});

export const conversationsQuery = queryOptions({
  queryKey: queryKeys.conversations,
  queryFn: api.conversations,
});

export const conversationQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.conversation(id), queryFn: () => api.conversation(id) });

/** Read once when a chat opens; after that `useChat` owns the messages. */
export const messagesQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.messages(id),
    queryFn: () => api.messages(id),
    staleTime: 0,
    gcTime: 0,
  });

/** Connected once at backend startup: the status does not change while the app runs. */
export const mcpServersQuery = queryOptions({
  queryKey: queryKeys.mcpServers,
  queryFn: api.mcpServers,
  staleTime: Number.POSITIVE_INFINITY,
});

export const artifactsQuery = (conversationId: string) =>
  queryOptions({
    queryKey: queryKeys.artifacts(conversationId),
    queryFn: () => api.artifacts(conversationId),
  });

export const artifactQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.artifact(id), queryFn: () => api.artifact(id) });

/** Versions are immutable. */
export const artifactVersionQuery = (id: string, version: number) =>
  queryOptions({
    queryKey: queryKeys.artifactVersion(id, version),
    queryFn: () => api.artifactVersion(id, version),
    staleTime: Number.POSITIVE_INFINITY,
  });
