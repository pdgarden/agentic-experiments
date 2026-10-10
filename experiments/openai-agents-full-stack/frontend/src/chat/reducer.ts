// Events → parts. The same fold builds a run from its stored history and from the live stream.
import {
  type ErrorCode,
  EVENT_VERSION,
  type Event,
  type InputPart,
  type Part,
  type RunStatus,
  type RunWithEvents,
  type ToolPart,
  type Usage,
} from "@/api/types";

/** UI-only part marking a handoff: the agent that answers from here on. */
export interface AgentPart {
  type: "agent";
  agent: string;
}

export type ViewPart = Part | AgentPart;

export interface RunError {
  code: ErrorCode;
  message: string;
}

/** One run as the UI shows it: the user's message and the assistant's parts. */
export interface RunView {
  id: string;
  status: RunStatus;
  agent: string | null;
  input: InputPart[];
  parts: ViewPart[];
  errors: RunError[];
  usage: Usage | null;
  /** The last applied event's seq: the stream resumes after it. */
  lastSeq: number;
  /** `segment_id` → index of its text part in `parts`. */
  segments: Record<string, number>;
}

export function emptyRun(id: string, input: InputPart[] = []): RunView {
  return {
    id,
    status: "running",
    agent: null,
    input,
    parts: [],
    errors: [],
    usage: null,
    lastSeq: 0,
    segments: {},
  };
}

/**
 * Apply one event. Events at or below `lastSeq` are ignored, so a replay overlapping the
 * live stream is harmless; events of an unknown type or version only advance `lastSeq`.
 */
export function applyEvent(run: RunView, event: Event): RunView {
  if (event.seq <= run.lastSeq) return run;
  const next = { ...run, lastSeq: event.seq };
  if (event.v !== EVENT_VERSION) return next;

  switch (event.type) {
    case "run_started":
      return { ...next, status: "running", agent: event.agent };

    case "user_message":
      return { ...next, input: event.parts };

    case "text_delta": {
      const index = next.segments[event.segment_id];
      const part = index === undefined ? undefined : next.parts[index];
      if (index === undefined || part?.type !== "text") {
        return {
          ...next,
          parts: [...next.parts, { type: "text", text: event.delta }],
          segments: { ...next.segments, [event.segment_id]: next.parts.length },
        };
      }
      return {
        ...next,
        parts: replaceAt(next.parts, index, { ...part, text: part.text + event.delta }),
      };
    }

    case "tool_call":
      return {
        ...next,
        parts: [
          ...next.parts,
          {
            type: "tool",
            call_id: event.call_id,
            name: event.name,
            args: event.args,
            status: "running",
            result: null,
          },
        ],
      };

    case "tool_result": {
      const index = next.parts.findIndex(
        (part) => part.type === "tool" && part.call_id === event.call_id,
      );
      const part = next.parts[index];
      if (part?.type !== "tool") return next;
      const done: ToolPart = {
        ...part,
        status: event.is_error ? "error" : "ok",
        result: event.result,
      };
      return { ...next, parts: replaceAt(next.parts, index, done) };
    }

    // One part per write: each message shows the version it made, even after later updates.
    case "artifact_created":
    case "artifact_updated":
      return {
        ...next,
        parts: [
          ...next.parts,
          {
            type: "artifact",
            artifact_id: event.artifact_id,
            kind: event.kind,
            title: event.title,
            version: event.version,
          },
        ],
      };

    case "agent_changed":
      return {
        ...next,
        agent: event.agent,
        parts: [...next.parts, { type: "agent", agent: event.agent }],
      };

    case "run_finished":
      return { ...next, status: event.status, usage: event.usage ?? next.usage };

    case "error":
      return { ...next, errors: [...next.errors, { code: event.code, message: event.message }] };

    default:
      return next;
  }
}

export function foldEvents(run: RunView, events: readonly Event[]): RunView {
  return events.reduce(applyEvent, run);
}

/** A stored run, folded. The run record's status and error back up an incomplete event log. */
export function runFromRecord(record: RunWithEvents): RunView {
  const run = foldEvents(emptyRun(record.id, record.input), record.events);
  const finished = record.status !== "running" && run.status === "running";
  return {
    ...run,
    status: finished ? record.status : run.status,
    usage: run.usage ?? record.usage,
    errors:
      run.errors.length === 0 && record.error
        ? [{ code: "internal", message: record.error }]
        : run.errors,
  };
}

function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  const copy = items.slice();
  copy[index] = item;
  return copy;
}
