// Thin typed client over the REST routes; paths and bodies come from /openapi.json.
import createClient from "openapi-fetch";
import type { paths } from "@/api/schema.gen";
import type { InputPart, SessionDetail, SessionRecord } from "@/api/types";

export const http = createClient<paths>({ baseUrl: "" });

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Result<T> = { data?: T; error?: unknown; response: Response };

function unwrap<T>({ data, error, response }: Result<T>): T {
  if (error !== undefined || !response.ok) {
    throw new ApiError(response.status, detail(error) ?? response.statusText);
  }
  return data as T;
}

function detail(error: unknown): string | undefined {
  if (error && typeof error === "object" && "detail" in error) {
    const value = error.detail;
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  return undefined;
}

export const api = {
  listSessions: async (): Promise<SessionRecord[]> => unwrap(await http.GET("/api/sessions")),

  createSession: async (title = ""): Promise<SessionRecord> =>
    unwrap(await http.POST("/api/sessions", { body: { title } })),

  getSession: async (sessionId: string): Promise<SessionDetail> =>
    unwrap(
      await http.GET("/api/sessions/{session_id}", { params: { path: { session_id: sessionId } } }),
    ),

  renameSession: async (sessionId: string, title: string): Promise<SessionRecord> =>
    unwrap(
      await http.PATCH("/api/sessions/{session_id}", {
        params: { path: { session_id: sessionId } },
        body: { title },
      }),
    ),

  deleteSession: async (sessionId: string): Promise<void> => {
    unwrap(
      await http.DELETE("/api/sessions/{session_id}", {
        params: { path: { session_id: sessionId } },
        parseAs: "stream",
      }),
    );
  },

  startRun: async (sessionId: string, parts: InputPart[]): Promise<string> =>
    unwrap(
      await http.POST("/api/sessions/{session_id}/runs", {
        params: { path: { session_id: sessionId } },
        body: { parts },
      }),
    ).run_id,

  cancelRun: async (runId: string): Promise<void> => {
    unwrap(
      await http.POST("/api/runs/{run_id}/cancel", {
        params: { path: { run_id: runId } },
        parseAs: "stream",
      }),
    );
  },
};
