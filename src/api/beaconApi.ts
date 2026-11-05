import type {
  AppInfo,
  ClaimInput,
  EventInput,
  EvidenceLink,
  HypothesisInput,
  LinkInput,
  ResearchClaim,
  ResearchEvent,
  ResearchHypothesis,
  ResearchSource,
  SourceInput,
  WatchtowerSnapshot,
  CollectionInput,
  DuplicateCheck,
  ImportedDocument,
  ImportedExcerpt,
  ImportedHit,
  ImportedLinks,
  ImportedSourceLink,
  ImportedSummary,
  ResearchCollection,
  ResearchImportInput,
  ResearchMetadataUpdate,
  Document,
  DocumentSummary,
  ImportDocument,
  LookupResult,
  NewNote,
  Note,
  NoteSummary,
  ScriptureOverview,
  ScripturePassage,
  SearchHit,
} from './types';

/**
 * Everything the UI may ask of the backend. Components depend on this interface only, never on
 * Tauri, so they can be tested with an in-memory fake and the storage layer can change freely.
 */
export interface BeaconApi {
  getAppInfo(): Promise<AppInfo>;
  listNotes(): Promise<NoteSummary[]>;
  getNote(id: number): Promise<Note>;
  createNote(input: NewNote): Promise<Note>;
  importDocument(input: ImportDocument): Promise<Document>;
  listDocuments(): Promise<DocumentSummary[]>;
  getDocument(id: number): Promise<Document>;
  searchDocuments(query: string): Promise<SearchHit[]>;
  /** Translation details and the list of books. Read-only reference data. */
  getScriptureOverview(): Promise<ScriptureOverview>;
  /** Resolve a typed reference such as "Rev 13:16-18". Bad input yields `{ ok: false }`. */
  lookupScripture(input: string): Promise<LookupResult>;
  /** A whole chapter by book id ("REV") and chapter number. Rejects with `not_found` if absent. */
  getScriptureChapter(bookId: string, chapter: number): Promise<ScripturePassage>;

  // Watchtower: private local research records. Reads return everything in one consistent
  // snapshot; the UI derives the timeline and detail views from it. There is no delete in
  // v0.1, and claims and evidence links are append-only.
  getWatchtower(): Promise<WatchtowerSnapshot>;
  createEvent(input: EventInput): Promise<ResearchEvent>;
  updateEvent(id: number, input: EventInput): Promise<ResearchEvent>;
  createSource(input: SourceInput): Promise<ResearchSource>;
  updateSource(id: number, input: SourceInput): Promise<ResearchSource>;
  createClaim(input: ClaimInput): Promise<ResearchClaim>;
  createHypothesis(input: HypothesisInput): Promise<ResearchHypothesis>;
  updateHypothesis(id: number, input: HypothesisInput): Promise<ResearchHypothesis>;
  createEvidenceLink(input: LinkInput): Promise<EvidenceLink>;

  // Private research import. Originals are preserved byte for byte; extracted text is derivative.
  // Nothing here publishes, syncs or uploads. Importing the same bytes twice rejects with
  // `duplicate` and changes nothing.
  listResearchCollections(): Promise<ResearchCollection[]>;
  createResearchCollection(input: CollectionInput): Promise<ResearchCollection>;
  checkResearchDuplicate(sha256: string): Promise<DuplicateCheck>;
  importResearch(input: ResearchImportInput): Promise<ImportedDocument>;
  listResearch(collectionId?: number): Promise<ImportedSummary[]>;
  /** Re-verifies the preserved original; rejects with `integrity` if it changed or vanished. */
  getResearch(id: number): Promise<ImportedDocument>;
  searchResearch(query: string, collectionId?: number): Promise<ImportedHit[]>;
  updateResearchMetadata(id: number, input: ResearchMetadataUpdate): Promise<ImportedSummary>;
  getResearchLinks(): Promise<ImportedLinks>;
  linkResearchSource(documentId: number, sourceId: number): Promise<ImportedSourceLink>;
  linkResearchExcerpt(
    documentId: number,
    claimId: number,
    location?: string,
  ): Promise<ImportedExcerpt>;
}
