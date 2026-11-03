import { describe, expect, it } from 'vitest';

import {
  MATCH_END,
  MATCH_START,
  QueryRejection,
  parseSearchQuery,
  splitSnippet,
} from './searchQuery';

describe('parseSearchQuery (mirrors query.rs)', () => {
  it('splits words and keeps quoted phrases together', () => {
    expect(parseSearchQuery('north bridge')).toEqual(['north', 'bridge']);
    expect(parseSearchQuery('"north bridge"')).toEqual(['north bridge']);
    expect(parseSearchQuery('radio "signal checks" 0900')).toEqual([
      'radio',
      'signal checks',
      '0900',
    ]);
  });

  it('treats empty, blank and punctuation-only input as nothing to search', () => {
    for (const query of ['', '   ', '"', '""', '*** --- ()']) {
      expect(parseSearchQuery(query)).toEqual([]);
    }
  });

  it('treats an unterminated quote as a phrase to the end', () => {
    expect(parseSearchQuery('"north bridge')).toEqual(['north bridge']);
  });

  it('keeps search operators as ordinary words', () => {
    expect(parseSearchQuery('north OR bridge NOT x')).toEqual([
      'north',
      'OR',
      'bridge',
      'NOT',
      'x',
    ]);
    expect(parseSearchQuery('col:foo a* ^b')).toEqual(['col:foo', 'a*', '^b']);
  });

  it('rejects overlong, control-character and too-many-term queries', () => {
    expect(() => parseSearchQuery('a'.repeat(201))).toThrow(QueryRejection);
    expect(parseSearchQuery('a'.repeat(200))).toHaveLength(1);
    expect(() => parseSearchQuery('bad\u0000query')).toThrow(QueryRejection);
    expect(() => parseSearchQuery('two\nlines')).toThrow(QueryRejection);
    expect(() => parseSearchQuery('a b c d e f g h i')).toThrow(QueryRejection);
    expect(parseSearchQuery('a b c d e f g h')).toHaveLength(8);
  });
});

describe('splitSnippet', () => {
  it('splits highlight markers into parts and collapses whitespace', () => {
    const snippet = `…at ${MATCH_START}north${MATCH_END}\nbridge  now`;
    expect(splitSnippet(snippet)).toEqual([
      { text: '…at ', match: false },
      { text: 'north', match: true },
      { text: ' bridge now', match: false },
    ]);
  });

  it('never produces markup: angle brackets stay literal text', () => {
    const parts = splitSnippet(`<b>${MATCH_START}<script>${MATCH_END}</b>`);
    expect(parts.map((part) => part.text).join('')).toBe('<b><script></b>');
  });
});
