"""Delete a conversation's runs from the step store (`SqliteStepStore` has no delete API; its schema is below)."""

import sqlite3
from pathlib import Path


def delete_step_runs(steps_db: Path, conversation_id: str) -> None:
    if not steps_db.exists():
        return
    with sqlite3.connect(steps_db) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if "runs" not in tables:
            return
        run_ids = [r[0] for r in conn.execute("SELECT run_id FROM runs WHERE conversation_id = ?", (conversation_id,))]
        for run_id in run_ids:
            if "snapshot_message_refs" in tables:
                conn.execute(
                    "DELETE FROM snapshot_message_refs"
                    " WHERE snapshot_seq IN (SELECT seq FROM snapshots WHERE run_id = ?)",
                    (run_id,),
                )
            for table in ("snapshots", "snapshot_idempotency_keys", "events", "tool_effects", "runs"):
                if table in tables:
                    conn.execute(f"DELETE FROM {table} WHERE run_id = ?", (run_id,))  # noqa: S608
