-- Version 5: private research collections and imported research documents (Sprint 005).
-- Existing notes, documents, Scripture and Watchtower tables are not modified.
--
-- Conventions
--  * Everything here is private local user data. `visibility` is a column whose only legal
--    value is 'private', so privacy is enforced by the database, not only by labels in the UI.
--    There is no publish, sync or upload path anywhere in this schema.
--  * The original file is the source of truth and lives in <app data>/research_originals/,
--    named by its SHA-256. `content` is DERIVATIVE text extracted from it for reading and
--    search; it is never presented as equivalent to the original.
--  * Rights notes (what the rights holder permits) are kept apart from the private-use
--    attribution note and are never read as permission to redistribute.
--  * Links to Watchtower are separate tables, distinct from a source's public URL, and every
--    foreign key is RESTRICT so no link can be orphaned. The app has no delete in v0.1.

CREATE TABLE research_collections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    description TEXT CHECK (description IS NULL OR length(description) BETWEEN 1 AND 1000),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Names are unique ignoring ASCII case.
CREATE UNIQUE INDEX idx_research_collections_name ON research_collections(lower(name));

CREATE TABLE research_documents (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id     INTEGER NOT NULL REFERENCES research_collections(id) ON DELETE RESTRICT,
    title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    -- Display only. Never used to build a path.
    original_name     TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
    format            TEXT NOT NULL CHECK (format IN ('pdf', 'md', 'txt')),
    sha256            TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
    byte_length       INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 20971520),
    content           TEXT NOT NULL CHECK (length(content) > 0),
    extraction_method TEXT NOT NULL CHECK (length(extraction_method) BETWEEN 1 AND 100),
    page_count        INTEGER CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 100000),
    text_truncated    INTEGER NOT NULL DEFAULT 0 CHECK (text_truncated IN (0, 1)),
    author            TEXT CHECK (author IS NULL OR length(author) BETWEEN 1 AND 200),
    publisher         TEXT CHECK (publisher IS NULL OR length(publisher) BETWEEN 1 AND 200),
    published_date    TEXT CHECK (published_date IS NULL OR length(published_date) BETWEEN 4 AND 10),
    attribution_note  TEXT CHECK (attribution_note IS NULL OR length(attribution_note) BETWEEN 1 AND 1000),
    rights_note       TEXT CHECK (rights_note IS NULL OR length(rights_note) BETWEEN 1 AND 1000),
    visibility        TEXT NOT NULL DEFAULT 'private' CHECK (visibility = 'private'),
    imported_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_research_documents_collection ON research_documents(collection_id, imported_at DESC, id DESC);

CREATE VIRTUAL TABLE research_documents_fts USING fts5(
    title, content, content='research_documents', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER research_documents_insert AFTER INSERT ON research_documents BEGIN
    INSERT INTO research_documents_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER research_documents_delete AFTER DELETE ON research_documents BEGIN
    INSERT INTO research_documents_fts(research_documents_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
END;

-- The title is the only indexed column a person may edit.
CREATE TRIGGER research_documents_title_update AFTER UPDATE OF title ON research_documents BEGIN
    INSERT INTO research_documents_fts(research_documents_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
    INSERT INTO research_documents_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;

-- A Watchtower source that was created from an imported document.
CREATE TABLE research_source_links (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    research_document_id INTEGER NOT NULL REFERENCES research_documents(id) ON DELETE RESTRICT,
    source_id            INTEGER NOT NULL REFERENCES watchtower_sources(id) ON DELETE RESTRICT,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (research_document_id, source_id)
);

CREATE INDEX idx_research_source_links_source ON research_source_links(source_id);

-- A Watchtower claim whose text the user chose as an excerpt of an imported document.
-- This records where the words came from; it does not verify them, and the claim keeps the
-- classification the user gave it.
CREATE TABLE research_excerpts (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    research_document_id INTEGER NOT NULL REFERENCES research_documents(id) ON DELETE RESTRICT,
    claim_id             INTEGER NOT NULL UNIQUE REFERENCES watchtower_claims(id) ON DELETE RESTRICT,
    location             TEXT CHECK (location IS NULL OR length(location) BETWEEN 1 AND 100),
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_research_excerpts_document ON research_excerpts(research_document_id);
