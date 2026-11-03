-- Version 2: imported text originals, metadata, and SQLite FTS5.
-- Existing notes and schema version 1 are preserved.
-- SHA-256 is unique to avoid silent duplicate imports. Originals are stored
-- separately in the app-data "originals" folder, under hash-derived names.
CREATE TABLE documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    original_name TEXT NOT NULL,
    format        TEXT NOT NULL CHECK (format IN ('md', 'txt')),
    sha256        TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
    byte_length   INTEGER NOT NULL CHECK (byte_length BETWEEN 0 AND 1048576),
    content       TEXT NOT NULL,
    imported_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_documents_imported_at ON documents(imported_at DESC, id DESC);

CREATE VIRTUAL TABLE documents_fts USING fts5(
    title, content, content='documents', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER documents_insert AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER documents_delete AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
END;
