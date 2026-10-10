import { beforeEach, describe, expect, it } from "vitest";
import type { Event, RunWithEvents } from "@/api/types";
import { applyEvent, emptyRun, foldEvents, runFromRecord } from "@/chat/reducer";
import { ev, fixture, fixtures, resetSeq } from "@/test/fixtures";

const fold = (events: Event[]) => foldEvents(emptyRun("run-1"), events);

describe("recorded fixtures", () => {
  it("are found", () => {
    expect(Object.keys(fixtures)).toContain("tool_roundtrip");
  });

  for (const [name, events] of Object.entries(fixtures)) {
    describe(name, () => {
      it("folds to a finished run that saw every event", () => {
        const run = fold(events);
        expect(run.status).not.toBe("running");
        expect(run.lastSeq).toBe(events.at(-1)?.seq);
      });

      it("ignores a replay of events already applied", () => {
        expect(fold([...events, ...events])).toEqual(fold(events));
      });

      it("resumes from any point: history then live tail", () => {
        const full = fold(events);
        for (let cut = 0; cut <= events.length; cut += 1) {
          const history = fold(events.slice(0, cut));
          // The stream replays from lastSeq, possibly overlapping what history holds.
          const tail = events.slice(Math.max(0, cut - 1));
          expect(foldEvents(history, tail)).toEqual(full);
        }
      });
    });
  }
});

describe("tool_roundtrip", () => {
  it("becomes the user message, one tool card, then text", () => {
    const run = fold(fixture("tool_roundtrip"));
    expect(run).toMatchObject({
      status: "succeeded",
      agent: "assistant",
      input: [{ type: "text", text: "What is 6 times 7?" }],
      errors: [],
      usage: { requests: 2, total_tokens: 30 },
    });
    expect(run.parts).toEqual([
      {
        type: "tool",
        call_id: "call_1",
        name: "run_python",
        args: '{"code":"6 * 7"}',
        status: "ok",
        result: "result:\n42",
      },
      { type: "text", text: "The answer is 42." },
    ]);
  });

  it("shows the tool as running until its result arrives", () => {
    const events = fixture("tool_roundtrip");
    const callIndex = events.findIndex((event) => event.type === "tool_call");
    const run = fold(events.slice(0, callIndex + 1));
    expect(run.status).toBe("running");
    expect(run.parts).toMatchObject([{ type: "tool", status: "running", result: null }]);
  });
});

describe("chart_roundtrip", () => {
  it("keeps one artifact part per version, after its tool card", () => {
    const run = fold(fixture("chart_roundtrip"));
    expect(run.status).toBe("succeeded");
    expect(run.parts.map((part) => part.type)).toEqual([
      "tool",
      "artifact",
      "tool",
      "artifact",
      "text",
    ]);
    const artifacts = run.parts.filter((part) => part.type === "artifact");
    expect(artifacts).toEqual([
      expect.objectContaining({ kind: "chart", title: "LeBron points", version: 1 }),
      expect.objectContaining({ kind: "chart", title: "LeBron points (line)", version: 2 }),
    ]);
    expect(new Set(artifacts.map((part) => part.artifact_id)).size).toBe(1);
  });
});

