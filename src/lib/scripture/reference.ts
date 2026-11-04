/**
 * Scripture reference parsing, validation, canonical formatting and chapter navigation.
 *
 * The TypeScript twin of src-tauri/src/scripture/reference.rs, used by the browser demo. Both are
 * tested against the shared vectors in data/scripture/reference-vectors.json so the desktop app
 * and the demo cannot drift apart. See reference.rs for the grammar.
 */
import type { CanonBook } from './data';

export const MAX_INPUT_CHARS = 100;
export const MAX_PASSAGE_VERSES = 500;

export interface Book {
  id: string;
  name: string;
  citation: string;
  order: number;
  testament: 'OT' | 'NT';
  /** Verses in each chapter; the length is the chapter count. */
  verseCounts: number[];
}

export interface Resolved {
  book: number;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
}

export interface Problem {
  code: string;
  message: string;
}

export type ParseResult = { ok: true; resolved: Resolved } | { ok: false; problem: Problem };

const MALFORMED =
  'Could not read that reference. Try a form like “John 3:16”, “Psalm 23” or “Rev 13:16-18”.';

function problem(code: string, message: string): ParseResult {
  return { ok: false, problem: { code, message } };
}

const ORDINALS: ReadonlyMap<string, string> = new Map([
  ['1', '1'],
  ['1st', '1'],
  ['i', '1'],
  ['first', '1'],
  ['2', '2'],
  ['2nd', '2'],
  ['ii', '2'],
  ['second', '2'],
  ['3', '3'],
  ['3rd', '3'],
  ['iii', '3'],
  ['third', '3'],
]);

/**
 * Reduce a book name to its lookup key: lower case, no periods or spaces, a leading ordinal
 * ("I", "First", "1st") turned into a digit. `null` if anything but letters and digits remain.
 */
