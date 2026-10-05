// SSE reader for `GET /api/runs/{id}/events`: replay after a seq, then the live tail.
import type { Event } from "@/api/types";

export interface RunStreamHandlers {
  onEvent: (event: Event) => void;
  /** The stream failed for good (e.g. unknown run); transient drops reconnect on their own. */
  onError?: (error: Error) => void;
}

type EventSourceLike = Pick<EventSource, "close" | "readyState"> & {
  onmessage: ((message: MessageEvent<string>) => void) | null;
  onerror: ((event: globalThis.Event) => void) | null;
};

export type EventSourceFactory = (url: string) => EventSourceLike;

const browserEventSource: EventSourceFactory = (url) => new EventSource(url);

export function runEventsUrl(runId: string, after: number): string {
  return `/api/runs/${encodeURIComponent(runId)}/events?after=${after}`;
}

/**
 * Subscribe to a run's events with `seq > after`; returns the unsubscribe function.
 *
 * `EventSource` reconnects by itself with `Last-Event-ID`, so a dropped connection
 * resumes where it stopped. The server closes the stream after `run_finished`; we close
 * first, otherwise `EventSource` would reconnect forever. Events are delivered once each,
 * in `seq` order, even if a reconnect replays some.
 */
export function subscribeRun(
  runId: string,
  after: number,
  handlers: RunStreamHandlers,
  createSource: EventSourceFactory = browserEventSource,
): () => void {
  let lastSeq = after;
  let closed = false;
  const source = createSource(runEventsUrl(runId, after));

  const close = () => {
    closed = true;
    source.close();
  };

  source.onmessage = (message) => {
    if (closed) return;
    let event: Event;
    try {
      event = JSON.parse(message.data) as Event;
    } catch {
      return;
    }
    if (typeof event?.seq !== "number" || event.seq <= lastSeq) return;
    lastSeq = event.seq;
    handlers.onEvent(event);
    if (event.type === "run_finished") close();
  };

  source.onerror = () => {
    // CONNECTING means the browser is retrying; CLOSED means it gave up (non-SSE response).
    if (!closed && source.readyState === 2) {
      closed = true;
      handlers.onError?.(new Error(`The event stream of run ${runId} failed`));
    }
  };

  return close;
}
