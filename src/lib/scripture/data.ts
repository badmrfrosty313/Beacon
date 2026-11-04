/**
 * Parsers for the packaged Scripture data (data/scripture/*). The TypeScript twin of
 * src-tauri/src/scripture/data.rs, used only by the browser demo; the desktop app reads the
 * same files in Rust.
 *
 * The parsers are strict: a dataset that is partial, reordered, has a gap in verse numbers or
 * disagrees with its own recorded totals is rejected, so an incomplete Bible can never be
 * loaded and pass as a complete one.
 */
import { sha256Hex } from '../sha256';

export interface CanonBook {
  id: string;
  order: number;
  testament: 'OT' | 'NT';
  name: string;
  /** Name used in citations; equals `name` unless the canon file says otherwise ("Psalm"). */
  citation: string;
  /** Normalized aliases (lower case, no spaces or periods, ordinal turned into a digit). */
  aliases: string[];
}

export function parseCanon(text: string): CanonBook[] {
  const books: CanonBook[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const fields = line.split('|');
    if (fields.length !== 6) throw new Error(`malformed canon line: ${line}`);
    const [id, order, testament, name, citation, aliases] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (testament !== 'OT' && testament !== 'NT') throw new Error(`bad testament: ${line}`);
    const orderNumber = Number(order);
    if (!Number.isInteger(orderNumber)) throw new Error(`bad book order: ${line}`);
    books.push({
      id,
      order: orderNumber,
      testament,
      name,
      citation: citation === '' ? name : citation,
      aliases: aliases.split(',').filter((alias) => alias !== ''),
    });
  }
  books.forEach((book, index) => {
    if (book.order !== index + 1) throw new Error(`canon order is not contiguous at ${book.id}`);
  });
  return books;
}

export type Meta = ReadonlyMap<string, string>;

export function parseMeta(text: string): Meta {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at > 0) map.set(line.slice(0, at), line.slice(at + 1));
  }
  return map;
}

export function metaGet(meta: Meta, key: string): string {
  const value = meta.get(key);
  if (value === undefined) throw new Error(`packaged Scripture metadata is missing ${key}`);
  return value;
}

export function metaNumber(meta: Meta, key: string): number {
  const value = Number(metaGet(meta, key));
  if (!Number.isInteger(value))
    throw new Error(`packaged Scripture metadata ${key} is not a number`);
  return value;
}

export interface ParsedChapter {
  /** Index into the canon. */
  book: number;
  chapter: number;
  superscription: string;
  /** Verse texts; verse 1 first. */
  verses: string[];
}

function unescapeField(field: string): string {
  let out = '';
  for (let i = 0; i < field.length; i += 1) {
    const c = field.charAt(i);
    if (c !== '\\') {
      out += c;
      continue;
    }
    i += 1;
    const next = field.charAt(i);
    if (next === '\\') out += '\\';
    else if (next === 'n') out += '\n';
    else throw new Error('invalid escape in Scripture data');
  }
  return out;
}

export function parseTsv(text: string, canon: readonly CanonBook[]): ParsedChapter[] {
  const lines = text.split('\n');
  if (lines[0] !== '#BEACON-SCRIPTURE-TSV 1') throw new Error('unrecognized Scripture data format');
  const indexOf = new Map(canon.map((book, index) => [book.id, index]));

  const chapters: ParsedChapter[] = [];
  for (let n = 1; n < lines.length; n += 1) {
    const line = lines[n] as string;
    if (line === '' || line.startsWith('#')) continue;
    const fail = (what: string) => new Error(`Scripture data line ${n + 1}: ${what}`);

    const fields = line.split('\t');
    // The text is the 5th field and never contains a tab, so a plain split is exact.
    if (fields.length !== 5) throw fail('expected 5 fields');
    const [kind, bookId, chapterText, verseText, rawText] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];
    const book = indexOf.get(bookId);
    if (book === undefined) throw fail('unknown book');
    if (!/^\d+$/.test(chapterText)) throw fail('bad chapter');
    const chapterNumber = Number(chapterText);

    let current = chapters[chapters.length - 1];
    if (!current || current.book !== book || current.chapter !== chapterNumber) {
      const ordered = !current
        ? book === 0 && chapterNumber === 1
        : current.book === book
          ? chapterNumber === current.chapter + 1
          : book === current.book + 1 && chapterNumber === 1;
      if (!ordered) throw fail('book or chapter out of order');
      current = { book, chapter: chapterNumber, superscription: '', verses: [] };
      chapters.push(current);
    }
    const text = unescapeField(rawText);
    if (kind === 'D') {
      if (verseText !== '' || current.verses.length > 0) throw fail('misplaced superscription');
      current.superscription = text;
    } else if (kind === 'V') {
      if (!/^\d+$/.test(verseText) || Number(verseText) !== current.verses.length + 1) {
        throw fail('verse numbers must be contiguous from 1');
      }
      current.verses.push(text);
    } else {
      throw fail('unknown row kind');
    }
  }

  const last = chapters[chapters.length - 1];
  if (!last || last.book + 1 !== canon.length) {
    throw new Error('Scripture data does not cover every book of the canon');
  }
  const seen = new Set<number>();
  for (const chapter of chapters) {
    if (chapter.verses.length === 0) {
      throw new Error(`${canon[chapter.book]?.id} ${chapter.chapter} has no verses`);
    }
    seen.add(chapter.book);
  }
  if (seen.size !== canon.length) throw new Error('Scripture data is missing a book');
  return chapters;
}

export interface PackagedScripture {
  canon: CanonBook[];
  meta: Meta;
  chapters: ParsedChapter[];
  dataSha256: string;
}

/** Parse the packaged files and check them against their recorded SHA-256 and totals. */
export function verifyPackaged(
  canonText: string,
  metaText: string,
  tsv: string,
): PackagedScripture {
  const canon = parseCanon(canonText);
  const meta = parseMeta(metaText);

  const actual = sha256Hex(new TextEncoder().encode(tsv));
  if (actual !== metaGet(meta, 'data.sha256')) {
    throw new Error('packaged Scripture text does not match its recorded SHA-256');
  }
  const chapters = parseTsv(tsv, canon);
  const verseTotal = chapters.reduce((sum, chapter) => sum + chapter.verses.length, 0);
  if (
    canon.length !== metaNumber(meta, 'data.books') ||
    chapters.length !== metaNumber(meta, 'data.chapters') ||
    verseTotal !== metaNumber(meta, 'data.verses')
  ) {
    throw new Error('packaged Scripture text does not match its recorded totals');
  }
  return { canon, meta, chapters, dataSha256: actual };
}
