/**
 * The browser demo's Scripture backend: the same lookups the Rust module performs, over the
 * packaged data held in memory. Read-only by construction (nothing here can write), with no
 * network access of any kind.
 */
import type {
  BookSummary,
  LookupResult,
  NavTarget,
  PassageChapter,
  ScriptureOverview,
  ScripturePassage,
  ScriptureVerse,
  TranslationInfo,
} from '../../api/types';
import { metaGet, metaNumber, type PackagedScripture } from './data';
import { Structure, type Book, type Resolved } from './reference';

export interface ScriptureEngine {
  overview(): ScriptureOverview;
  lookup(input: string): LookupResult;
  /** `null` when the book or chapter does not exist. */
  chapter(bookId: string, chapter: number): ScripturePassage | null;
}

export function createScriptureEngine(data: PackagedScripture): ScriptureEngine {
  const { canon, meta, chapters } = data;

  // chapters by book then chapter: text[book][chapter - 1]
  const text: Array<Array<{ verses: string[]; superscription: string }>> = canon.map(() => []);
  for (const chapter of chapters) {
    (text[chapter.book] as Array<unknown>).push({
      verses: chapter.verses,
      superscription: chapter.superscription,
    });
  }
  const structure = new Structure(
    canon,
    text.map((book) => book.map((chapter) => chapter.verses.length)),
  );

  const translation: TranslationInfo = {
    id: metaGet(meta, 'translation.id'),
    abbreviation: metaGet(meta, 'translation.abbreviation'),
    name: metaGet(meta, 'translation.name'),
    edition: metaGet(meta, 'translation.edition'),
    language: metaGet(meta, 'translation.language'),
    licenseStatus: metaGet(meta, 'license.status'),
    licenseNotice: `${metaGet(meta, 'license.trademark')} Text from ${metaGet(meta, 'source.url')} (retrieved ${metaGet(meta, 'source.retrieved')}); SHA-256 of the source archive ${metaGet(meta, 'source.zip.sha256')}.`,
    sourceUrl: metaGet(meta, 'source.url'),
    sourceSha256: metaGet(meta, 'source.zip.sha256'),
    retrievedOn: metaGet(meta, 'source.retrieved'),
    verseCount: metaNumber(meta, 'data.verses'),
  };

  const books: BookSummary[] = structure.books.map((book: Book) => ({
    id: book.id,
    name: book.name,
    citationName: book.citation,
    testament: book.testament,
    order: book.order,
    chapterCount: book.verseCounts.length,
  }));

  function navTarget(target: [number, number] | null): NavTarget | null {
    if (target === null) return null;
    const [book, chapter] = target;
    const info = structure.books[book] as Book;
    return {
      bookId: info.id,
      bookName: info.name,
      chapter,
      label: `${info.citation} ${chapter}`,
    };
  }

  function fetchPassage(r: Resolved): ScripturePassage {
    const info = structure.books[r.book] as Book;
    const verses: ScriptureVerse[] = [];
    const touched: PassageChapter[] = [];
    for (let chapter = r.startChapter; chapter <= r.endChapter; chapter += 1) {
      const stored = (text[r.book] as Array<{ verses: string[]; superscription: string }>)[
        chapter - 1
      ] as { verses: string[]; superscription: string };
      const from = chapter === r.startChapter ? r.startVerse : 1;
      const to = chapter === r.endChapter ? r.endVerse : stored.verses.length;
      for (let verse = from; verse <= to; verse += 1) {
        verses.push({ chapter, verse, text: stored.verses[verse - 1] as string });
      }
      touched.push({
        chapter,
        verseCount: stored.verses.length,
        // A passage that starts partway into a chapter does not include its title.
        superscription:
          chapter === r.startChapter && r.startVerse !== 1 ? '' : stored.superscription,
      });
    }
    return {
      translationId: translation.id,
      translationAbbreviation: translation.abbreviation,
      bookId: info.id,
      bookName: info.name,
      citationName: info.citation,
      bookChapterCount: info.verseCounts.length,
      canonical: structure.canonical(r),
      startChapter: r.startChapter,
      startVerse: r.startVerse,
      endChapter: r.endChapter,
      endVerse: r.endVerse,
      verses,
      chapters: touched,
      previous: navTarget(structure.previousChapter(r.book, r.startChapter)),
      next: navTarget(structure.nextChapter(r.book, r.endChapter)),
    };
  }

  return {
    overview: () => ({ translation, books }),
    lookup(input) {
      const parsed = structure.parse(input);
      if (!parsed.ok) return { ok: false, problem: parsed.problem };
      return { ok: true, passage: fetchPassage(parsed.resolved) };
    },
    chapter(bookId, chapter) {
      const book = structure.bookIndex(bookId);
      if (book < 0) return null;
      const resolved = structure.wholeChapter(book, chapter);
      return resolved === null ? null : fetchPassage(resolved);
    },
  };
}
