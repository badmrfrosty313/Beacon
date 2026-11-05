/** Shapes returned by the Rust backend. Keep in sync with src-tauri/src/{notes,state}.rs. */

export interface NoteSummary {
  id: number;
  title: string;
  /** ISO-8601 UTC timestamp, e.g. 2026-11-02T16:45:10.123Z */
  createdAt: string;
}

export interface Note extends NoteSummary {
  body: string;
}

export interface NewNote {
  title: string;
  body: string;
}

/** Metadata for a preserved Markdown or text original (the body is never in list payloads). */
export interface DocumentSummary {
  id: number;
  title: string;
  originalName: string;
  format: string;
  sha256: string;
  byteLength: number;
  importedAt: string;
}

export interface Document extends DocumentSummary {
  body: string;
}

export interface ImportDocument {
  name: string;
  bytes: number[];
}

export interface SearchHit {
  id: number;
  title: string;
  format: string;
  snippet: string;
  importedAt: string;
}

export interface AppInfo {
  appVersion: string;
  dataDir: string;
  /** null when the database could not be opened */
  schemaVersion: number | null;
  databaseError: string | null;
}

/** Read-only Scripture reference data. Mirrors src-tauri/src/scripture/mod.rs. */

export interface TranslationInfo {
  id: string;
  /** Short identifier shown next to every passage, e.g. "WEB". */
  abbreviation: string;
  name: string;
  edition: string;
  language: string;
  licenseStatus: string;
  licenseNotice: string;
  sourceUrl: string;
  sourceSha256: string;
  retrievedOn: string;
  verseCount: number;
}

export interface BookSummary {
  /** USFM book id, e.g. "REV" or "1JN". */
  id: string;
  name: string;
  /** Name used in citations; differs from `name` for Psalms ("Psalm"). */
  citationName: string;
  testament: 'OT' | 'NT';
  order: number;
  chapterCount: number;
}

export interface ScriptureOverview {
  translation: TranslationInfo;
  books: BookSummary[];
}

export interface ScriptureVerse {
  chapter: number;
  verse: number;
  /** Empty only for verses the source provides as a number plus a footnote. */
  text: string;
}

export interface PassageChapter {
  chapter: number;
  verseCount: number;
  /** Psalm title, shown separately from the numbered verses; "" when there is none. */
  superscription: string;
}

export interface NavTarget {
  bookId: string;
  bookName: string;
  chapter: number;
  label: string;
}

export interface ScripturePassage {
  translationId: string;
  translationAbbreviation: string;
  bookId: string;
  bookName: string;
  citationName: string;
  bookChapterCount: number;
  /** Canonical, re-parseable citation, e.g. "Revelation 13:16-18". */
  canonical: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  verses: ScriptureVerse[];
  /** One entry per chapter the passage touches. */
  chapters: PassageChapter[];
  previous: NavTarget | null;
  next: NavTarget | null;
}

export interface ReferenceProblem {
  code: string;
  message: string;
}

/** An unusable reference is an expected outcome, reported as data rather than an error. */
export type LookupResult =
  | { ok: true; passage: ScripturePassage }
  | { ok: false; problem: ReferenceProblem };

/** Watchtower: private, local research records. Mirrors src-tauri/src/watchtower/mod.rs. */

export type DatePrecision = 'year' | 'month' | 'day' | 'minute';
export const CLAIM_KINDS = [
  'observation',
  'attributed_claim',
  'interpretation',
  'forecast',
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export const HYPOTHESIS_STATUSES = ['open', 'under_review', 'set_aside'] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];
export const LINK_RELATIONS = ['supports', 'contradicts', 'context'] as const;
export type LinkRelation = (typeof LINK_RELATIONS)[number];

