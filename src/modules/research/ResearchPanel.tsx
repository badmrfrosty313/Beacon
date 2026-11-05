import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage, toApiError } from '../../api/errors';
import type { ImportedHit, ImportedSummary, ResearchCollection } from '../../api/types';
import { formatBytes, formatTimestamp } from '../../lib/format';
import { readAsArrayBuffer } from '../../lib/readImportFile';
import { prepareFile } from '../../lib/research/prepare';
import { extractPdfText, type PdfExtractor } from '../../lib/research/pdfText';
import { MAX_ORIGINAL_BYTES } from '../../lib/research/validation';
import { MAX_SEARCH_RESULTS, splitSnippet } from '../../lib/searchQuery';
import { FormError, TextAreaField, TextField, blankToNull, useSubmit } from '../watchtower/fields';
import { ResearchReader } from './ResearchReader';
import { StagedPreview, type Staged } from './StagedImport';

const MAX_FILES_PER_BATCH = 20;

function Snippet({ text }: { text: string }) {
  return (
    <span className="doc-snippet">
      {splitSnippet(text).map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </span>
  );
}

/**
 * Private research library. Choosing files only STAGES them (validated, hashed, text extracted
 * locally). Nothing is stored until the person picks a collection, reviews the preview and
 * confirms the import. Nothing here is published, synced or uploaded.
 */
export function ResearchPanel({ extractPdf = extractPdfText }: { extractPdf?: PdfExtractor }) {
  const api = useApi();
  const isBrowserDemo = import.meta.env.MODE === 'browser-demo';
  const inputRef = useRef<HTMLInputElement>(null);
  const keyCounter = useRef(0);
  const searchSequence = useRef(0);

  const [collections, setCollections] = useState<ResearchCollection[] | null>(null);
  const [documents, setDocuments] = useState<ImportedSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [collectionId, setCollectionId] = useState<string>('');
  const [filterId, setFilterId] = useState<string>('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const collectionForm = useSubmit();

  const [staged, setStaged] = useState<Staged[]>([]);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  const [queryText, setQueryText] = useState('');
  const [search, setSearch] = useState<{ query: string; hits: ImportedHit[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const filter = filterId === '' ? undefined : Number(filterId);
    Promise.all([api.listResearchCollections(), api.listResearch(filter)]).then(
      ([loadedCollections, loadedDocuments]) => {
        if (cancelled) return;
        setCollections(loadedCollections);
        setDocuments(loadedDocuments);
        setLoadError(null);
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, reload, filterId]);

  const refresh = () => setReload((n) => n + 1);

  function patchStaged(key: number, patch: Partial<Staged>) {
    setStaged((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  async function createCollection(event: FormEvent) {
    event.preventDefault();
    await collectionForm.run(async () => {
      const created = await api.createResearchCollection({
        name: newName,
        description: blankToNull(newDescription),
      });
      setNewName('');
      setNewDescription('');
      setCollectionId(String(created.id));
      refresh();
    });
  }

  async function stageFiles(files: File[]) {
    setBatchError(null);
    const chosen = files.slice(0, MAX_FILES_PER_BATCH);
    if (files.length > MAX_FILES_PER_BATCH) {
      setBatchError(
        `Only ${MAX_FILES_PER_BATCH} files can be reviewed at a time. Import the rest in another batch.`,
      );
    }
    const items: Staged[] = chosen.map((file) => ({
      key: ++keyCounter.current,
      name: file.name,
      status: 'reading',
      include: true,
      title: '',
      author: '',
      publisher: '',
      publishedDate: '',
      attributionNote: '',
      rightsNote: '',
    }));
    setStaged((list) => [...list.filter((item) => item.status !== 'imported'), ...items]);
    setActiveKey(items[0]?.key ?? null);
    setSelectedId(null);
    for (const [index, file] of chosen.entries()) {
      const item = items[index];
      if (!item) continue;
      try {
        if (file.size > MAX_ORIGINAL_BYTES) {
          throw new Error('The file is too large. PDFs can be at most 20 MiB.');
        }
        const bytes = new Uint8Array(await readAsArrayBuffer(file));
        const prepared = await prepareFile(file.name, bytes, extractPdf);
        const duplicate = await api.checkResearchDuplicate(prepared.sha256);
        patchStaged(item.key, {
          status: 'ready',
          prepared,
          duplicate,
          title: prepared.defaultTitle,
          include: duplicate.research === null,
        });
      } catch (error) {
        patchStaged(item.key, {
          status: 'error',
          include: false,
          error: errorMessage(error),
        });
      }
    }
  }

  const importable = staged.filter(
    (item) => item.status === 'ready' && item.include && item.duplicate?.research == null,
  );

  async function importSelected() {
    if (collectionId === '') {
      setBatchError(
        'Choose a collection first. Each import goes into a private collection you pick.',
      );
      return;
    }
    setBatchError(null);
    setImporting(true);
    let lastId: number | null = null;
    for (const item of importable) {
      const prepared = item.prepared;
      if (!prepared) continue;
      try {
        const doc = await api.importResearch({
          name: prepared.name,
          bytes: prepared.bytes,
          collectionId: Number(collectionId),
          title: item.title,
          author: blankToNull(item.author),
          publisher: blankToNull(item.publisher),
          publishedDate: blankToNull(item.publishedDate),
          attributionNote: blankToNull(item.attributionNote),
          rightsNote: blankToNull(item.rightsNote),
          ...(prepared.format === 'pdf'
            ? {
                extractedText: prepared.text,
                extractionMethod: prepared.method,
                pageCount: prepared.pageCount ?? 1,
                textTruncated: prepared.truncated,
              }
            : {}),
        });
        lastId = doc.id;
        patchStaged(item.key, {
          status: 'imported',
          include: false,
          outcome: `Imported “${doc.title}”.`,
        });
      } catch (error) {
        const apiError = toApiError(error);
        patchStaged(item.key, {
          status: apiError.code === 'duplicate' ? 'ready' : 'error',
          include: false,
          error: apiError.message,
          outcome: apiError.message,
        });
      }
    }
    setImporting(false);
    refresh();
    if (lastId !== null) {
      setSelectedId(lastId);
      setActiveKey(null);
    }
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    const text = queryText.trim();
    if (text === '') {
      clearSearch();
      return;
    }
    const sequence = ++searchSequence.current;
    setSearchError(null);
    try {
      const hits = await api.searchResearch(text, filterId === '' ? undefined : Number(filterId));
      if (sequence === searchSequence.current) setSearch({ query: text, hits });
    } catch (error) {
      if (sequence === searchSequence.current) {
        setSearch(null);
        setSearchError(errorMessage(error));
      }
    }
  }

  function clearSearch() {
    searchSequence.current += 1;
    setSearch(null);
    setSearchError(null);
    setQueryText('');
  }

  const activeItem = staged.find((item) => item.key === activeKey) ?? null;
  const collectionName = (id: number) => collections?.find((c) => c.id === id)?.name ?? '';

  return (
    <div className="archive-layout">
      <div className="note-list-panel">
        <div className="panel-header">
          <h2 className="panel-title">
            Research library
            {documents ? <span className="count">{documents.length}</span> : null}
          </h2>
        </div>
        <p className="muted doc-hint">
          Private. Imported research stays on this device. There is no upload, sync or publishing.
        </p>

        <form className="form-section" onSubmit={createCollection} aria-label="New collection">
          <TextField
            label="New collection name"
            value={newName}
            maxLength={100}
            hint="For example: Convergence research, Biblical research, Astronomy, General research."
            onChange={setNewName}
          />
          <TextAreaField
            label="Collection description (optional)"
            value={newDescription}
            rows={2}
            onChange={setNewDescription}
          />
          <FormError message={collectionForm.error} />
          <button type="submit" className="button" disabled={collectionForm.busy}>
            Create collection
          </button>
        </form>

        <div className="field">
          <label htmlFor="research-collection">Import into collection</label>
          <select
            id="research-collection"
            value={collectionId}
            onChange={(event) => setCollectionId(event.target.value)}
          >
            <option value="">Choose a collection…</option>
            {collections?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="panel-header">
          <button
            type="button"
            className="button button-primary"
            disabled={importing}
            onClick={() => inputRef.current?.click()}
          >
            Choose files to review
          </button>
          <input
            ref={inputRef}
            type="file"
            className="visually-hidden"
            aria-label="Choose research files"
            accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
            multiple
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length > 0) void stageFiles(files);
            }}
          />
        </div>
        <p className="muted doc-hint">
          Text-layer PDF, Markdown (.md) or text (.txt). PDFs up to 20 MiB; Markdown and text up to
          1 MiB. No OCR: scanned PDFs cannot be read.
          {isBrowserDemo
            ? ' Browser demo: files are stored only in this browser’s IndexedDB, not in a file on disk.'
            : ''}
        </p>

        {batchError ? (
          <div className="banner banner-error" role="alert">
            <p>{batchError}</p>
          </div>
        ) : null}

        {staged.length > 0 ? (
          <div>
            <ul className="note-list" aria-label="Files to review">
              {staged.map((item) => (
                <li key={item.key}>
                  <div className="note-item">
                    <label>
                      <input
                        type="checkbox"
                        checked={item.include}
                        disabled={item.status !== 'ready' || item.duplicate?.research != null}
                        onChange={(event) =>
                          patchStaged(item.key, { include: event.target.checked })
                        }
                      />{' '}
                      Include <span className="visually-hidden">{item.name}</span>
                    </label>
                    <button
                      type="button"
                      className={
                        item.key === activeKey ? 'note-item note-item-active' : 'note-item'
                      }
                      onClick={() => {
                        setActiveKey(item.key);
                        setSelectedId(null);
                      }}
                    >
                      <span className="note-item-title">{item.name}</span>
                      <span className="note-item-date">
                        {item.status === 'reading' ? 'Reading…' : null}
                        {item.status === 'ready' && item.duplicate?.research
                          ? 'Already imported'
                          : null}
                        {item.status === 'ready' && !item.duplicate?.research
                          ? item.prepared
                            ? `${item.prepared.format.toUpperCase()} · ${formatBytes(item.prepared.byteLength)}`
                            : 'Ready'
                          : null}
                        {item.status === 'imported' ? (item.outcome ?? 'Imported') : null}
                        {item.status === 'error' ? (item.error ?? 'Could not be read') : null}
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="form-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={importing || importable.length === 0}
                onClick={() => void importSelected()}
              >
                {importing ? 'Importing…' : `Import selected files (${importable.length})`}
              </button>
              <button
                type="button"
                className="button"
                disabled={importing}
                onClick={() => {
                  setStaged([]);
                  setActiveKey(null);
                  setBatchError(null);
                }}
              >
                Discard review
              </button>
            </div>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="research-filter">Show collection</label>
          <select
            id="research-filter"
            value={filterId}
            onChange={(event) => {
              setFilterId(event.target.value);
              clearSearch();
            }}
          >
            <option value="">All collections</option>
            {collections?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.documentCount})
              </option>
            ))}
          </select>
        </div>

        <form
          className="doc-search"
          role="search"
          aria-label="Research search"
          onSubmit={runSearch}
        >
          <label htmlFor="research-search-input" className="field-label">
            Search imported research
          </label>
          <div className="doc-search-row">
            <input
              id="research-search-input"
              type="search"
              className="input"
              value={queryText}
              maxLength={200}
              placeholder={'Words, or "an exact phrase"'}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setQueryText(event.target.value)}
            />
            <button type="submit" className="button">
              Search
            </button>
            {search !== null || searchError !== null || queryText !== '' ? (
              <button type="button" className="button" onClick={clearSearch}>
                Clear
              </button>
            ) : null}
          </div>
          <p className="muted doc-hint" data-testid="research-search-note">
            {isBrowserDemo
              ? 'Browser demo search: a simple word scan in this browser, not SQLite FTS5.'
              : 'Searches run on this device using SQLite full-text search (FTS5).'}
          </p>
        </form>

        {searchError ? (
          <div className="banner banner-error" role="alert">
            <p>{searchError}</p>
          </div>
        ) : null}

        {loadError ? (
          <div className="banner banner-error" role="alert">
            <p>{loadError}</p>
            <button type="button" className="button" onClick={refresh}>
              Retry
            </button>
          </div>
        ) : null}

        {search !== null ? (
          <div>
            <p className="muted pad" role="status">
              {search.hits.length === 0
                ? `No imported research matches “${search.query}”.`
                : `${search.hits.length} ${search.hits.length === 1 ? 'match' : 'matches'} for “${search.query}”${
                    search.hits.length >= MAX_SEARCH_RESULTS
                      ? ` (showing the best ${MAX_SEARCH_RESULTS})`
                      : ''
                  }`}
            </p>
            <ul className="note-list" aria-label="Research search results">
              {search.hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className={hit.id === selectedId ? 'note-item note-item-active' : 'note-item'}
                    onClick={() => {
                      setSelectedId(hit.id);
                      setActiveKey(null);
                    }}
                  >
                    <span className="note-item-title">{hit.title}</span>
                    <Snippet text={hit.snippet} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {documents !== null && documents.length === 0 && !loadError ? (
              <p className="muted pad">No imported research yet.</p>
            ) : null}
            {documents !== null && documents.length > 0 ? (
              <ul className="note-list" aria-label="Imported research">
                {documents.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      className={doc.id === selectedId ? 'note-item note-item-active' : 'note-item'}
                      aria-current={doc.id === selectedId ? 'true' : undefined}
                      onClick={() => {
                        setSelectedId(doc.id);
                        setActiveKey(null);
                      }}
                    >
                      <span className="note-item-title">{doc.title}</span>
                      <span className="note-item-date">
                        {collectionName(doc.collectionId)} · {doc.format.toUpperCase()} ·{' '}
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
        {activeItem ? (
          <StagedPreview
            key={activeItem.key}
            item={activeItem}
            onChange={(patch) => patchStaged(activeItem.key, patch)}
          />
        ) : selectedId !== null ? (
          <ResearchReader
            key={`${selectedId}:${reload}`}
            id={selectedId}
            collections={collections ?? []}
            onChanged={refresh}
          />
        ) : (
          <div className="empty-state">
            <h2>Private research</h2>
            <p className="muted">
              Choose files to review, pick a collection, then import. Open an imported document to
              see its provenance and, if you choose, map it into Watchtower.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
