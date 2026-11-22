import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

// Streams and history recorded from the real backend (backend/tests/test_fixtures.py, `make fixtures`).
export { default as chatSse } from "../../../backend/tests/fixtures/chat.sse?raw";
export { default as artifactSse } from "../../../backend/tests/fixtures/chat_artifact.sse?raw";
export { default as codeSse } from "../../../backend/tests/fixtures/chat_code.sse?raw";
export { default as stoppedSse } from "../../../backend/tests/fixtures/chat_stopped.sse?raw";
export { default as thinkingSse } from "../../../backend/tests/fixtures/chat_thinking.sse?raw";
export { default as messagesJson } from "../../../backend/tests/fixtures/messages.json?raw";

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

/**
 * Stub `fetch` with routes keyed `"METHOD /path"`. Unknown routes answer 404 so a missing stub
 * shows up as an error in the UI, not a hang. Every call is recorded.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://test");
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // keep the raw string
      }
    }
    const call = { method, path: url.pathname, body };
    calls.push(call);
    const handler = routes[`${method} ${url.pathname}`];
    return handler ? handler(call) : json({ detail: `no stub for ${method} ${url.pathname}` }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    called: (method: string, path: string) =>
      calls.filter((c) => c.method === method && c.path === path),
  };
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const SSE_HEADERS = { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" };

export const sse = (text: string) => new Response(text, { headers: SSE_HEADERS });

/** An SSE response that sends `head`, then waits for `release()` before sending `tail` and closing. */
export function heldSse(head: string, tail: string) {
  const encoder = new TextEncoder();
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(head));
      await released;
      controller.enqueue(encoder.encode(tail));
      controller.close();
    },
  });
  return { response: () => new Response(body, { headers: SSE_HEADERS }), release };
}

/** Split a recorded stream before the first chunk of `type`. */
export function splitBefore(text: string, type: string): [string, string] {
  const index = text.indexOf(`data: {"type":"${type}"`);
  if (index < 0) throw new Error(`no ${type} chunk`);
  return [text.slice(0, index), text.slice(index)];
}

export function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

export const catalogue = {
  default_model: "claude-sonnet",
  models: [
    {
      id: "claude-sonnet",
      label: "Claude Sonnet",
      thinking_levels: ["off", "low", "medium", "high"],
      context_window: 200000,
    },
    { id: "gpt-mini", label: "GPT mini", thinking_levels: ["off"], context_window: 400000 },
  ],
};

export function conversation(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: "A chat",
    updated_at: "2026-11-22T10:00:00Z",
    settings: { model_id: "claude-sonnet", thinking: "off", mcp_servers: [], skills: [] },
    interrupted: null,
    running: false,
    ...overrides,
  };
}

export function mcpServer(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    type: "stdio",
    status: "connected",
    description: null,
    tools: [{ name: "games", description: "Recent games" }],
    error: null,
    ...overrides,
  };
}
