import { queryOptions } from "@tanstack/react-query";
import { api } from "@/api/client";

export const queryKeys = {
  sessions: ["sessions"] as const,
  session: (id: string) => ["sessions", id] as const,
};

export const sessionsQuery = queryOptions({
  queryKey: queryKeys.sessions,
  queryFn: api.listSessions,
});

export const sessionQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.session(id), queryFn: () => api.getSession(id) });
