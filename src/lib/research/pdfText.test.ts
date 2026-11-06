// @vitest-environment node
//
// Real pdf.js extraction against invented, hand-built PDFs. Runs in Node because pdf.js's
// browser-only dependencies are not worth faking; the code under test is environment-neutral.
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api/types';
import { buildSyntheticPdf } from '../../test/syntheticPdf';
import { extractPdfText } from './pdfText';
import { prepareFile } from './prepare';

vi.setConfig({ testTimeout: 60000 });

describe('local PDF text extraction (pdf.js, offline)', () => {
  it('reads the text layer page by page and reports the page count', async () => {
    const pdf = buildSyntheticPdf({
      pages: [['Invented comet ledger', 'Second line'], ['Page two zebrafish']],
    });
    const result = await extractPdfText(pdf);
    expect(result.pageCount).toBe(2);
    expect(result.method).toBe('pdfjs-text-layer');
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('Invented comet ledger');
    expect(result.text).toContain('Page two zebrafish');
  });

  it('does not run PDF JavaScript or follow links, and still reads the text', async () => {
    const pdf = buildSyntheticPdf({
      pages: [['Harmless synthetic text']],
      javascript: true,
      link: true,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const result = await extractPdfText(pdf);
      expect(result.text).toContain('Harmless synthetic text');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects a corrupt PDF with a plain message', async () => {
    const corrupt = new TextEncoder().encode('%PDF-1.4\nthis is not a real pdf body');
    await expect(extractPdfText(corrupt)).rejects.toBeInstanceOf(ApiError);
  });

  it('prepareFile hashes the original and rejects a PDF with no text layer', async () => {
    const withText = buildSyntheticPdf({ pages: [['Some invented words']] });
    const prepared = await prepareFile('synthetic.pdf', withText);
    expect(prepared.format).toBe('pdf');
    expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.limitations.join(' ')).toMatch(/OCR/);

    const empty = buildSyntheticPdf({ pages: [[]] });
    await expect(prepareFile('blank.pdf', empty)).rejects.toThrow(/No text could be read/);
  });
});
