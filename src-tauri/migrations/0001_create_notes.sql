-- Migration 0001: create the Sprint 001 demo notes table.
--
-- Rules for every migration file in this directory:
--   * Forward-only. Never edit a migration that has shipped; add a new one.
--   * Do NOT include BEGIN / COMMIT. The runner wraps each migration in a transaction
--     together with its schema_migrations bookkeeping row.
--   * Constraints here are defence in depth. The Rust layer (src/notes/validation.rs)
--     validates first and produces friendly errors; keep the limits in sync.

CREATE TABLE notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    body       TEXT    NOT NULL DEFAULT '' CHECK (length(CAST(body AS BLOB)) <= 100000),
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_notes_created_at ON notes (created_at DESC, id DESC);
