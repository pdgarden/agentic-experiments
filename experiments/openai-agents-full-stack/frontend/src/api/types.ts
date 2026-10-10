// Names for the generated contract types. Regenerate the source with `make gen-types`.
import type { components } from "@/api/schema.gen";

type Schemas = components["schemas"];

export type Event = Schemas["Event"];
export type EventType = Event["type"];
export type Part = Schemas["Part"];
export type TextPart = Schemas["TextPart"];
export type ToolPart = Schemas["ToolPart"];
export type InputPart = Schemas["InputPart"];
export type Usage = Schemas["Usage"];
export type ErrorCode = Schemas["ErrorCode"];
export type RunStatus = Schemas["RunStatus"];
export type SessionRecord = Schemas["SessionRecord"];
export type SessionDetail = Schemas["SessionDetail"];
export type RunWithEvents = Schemas["RunWithEvents"];
export type McpServerInfo = Schemas["McpServerInfo"];
export type ArtifactPart = Schemas["ArtifactPart"];
export type ArtifactRecord = Schemas["ArtifactRecord"];
export type ArtifactDetail = Schemas["ArtifactDetail"];
export type ArtifactVersionRecord = Schemas["ArtifactVersionRecord"];
export type ChartContent = Schemas["ChartContent"];

/** The event of a given `type`, e.g. `EventOf<"text_delta">`. */
export type EventOf<T extends EventType> = Extract<Event, { type: T }>;

/** The envelope version this client understands. */
export const EVENT_VERSION = 1;
