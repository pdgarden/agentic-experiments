// The backend's recorded event sequences (backend/tests/fixtures/events, `make fixtures`).
// They omit run_id / session_id; these helpers put them back.
import type { Event } from "@/api/types";

type Recorded = Array<Record<string, unknown>>;

const files = import.meta.glob<Recorded>("../../../backend/tests/fixtures/events/*.json", {
  eager: true,
  import: "default",
});

export const fixtures: Record<string, Event[]> = Object.fromEntries(
  Object.entries(files).map(([path, events]) => [
    path
      .split("/")
      .pop()
      ?.replace(/\.json$/, "") ?? path,
    events.map((event) => ({ run_id: "run-1", session_id: "session-1", ...event }) as Event),
  ]),
);

export function fixture(name: string): Event[] {
  const events = fixtures[name];
  if (!events) throw new Error(`No fixture ${name}; known: ${Object.keys(fixtures).join(", ")}`);
  return events;
}

let seq = 0;

/** Hand-written events for cases no fixture covers; seq increments per call to `resetSeq`. */
export function ev<T extends Event["type"]>(
  type: T,
  body: Omit<Extract<Event, { type: T }>, "v" | "run_id" | "seq" | "type">,
): Event {
  seq += 1;
  return { v: 1, run_id: "run-1", seq, type, ...body } as unknown as Event;
}

export function resetSeq() {
  seq = 0;
}
