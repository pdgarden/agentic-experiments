import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import type { EventSourceFactory } from "@/api/stream";
import type { Event, RunWithEvents, SessionDetail } from "@/api/types";
import { useChat } from "@/chat/useChat";
import { fixture } from "@/test/fixtures";

vi.mock("@/api/client", () => ({
  api: { getSession: vi.fn(), startRun: vi.fn(), cancelRun: vi.fn() },
}));

const mocked = vi.mocked(api);

/** Records the URLs opened; `push` delivers an event to the latest source. */
function fakeSources() {
  const opened: Array<{ url: string; closed: boolean; push: (event: Event) => void }> = [];
  const factory: EventSourceFactory = (url) => {
    const source = {
      readyState: 1,
      onmessage: null as ((message: MessageEvent<string>) => void) | null,
      onerror: null,
      close: () => {
        entry.closed = true;
      },
    };
    const entry = {
      url,
      closed: false,
      push: (event: Event) =>
        source.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) })),
    };
    opened.push(entry);
    return source as unknown as ReturnType<EventSourceFactory>;
  };
  return { opened, factory };
}

function detail(runs: RunWithEvents[]): SessionDetail {
  return {
    session: {
      id: "session-1",
      title: "t",
      current_agent: "assistant",
      created_at: "",
      updated_at: "",
    },
    runs,
  };
}

function record(id: string, status: RunWithEvents["status"], events: Event[]): RunWithEvents {
  return {
    id,
    session_id: "session-1",
    input: [{ type: "text", text: "What is 6 times 7?" }],
    status,
    started_at: "",
    ended_at: null,
    usage: null,
    error: null,
    events,
  };
}

function setup(factory: EventSourceFactory) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useChat("session-1", factory), { wrapper });
}

describe("useChat", () => {
  const events = fixture("tool_roundtrip");

  beforeEach(() => vi.resetAllMocks());

  it("shows finished history without opening a stream", async () => {
    mocked.getSession.mockResolvedValue(detail([record("r1", "succeeded", events)]));
    const { opened, factory } = fakeSources();
    const { result } = setup(factory);

    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    expect(result.current.running).toBe(false);
    expect(opened).toEqual([]);
  });

  it("resumes a running run after its last stored event", async () => {
    mocked.getSession.mockResolvedValue(detail([record("r1", "running", events.slice(0, 3))]));
    const { opened, factory } = fakeSources();
    const { result } = setup(factory);

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]?.url).toBe("/api/runs/r1/events?after=3");
    expect(result.current.running).toBe(true);

    act(() => {
      for (const event of events.slice(3)) opened[0]?.push(event);
    });
    expect(result.current.running).toBe(false);
    expect(result.current.runs[0]).toMatchObject({ status: "succeeded", lastSeq: 6 });
    expect(opened[0]?.closed).toBe(true);
  });

  it("streams a run it starts from the beginning", async () => {
    mocked.getSession.mockResolvedValue(detail([]));
    mocked.startRun.mockResolvedValue("r2");
    const { opened, factory } = fakeSources();
    const { result } = setup(factory);
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.send([{ type: "text", text: "hi" }]));
    expect(mocked.startRun).toHaveBeenCalledWith("session-1", [{ type: "text", text: "hi" }]);
    expect(result.current.runs[0]).toMatchObject({ id: "r2", input: [{ text: "hi" }] });
    expect(opened.map((source) => source.url)).toEqual(["/api/runs/r2/events?after=0"]);

    await act(() => result.current.cancel());
    expect(mocked.cancelRun).toHaveBeenCalledWith("r2");
  });

  it("closes the stream on unmount", async () => {
    mocked.getSession.mockResolvedValue(detail([record("r1", "running", [])]));
    const { opened, factory } = fakeSources();
    const { unmount } = setup(factory);
    await waitFor(() => expect(opened).toHaveLength(1));
    unmount();
    expect(opened[0]?.closed).toBe(true);
  });
});
