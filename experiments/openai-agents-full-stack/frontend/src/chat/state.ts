// A session's runs in order: loaded history, merged with runs started or streamed here.
import type { Event, InputPart, RunWithEvents } from "@/api/types";
import { applyEvent, emptyRun, type RunView, runFromRecord } from "@/chat/reducer";

export interface ChatState {
  runs: RunView[];
}

export type ChatAction =
  | { type: "loaded"; runs: RunWithEvents[] }
  | { type: "started"; runId: string; input: InputPart[] }
  | { type: "event"; runId: string; event: Event };

export const initialChat: ChatState = { runs: [] };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "loaded": {
      // History may be older than what the live stream already delivered: keep the view
      // that has seen more events. Runs started here but not yet loaded stay at the end.
      const local = new Map(state.runs.map((run) => [run.id, run]));
      const runs = action.runs.map((record) => {
        const loaded = runFromRecord(record);
        const current = local.get(record.id);
        local.delete(record.id);
        return current && current.lastSeq > loaded.lastSeq ? current : loaded;
      });
      return { runs: [...runs, ...local.values()] };
    }
    case "started":
      if (state.runs.some((run) => run.id === action.runId)) return state;
      return { runs: [...state.runs, emptyRun(action.runId, action.input)] };
    case "event": {
      const exists = state.runs.some((run) => run.id === action.runId);
      const runs = exists ? state.runs : [...state.runs, emptyRun(action.runId)];
      return {
        runs: runs.map((run) => (run.id === action.runId ? applyEvent(run, action.event) : run)),
      };
    }
  }
}

/** The run still in progress, if any: a session has at most one. */
export function activeRun(state: ChatState): RunView | undefined {
  return state.runs.find((run) => run.status === "running");
}
