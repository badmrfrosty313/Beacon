/**
 * Local PDF text extraction (B-015). Runs entirely inside the app:
 *  - pdf.js is imported lazily, so it is only loaded when a PDF is chosen;
 *  - the PDF worker module is imported and run on the main thread (no Worker URL, no network);
 *  - `isEvalSupported: false`, no XFA, no scripting, no streaming/range fetching: embedded
 *    JavaScript and external links are never executed or followed;
 *  - we read only the text layer. There is no OCR, so scanned PDFs yield no text and are
 *    rejected by the caller with an explanation;
 *  - encrypted or malformed files are rejected with a plain-language message.
 * The extracted text is derivative; the original bytes are preserved separately.
 */
import { ApiError } from '../../api/types';
import { MAX_EXTRACTED_CHARS, MAX_PAGES } from './validation';

export interface PdfText {
  text: string;
  pageCount: number;
  /** True when extraction stopped at the safety limit for text size. */
  truncated: boolean;
  method: string;
}

export type PdfExtractor = (bytes: Uint8Array) => Promise<PdfText>;

export const PDF_EXTRACTION_METHOD = 'pdfjs-text-layer';

interface TextItem {
  str?: string;
  hasEOL?: boolean;
}
interface PdfPage {
  getTextContent(): Promise<{ items: TextItem[] }>;
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfJs {
  getDocument(options: Record<string, unknown>): {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  };
}

const CONTROL_EXCEPT_WHITESPACE = /[^\P{Cc}\t\n\r]/gu;

function friendly(error: unknown): ApiError {
  const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : '';
  if (name === 'PasswordException') {
    return new ApiError(
      'validation',
      'This PDF is password-protected or encrypted. BEACON cannot open it.',
    );
  }
  return new ApiError(
    'validation',
    'This PDF could not be read. It may be damaged, or not a valid PDF.',
  );
}

export const extractPdfText: PdfExtractor = async (bytes) => {
  let pdfjs: PdfJs;
  try {
    pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
    // Providing the worker's message handler up front makes pdf.js run it on this thread.
    const worker: unknown = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  } catch {
    throw new ApiError('unavailable', 'The PDF reader could not be loaded.');
  }

  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const task = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    stopAtErrors: false,
    verbosity: 0,
  });

  try {
    const doc = await task.promise;
    const pageCount = doc.numPages;
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
      throw new ApiError('validation', 'This PDF has no readable pages, or too many pages.');
    }
    const pages: string[] = [];
    let length = 0;
    let truncated = false;
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str;
        if (item.hasEOL === true) text += '\n';
      }
      page.cleanup();
      text = text.replace(CONTROL_EXCEPT_WHITESPACE, ' ').trim();
      if (text === '') continue;
      if (length + text.length > MAX_EXTRACTED_CHARS) {
        pages.push(
          Array.from(text)
            .slice(0, Math.max(0, MAX_EXTRACTED_CHARS - length))
            .join(''),
        );
        truncated = true;
        break;
      }
      pages.push(text);
      length += text.length + 2;
    }
    return { text: pages.join('\n\n'), pageCount, truncated, method: PDF_EXTRACTION_METHOD };
  } catch (error) {
    throw error instanceof ApiError ? error : friendly(error);
  } finally {
    await task.destroy().catch(() => undefined);
  }
};
