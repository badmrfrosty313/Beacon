/**
 * Turns a chosen file into a reviewable preview BEFORE anything is stored: validates it, hashes
 * the exact bytes, and extracts text locally (PDF text layer; UTF-8 for .md/.txt).
 */
import { ApiError, type ImportedFormat } from '../../api/types';
import { validateContent } from '../documentValidation';
import { sha256Hex } from '../sha256';
import { extractPdfText, type PdfExtractor } from './pdfText';
import {
  MAX_ORIGINAL_BYTES,
  validateExtractedText,
  validateFilename,
  validatePdfHeader,
} from './validation';

export interface PreparedFile {
  name: string;
  bytes: Uint8Array;
  format: ImportedFormat;
  /** Title derived from the file name; the person may change it. */
  defaultTitle: string;
  sha256: string;
  byteLength: number;
  /** Extracted (derivative) text, shown in the preview and stored beside the original. */
  text: string;
  method: string;
  pageCount: number | null;
  truncated: boolean;
  /** Plain-language limits of this extraction, always shown with the preview. */
  limitations: string[];
}

export const PDF_LIMITATIONS = [
  'Text was read from the PDF’s text layer only. There is no OCR, so scanned images are not read.',
  'Reading order, columns, tables, footnotes and unusual fonts may be extracted imperfectly.',
  'PDF scripts and links are never run or followed. The original PDF is kept unchanged.',
];

export const TEXT_LIMITATIONS = [
  'The text is decoded from the file as UTF-8 and shown exactly as stored. The original file is kept unchanged.',
];

export async function prepareFile(
  name: string,
  bytes: Uint8Array,
  extractPdf: PdfExtractor = extractPdfText,
): Promise<PreparedFile> {
  const { title, format } = validateFilename(name);
  if (bytes.length > MAX_ORIGINAL_BYTES) {
    throw new ApiError('validation', 'The file is too large. PDFs can be at most 20 MiB.');
  }
  const base = { name, bytes, format, defaultTitle: title, byteLength: bytes.length };
  if (format === 'pdf') {
    validatePdfHeader(bytes);
    const extracted = await extractPdf(bytes);
    validateExtractedText(extracted.text);
    return {
      ...base,
      sha256: sha256Hex(bytes),
      text: extracted.text,
      method: extracted.method,
      pageCount: extracted.pageCount,
      truncated: extracted.truncated,
      limitations: [
        ...PDF_LIMITATIONS,
        ...(extracted.truncated
          ? ['The text was cut at the size limit; the rest is not searchable.']
          : []),
      ],
    };
  }
  return {
    ...base,
    sha256: sha256Hex(bytes),
    text: validateContent(bytes),
    method: 'utf8-text',
    pageCount: null,
    truncated: false,
    limitations: TEXT_LIMITATIONS,
  };
}
