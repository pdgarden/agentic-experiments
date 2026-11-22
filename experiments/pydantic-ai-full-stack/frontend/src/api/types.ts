// Shapes of the backend's REST API (backend/src/api/*.py). Chat streams use the AI SDK's own types.
import type { UIMessage } from "ai";

export type ThinkingLevel = "off" | "low" | "medium" | "high";

export interface ModelInfo {
  id: string;
  label: string;
  /** `["off"]` for a model without thinking. */
  thinking_levels: ThinkingLevel[];
  context_window: number | null;
}

export interface ModelCatalogue {
  default_model: string;
  models: ModelInfo[];
}

export interface ConversationSettings {
  model_id: string;
  thinking: ThinkingLevel;
  mcp_servers: string[];
  skills: string[];
}

export interface UnresolvedTool {
  tool_call_id: string | null;
  tool_name: string | null;
}

/** Set by crash recovery: the run stopped with the process, its completed steps are kept. */
export interface Interrupted {
  run_id: string;
  at: string;
  unresolved_tools: UnresolvedTool[];
}

export interface Conversation {
  id: string;
  title: string | null;
  updated_at: string;
  settings: ConversationSettings;
  interrupted: Interrupted | null;
  running: boolean;
}

export interface ConversationMessages {
  messages: UIMessage[];
  /** A run is streaming and its turn is not saved yet: resume its stream. */
  active_run: boolean;
}

export interface UploadedFile {
  id: string;
  /** `/api/files/<id>`: the only URL a message's file part may use. */
  url: string;
  filename: string;
  media_type: string;
  size: number;
}

export interface McpToolInfo {
  /** As the server names it; the agent calls it `<server>_<name>` from `run_code`. */
  name: string;
  description: string | null;
}

export interface McpServerInfo {
  name: string;
  type: "stdio" | "http";
  status: "connected" | "failed" | "disabled";
  description: string | null;
  tools: McpToolInfo[];
  error: string | null;
}

export type ArtifactKind = "chart" | "text";

export interface ArtifactRecord {
  id: string;
  conversation_id: string;
  kind: ArtifactKind;
  title: string;
  latest_version: number;
  created_at: string;
  updated_at: string;
}

export interface ArtifactVersionInfo {
  version: number;
  title: string;
  created_at: string;
}

export interface ArtifactDetail extends ArtifactRecord {
  versions: ArtifactVersionInfo[];
}

export type ArtifactContent =
  | { kind: "chart"; spec: Record<string, unknown> }
  | { kind: "text"; text: string };

export interface ArtifactVersion extends ArtifactVersionInfo {
  artifact_id: string;
  kind: ArtifactKind;
  content: ArtifactContent;
}

/** What `create_artifact` / `update_artifact` return, read from the tool part to render the card. */
export interface ArtifactRef {
  artifact_id: string;
  version: number;
  kind: ArtifactKind;
  title: string;
}
