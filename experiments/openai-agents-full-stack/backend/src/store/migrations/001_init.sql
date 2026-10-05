CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    current_agent TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    input TEXT NOT NULL,  -- JSON list of input parts
    status TEXT NOT NULL
        CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    usage TEXT,  -- JSON
    error TEXT
);

CREATE INDEX runs_by_session ON runs (session_id, started_at);

-- One active run per session, enforced by the database rather than a check-then-insert.
CREATE UNIQUE INDEX one_running_run_per_session ON runs (session_id) WHERE status = 'running';

CREATE TABLE events (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,  -- the full event as JSON
    created_at TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
) WITHOUT ROWID;
