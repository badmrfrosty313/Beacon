import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage, toApiError } from '../../api/errors';
import type { DocumentSummary, SearchHit } from '../../api/types';
import { formatBytes, formatTimestamp } from '../../lib/format';
import { readImportFile } from '../../lib/readImportFile';
import { MAX_SEARCH_RESULTS, splitSnippet } from '../../lib/searchQuery';
import { DocumentReader } from './DocumentReader';

const MAX_FILES_PER_IMPORT = 20;

interface ImportResult {
  name: string;
  kind: 'imported' | 'duplicate' | 'error';
  message: string;
}

interface ActiveSearch {
  query: string;
  hits: SearchHit[];
}

/** Match highlights are rendered as <mark> text nodes, never as HTML. */
function Snippet({ text }: { text: string }) {
  return (
    <span className="doc-snippet">
      {splitSnippet(text).map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </span>
  );
}

export function DocumentsPanel() {
  const api = useApi();
  const isBrowserDemo = import.meta.env.MODE === 'browser-demo';
  const inputRef = useRef<HTMLInputElement>(null);
  const searchSequence = useRef(0);

  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  const [queryText, setQueryText] = useState('');
  const [search, setSearch] = useState<ActiveSearch | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.listDocuments().then(
      (list) => {
        if (!cancelled) setDocuments(list);
      },
      (error: unknown) => {
        if (!cancelled) setListError(errorMessage(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, reloadToken]);

  function reload() {
    setListError(null);
    setReloadToken((token) => token + 1);
  }

  async function importFiles(files: File[]) {
    setImporting(true);
    const results: ImportResult[] = [];
    let lastImportedId: number | null = null;
    for (const file of files.slice(0, MAX_FILES_PER_IMPORT)) {
      try {
        const input = await readImportFile(file);
        const document = await api.importDocument(input);
        lastImportedId = document.id;
        results.push({
          name: file.name,
          kind: 'imported',
          message: `Imported “${document.title}”.`,
        });
      } catch (error) {
        const apiError = toApiError(error);
        results.push({
          name: file.name,
          kind: apiError.code === 'duplicate' ? 'duplicate' : 'error',
          message: apiError.message,
        });
      }
    }
    if (files.length > MAX_FILES_PER_IMPORT) {
      results.push({
        name: `${files.length - MAX_FILES_PER_IMPORT} more files`,
        kind: 'error',
        message: `Only ${MAX_FILES_PER_IMPORT} files can be imported at a time. Import the rest in another batch.`,
      });
    }
    setImportResults(results);
    setImporting(false);
    reload();
    if (lastImportedId !== null) setSelectedId(lastImportedId);
  }

  function clearSearch() {
    searchSequence.current += 1;
    setSearch(null);
    setSearchError(null);
    setSearching(false);
    setQueryText('');
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    const text = queryText.trim();
    if (!text) {
      clearSearch();
      return;
    }
    const sequence = ++searchSequence.current;
    setSearching(true);
    setSearchError(null);
    try {
      const hits = await api.searchDocuments(text);
      if (sequence === searchSequence.current) setSearch({ query: text, hits });
    } catch (error) {
      if (sequence === searchSequence.current) {
        setSearch(null);
        setSearchError(errorMessage(error));
      }
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  }

  return (
    <div className="archive-layout">
      <div className="note-list-panel">
        <div className="panel-header">
          <h2 className="panel-title">
            Documents
            {documents ? <span className="count">{documents.length}</span> : null}
          </h2>
          <button
            type="button"
            className="button button-primary"
            onClick={() => inputRef.current?.click()}
            disabled={importing}
          >
            {importing ? 'Importing…' : 'Import documents'}
          </button>
          <input
            ref={inputRef}
            type="file"
            className="visually-hidden"
            aria-label="Choose documents to import"
            accept=".md,.txt,text/markdown,text/plain"
            multiple
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length > 0) void importFiles(files);
            }}
          />
        </div>

        <p className="muted doc-hint">
          Markdown (.md) or text (.txt), UTF-8, up to 1 MiB each. Files are copied into BEACON on
          this device and never uploaded.
        </p>

        {importResults.length > 0 ? (
          <div className="import-results" role="status" aria-live="polite">
            <ul aria-label="Import results">
              {importResults.map((result, index) => (
                <li key={`${result.name}-${index}`} className={`import-${result.kind}`}>
                  <strong>{result.name}</strong>
                  <span>{result.message}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="button" onClick={() => setImportResults([])}>
              Dismiss
            </button>
          </div>
        ) : null}

        <form
          className="doc-search"
          role="search"
          aria-label="Document search"
          onSubmit={runSearch}
        >
          <label htmlFor="doc-search-input" className="field-label">
            Search documents
          </label>
          <div className="doc-search-row">
            <input
              id="doc-search-input"
              type="search"
              className="input"
              value={queryText}
              maxLength={200}
              placeholder={'Words, or "an exact phrase"'}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setQueryText(event.target.value)}
            />
            <button type="submit" className="button" disabled={searching}>
              Search
            </button>
            {search !== null || searchError !== null || queryText !== '' ? (
              <button type="button" className="button" onClick={clearSearch}>
                Clear
              </button>
            ) : null}
          </div>
          <p className="muted doc-hint" data-testid="search-engine-note">
            {isBrowserDemo
              ? 'Browser demo search: a simple word scan in this browser. It is not SQLite FTS5, so results can differ from the desktop app.'
              : 'Searches run on this device using SQLite full-text search (FTS5). Nothing is sent anywhere.'}
          </p>
        </form>

        {searchError ? (
          <div className="banner banner-error" role="alert">
            <p>{searchError}</p>
          </div>
        ) : null}

        {search !== null ? (
          <div>
            <p className="muted pad" role="status">
              {search.hits.length === 0
                ? `No documents match “${search.query}”.`
                : `${search.hits.length} ${search.hits.length === 1 ? 'match' : 'matches'} for “${search.query}”${
                    search.hits.length >= MAX_SEARCH_RESULTS
                      ? ` (showing the best ${MAX_SEARCH_RESULTS})`
                      : ''
                  }`}
            </p>
            {search.hits.length > 0 ? (
              <ul className="note-list" aria-label="Search results">
                {search.hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className={hit.id === selectedId ? 'note-item note-item-active' : 'note-item'}
                      aria-current={hit.id === selectedId ? 'true' : undefined}
                      onClick={() => setSelectedId(hit.id)}
                    >
                      <span className="note-item-title">{hit.title}</span>
                      <Snippet text={hit.snippet} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <>
            {listError ? (
              <div className="banner banner-error" role="alert">
                <p>{listError}</p>
                <button type="button" className="button" onClick={reload}>
                  Retry
                </button>
              </div>
            ) : null}
            {!listError && documents === null ? (
              <p className="muted pad" role="status">
                Loading documents…
              </p>
            ) : null}
            {documents !== null && documents.length === 0 && !listError ? (
              <p className="muted pad">No documents yet.</p>
            ) : null}
            {documents !== null && documents.length > 0 ? (
              <ul className="note-list" aria-label="Documents">
                {documents.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      className={doc.id === selectedId ? 'note-item note-item-active' : 'note-item'}
                      aria-current={doc.id === selectedId ? 'true' : undefined}
                      onClick={() => setSelectedId(doc.id)}
                    >
                      <span className="note-item-title">{doc.title}</span>
                      <span className="note-item-date">
                        {doc.format.toUpperCase()} · {formatBytes(doc.byteLength)} ·{' '}
                        {formatTimestamp(doc.importedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <div className="archive-pane">
        {selectedId !== null ? (
          <DocumentReader key={selectedId} id={selectedId} />
        ) : (
          <div className="empty-state">
            <h2>{documents && documents.length > 0 ? 'Select a document' : 'Start a library'}</h2>
            <p className="muted">
              {documents && documents.length > 0
                ? 'Choose a document from the list or from your search results.'
                : 'Import a Markdown or text file. It is kept on this device, can be searched offline, and is still here after you close and reopen BEACON.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
