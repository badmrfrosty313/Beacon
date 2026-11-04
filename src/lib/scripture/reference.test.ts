import { describe, expect, it } from 'vitest';

import vectorsJson from '../../../data/scripture/reference-vectors.json';
import { testScriptureEngine } from '../../test/scriptureEngine';
import { normalizeBookName } from './reference';

interface Vector {
  input: string;
  ok: boolean;
  canonical?: string;
  bookId?: string;
  range?: [number, number, number, number];
  code?: string;
}

const vectors = (vectorsJson as unknown as { cases: Vector[] }).cases;

describe('reference parser (shared vectors, also run by the Rust tests)', () => {
  it('has a substantial vector set', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(60);
  });

  for (const vector of vectors) {
    it(`${JSON.stringify(vector.input)} → ${vector.ok ? vector.canonical : vector.code}`, () => {
      const result = testScriptureEngine().lookup(vector.input);
      if (vector.ok) {
        if (!result.ok) throw new Error(`expected success, got ${result.problem.code}`);
        const p = result.passage;
        expect(p.canonical).toBe(vector.canonical);
        expect(p.bookId).toBe(vector.bookId);
        expect([p.startChapter, p.startVerse, p.endChapter, p.endVerse]).toEqual(vector.range);
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.problem.code).toBe(vector.code);
      }
    });
  }
});

describe('the inputs named in the Sprint 003 brief', () => {
  const engine = testScriptureEngine();
  const cases: Array<[string, string]> = [
    ['Genesis 1:1', 'Genesis 1:1'],
    ['John 3:16', 'John 3:16'],
    ['Psalm 23', 'Psalm 23'],
    ['Revelation 13:16-18', 'Revelation 13:16-18'],
    ['Rev 13:18', 'Revelation 13:18'],
    ['1 John 4:1', '1 John 4:1'],
    ['3 John 1:2', '3 John 1:2'],
  ];
  for (const [input, canonical] of cases) {
    it(`resolves ${input}`, () => {
      const result = engine.lookup(input);
      expect(result.ok && result.passage.canonical).toBe(canonical);
    });
  }
});

describe('hostile and malformed input', () => {
  const engine = testScriptureEngine();
  const bad = [
    '',
    '   ',
    '<script>alert(1)</script>',
    "'; DROP TABLE scripture_verses; --",
    '../../etc/passwd',
    'John 3:16\u0000',
    'John 0',
    'John 22',
    'John 3:0',
    'John 3:37',
    'Revelation 13:18-13:16',
    'x'.repeat(5000),
    'John 99999999999999999999',
  ];
  for (const input of bad) {
    it(`rejects ${JSON.stringify(input.slice(0, 30))} without throwing`, () => {
      const result = engine.lookup(input);
      expect(result.ok).toBe(false);
    });
  }

  it('never returns an out-of-range chapter or verse', () => {
    expect(engine.chapter('JHN', 22)).toBeNull();
    expect(engine.chapter('JHN', 0)).toBeNull();
    expect(engine.chapter('NOPE', 1)).toBeNull();
  });
});

describe('normalizeBookName', () => {
  it('ignores case, spaces and periods and maps ordinals to digits', () => {
    expect(normalizeBookName('1st John')).toBe(normalizeBookName('1 John'));
    expect(normalizeBookName('REV.')).toBe(normalizeBookName('rev'));
  });
  it('rejects names containing anything but letters and digits', () => {
    expect(normalizeBookName('john!')).toBeNull();
  });
});
