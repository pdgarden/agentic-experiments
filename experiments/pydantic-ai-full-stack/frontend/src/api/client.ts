import type {
  ArtifactDetail,
  ArtifactRecord,
  ArtifactVersion,
  Conversation,
  ConversationMessages,
  ConversationSettings,
  McpServerInfo,
  ModelCatalogue,
  UploadedFile,
} from "@/api/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** FastAPI errors carry `detail`: a string, or a list of validation errors. */
async function errorFrom(response: Response): Promise<ApiError> {
  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail)) message = body.detail.map((d) => d?.msg ?? d).join("; ");
  } catch {
    // not JSON: keep the status line
  }
  return new ApiError(response.status, message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const conversationPath = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;
const chatPath = (id: string) => `/api/chat/${encodeURIComponent(id)}`;
const artifactPath = (id: string) => `/api/artifacts/${encodeURIComponent(id)}`;

export const api = {
  models: () => request<ModelCatalogue>("/api/models"),
  mcpServers: () => request<McpServerInfo[]>("/api/mcp-servers"),
  artifacts: (conversationId: string) =>
    request<ArtifactRecord[]>(`${conversationPath(conversationId)}/artifacts`),
  artifact: (id: string) => request<ArtifactDetail>(artifactPath(id)),
  artifactVersion: (id: string, version: number) =>
    request<ArtifactVersion>(`${artifactPath(id)}/versions/${version}`),
  conversations: () => request<Conversation[]>("/api/conversations"),
  conversation: (id: string) => request<Conversation>(conversationPath(id)),
  messages: (id: string) => request<ConversationMessages>(`${conversationPath(id)}/messages`),
  /** Idempotent: creates the conversation on first call, then updates its settings. */
  putSettings: (id: string, settings: ConversationSettings) =>
    request<Conversation>(conversationPath(id), json("PUT", settings)),
  rename: (id: string, title: string) =>
    request<Conversation>(conversationPath(id), json("PATCH", { title })),
  remove: (id: string) => request<void>(conversationPath(id), { method: "DELETE" }),
  cancel: (id: string) =>
    request<{ cancelled: boolean }>(`${chatPath(id)}/cancel`, { method: "POST" }),
  /**
   * Start the continuation of an interrupted conversation. Its stream is then read through the
   * normal resume path, so the body of this response is dropped (the run does not depend on it).
   */
  continueRun: async (id: string) => {
    const response = await fetch(`${chatPath(id)}/continue`, { method: "POST" });
    if (!response.ok) throw await errorFrom(response);
    await response.body?.cancel();
  },
  upload: (file: File, conversationId: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("conversation_id", conversationId);
    return request<UploadedFile>("/api/files", { method: "POST", body: form });
  },
};
