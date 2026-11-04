import canonText from '../../../data/scripture/canon-protestant66.txt?raw';
import metaText from '../../../data/scripture/engwebp.meta.txt?raw';
import tsv from '../../../data/scripture/engwebp.tsv?raw';
import { describe, expect, it } from 'vitest';

import { testScriptureEngine } from '../../test/scriptureEngine';
import { metaGet, parseCanon, parseMeta, parseTsv, verifyPackaged } from './data';

const engine = testScriptureEngine();
const overview = engine.overview();

describe('packaged dataset is the complete Protestant canon', () => {
  it('has 66 books, 39 OT and 27 NT, in canonical order', () => {
    expect(overview.books).toHaveLength(66);
    expect(overview.books.filter((b) => b.testament === 'OT')).toHaveLength(39);
    expect(overview.books.filter((b) => b.testament === 'NT')).toHaveLength(27);
    expect(overview.books[0]?.id).toBe('GEN');
    expect(overview.books[65]?.id).toBe('REV');
    expect(overview.books.map((b) => b.order)).toEqual(Array.from({ length: 66 }, (_, i) => i + 1));
  });

  it('has 1,189 chapters (929 OT, 260 NT) and 31,103 verses', () => {
    const chapters = overview.books.reduce((n, b) => n + b.chapterCount, 0);
    expect(chapters).toBe(1189);
    expect(
      overview.books.filter((b) => b.testament === 'OT').reduce((n, b) => n + b.chapterCount, 0),
    ).toBe(929);
    expect(
      overview.books.filter((b) => b.testament === 'NT').reduce((n, b) => n + b.chapterCount, 0),
    ).toBe(260);
    expect(overview.translation.verseCount).toBe(31103);

    let verses = 0;
    for (const book of overview.books) {
      for (let c = 1; c <= book.chapterCount; c += 1) {
        verses += engine.chapter(book.id, c)?.verses.length ?? 0;
      }
    }
    expect(verses).toBe(31103);
  });

  it('covers Genesis, Psalms, John, Revelation and the numbered books', () => {
    const counts = Object.fromEntries(overview.books.map((b) => [b.id, b.chapterCount]));
    expect(counts).toMatchObject({
      GEN: 50,
      PSA: 150,
      JHN: 21,
      REV: 22,
      '1SA': 31,
      '2SA': 24,
      '1KI': 22,
      '2KI': 25,
      '1CH': 29,
      '2CH': 36,
      '1CO': 16,
      '2CO': 13,
      '1TH': 5,
      '2TH': 3,
      '1TI': 6,
      '2TI': 4,
      '1PE': 5,
      '2PE': 3,
      '1JN': 5,
      '2JN': 1,
      '3JN': 1,
      JUD: 1,
      OBA: 1,
      PHM: 1,
    });
  });

  it('has the expected verse counts in key chapters', () => {
    const n = (id: string, c: number) => engine.chapter(id, c)?.verses.length;
    expect(n('GEN', 1)).toBe(31);
    expect(n('PSA', 23)).toBe(6);
    expect(n('PSA', 119)).toBe(176);
    expect(n('JHN', 3)).toBe(36);
    expect(n('REV', 13)).toBe(18);
    expect(n('3JN', 1)).toBe(14);
  });

  it('has contiguous verse numbers in every chapter', () => {
    for (const book of overview.books) {
      for (let c = 1; c <= book.chapterCount; c += 1) {
        const verses = engine.chapter(book.id, c)?.verses ?? [];
        expect(verses.map((v) => v.verse)).toEqual(verses.map((_, i) => i + 1));
      }
    }
  });

  it('leaves exactly the five known footnote-only verses empty', () => {
    const empty: string[] = [];
    for (const book of overview.books) {
      for (let c = 1; c <= book.chapterCount; c += 1) {
        for (const v of engine.chapter(book.id, c)?.verses ?? []) {
          if (v.text === '') empty.push(`${book.id} ${c}:${v.verse}`);
        }
      }
    }
    expect(empty.sort()).toEqual(['ACT 15:34', 'ACT 24:7', 'ACT 8:37', 'LUK 17:36', 'ROM 16:25']);
  });
});