export function normalizeBookName(raw: string): string | null {
  const cleaned = raw.toLowerCase().split('.').join('');
  const tokens = cleaned.split(' ').filter((token) => token !== '');
  const first = tokens[0];
  if (tokens.length >= 2 && first !== undefined) {
    const digit = ORDINALS.get(first);
    if (digit !== undefined) tokens[0] = digit;
  }
  const joined = tokens.join('');
  return /^[a-z0-9]+$/.test(joined) ? joined : null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A short echo of user input for error messages (only allowed characters reach this). */
function echo(text: string): string {
  return Array.from(text).slice(0, 40).join('');
}

function normalizeInput(input: string): string {
  let out = '';
  for (const c of input) {
    switch (c) {
      case '–':
      case '—':
      case '‒':
      case '−':
      case '‑':
        out += '-';
        break;
      case '\t':
      case '\n':
      case '\r':
      case ' ':
        out += ' ';
        break;
      default:
        out += c;
    }
  }
  return out;
}

const ALLOWED = /^[A-Za-z0-9 .:-]*$/;

type Tok = number | ':' | '-';

function tokenizeTail(tail: string): Tok[] | null {
  const tokens: Tok[] = [];
  let digits = '';
  const flush = (): boolean => {
    if (digits === '') return true;
    // A number directly after another number can only mean digits separated by a space.
    if (typeof tokens[tokens.length - 1] === 'number' || digits.length > 4) return false;
    tokens.push(Number(digits));
    digits = '';
    return true;
  };
  for (const c of tail) {
    if (c >= '0' && c <= '9') {
      digits += c;
      continue;
    }
    if (!flush()) return null;
    if (c === ':' || c === '-') tokens.push(c);
    else if (c !== ' ') return null;
  }
  return flush() ? tokens : null;
}

function trimSpaces(text: string): string {
  return text.replace(/^ +| +$/g, '');
}

function isTailChar(c: string): boolean {
  return (c >= '0' && c <= '9') || c === ':' || c === '-' || c === ' ';
}

export class Structure {
  readonly books: readonly Book[];
  private readonly aliases = new Map<string, number>();

  /** Build the lookup structure from the canon and the verse count of every chapter. */
  constructor(canon: readonly CanonBook[], verseCounts: readonly (readonly number[])[]) {
    if (canon.length !== verseCounts.length) throw new Error('canon and verse counts disagree');
    const books: Book[] = [];
    canon.forEach((book, index) => {
      const counts = verseCounts[index] as readonly number[];
      if (counts.length === 0 || counts.includes(0))
        throw new Error(`${book.id} has an empty chapter`);
      for (const raw of [book.name, book.citation, ...book.aliases]) {
        const key = normalizeBookName(raw);
        if (key === null) throw new Error(`unusable book alias ${raw} for ${book.id}`);
        const previous = this.aliases.get(key);
        if (previous !== undefined && previous !== index) {
          throw new Error(`ambiguous book alias ${key}`);
        }
        this.aliases.set(key, index);
      }
      books.push({
        id: book.id,
        name: book.name,
        citation: book.citation,
        order: book.order,
        testament: book.testament,
        verseCounts: [...counts],
      });
    });
    this.books = books;
  }

  bookIndex(id: string): number {
    return this.books.findIndex((book) => book.id === id);
  }

  private versesIn(book: number, chapter: number): number {
    return (this.books[book] as Book).verseCounts[chapter - 1] as number;
  }

  /** Parse and validate a user-typed reference against the real bounds of the canon. */
  parse(input: string): ParseResult {
    if (Array.from(input).length > MAX_INPUT_CHARS) {
      return problem('too_long', `References are limited to ${MAX_INPUT_CHARS} characters.`);
    }
    const text = trimSpaces(normalizeInput(input));
    if (text === '') return problem('empty', 'Enter a reference such as “John 3:16”.');
    if (!ALLOWED.test(text)) {
      return problem(
        'malformed',
        'Use only letters A–Z, numbers, spaces, “:” and “-”, for example “John 3:16”.',
      );
    }

    let split = text.length;
    while (split > 0 && isTailChar(text.charAt(split - 1))) split -= 1;
    const bookPart = trimSpaces(text.slice(0, split));
    const tail = trimSpaces(text.slice(split));

    if (bookPart === '') {
      return problem('malformed', 'Start with a book name, for example “John 3:16”.');
    }
    if (tail !== '' && !(tail.charAt(0) >= '0' && tail.charAt(0) <= '9')) {
      return problem('malformed', MALFORMED);
    }

    const key = normalizeBookName(bookPart);
    const book = key === null ? undefined : this.aliases.get(key);
    if (book === undefined) {
      return problem('unknown_book', `No book matches “${echo(bookPart)}”.`);
    }
    const info = this.books[book] as Book;
    const tokens = tokenizeTail(tail);
    if (tokens === null) return problem('malformed', MALFORMED);
    const single = info.verseCounts.length === 1;

    // Each shape yields (start chapter, start verse, end chapter, end verse); a verse of
    // `null` means "whole chapter" at that end.
    let sc: number;
    let sv: number | null;
    let ec: number;
    let ev: number | null;
    const n = (index: number): number => tokens[index] as number;
    const shape = tokens.map((t) => (typeof t === 'number' ? 'N' : t)).join('');
    if (shape === '') {
      [sc, sv, ec, ev] = [1, null, 1, null];
    } else if (shape === 'N' && single) {
      [sc, sv, ec, ev] = [1, n(0), 1, n(0)];
    } else if (shape === 'N') {
      [sc, sv, ec, ev] = [n(0), null, n(0), null];
    } else if (shape === 'N:N') {
      [sc, sv, ec, ev] = [n(0), n(2), n(0), n(2)];
    } else if (shape === 'N:N-N') {
      [sc, sv, ec, ev] = [n(0), n(2), n(0), n(4)];
    } else if (shape === 'N:N-N:N') {
      [sc, sv, ec, ev] = [n(0), n(2), n(4), n(6)];
    } else if (shape === 'N-N' && single) {
      [sc, sv, ec, ev] = [1, n(0), 1, n(2)];
    } else if (shape === 'N-N') {
      [sc, sv, ec, ev] = [n(0), null, n(2), null];
    } else {
      return problem('malformed', MALFORMED);
    }

    const chapterCount = info.verseCounts.length;
    for (const chapter of [sc, ec]) {
      if (chapter === 0 || chapter > chapterCount) {
        return problem(
          'out_of_range',
          `${info.citation} has ${plural(chapterCount, 'chapter', 'chapters')}.`,
        );
      }
    }
    const checkVerse = (chapter: number, verse: number): Problem | null => {
      const max = this.versesIn(book, chapter);
      if (verse === 0 || verse > max) {
        const what = single ? info.citation : `${info.citation} ${chapter}`;
        return { code: 'out_of_range', message: `${what} has ${plural(max, 'verse', 'verses')}.` };
      }
      return null;
    };
    let startVerse = 1;
    if (sv !== null) {
      const bad = checkVerse(sc, sv);
      if (bad) return { ok: false, problem: bad };
      startVerse = sv;
    }
    let endVerse = this.versesIn(book, ec);
    if (ev !== null) {
      const bad = checkVerse(ec, ev);
      if (bad) return { ok: false, problem: bad };
      endVerse = ev;
    }
    if (ec < sc || (ec === sc && endVerse < startVerse)) {
      return problem('invalid_range', 'The end of the range comes before its start.');
    }

    const resolved: Resolved = {
      book,
      startChapter: sc,
      startVerse,
      endChapter: ec,
      endVerse,
    };
    if (this.verseSpan(resolved) > MAX_PASSAGE_VERSES) {
      return problem(
        'range_too_large',
        `Please request at most ${MAX_PASSAGE_VERSES} verses at a time.`,
      );
    }
    return { ok: true, resolved };
  }

  /** Number of verses a passage covers. */
  verseSpan(r: Resolved): number {
    if (r.startChapter === r.endChapter) return r.endVerse - r.startVerse + 1;
    let total = this.versesIn(r.book, r.startChapter) - r.startVerse + 1;
    for (let chapter = r.startChapter + 1; chapter < r.endChapter; chapter += 1) {
      total += this.versesIn(r.book, chapter);
    }
    return total + r.endVerse;
  }

  /** A resolved passage for a whole chapter, or `null` if it does not exist. */
  wholeChapter(book: number, chapter: number): Resolved | null {
    const info = this.books[book];
    if (!info || !Number.isInteger(chapter) || chapter < 1 || chapter > info.verseCounts.length) {
      return null;
    }
    return {
      book,
      startChapter: chapter,
      startVerse: 1,
      endChapter: chapter,
      endVerse: this.versesIn(book, chapter),
    };
  }

  /** The canonical, re-parseable citation for a passage. */
  canonical(r: Resolved): string {
    const info = this.books[r.book] as Book;
    return formatCitation(
      {
        citationName: info.citation,
        bookChapterCount: info.verseCounts.length,
        chapterVerseCount: (chapter) => this.versesIn(r.book, chapter),
      },
      r,
    );
  }

  previousChapter(book: number, chapter: number): [number, number] | null {
    if (chapter > 1) return [book, chapter - 1];
    if (book > 0) return [book - 1, (this.books[book - 1] as Book).verseCounts.length];
    return null;
  }

  nextChapter(book: number, chapter: number): [number, number] | null {
    if (chapter < (this.books[book] as Book).verseCounts.length) return [book, chapter + 1];
    if (book + 1 < this.books.length) return [book + 1, 1];
    return null;
  }
}

export interface CitationBook {
  citationName: string;
  bookChapterCount: number;
  chapterVerseCount: (chapter: number) => number;
}

export interface CitationRange {
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
}

/**
 * The canonical citation for a range, e.g. `Revelation 13:16-18`, `Psalm 23`, `Genesis 1:31-2:3`,
 * `Genesis 1-3`, `Jude 1:3`. Shared by the demo engine and by the reader when it names a verse
 * selection, so both produce exactly the strings the Rust backend does.
 */
export function formatCitation(book: CitationBook, r: CitationRange): string {
  const name = book.citationName;
  const whole = r.startVerse === 1 && r.endVerse === book.chapterVerseCount(r.endChapter);
  if (r.startChapter === r.endChapter) {
    if (r.startVerse === r.endVerse) return `${name} ${r.startChapter}:${r.startVerse}`;
    if (whole && book.bookChapterCount > 1) return `${name} ${r.startChapter}`;
    return `${name} ${r.startChapter}:${r.startVerse}-${r.endVerse}`;
  }
  if (whole) return `${name} ${r.startChapter}-${r.endChapter}`;
  return `${name} ${r.startChapter}:${r.startVerse}-${r.endChapter}:${r.endVerse}`;
}