export interface ResearchEvent {
  id: number;
  title: string;
  description: string | null;
  /** When the event happened, as the user stated it. `null` means undated; never defaulted. */
  eventDate: string | null;
  datePrecision: DatePrecision | null;
  /** Ordering key only: minutes since 1970-01-01T00:00Z at the start of the stated period. */
  eventSort: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSource {
  id: number;
  title: string;
  author: string | null;
  publisher: string | null;
  /** Stored as data only; never fetched. A URL alone is not an offline copy. */
  url: string | null;
  publishedDate: string | null;
  retrievedDate: string | null;
  /** An Archive document the user preserved locally (distinct from the URL). */
  documentId: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchClaim {
  id: number;
  eventId: number;
  sourceId: number | null;
  kind: ClaimKind;
  text: string;
  attribution: string | null;
  scriptureReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchHypothesis {
  id: number;
  title: string;
  statement: string;
  status: HypothesisStatus;
  scriptureReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceLink {
  id: number;
  hypothesisId: number;
  relation: LinkRelation;
  claimId: number | null;
  sourceId: number | null;
  /** Only for source-only evidence; a claim already belongs to one event. */
  eventId: number | null;
  explanation: string;
  createdAt: string;
}

export interface WatchtowerSnapshot {
  events: ResearchEvent[];
  sources: ResearchSource[];
  claims: ResearchClaim[];
  hypotheses: ResearchHypothesis[];
  links: EvidenceLink[];
}

export interface EventInput {
  title: string;
  description?: string | null;
  eventDate?: string | null;
}

export interface SourceInput {
  title: string;
  author?: string | null;
  publisher?: string | null;
  url?: string | null;
  publishedDate?: string | null;
  retrievedDate?: string | null;
  documentId?: number | null;
  note?: string | null;
}

export interface ClaimInput {
  eventId: number;
  sourceId?: number | null;
  kind: ClaimKind;
  text: string;
  attribution?: string | null;
  scriptureReference?: string | null;
}

export interface HypothesisInput {
  title: string;
  statement: string;
  status?: HypothesisStatus;
  scriptureReference?: string | null;
}

export interface LinkInput {
  hypothesisId: number;
  relation: LinkRelation;
  claimId?: number | null;
  sourceId?: number | null;
  eventId?: number | null;
  explanation: string;
}

export type ApiErrorCode =
  | 'validation'
  | 'not_found'
  | 'database'
  | 'io'
  | 'migration'
  | 'unavailable'
  | 'internal'
  | 'integrity'
  /** The same bytes were already imported; nothing was changed (or a lost original restored). */
  | 'duplicate'
  /** The packaged Scripture text could not be installed or verified; notes are unaffected. */
  | 'scripture_unavailable'
  /** The page is running outside the Tauri desktop shell (e.g. a plain browser). */
  | 'backend_unavailable'
  | 'unknown';

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * Private research import (B-014/B-015). Mirrors src-tauri/src/research/mod.rs. Everything here
 * is private to this device; there is no publish, sync or upload path.
 */
export interface ResearchCollection {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  documentCount: number;
}

export type ImportedFormat = 'pdf' | 'md' | 'txt';

export interface ImportedSummary {
  id: number;
  collectionId: number;
  title: string;
  /** The file name as chosen. Display only; stored originals are named by hash. */
  originalName: string;
  format: ImportedFormat;
  sha256: string;
  byteLength: number;
  pageCount: number | null;
  /** True when the extracted text was cut at a safety limit. */
  textTruncated: boolean;
  extractionMethod: string;
  author: string | null;
  publisher: string | null;
  /** The document's own authored/published date, never the import time. */
  publishedDate: string | null;
  importedAt: string;
  updatedAt: string;
}

export interface ImportedDocument extends ImportedSummary {
  attributionNote: string | null;
  /** Redistribution/rights notes, kept apart from private-use permission. */
  rightsNote: string | null;
  /** Derivative text for reading and search; the preserved original is the source. */
  body: string;
}

export interface ImportedHit {
  id: number;
  collectionId: number;
  title: string;
  format: ImportedFormat;
  snippet: string;
  importedAt: string;
}

export interface ImportedSourceLink {
  id: number;
  researchDocumentId: number;
  sourceId: number;
  createdAt: string;
}

export interface ImportedExcerpt {
  id: number;
  researchDocumentId: number;
  claimId: number;
  location: string | null;
  createdAt: string;
}

export interface ImportedLinks {
  sourceLinks: ImportedSourceLink[];
  excerpts: ImportedExcerpt[];
}

export interface DuplicateMatch {
  id: number;
  title: string;
}

export interface DuplicateCheck {
  research: DuplicateMatch | null;
  archive: DuplicateMatch | null;
}

export interface CollectionInput {
  name: string;
  description?: string | null;
}

export interface ResearchMetadata {
  title: string;
  author?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  attributionNote?: string | null;
  rightsNote?: string | null;
}

export interface ResearchMetadataUpdate extends ResearchMetadata {
  collectionId: number;
}

export interface ResearchImportInput extends Partial<ResearchMetadata> {
  name: string;
  bytes: Uint8Array;
  collectionId: number;
  /** PDF only: text extracted locally by the app. Ignored for .md/.txt. */
  extractedText?: string;
  extractionMethod?: string;
  pageCount?: number;
  textTruncated?: boolean;
}