describe('text is preserved exactly', () => {
  const text = (input: string) => {
    const r = engine.lookup(input);
    if (!r.ok) throw new Error(r.problem.message);
    return r.passage.verses.map((v) => v.text);
  };

  it('Genesis 1:1', () => {
    expect(text('Genesis 1:1')).toEqual([
      'In the beginning, God created the heavens and the earth.',
    ]);
  });
  it('John 3:16', () => {
    expect(text('John 3:16')).toEqual([
      'For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.',
    ]);
  });
  it('Revelation 13:18 (including the number)', () => {
    expect(text('Rev 13:18')[0]).toBe(
      'Here is wisdom. He who has understanding, let him calculate the number of the beast, for it is the number of a man. His number is six hundred sixty-six.',
    );
  });
  it('3 John 1:2', () => {
    expect(text('3 John 1:2')[0]).toContain('Beloved, I pray that you may prosper in all things');
  });
  it('keeps poetry line breaks within a verse', () => {
    expect(text('Psalm 23:1')).toEqual(['The LORD is my shepherd;\nI shall lack nothing.']);
  });
  it('keeps Psalm titles separate from the numbered verses', () => {
    const p = engine.chapter('PSA', 23);
    expect(p?.chapters[0]?.superscription).toBe('A Psalm by David.');
    expect(p?.verses[0]?.verse).toBe(1);
  });
  it('preserves typographic punctuation and non-ASCII characters', () => {
    const all = tsv;
    expect(all).toMatch(/[“”‘’]/);
    expect(all).not.toContain('\r');
    // Every row decodes without replacement characters.
    expect(all).not.toContain('�');
  });
  it('contains no markup or footnote residue', () => {
    // Only the format's own \n and \\ escapes may contain a backslash.
    expect(tsv).not.toMatch(/\\(?![n\\])/);
    expect(tsv).not.toMatch(/strong=|\|lemma|<[a-z/]/i);
  });
});

describe('navigation across boundaries', () => {
  it('goes to the previous/next chapter, and across books', () => {
    const rev13 = engine.chapter('REV', 13);
    expect(rev13?.previous?.label).toBe('Revelation 12');
    expect(rev13?.next?.label).toBe('Revelation 14');
    expect(engine.chapter('GEN', 50)?.next?.label).toBe('Exodus 1');
    expect(engine.chapter('EXO', 1)?.previous?.label).toBe('Genesis 50');
    expect(engine.chapter('MAL', 4)?.next?.label).toBe('Matthew 1');
    expect(engine.chapter('PSA', 150)?.next?.label).toBe('Proverbs 1');
    expect(engine.chapter('2JN', 1)?.next?.label).toBe('3 John 1');
  });
  it('has no previous before Genesis 1 and no next after Revelation 22', () => {
    expect(engine.chapter('GEN', 1)?.previous).toBeNull();
    expect(engine.chapter('REV', 22)?.next).toBeNull();
  });
  it('reads a range spanning a chapter boundary in order', () => {
    const r = engine.lookup('Genesis 1:31-2:3');
    if (!r.ok) throw new Error('lookup failed');
    expect(r.passage.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual([
      '1:31',
      '2:1',
      '2:2',
      '2:3',
    ]);
  });
  it('does not attach a Psalm title to a range that starts after verse 1', () => {
    const r = engine.lookup('Psalm 23:2-3');
    if (!r.ok) throw new Error('lookup failed');
    expect(r.passage.chapters[0]?.superscription).toBe('');
  });
});

describe('integrity checks reject partial or altered data', () => {
  const canon = parseCanon(canonText);
  const meta = parseMeta(metaText);

  it('accepts the genuine files', () => {
    expect(verifyPackaged(canonText, metaText, tsv).chapters).toHaveLength(1189);
    expect(metaGet(meta, 'translation.abbreviation')).toBe('WEB');
  });

  it('rejects a dataset with a verse removed (hash)', () => {
    const lines = tsv.split('\n');
    const index = lines.findIndex((l) => l.startsWith('V\tREV\t13\t18\t'));
    lines.splice(index, 1);
    expect(() => verifyPackaged(canonText, metaText, lines.join('\n'))).toThrow(/SHA-256/);
  });

  it('rejects a dataset with a changed word (hash)', () => {
    expect(() =>
      verifyPackaged(canonText, metaText, tsv.replace('God created', 'God made')),
    ).toThrow(/SHA-256/);
  });

  it('rejects a truncated Bible even before hashing (parser)', () => {
    const lines = tsv.split('\n');
    const cut = lines.findIndex((l) => l.startsWith('V\tMAT\t'));
    expect(() => parseTsv(lines.slice(0, cut).join('\n'), canon)).toThrow(/every book/);
  });

  it('rejects a gap in verse numbers (parser)', () => {
    const lines = tsv.split('\n');
    const index = lines.findIndex((l) => l.startsWith('V\tGEN\t1\t5\t'));
    lines.splice(index, 1);
    expect(() => parseTsv(lines.join('\n'), canon)).toThrow(/contiguous/);
  });

  it('rejects an unknown format header', () => {
    expect(() => parseTsv(tsv.replace('#BEACON-SCRIPTURE-TSV 1', '#OTHER 2'), canon)).toThrow(
      /format/,
    );
  });
});

describe('provenance is recorded', () => {
  const t = overview.translation;
  it('names the edition, source, retrieval date and archive checksum', () => {
    expect(t.id).toBe('engwebp');
    expect(t.abbreviation).toBe('WEB');
    expect(t.sourceSha256).toBe('a93df5571009fed56f77e3ac1d3ce71c9a3a3df1486f7570cc7a8f823192fdba');
    expect(t.retrievedOn).toBe('2026-11-04');
    expect(t.sourceUrl).toMatch(/^https:\/\/ebible\.org\//i);
    expect(t.licenseStatus.toLowerCase()).toContain('public domain');
    expect(t.licenseNotice).toMatch(/World English Bible/);
  });
});
