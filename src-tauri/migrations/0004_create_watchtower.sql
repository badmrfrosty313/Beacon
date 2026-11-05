-- Version 4: Watchtower research records (events, sources, claims, hypotheses, evidence links).
-- Existing notes, documents and the read-only Scripture tables are not touched.
--
-- Conventions
--  * All records are private local user data. Nothing here is published or fetched.
--  * Optional text is NULL when absent. A missing date is never synthesized.
--  * Four different times are kept apart: when the event happened (event_date), when a source
--    was published (published_date), when the user retrieved it (retrieved_date), and when the
--    record was created or edited (created_at / updated_at, set by SQLite).
--  * event_sort is minutes since 1970-01-01T00:00Z at the START of the stated period; it is an
--    ordering key computed by the application, never shown as the event time.
--  * Foreign keys are RESTRICT: nothing can be left orphaned. The app has no delete in v0.1.
--  * Dates and field limits are validated by the application first; the CHECKs here are the
--    backstop that keeps the database consistent even if another writer is added later.

CREATE TABLE watchtower_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    description    TEXT CHECK (description IS NULL OR length(description) BETWEEN 1 AND 5000),
    event_date     TEXT,
    date_precision TEXT CHECK (date_precision IN ('year', 'month', 'day', 'minute')),
    event_sort     INTEGER,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
        (event_date IS NULL AND date_precision IS NULL AND event_sort IS NULL)
        OR (event_date IS NOT NULL AND date_precision IS NOT NULL AND event_sort IS NOT NULL)
    )
);

CREATE INDEX idx_watchtower_events_sort ON watchtower_events(event_sort, id);

CREATE TABLE watchtower_sources (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    author         TEXT CHECK (author IS NULL OR length(author) BETWEEN 1 AND 200),
    publisher      TEXT CHECK (publisher IS NULL OR length(publisher) BETWEEN 1 AND 200),
    -- Stored as data only. BEACON never fetches it; a URL alone is NOT an offline copy.
    url            TEXT CHECK (url IS NULL OR length(url) BETWEEN 1 AND 2048),
    published_date TEXT CHECK (published_date IS NULL OR length(published_date) IN (4, 7, 10)),
    retrieved_date TEXT CHECK (retrieved_date IS NULL OR length(retrieved_date) IN (4, 7, 10)),
    -- An Archive document the user has preserved locally. Distinct from the URL above.
    document_id    INTEGER REFERENCES documents(id) ON DELETE RESTRICT,
    note           TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 5000),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (author IS NOT NULL OR publisher IS NOT NULL OR url IS NOT NULL OR document_id IS NOT NULL)
);

CREATE INDEX idx_watchtower_sources_document ON watchtower_sources(document_id);

CREATE TABLE watchtower_claims (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id            INTEGER NOT NULL REFERENCES watchtower_events(id) ON DELETE RESTRICT,
    source_id           INTEGER REFERENCES watchtower_sources(id) ON DELETE RESTRICT,
    -- The epistemic class is mandatory and never inferred.
    kind                TEXT NOT NULL
                        CHECK (kind IN ('observation', 'attributed_claim', 'interpretation', 'forecast')),
    text                TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 5000),
    attribution         TEXT CHECK (attribution IS NULL OR length(attribution) BETWEEN 1 AND 200),
    scripture_reference TEXT CHECK (scripture_reference IS NULL OR length(scripture_reference) BETWEEN 1 AND 100),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (kind <> 'attributed_claim' OR attribution IS NOT NULL)
);

CREATE INDEX idx_watchtower_claims_event ON watchtower_claims(event_id, id);
CREATE INDEX idx_watchtower_claims_source ON watchtower_claims(source_id);

CREATE TABLE watchtower_hypotheses (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    -- A proposition under evaluation, not a verified fact.
    statement           TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 5000),
    -- Chosen by the user only. Nothing changes it automatically; there is no score.
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'under_review', 'set_aside')),
    scripture_reference TEXT CHECK (scripture_reference IS NULL OR length(scripture_reference) BETWEEN 1 AND 100),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE watchtower_links (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    hypothesis_id INTEGER NOT NULL REFERENCES watchtower_hypotheses(id) ON DELETE RESTRICT,
    relation      TEXT NOT NULL CHECK (relation IN ('supports', 'contradicts', 'context')),
    claim_id      INTEGER REFERENCES watchtower_claims(id) ON DELETE RESTRICT,
    source_id     INTEGER REFERENCES watchtower_sources(id) ON DELETE RESTRICT,
    -- Only for source-only evidence; a claim already belongs to exactly one event.
    event_id      INTEGER REFERENCES watchtower_events(id) ON DELETE RESTRICT,
    explanation   TEXT NOT NULL CHECK (length(explanation) BETWEEN 1 AND 2000),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (claim_id IS NOT NULL OR source_id IS NOT NULL),
    CHECK (claim_id IS NULL OR event_id IS NULL)
);

CREATE INDEX idx_watchtower_links_hypothesis ON watchtower_links(hypothesis_id, id);
CREATE INDEX idx_watchtower_links_claim ON watchtower_links(claim_id);
CREATE INDEX idx_watchtower_links_source ON watchtower_links(source_id);
CREATE INDEX idx_watchtower_links_event ON watchtower_links(event_id);

-- The same evidence cannot be linked to the same hypothesis with the same relation twice.
CREATE UNIQUE INDEX idx_watchtower_links_unique ON watchtower_links(
    hypothesis_id, relation, COALESCE(claim_id, 0), COALESCE(source_id, 0), COALESCE(event_id, 0)
);
