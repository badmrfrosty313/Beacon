-- Version 3: read-only Scripture reference data (translation-ready and canon-ready).
-- Existing notes, documents and their indexes are not touched.
--
-- The verse text itself is NOT in this file: it is installed from the packaged, checksummed
-- data embedded in the application (see src/scripture/data.rs) inside one transaction on first
-- run, so a half-installed translation can never exist. These tables are reference data, never
-- user data: triggers below make them immutable once installed, so editing a note can never
-- change Scripture, and a bug cannot silently rewrite it.
--
-- Extending later: a new translation is a new row in scripture_translations plus its chapters
-- and verses (its canon may be an existing or a new row in scripture_canons). No existing row
-- changes.
CREATE TABLE scripture_canons (
    id   TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 40),
    name TEXT NOT NULL
);

CREATE TABLE scripture_books (
    canon_id      TEXT NOT NULL REFERENCES scripture_canons(id),
    id            TEXT NOT NULL CHECK (length(id) = 3),
    sort_order    INTEGER NOT NULL CHECK (sort_order >= 1),
    testament     TEXT NOT NULL CHECK (testament IN ('OT', 'NT')),
    name          TEXT NOT NULL,
    citation_name TEXT NOT NULL,
    chapter_count INTEGER NOT NULL CHECK (chapter_count >= 1),
    PRIMARY KEY (canon_id, id),
    UNIQUE (canon_id, sort_order)
) WITHOUT ROWID;

CREATE TABLE scripture_translations (
    id             TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 40),
    abbreviation   TEXT NOT NULL,
    name           TEXT NOT NULL,
    edition        TEXT NOT NULL,
    language       TEXT NOT NULL,
    canon_id       TEXT NOT NULL REFERENCES scripture_canons(id),
    license_status TEXT NOT NULL,
    license_notice TEXT NOT NULL,
    source_url     TEXT NOT NULL,
    source_sha256  TEXT NOT NULL CHECK (length(source_sha256) = 64),
    retrieved_on   TEXT NOT NULL,
    data_sha256    TEXT NOT NULL CHECK (length(data_sha256) = 64),
    verse_count    INTEGER NOT NULL CHECK (verse_count >= 1)
);

-- Rows are inserted BEFORE the translation row (which is written last), hence the deferred
-- foreign keys; they are still enforced when the installing transaction commits.
CREATE TABLE scripture_chapters (
    translation_id TEXT NOT NULL REFERENCES scripture_translations(id) DEFERRABLE INITIALLY DEFERRED,
    book_id        TEXT NOT NULL,
    chapter        INTEGER NOT NULL CHECK (chapter >= 1),
    verse_count    INTEGER NOT NULL CHECK (verse_count >= 1),
    superscription TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (translation_id, book_id, chapter)
) WITHOUT ROWID;

-- An empty text is allowed ONLY because a few verses exist in the source as a number plus a
-- footnote (see DECISIONS.md ADR-014); the reader labels them explicitly.
CREATE TABLE scripture_verses (
    translation_id TEXT NOT NULL REFERENCES scripture_translations(id) DEFERRABLE INITIALLY DEFERRED,
    book_id        TEXT NOT NULL,
    chapter        INTEGER NOT NULL CHECK (chapter >= 1),
    verse          INTEGER NOT NULL CHECK (verse >= 1),
    text           TEXT NOT NULL,
    PRIMARY KEY (translation_id, book_id, chapter, verse)
) WITHOUT ROWID;

-- Read-only: no updates or deletes, and no inserts into a translation/canon once it is complete.
CREATE TRIGGER scripture_verses_no_update BEFORE UPDATE ON scripture_verses BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;
CREATE TRIGGER scripture_verses_no_delete BEFORE DELETE ON scripture_verses BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;
CREATE TRIGGER scripture_verses_sealed BEFORE INSERT ON scripture_verses
WHEN EXISTS (SELECT 1 FROM scripture_translations WHERE id = new.translation_id) BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;

CREATE TRIGGER scripture_chapters_no_update BEFORE UPDATE ON scripture_chapters BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;
CREATE TRIGGER scripture_chapters_no_delete BEFORE DELETE ON scripture_chapters BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;
CREATE TRIGGER scripture_chapters_sealed BEFORE INSERT ON scripture_chapters
WHEN EXISTS (SELECT 1 FROM scripture_translations WHERE id = new.translation_id) BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;

CREATE TRIGGER scripture_translations_no_update BEFORE UPDATE ON scripture_translations BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;
CREATE TRIGGER scripture_translations_no_delete BEFORE DELETE ON scripture_translations BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;

CREATE TRIGGER scripture_books_no_update BEFORE UPDATE ON scripture_books BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;
CREATE TRIGGER scripture_books_no_delete BEFORE DELETE ON scripture_books BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;
CREATE TRIGGER scripture_books_sealed BEFORE INSERT ON scripture_books
WHEN EXISTS (SELECT 1 FROM scripture_translations WHERE canon_id = new.canon_id) BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;

CREATE TRIGGER scripture_canons_no_update BEFORE UPDATE ON scripture_canons BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;
CREATE TRIGGER scripture_canons_no_delete BEFORE DELETE ON scripture_canons BEGIN
    SELECT RAISE(ABORT, 'Scripture reference data is read-only');
END;
