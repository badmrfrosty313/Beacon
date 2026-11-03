import { describe, expect, it } from 'vitest';
import { validateDocument, MAX_DOCUMENT_BYTES } from './documentValidation';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));

describe('file import validation', () => {
  it('accepts UTF-8 Markdown and preserves line breaks as text', () => {
    expect(validateDocument('My Report.MD', bytes('# Hello\r\nβeta'))).toEqual({
      title: 'My Report',
      format: 'md',
      body: '# Hello\r\nβeta',
    });
  });

  it.each(['../../outside.md', 'C:\\secret.txt', 'evil.html', '.md', 'x\0.txt'])(
    'rejects unsafe or unsupported filename %s', (name) => {
      expect(() => validateDocument(name, bytes('safe'))).toThrow();
    },
  );

  it('rejects invalid UTF-8, control bytes and oversized input', () => {
    expect(() => validateDocument('bad.txt', [255])).toThrow(/UTF-8/);
    expect(() => validateDocument('bad.md', [0])).toThrow(/control/);
    expect(() => validateDocument('huge.txt', Array(MAX_DOCUMENT_BYTES + 1).fill(65))).toThrow(/MiB/);
  });

  it('does not interpret imported HTML', () => {
    const text = '<script>alert("x")</script>';
    expect(validateDocument('raw.md', bytes(text)).body).toBe(text);
  });
});
