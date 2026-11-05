import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from '../base64';
import {
  validateCollectionName,
  validateExtractedText,
  validateExtractionMethod,
  validateFilename,
  validateLocation,
  validatePageCount,
  validatePdfHeader,
  validateSha256,
} from './validation';

describe('research filename validation', () => {
  it('accepts pdf, md and txt and derives title and format', () => {
    expect(validateFilename('Synthetic Report.PDF')).toEqual({
      title: 'Synthetic Report',
      format: 'pdf',
    });
    expect(validateFilename('notes.v2.md')).toEqual({ title: 'notes.v2', format: 'md' });
    expect(validateFilename('a.txt').format).toBe('txt');
  });

  it('rejects traversal, separators, drive prefixes, controls and wrong types', () => {
    const hostile = [
      '',
      '.',
      '..',
      '.pdf',
      '   .txt',
      '../escape.pdf',
      '..\\escape.pdf',
      'dir/file.pdf',
      'C:\\secret.pdf',
      'C:file.pdf',
      'macro.docx',
      'evil.exe',
      'noextension',
      'tab\there.md',
      'bidi\u202Egpj.pdf',
      'zero\u200Bwidth.md',
      `${'a'.repeat(300)}.pdf`,
    ];
    for (const name of hostile) {
      expect(() => validateFilename(name), JSON.stringify(name)).toThrow();
    }
  });

  it('allows unusual but harmless Unicode names', () => {
    expect(validateFilename('Résumé — 研究 ✓.md').format).toBe('md');
  });
});

describe('research field validation', () => {
  it('requires the PDF signature near the start', () => {
    expect(() => validatePdfHeader(new TextEncoder().encode('%PDF-1.7\n'))).not.toThrow();
    expect(() => validatePdfHeader(new TextEncoder().encode('GIF89a%PDF-'))).not.toThrow();
    expect(() => validatePdfHeader(new TextEncoder().encode('<html></html>'))).toThrow();
    expect(() => validatePdfHeader(new Uint8Array())).toThrow();
  });

  it('rejects empty, oversized and control-laden extracted text with helpful wording', () => {
    expect(() => validateExtractedText('  \n ')).toThrow(/OCR/);
    expect(() => validateExtractedText('x'.repeat(3_000_001))).toThrow();
    expect(() => validateExtractedText('bad \u0000 text')).toThrow();
    expect(() => validateExtractedText('fine\ttext\nwith lines')).not.toThrow();
  });

  it('validates method labels, page counts, names, locations and hashes', () => {
    expect(() => validateExtractionMethod('pdfjs-text-layer')).not.toThrow();
    expect(() => validateExtractionMethod('<script>')).toThrow();
    expect(() => validatePageCount(0)).toThrow();
    expect(() => validatePageCount(100_001)).toThrow();
    expect(() => validatePageCount(1.5)).toThrow();
    expect(validateCollectionName('  Convergence research ')).toBe('Convergence research');
    expect(() => validateCollectionName('a\nb')).toThrow();
    expect(validateLocation('  page 2 ')).toBe('page 2');
    expect(validateLocation('  ')).toBeNull();
    expect(() => validateLocation('x'.repeat(101))).toThrow();
    expect(() => validateSha256('A'.repeat(64))).toThrow();
    expect(() => validateSha256('a'.repeat(64))).not.toThrow();
  });
});

describe('base64 for IPC', () => {
  it('matches RFC 4648 vectors', () => {
    const enc = (s: string) => bytesToBase64(new TextEncoder().encode(s));
    expect([
      enc(''),
      enc('f'),
      enc('fo'),
      enc('foo'),
      enc('foob'),
      enc('fooba'),
      enc('foobar'),
    ]).toEqual(['', 'Zg==', 'Zm8=', 'Zm9v', 'Zm9vYg==', 'Zm9vYmE=', 'Zm9vYmFy']);
  });

  it('encodes every byte value and large inputs identically to Node', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToBase64(all)).toBe(Buffer.from(all).toString('base64'));
    const big = new Uint8Array(200_003).map((_, i) => (i * 31) & 255);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'));
  });
});
