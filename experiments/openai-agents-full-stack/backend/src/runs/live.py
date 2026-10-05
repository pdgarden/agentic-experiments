"""In-process state of the runs executing now, and live fan-out of their events.

Everything here lives in one process (a non-goal to scale out). Events are
persisted before they are published, so a subscriber that reads the database
after subscribing misses nothing; it only has to drop duplicates by ``seq``.
"""

import asyncio
from dataclasses import dataclass, field

from agents import RunResultStreaming

from src.events import Event

# ``None`` tells subscribers the run is over.
type Subscription = asyncio.Queue[Event | None]


@dataclass
class LiveRun:
    run_id: str
    session_id: str
    task: asyncio.Task[None] | None = None
    result: RunResultStreaming | None = None
    cancel_requested: bool = False
    _subscribers: set[Subscription] = field(default_factory=set[Subscription])

    def subscribe(self) -> Subscription:
        queue: Subscription = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: Subscription) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: Event) -> None:
        for queue in self._subscribers:
            queue.put_nowait(event)

    def close(self) -> None:
        for queue in self._subscribers:
            queue.put_nowait(None)
        self._subscribers.clear()

    def cancel(self) -> None:
        """Ask the run to stop; the run task records the outcome."""
        self.cancel_requested = True
        if self.result is not None:
            self.result.cancel()


class LiveRuns:
    def __init__(self) -> None:
        self._runs: dict[str, LiveRun] = {}

    def add(self, run: LiveRun) -> None:
        self._runs[run.run_id] = run

    def remove(self, run_id: str) -> None:
        self._runs.pop(run_id, None)

    def get(self, run_id: str) -> LiveRun | None:
        return self._runs.get(run_id)

    def for_session(self, session_id: str) -> list[LiveRun]:
        return [run for run in self._runs.values() if run.session_id == session_id]

    def all(self) -> list[LiveRun]:
        return list(self._runs.values())
