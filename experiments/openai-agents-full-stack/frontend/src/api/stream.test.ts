import { describe, expect, it, vi } from "vitest";
import { type EventSourceFactory, runEventsUrl, subscribeRun } from "@/api/stream";
import type { Event } from "@/api/types";
import { fixture } from "@/test/fixtures";

class FakeSource {
  static last: FakeSource | undefined;
  readyState = 1;
  closed = false;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: ((event: globalThis.Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeSource.last = this;
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(data: unknown) {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent("message", { data: text }));
  }
  fail(readyState: number) {
    this.readyState = readyState;
    this.onerror?.(new globalThis.Event("error"));
  }
}

const factory: EventSourceFactory = (url) => new FakeSource(url);

function open(after = 0) {
  const events: Event[] = [];
  const onError = vi.fn();
  const close = subscribeRun("r 1", after, { onEvent: (e) => events.push(e), onError }, factory);
  const source = FakeSource.last as FakeSource;
  return { events, onError, close, source };
}

describe("subscribeRun", () => {
  it("asks for events after the given seq", () => {
    expect(open(4).source.url).toBe("/api/runs/r%201/events?after=4");
    expect(runEventsUrl("x", 0)).toBe("/api/runs/x/events?after=0");
  });

  it("delivers each event once, in order, and closes after run_finished", () => {
    const { events, source } = open();
    const recorded = fixture("tool_roundtrip");
    for (const event of recorded.slice(0, 3)) source.emit(event);
    // A reconnect replays from Last-Event-ID; overlap is dropped.
    for (const event of recorded.slice(1)) source.emit(event);
    expect(events.map((e) => e.seq)).toEqual(recorded.map((e) => e.seq));
    expect(source.closed).toBe(true);
  });

  it("skips events at or below `after` and malformed messages", () => {
    const { events, source } = open(2);
    source.emit("not json");
    source.emit({ hello: "world" });
    for (const event of fixture("tool_roundtrip")) source.emit(event);
    expect(events[0]?.seq).toBe(3);
  });

  it("lets the browser retry a dropped connection", () => {
    const { onError, source } = open();
    source.fail(0); // CONNECTING: EventSource is reconnecting
    expect(onError).not.toHaveBeenCalled();
    expect(source.closed).toBe(false);
  });

  it("reports a stream that failed for good", () => {
    const { onError, source } = open();
    source.fail(2);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("stops delivering once unsubscribed", () => {
    const { events, close, source } = open();
    close();
    source.emit(fixture("tool_roundtrip")[0]);
    expect(events).toEqual([]);
    expect(source.closed).toBe(true);
  });
});
