CREATE TABLE conversation_records (
    conversation_id TEXT PRIMARY KEY,
    revision TEXT NOT NULL,
    head_id TEXT,
    scope TEXT,
    title TEXT,
    metadata TEXT,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    record TEXT NOT NULL  -- the rest of the ConversationRecord (usage, deferred requests, branches, fork info) as JSON
);
CREATE INDEX conversation_records_updated ON conversation_records (updated_at DESC);

CREATE TABLE conversation_entries (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES conversation_entries (id),
    message TEXT NOT NULL
);
CREATE INDEX conversation_entries_parent ON conversation_entries (parent_id);

CREATE TABLE files (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX files_conversation ON files (conversation_id);
