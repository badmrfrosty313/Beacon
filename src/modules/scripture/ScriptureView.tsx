import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage } from '../../api/errors';
import type {
  BookSummary,
  ScriptureOverview,
  ScripturePassage,
  ScriptureVerse,
} from '../../api/types';
import { formatCitation } from '../../lib/scripture/reference';
import { copyText } from './clipboard';
import { loadPosition, savePosition } from './position';
import { buildReferenceNote, type NoteSeed } from './referenceNote';
import { nextSelection, type Selection } from './selection';

/** Ask the reader to open a typed reference (e.g. from a link in a note). A new `nonce` reopens. */
export interface OpenRequest {
  reference: string;
  nonce: number;
}

interface ScriptureViewProps {
  openRequest: OpenRequest | null;
  onCreateNote: (seed: NoteSeed) => void;
  /** True while Archive → Notes holds an unsaved draft that must not be overwritten. */
  noteDraftInProgress: boolean;
  onOpenDraft: () => void;
}

type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ScriptureOverview };

const DEFAULT_POSITION = { bookId: 'GEN', chapter: 1 };

function versesOf(passage: ScripturePassage, chapter: number): ScriptureVerse[] {
  return passage.verses.filter((verse) => verse.chapter === chapter);
}

export function ScriptureView({
  openRequest,
  onCreateNote,
  noteDraftInProgress,
  onOpenDraft,
}: ScriptureViewProps) {
  const api = useApi();
  const [overview, setOverview] = useState<OverviewState>({ status: 'loading' });
  const [passage, setPassage] = useState<ScripturePassage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [copyStatus, setCopyStatus] = useState<string>('');

  const requestId = useRef(0);
  const currentPassage = useRef<ScripturePassage | null>(null);
  const focusAfterLoad = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const accept = useCallback((next: ScripturePassage, focus: boolean) => {
    currentPassage.current = next;
    focusAfterLoad.current = focus;
    setPassage(next);
    setSelection(null);
    setCopyStatus('');
    setProblem(null);
    setLoadError(null);
    setInput('');
    savePosition({ bookId: next.bookId, chapter: next.startChapter });
  }, []);

  const loadChapter = useCallback(
    async (bookId: string, chapter: number, focus: boolean) => {
      const id = ++requestId.current;
      try {
        const next = await api.getScriptureChapter(bookId, chapter);
        if (id === requestId.current) accept(next, focus);
      } catch (error) {
        if (id === requestId.current) setLoadError(errorMessage(error));
      }
    },
    [api, accept],
  );

  const lookup = useCallback(
    async (text: string) => {
      const id = ++requestId.current;
      try {
        const result = await api.lookupScripture(text);
        if (id !== requestId.current) return;
        if (result.ok) {
          accept(result.passage, true);
          return;
        }
        setProblem(result.problem.message);
        // Never leave the reader empty because of a bad reference.
        if (currentPassage.current === null) {
          const saved = loadPosition() ?? DEFAULT_POSITION;
          void loadChapter(saved.bookId, saved.chapter, false);
        }
      } catch (error) {
        if (id === requestId.current) setLoadError(errorMessage(error));
      }
    },
    [api, accept, loadChapter],
  );

  // Load the translation and book list once.
  useEffect(() => {
    let cancelled = false;
    api.getScriptureOverview().then(
      (data) => {
        if (!cancelled) setOverview({ status: 'ready', data });
      },
      (error: unknown) => {
        if (!cancelled) setOverview({ status: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const ready = overview.status === 'ready';

  // Open the requested reference, else continue where the user left off.
  useEffect(() => {
    if (!ready) return;
    if (openRequest) {
      void lookup(openRequest.reference);
      return;
    }
    if (currentPassage.current !== null) return;
    const saved = loadPosition() ?? DEFAULT_POSITION;
    void loadChapter(saved.bookId, saved.chapter, false);
  }, [ready, openRequest, lookup, loadChapter]);

  useEffect(() => {
    if (passage && focusAfterLoad.current) {
      focusAfterLoad.current = false;
      headingRef.current?.focus();
    }
  }, [passage]);

  const books: BookSummary[] = useMemo(
    () => (overview.status === 'ready' ? overview.data.books : []),
    [overview],
  );

  const selectionReference = useMemo(() => {
    if (!passage || !selection) return null;
    return formatCitation(
      {
        citationName: passage.citationName,
        bookChapterCount: passage.bookChapterCount,
        chapterVerseCount: (chapter) =>
          passage.chapters.find((entry) => entry.chapter === chapter)?.verseCount ?? 0,
      },
      {
        startChapter: selection.chapter,
        startVerse: selection.from,
        endChapter: selection.chapter,
        endVerse: selection.to,
      },
    );
  }, [passage, selection]);

  if (overview.status === 'loading') {
    return (
      <section className="view" aria-labelledby="scripture-title">
        <h1 id="scripture-title">Scripture</h1>
        <p className="muted" role="status">
          Loading Scripture…
        </p>
      </section>
    );
  }
  if (overview.status === 'error') {
    return (
      <section className="view" aria-labelledby="scripture-title">
        <h1 id="scripture-title">Scripture</h1>
        <div className="banner banner-error" role="alert">
          <p>{overview.message}</p>
        </div>
      </section>
    );
  }

  const { translation } = overview.data;
  const activeReference = selectionReference ?? passage?.canonical ?? null;
  const oldTestament = books.filter((book) => book.testament === 'OT');
  const newTestament = books.filter((book) => book.testament === 'NT');
  const currentBook = passage ? books.find((book) => book.id === passage.bookId) : undefined;
  const multiChapter = passage ? passage.chapters.length > 1 : false;

  function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void lookup(input);
  }

  async function handleCopy() {
    if (!activeReference) return;
    const copied = await copyText(activeReference);
    setCopyStatus(
      copied
        ? `Copied “${activeReference}”.`
        : 'Could not copy automatically. Select the reference above and copy it manually.',
    );
  }

  function handleCreateNote() {
    if (!activeReference) return;
    onCreateNote(buildReferenceNote(activeReference, translation.abbreviation));
  }

  function navButton(target: ScripturePassage['previous'], direction: 'previous' | 'next') {
    const word = direction === 'previous' ? 'Previous' : 'Next';
    const text = target ? target.label : word;
    return (
      <button
        type="button"
        className="button"
        disabled={target === null}
        aria-label={target ? `${word} chapter: ${target.label}` : `No ${direction} chapter`}
        onClick={() => target && void loadChapter(target.bookId, target.chapter, true)}
      >
        {direction === 'previous' ? `← ${text}` : `${text} →`}
      </button>
    );
  }

  return (
    <section className="view scripture" aria-labelledby="scripture-title">
      <header className="view-header">
        <div>
          <h1 id="scripture-title">Scripture</h1>
          <p className="view-subtitle">
            Read-only reference text, stored on this device. Your notes are separate and never
            change it.
          </p>
        </div>
        <p className="translation-badge" title={`${translation.name} — ${translation.edition}`}>
          <span className="translation-abbr">{translation.abbreviation}</span>
          <span className="translation-name">{translation.name}</span>
        </p>
      </header>

      <div className="scripture-controls">
        <form className="scripture-lookup" onSubmit={handleLookup} aria-label="Reference lookup">
          <label htmlFor="scripture-reference">Go to reference</label>
          <div className="scripture-lookup-row">
            <input
              id="scripture-reference"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="John 3:16 · Psalm 23 · Rev 13:16-18"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? 'scripture-reference-error' : undefined}
            />
            <button type="submit" className="button button-primary">
              Go
            </button>
          </div>
          {problem ? (
            <p id="scripture-reference-error" className="field-error" role="alert">
              {problem}
            </p>
          ) : null}
        </form>

        <div className="scripture-pickers">
          <div className="field">
            <label htmlFor="scripture-book">Book</label>
            <select
              id="scripture-book"
              value={passage?.bookId ?? ''}
              onChange={(event) => void loadChapter(event.target.value, 1, true)}
              disabled={passage === null}
            >
              {passage === null ? <option value="">…</option> : null}
              <optgroup label="Old Testament">
                {oldTestament.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="New Testament">
                {newTestament.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="field">
            <label htmlFor="scripture-chapter">Chapter</label>
            <select
              id="scripture-chapter"
              value={passage?.startChapter ?? ''}
              onChange={(event) =>
                passage && void loadChapter(passage.bookId, Number(event.target.value), true)
              }
              disabled={passage === null}
            >
              {passage === null ? <option value="">…</option> : null}
              {Array.from({ length: currentBook?.chapterCount ?? 0 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="banner banner-error" role="alert">
          <p>{loadError}</p>
        </div>
      ) : null}

      {passage === null ? (
        loadError ? null : (
          <p className="muted" role="status">
            Loading passage…
          </p>
        )
      ) : (
        <article className="passage" aria-labelledby="passage-heading">
          <header className="passage-header">
            <h2 id="passage-heading" tabIndex={-1} ref={headingRef}>
              {passage.canonical}
            </h2>
            <span className="translation-abbr" title={translation.name}>
              {passage.translationAbbreviation}
            </span>
          </header>

          <nav className="chapter-nav" aria-label="Chapter navigation, top">
            {navButton(passage.previous, 'previous')}
            {navButton(passage.next, 'next')}
          </nav>

          {passage.chapters.map((chapter) => (
            <div key={chapter.chapter} className="passage-chapter">
              {multiChapter ? (
                <h3 className="chapter-heading">
                  {passage.citationName} {chapter.chapter}
                </h3>
              ) : null}
              {chapter.superscription ? (
                <p className="superscription">{chapter.superscription}</p>
              ) : null}
              <ol className="verses">
                {versesOf(passage, chapter.chapter).map((verse) => {
                  const selected =
                    selection !== null &&
                    selection.chapter === verse.chapter &&
                    verse.verse >= selection.from &&
                    verse.verse <= selection.to;
                  return (
                    <li
                      key={`${verse.chapter}:${verse.verse}`}
                      className={selected ? 'verse verse-selected' : 'verse'}
                    >
                      <button
                        type="button"
                        className="verse-number"
                        aria-pressed={selected}
                        aria-label={`Verse ${verse.verse}${multiChapter ? ` of chapter ${verse.chapter}` : ''}`}
                        onClick={(event) =>
                          setSelection((previous) =>
                            nextSelection(previous, verse.chapter, verse.verse, event.shiftKey),
                          )
                        }
                      >
                        {verse.verse}
                      </button>
                      {verse.text === '' ? (
                        <span className="verse-text verse-missing">
                          This verse has no text in the {translation.abbreviation} main text. The
                          source records only a variant in a footnote, which BEACON does not
                          include.
                        </span>
                      ) : (
                        <span className="verse-text">{verse.text}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}

          <nav className="chapter-nav" aria-label="Chapter navigation, bottom">
            {navButton(passage.previous, 'previous')}
            {navButton(passage.next, 'next')}
          </nav>

          <div className="passage-actions" role="group" aria-label="Reference actions">
            <p className="selection-label">
              {selectionReference ? (
                <>
                  Selected: <strong>{selectionReference}</strong>
                </>
              ) : (
                <>
                  Select a verse number to choose a verse or range (Shift-click extends). With
                  nothing selected, actions use <strong>{passage.canonical}</strong>.
                </>
              )}
            </p>
            <div className="form-actions">
              <button type="button" className="button" onClick={() => void handleCopy()}>
                Copy reference
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={handleCreateNote}
                disabled={noteDraftInProgress}
                aria-describedby={noteDraftInProgress ? 'draft-in-progress' : undefined}
              >
                Create note from reference
              </button>
              {selection ? (
                <button type="button" className="button" onClick={() => setSelection(null)}>
                  Clear selection
                </button>
              ) : null}
            </div>
            <p className="copy-status muted" role="status">
              {copyStatus}
            </p>
            {noteDraftInProgress ? (
              <p id="draft-in-progress" className="muted">
                You have an unsaved note in Archive → Notes. Save or discard it before creating
                another.{' '}
                <button type="button" className="link-button" onClick={onOpenDraft}>
                  Open the unsaved note
                </button>
              </p>
            ) : null}
          </div>
        </article>
      )}

      <details className="scripture-about">
        <summary>About this text</summary>
        <dl className="info-grid">
          <div>
            <dt>Translation</dt>
            <dd>
              {translation.name} ({translation.abbreviation}), {translation.edition}
            </dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>{translation.licenseStatus}</dd>
          </div>
          <div>
            <dt>Notice</dt>
            <dd>{translation.licenseNotice}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd className="mono">{translation.sourceUrl}</dd>
          </div>
          <div>
            <dt>Source archive SHA-256</dt>
            <dd className="mono">{translation.sourceSha256}</dd>
          </div>
          <div>
            <dt>Retrieved</dt>
            <dd>{translation.retrievedOn}</dd>
          </div>
          <div>
            <dt>Verses</dt>
            <dd>{translation.verseCount.toLocaleString('en-US')}</dd>
          </div>
        </dl>
        <p className="muted">
          Strong&rsquo;s numbers, translator footnotes and cross-references are not included. BEACON
          never fetches Scripture from the internet and adds no commentary.
        </p>
      </details>
    </section>
  );
}
