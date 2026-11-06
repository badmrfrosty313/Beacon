/**
 * SEED table descriptions: the TypeScript mirror of the `TABLES` list in src-tauri/src/seed/mod.rs.
 * Column names are the SQLite names (snake_case); that is the package's wire format. The browser
 * demo's IndexedDB records use camelCase, converted by `camelOf`.
 */

export interface TableSpec {
  readonly name: string;
  /** IndexedDB store holding this table in the browser demo. */
  readonly store: string;
  readonly cols: readonly string[];
  readonly fks: readonly (readonly [column: string, parent: string])[];
  readonly keyCols: readonly string[];
  readonly keyFks: readonly string[];
  readonly lower: readonly string[];
  /** Columns restricted to a fixed set of values (the SQLite CHECK constraints). */
  readonly enums: Readonly<Record<string, readonly string[]>>;
  /** NOT NULL columns (IndexedDB has no such constraint, so imports are checked here). */
  readonly required: readonly string[];
  /** Integer columns; every other column is text. */
  readonly ints: readonly string[];
}

export const TABLES: readonly TableSpec[] = [
  {
    name: 'notes',
    store: 'notes',
    cols: ['title', 'body', 'created_at'],
    fks: [],
    keyCols: ['title', 'body', 'created_at'],
    keyFks: [],
    lower: [],
    enums: {},
    required: ['title', 'body', 'created_at'],
    ints: [],
  },
  {
    name: 'documents',
    store: 'documents',
    cols: ['title', 'original_name', 'format', 'sha256', 'byte_length', 'content', 'imported_at'],
    fks: [],
    keyCols: ['sha256'],
    keyFks: [],
    lower: [],
    enums: { format: ['md', 'txt'] },
    required: [
      'title',
      'original_name',
      'format',
      'sha256',
      'byte_length',
      'content',
      'imported_at',
    ],
    ints: ['byte_length'],
  },
  {
    name: 'research_collections',
    store: 'rs_collections',
    cols: ['name', 'description', 'created_at'],
    fks: [],
    keyCols: ['name'],
    keyFks: [],
    lower: ['name'],
    enums: {},
    required: ['name', 'created_at'],
    ints: [],
  },
  {
    name: 'research_documents',
    store: 'rs_documents',
    cols: [
      'collection_id',
      'title',
      'original_name',
      'format',
      'sha256',
      'byte_length',
      'content',
      'extraction_method',
      'page_count',
      'text_truncated',
      'author',
      'publisher',
      'published_date',
      'attribution_note',
      'rights_note',
      'visibility',
      'imported_at',
      'updated_at',
    ],
    fks: [['collection_id', 'research_collections']],
    keyCols: ['sha256'],
    keyFks: [],
    lower: [],
    enums: { format: ['md', 'txt', 'pdf'], visibility: ['private'] },
    required: [
      'collection_id',
      'title',
      'original_name',
      'format',
      'sha256',
      'byte_length',
      'content',
      'extraction_method',
      'text_truncated',
      'visibility',
      'imported_at',
      'updated_at',
    ],
    ints: ['collection_id', 'byte_length', 'page_count', 'text_truncated'],
  },
  {
    name: 'watchtower_events',
    store: 'wt_events',
    cols: [
      'title',
      'description',
      'event_date',
      'date_precision',
      'event_sort',
      'created_at',
      'updated_at',
    ],
    fks: [],
    keyCols: ['title', 'description', 'event_date', 'date_precision', 'created_at'],
    keyFks: [],
    lower: [],
    enums: { date_precision: ['year', 'month', 'day', 'minute'] },
    required: ['title', 'created_at', 'updated_at'],
    ints: ['event_sort'],
  },
  {
    name: 'watchtower_sources',
    store: 'wt_sources',
    cols: [
      'title',
      'author',
      'publisher',
      'url',
      'published_date',
      'retrieved_date',
      'document_id',
      'note',
      'created_at',
      'updated_at',
    ],
    fks: [['document_id', 'documents']],
    keyCols: [
      'title',
      'author',
      'publisher',
      'url',
      'published_date',
      'retrieved_date',
      'created_at',
    ],
    keyFks: ['document_id'],
    lower: [],
    enums: {},
    required: ['title', 'created_at', 'updated_at'],
    ints: ['document_id'],
  },
  {
    name: 'watchtower_claims',
    store: 'wt_claims',
    cols: [
      'event_id',
      'source_id',
      'kind',
      'text',
      'attribution',
      'scripture_reference',
      'created_at',
      'updated_at',
    ],
    fks: [
      ['event_id', 'watchtower_events'],
      ['source_id', 'watchtower_sources'],
    ],
    keyCols: ['kind', 'text', 'attribution', 'created_at'],
    keyFks: ['event_id', 'source_id'],
    lower: [],
    enums: { kind: ['observation', 'attributed_claim', 'interpretation', 'forecast'] },
    required: ['event_id', 'kind', 'text', 'created_at', 'updated_at'],
    ints: ['event_id', 'source_id'],
  },
  {
    name: 'watchtower_hypotheses',
    store: 'wt_hypotheses',
    cols: ['title', 'statement', 'status', 'scripture_reference', 'created_at', 'updated_at'],
    fks: [],
    keyCols: ['title', 'statement', 'created_at'],
    keyFks: [],
    lower: [],
    enums: { status: ['open', 'under_review', 'set_aside'] },
    required: ['title', 'statement', 'status', 'created_at', 'updated_at'],
    ints: [],
  },
  {
    name: 'watchtower_links',
    store: 'wt_links',
    cols: [
      'hypothesis_id',
      'relation',
      'claim_id',
      'source_id',
      'event_id',
      'explanation',
      'created_at',
    ],
    fks: [
      ['hypothesis_id', 'watchtower_hypotheses'],
      ['claim_id', 'watchtower_claims'],
      ['source_id', 'watchtower_sources'],
      ['event_id', 'watchtower_events'],
    ],
    keyCols: ['relation'],
    keyFks: ['hypothesis_id', 'claim_id', 'source_id', 'event_id'],
    lower: [],
    enums: { relation: ['supports', 'contradicts', 'context'] },
    required: ['hypothesis_id', 'relation', 'explanation', 'created_at'],
    ints: ['hypothesis_id', 'claim_id', 'source_id', 'event_id'],
  },
  {
    name: 'research_source_links',
    store: 'rs_source_links',
    cols: ['research_document_id', 'source_id', 'created_at'],
    fks: [
      ['research_document_id', 'research_documents'],
      ['source_id', 'watchtower_sources'],
    ],
    keyCols: [],
    keyFks: ['research_document_id', 'source_id'],
    lower: [],
    enums: {},
    required: ['research_document_id', 'source_id', 'created_at'],
    ints: ['research_document_id', 'source_id'],
  },
  {
    name: 'research_excerpts',
    store: 'rs_excerpts',
    cols: ['research_document_id', 'claim_id', 'location', 'created_at'],
    fks: [
      ['research_document_id', 'research_documents'],
      ['claim_id', 'watchtower_claims'],
    ],
    keyCols: [],
    // claim_id is unique, so the claim alone identifies the excerpt.
    keyFks: ['claim_id'],
    lower: [],
    enums: {},
    required: ['research_document_id', 'claim_id', 'created_at'],
    ints: ['research_document_id', 'claim_id'],
  },
];

export function tableIndex(name: string): number {
  return TABLES.findIndex((table) => table.name === name);
}

export function camelOf(column: string): string {
  return column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
