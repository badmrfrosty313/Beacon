import { describe, expect, it } from 'vitest';

import {
  MAX_DOCUMENT_BYTES,
  validateContent,
  validateDocument,
  validateFilename,
} from './documentValidation';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));

describe('file import validation', () => {
  it('accepts UTF-8 Markdown and preserves line breaks as text', () => {
    expect(validateDocument('My Report.MD', bytes('# Hello\r\nβeta'))).toEqual({
      title: 'My Report',
      format: 'md',
      body: '# Hello\r\nβeta',
    });
  });

  it('accepts a UTF-8 byte-order mark but removes it from the decoded text', () => {
    expect(validateContent([0xef, 0xbb, 0xbf, 0x68, 0x69])).toBe('hi');
  });

  it.each([
    '../../outside.md',
    '..\\outside.md',
    'dir/file.txt',
    'C:\\secret.txt',
    'C:file.txt',
    'evil.html',
    'evil.pdf',
    'noextension',
    '.md',
    '..',
    '',
    'x\0.txt',
    'tab\there.md',
    'new\nline.md',
    'evil\u202Etxt.md',
    'zero\u200Bwidth.md',
    `${'a'.repeat(300)}.md`,
  ])('rejects unsafe or unsupported filename %j', (name) => {
    expect(() => validateFilename(name)).toThrow();
  });

  it('enforces the 200-character title limit', () => {
    expect(() => validateFilename(`${'a'.repeat(201)}.md`)).toThrow(/1–200/);
    expect(validateFilename(`${'a'.repeat(200)}.md`).title).toHaveLength(200);
  });

  it('rejects invalid UTF-8, control bytes, empty and oversized input', () => {
    expect(() => validateDocument('bad.txt', [255])).toThrow(/UTF-8/);
    expect(() => validateDocument('bad.md', [0])).toThrow(/control/);
    expect(() => validateDocument('bad.md', bytes('c1\u0085control'))).toThrow(/control/);
    expect(() => validateDocument('empty.txt', [])).toThrow(/empty/);
    expect(() => validateDocument('huge.txt', Array(MAX_DOCUMENT_BYTES + 1).fill(65))).toThrow(
      /MiB/,
    );
    expect(validateContent(new Uint8Array(MAX_DOCUMENT_BYTES).fill(65))).toHaveLength(
      MAX_DOCUMENT_BYTES,
    );
  });

  it('allows tabs and both newline styles', () => {
    expect(validateContent(bytes('a\tb\r\nc\nd'))).toBe('a\tb\r\nc\nd');
  });

  it('does not interpret imported HTML', () => {
    const text = '<script>alert("x")</script>';
    expect(validateDocument('raw.md', bytes(text)).body).toBe(text);
  });
});
