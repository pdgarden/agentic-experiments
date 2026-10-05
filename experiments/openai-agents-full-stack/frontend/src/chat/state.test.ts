import { beforeEach, describe, expect, it } from "vitest";
import type { RunWithEvents } from "@/api/types";
import { activeRun, chatReducer, initialChat } from "@/chat/state";
import { ev, fixture, resetSeq } from "@/test/fixtures";

const record = (id: string, events = fixture("tool_roundtrip")): RunWithEvents => ({
  id,
  session_id: "session-1",
  input: [{ type: "text", text: "What is 6 times 7?" }],
  status: "succeeded",
  started_at: "2026-10-05T00:00:00.000+00:00",
  ended_at: null,
  usage: null,
  error: null,
  events,
});

describe("chatReducer", () => {
  beforeEach(resetSeq);

  it("loads history in order", () => {
    const state = chatReducer(initialChat, { type: "loaded", runs: [record("a"), record("b")] });
    expect(state.runs.map((run) => run.id)).toEqual(["a", "b"]);
    expect(activeRun(state)).toBeUndefined();
  });

  it("shows a started run with its input before any event arrives", () => {
    const input = [{ type: "text" as const, text: "hello" }];
    const state = chatReducer(initialChat, { type: "started", runId: "r", input });
    expect(activeRun(state)).toMatchObject({ id: "r", input, parts: [] });
    expect(chatReducer(state, { type: "started", runId: "r", input })).toBe(state);
  });

  it("applies live events to their run", () => {
    let state = chatReducer(initialChat, { type: "started", runId: "r", input: [] });
    for (const event of fixture("tool_roundtrip")) {
      state = chatReducer(state, { type: "event", runId: "r", event });
    }
    expect(state.runs[0]).toMatchObject({ status: "succeeded", lastSeq: 6 });
  });

  it("keeps the live view when loaded history is older, and keeps unsaved local runs", () => {
    const events = fixture("tool_roundtrip");
    let state = chatReducer(initialChat, { type: "started", runId: "a", input: [] });
    for (const event of events.slice(0, 4)) {
      state = chatReducer(state, { type: "event", runId: "a", event });
    }
    state = chatReducer(state, { type: "started", runId: "b", input: [] });

    const stale = { ...record("a", events.slice(0, 2)), status: "running" as const };
    state = chatReducer(state, { type: "loaded", runs: [stale] });
    expect(state.runs.map((run) => [run.id, run.lastSeq])).toEqual([
      ["a", 4],
      ["b", 0],
    ]);

    state = chatReducer(state, { type: "loaded", runs: [record("a"), record("b", [])] });
    expect(state.runs.map((run) => [run.id, run.lastSeq])).toEqual([
      ["a", 6],
      ["b", 0],
    ]);
  });

  it("creates the run for an event it has not seen started", () => {
    const state = chatReducer(initialChat, {
      type: "event",
      runId: "x",
      event: ev("run_started", { session_id: "s", agent: "assistant" }),
    });
    expect(state.runs).toMatchObject([{ id: "x", agent: "assistant" }]);
  });
});
