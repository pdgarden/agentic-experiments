-- Artifacts are session objects the agent creates and revises through tools,
-- outside the message history: messages only reference a version.
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('chart')),
    title TEXT NOT NULL,
    latest_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX artifacts_by_session ON artifacts (session_id, created_at);

CREATE TABLE artifact_versions (
    artifact_id TEXT NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    run_id TEXT NOT NULL,  -- the run whose tool call wrote it
    title TEXT NOT NULL,  -- the artifact's title as of this version
    content TEXT NOT NULL,  -- JSON, shaped by the artifact's kind
    created_at TEXT NOT NULL,
    PRIMARY KEY (artifact_id, version)
) WITHOUT ROWID;
