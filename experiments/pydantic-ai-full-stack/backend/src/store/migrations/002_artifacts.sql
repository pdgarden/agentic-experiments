-- Artifacts live outside the message history: messages only reference an artifact id and version.
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation_records (conversation_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('chart', 'text')),
    title TEXT NOT NULL,
    latest_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX artifacts_conversation ON artifacts (conversation_id, created_at);

CREATE TABLE artifact_versions (
    artifact_id TEXT NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    run_id TEXT,  -- the run whose tool call wrote it
    title TEXT NOT NULL,  -- the artifact's title as of this version
    content TEXT NOT NULL,  -- JSON, shaped by the kind
    created_at TEXT NOT NULL,
    PRIMARY KEY (artifact_id, version)
) WITHOUT ROWID;
