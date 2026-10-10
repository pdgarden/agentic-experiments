"""What a run's tools can see: the SDK hands it to them as ``ctx.context``."""

from dataclasses import dataclass

from src.store.repo import Store


@dataclass(frozen=True)
class RunContext:
    session_id: str
    run_id: str
    store: Store
