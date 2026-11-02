import { describe, expect, it } from 'vitest';

import {
  MAX_BODY_BYTES,
  MAX_TITLE_CHARS,
  countCodePoints,
  countUtf8Bytes,
  validateNote,
} from './validation';

/** These cases intentionally mirror the Rust tests in src-tauri/src/notes/validation.rs. */
describe('validateNote (mirror of the Rust rules)', () => {
  it('accepts a normal note', () => {
    expect(validateNote('Water plan', 'line one\nline two\t(tabbed)\r\n')).toEqual({});
  });

  it('accepts an empty body', () => {
    expect(validateNote('Title', '')).toEqual({});
  });

  it('rejects empty and whitespace-only titles', () => {
    expect(validateNote('', 'x').title).toBe('A title is required.');
    expect(validateNote(' \n\t ', 'x').title).toBe('A title is required.');
  });

  it('title limit is inclusive and counts characters, not bytes or UTF-16 units', () => {
    expect(validateNote('é'.repeat(MAX_TITLE_CHARS), '')).toEqual({});
    expect(validateNote('é'.repeat(MAX_TITLE_CHARS + 1), '').title).toMatch(/at most 200/);
    // Astral characters are 2 UTF-16 units but 1 code point.
    expect(validateNote('🔦'.repeat(MAX_TITLE_CHARS), '')).toEqual({});
    expect(validateNote('🔦'.repeat(MAX_TITLE_CHARS + 1), '').title).toMatch(/at most 200/);
  });

  it('trims the title before measuring it', () => {
    expect(validateNote(`  ${'a'.repeat(MAX_TITLE_CHARS)}  `, '')).toEqual({});
  });

  it.each(['a\0b', 'a\nb', 'a\tb', 'a\u007fb', 'a\u001b[31mb'])(
    'rejects control characters in the title: %j',
    (bad) => {
      expect(validateNote(bad, '').title).toMatch(/control characters/);
    },
  );

  it('body limit is inclusive and measured in UTF-8 bytes', () => {
    expect(validateNote('t', 'a'.repeat(MAX_BODY_BYTES))).toEqual({});
    expect(validateNote('t', 'a'.repeat(MAX_BODY_BYTES + 1)).body).toMatch(/at most 100,000 bytes/);
    // 3 bytes per character: 33,334 characters is 100,002 bytes.
    expect(validateNote('t', '€'.repeat(33_334)).body).toMatch(/bytes/);
  });

  it.each(['a\0b', 'a\u0007b', 'a\u001bb', 'a\u007fb', 'a\u0085b'])(
    'rejects control characters other than newline, carriage return and tab in the body: %j',
    (bad) => {
      expect(validateNote('t', bad).body).toMatch(/control characters/);
    },
  );

  it('treats markup and SQL as ordinary text', () => {
    expect(validateNote('t', "<script>alert(1)</script> ' OR 1=1; DROP TABLE notes; --")).toEqual(
      {},
    );
  });

  it('reports title and body problems together', () => {
    const errors = validateNote('', 'bad\0');
    expect(errors.title).toBeDefined();
    expect(errors.body).toBeDefined();
  });
});

describe('counting helpers', () => {
  it('counts code points and UTF-8 bytes', () => {
    expect(countCodePoints('a🔦é')).toBe(3);
    expect(countUtf8Bytes('a🔦é')).toBe(1 + 4 + 2);
    expect(countUtf8Bytes('')).toBe(0);
  });
});