describe("applyEvent", () => {
  beforeEach(resetSeq);

  it("joins deltas of a segment and splits segments around a tool call", () => {
    const run = fold([
      ev("text_delta", { segment_id: "s1", delta: "Let me " }),
      ev("text_delta", { segment_id: "s1", delta: "check." }),
      ev("tool_call", { call_id: "c1", name: "run_python", args: "{}" }),
      ev("tool_result", { call_id: "c1", result: "ok", is_error: false }),
      ev("text_delta", { segment_id: "s2", delta: "Done" }),
      ev("text_delta", { segment_id: "s2", delta: "." }),
    ]);
    expect(run.parts.map((part) => (part.type === "text" ? part.text : part.type))).toEqual([
      "Let me check.",
      "tool",
      "Done.",
    ]);
  });

  it("marks a failed tool call as an error", () => {
    const run = fold([
      ev("tool_call", { call_id: "c1", name: "run_python", args: "{bad json" }),
      ev("tool_result", { call_id: "c1", result: "SyntaxError", is_error: true }),
    ]);
    expect(run.parts).toMatchObject([
      { status: "error", result: "SyntaxError", args: "{bad json" },
    ]);
  });

  it("matches results to calls by call_id", () => {
    const run = fold([
      ev("tool_call", { call_id: "a", name: "one", args: "{}" }),
      ev("tool_call", { call_id: "b", name: "two", args: "{}" }),
      ev("tool_result", { call_id: "b", result: "B", is_error: false }),
    ]);
    expect(run.parts).toMatchObject([
      { call_id: "a", status: "running" },
      { call_id: "b", status: "ok", result: "B" },
    ]);
  });

  it("ignores a result for an unknown call", () => {
    const run = fold([ev("tool_result", { call_id: "nope", result: "?", is_error: false })]);
    expect(run.parts).toEqual([]);
    expect(run.lastSeq).toBe(1);
  });

  it("records a handoff as an agent part", () => {
    const run = fold([
      ev("run_started", { session_id: "s", agent: "triage" }),
      ev("agent_changed", { agent: "coder" }),
    ]);
    expect(run.agent).toBe("coder");
    expect(run.parts).toEqual([{ type: "agent", agent: "coder" }]);
  });

  it("keeps errors and the final status", () => {
    const run = fold([
      ev("error", { code: "max_turns", message: "Max turns (10) exceeded" }),
      ev("run_finished", { status: "failed", usage: null }),
    ]);
    expect(run.status).toBe("failed");
    expect(run.errors).toEqual([{ code: "max_turns", message: "Max turns (10) exceeded" }]);
    expect(run.usage).toBeNull();
  });

  it("skips events of an unknown type or version but advances lastSeq", () => {
    const start = emptyRun("run-1");
    const unknownType = {
      v: 1,
      run_id: "run-1",
      seq: 1,
      type: "file_uploaded",
    } as unknown as Event;
    const newVersion = {
      ...ev("text_delta", { segment_id: "s1", delta: "x" }),
      v: 2,
      seq: 2,
    } as unknown as Event;
    const run = foldEvents(start, [unknownType, newVersion]);
    expect(run.parts).toEqual([]);
    expect(run.lastSeq).toBe(2);
  });

  it("does not change the run it is given", () => {
    const start = emptyRun("run-1");
    const snapshot = structuredClone(start);
    applyEvent(start, ev("text_delta", { segment_id: "s1", delta: "x" }));
    expect(start).toEqual(snapshot);
  });
});

describe("runFromRecord", () => {
  beforeEach(resetSeq);

  const record = (overrides: Partial<RunWithEvents>): RunWithEvents => ({
    id: "run-1",
    session_id: "session-1",
    input: [{ type: "text", text: "hi" }],
    status: "succeeded",
    started_at: "2026-10-05T00:00:00.000+00:00",
    ended_at: null,
    usage: null,
    error: null,
    events: [],
    ...overrides,
  });

  it("folds the stored events", () => {
    const run = runFromRecord(record({ events: fixture("tool_roundtrip") }));
    expect(run).toEqual(fold(fixture("tool_roundtrip")));
  });

  it("keeps a running run running, to resume its stream", () => {
    const run = runFromRecord(
      record({ status: "running", events: [ev("run_started", { session_id: "s", agent: "a" })] }),
    );
    expect(run).toMatchObject({ status: "running", lastSeq: 1, input: [{ text: "hi" }] });
  });

  it("falls back to the record when the event log stops early", () => {
    const run = runFromRecord(
      record({
        status: "failed",
        error: "boom",
        usage: { requests: 1, input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        events: [ev("run_started", { session_id: "s", agent: "a" })],
      }),
    );
    expect(run).toMatchObject({
      status: "failed",
      errors: [{ code: "internal", message: "boom" }],
      usage: { total_tokens: 2 },
    });
  });
});
