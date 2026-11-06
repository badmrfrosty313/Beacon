import type { BeaconApi } from './beaconApi';
import type { RunTransaction } from './browserWatchtower';
import { ApiError, type SeedPreview, type SeedTableCount } from './types';
import { sha256Hex } from '../lib/sha256';
import {
  DOC_DIR,
  MAX_ROWS,
  RECORDS_PATH,
  RESEARCH_DIR,
  SENSITIVITY_WARNING,
  SeedFormatError,
  buildPackage,
  identitiesOf,
  parsePackage,
  type CellValue,
  type Entry,
  type ParsedPackage,
  type SeedRow,
} from '../lib/seed/format';
import { TABLES, camelOf, tableIndex, type TableSpec } from '../lib/seed/spec';

/** Database schema the package format corresponds to (see ADR-017). */
const SCHEMA_VERSION = 5;
const STORES = TABLES.map((table) => table.store);
const DOCUMENTS = tableIndex('documents');
const RESEARCH_DOCUMENTS = tableIndex('research_documents');

type SeedApi = Pick<BeaconApi, 'exportSeed' | 'inspectSeed' | 'restoreSeed'>;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

// instanceof is unreliable across realms (jsdom, structured clones); the tag is not.
const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  Object.prototype.toString.call(value) === '[object ArrayBuffer]';

function bad(message: string): never {
  throw new ApiError('validation', message);
}

/** Convert package-format failures into the API's `validation` error; pass others through. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SeedFormatError) throw new ApiError('validation', error.message);
    throw error;
  }
}

function cell(value: unknown): CellValue {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  return null;
}

/** IndexedDB record (camelCase) to package row (SQLite column names). */
function toRow(spec: TableSpec, stored: Record<string, unknown>): SeedRow {
  const values: Record<string, CellValue> = {};
  for (const column of spec.cols) {
    if (column === 'visibility') values[column] = 'private';
    else if (column === 'text_truncated') values[column] = stored['textTruncated'] === true ? 1 : 0;
    else values[column] = cell(stored[camelOf(column)]);
  }
  return { id: stored['id'] as number, values };
}

function toStored(
  spec: TableSpec,
  row: SeedRow,
  idMap: Map<string, number>,
): Record<string, unknown> {
  const stored: Record<string, unknown> = {};
  for (const column of spec.cols) {
    if (column === 'visibility') continue;
    const value = row.values[column] ?? null;
    if (column === 'text_truncated') {
      stored['textTruncated'] = value === 1;
      continue;
    }
    const fk = spec.fks.find(([name]) => name === column);
    if (fk !== undefined && typeof value === 'number') {
      const mapped = idMap.get(`${tableIndex(fk[1])}:${value}`);
      if (mapped === undefined) bad('Invalid SEED package: a record points at a missing parent.');
      stored[camelOf(column)] = mapped;
    } else {
      stored[camelOf(column)] = value;
    }
  }
  return stored;
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function readLocal(tx: IDBTransaction): Promise<{
  rows: SeedRow[][];
  stored: Record<string, unknown>[][];
}> {
  const rows: SeedRow[][] = [];
  const stored: Record<string, unknown>[][] = [];
  for (const spec of TABLES) {
    const records = (await request(tx.objectStore(spec.store).getAll())) as Record<
      string,
      unknown
    >[];
    records.sort((a, b) => (a['id'] as number) - (b['id'] as number));
    stored.push(records);
    rows.push(records.map((record) => toRow(spec, record)));
  }
  return { rows, stored };
}

type Plan = (number | null)[][];

function makePlan(
  local: SeedRow[][],
  pkg: SeedRow[][],
): { plan: Plan; hashes: string[][]; counts: SeedTableCount[] } {
  const localHashes = identitiesOf(local).hashes;
  const { hashes } = identitiesOf(pkg);
  const plan: Plan = [];
  const counts: SeedTableCount[] = [];
  TABLES.forEach((spec, index) => {
    const existing = new Map<string, number>();
    (local[index] ?? []).forEach((row, position) => {
      existing.set(localHashes[index]?.[position] as string, row.id);
    });
    const mine = hashes[index] as string[];
    plan.push(mine.map((hash) => existing.get(hash) ?? null));
    // A record repeated inside the package counts as existing after its first copy.
    const seen = new Set<string>();
    let added = 0;
    mine.forEach((hash, position) => {
      if (plan[index]?.[position] === null && !seen.has(hash)) {
        seen.add(hash);
        added += 1;
      }
    });
    const total = mine.length;
    counts.push({ table: spec.name, total, added, existing: total - added });
  });
  return { plan, hashes, counts };
}

function previewOf(pkg: ParsedPackage, tables: SeedTableCount[]): SeedPreview {
  const warnings = [SENSITIVITY_WARNING];
  if (pkg.manifest.schemaVersion < SCHEMA_VERSION) {
    warnings.push(
      'This package was written by an older BEACON; its records are restored as they are.',
    );
  }
  return {
    formatVersion: pkg.manifest.formatVersion,
    appVersion: pkg.manifest.appVersion,
    schemaVersion: pkg.manifest.schemaVersion,
    createdAt: pkg.manifest.createdAt,
    packageSha256: pkg.packageSha256,
    byteLength: pkg.byteLength,
    fileCount: pkg.files.size - 1,
    tables,
    warnings,
  };
}

function fileNameFor(createdAt: string): string {
  const digits = createdAt.replace(/\D/g, '');
  return `beacon-seed-${digits.slice(0, 8)}-${digits.slice(8, 14)}.beacon`;
}

export function createBrowserSeed(runTransaction: RunTransaction, maxDocuments: number): SeedApi {
  return {
    exportSeed: () =>
      guarded(async () => {
        const { rows, stored } = await runTransaction(STORES, 'readonly', readLocal);
        if (rows.reduce((sum, table) => sum + table.length, 0) > MAX_ROWS) {
          bad('The library has more records than a v0.1 SEED package can hold.');
        }
        const entries: Entry[] = [];
        for (const [tableIdx, dir] of [
          [DOCUMENTS, DOC_DIR],
          [RESEARCH_DOCUMENTS, RESEARCH_DIR],
        ] as const) {
          for (const [position, row] of (rows[tableIdx] ?? []).entries()) {
            const original = (stored[tableIdx]?.[position] as { original?: unknown }).original;
            const sha = row.values['sha256'];
            const format = row.values['format'];
            const title = String(row.values['title'] ?? 'untitled');
            const bytes = isArrayBuffer(original) ? new Uint8Array(original) : new Uint8Array(0);
            if (typeof sha !== 'string' || sha256Hex(bytes) !== sha || bytes.length === 0) {
              bad(
                `The archived original for "${title}" is missing or damaged, so it cannot be exported. Re-import that file, then export again.`,
              );
            }
            entries.push({ path: `${dir}/${sha}.${String(format)}`, bytes });
          }
        }
        entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        const tables: Record<string, unknown[]> = {};
        for (const [index, spec] of TABLES.entries()) {
          tables[spec.name] = (rows[index] ?? []).map((row) => ({ ...row.values, id: row.id }));
        }
        entries.unshift({
          path: RECORDS_PATH,
          bytes: new TextEncoder().encode(JSON.stringify({ tables })),
        });
        const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        const bytes = buildPackage(
          { appVersion: '0.1.0-browser-demo', schemaVersion: SCHEMA_VERSION, createdAt },
          entries,
        );
        return {
          fileName: fileNameFor(createdAt),
          bytes,
          byteLength: bytes.length,
          packageSha256: sha256Hex(bytes),
          tables: TABLES.map((spec, index) => {
            const total = rows[index]?.length ?? 0;
            return { table: spec.name, total, added: total, existing: 0 };
          }),
          warnings: [SENSITIVITY_WARNING],
        };
      }),

    inspectSeed: (bytes) =>
      guarded(async () => {
        const pkg = parsePackage(bytes, SCHEMA_VERSION);
        const { rows } = await runTransaction(STORES, 'readonly', readLocal);
        return previewOf(pkg, makePlan(rows, pkg.rows).counts);
      }),

    restoreSeed: (bytes, confirmSha256) =>
      guarded(async () => {
        const pkg = parsePackage(bytes, SCHEMA_VERSION);
        if (confirmSha256 !== pkg.packageSha256) {
          bad(
            'The package does not match the one that was previewed. Preview it again before restoring.',
          );
        }
        // One readwrite transaction over every store: any thrown error aborts all of it.
        const counts = await runTransaction(STORES, 'readwrite', async (tx) => {
          const { rows } = await readLocal(tx);
          const { plan, hashes, counts: summary } = makePlan(rows, pkg.rows);
          const addedDocuments = summary[DOCUMENTS]?.added ?? 0;
          if ((rows[DOCUMENTS]?.length ?? 0) + addedDocuments > maxDocuments) {
            bad(`The browser demo stores at most ${maxDocuments} documents.`);
          }
          const known = TABLES.map(() => new Map<string, number>());
          const idMap = new Map<string, number>();
          for (const [index, spec] of TABLES.entries()) {
            const store = tx.objectStore(spec.store);
            for (const [position, row] of (pkg.rows[index] ?? []).entries()) {
              const hash = hashes[index]?.[position] as string;
              let localId = plan[index]?.[position] ?? known[index]?.get(hash);
              if (localId === undefined) {
                const record = toStored(spec, row, idMap);
                if (index === DOCUMENTS || index === RESEARCH_DOCUMENTS) {
                  const dir = index === DOCUMENTS ? DOC_DIR : RESEARCH_DIR;
                  const data = pkg.files.get(
                    `${dir}/${String(row.values['sha256'])}.${String(row.values['format'])}`,
                  );
                  if (data === undefined) bad('Invalid SEED package: an original is missing.');
                  record['original'] = arrayBufferOf(data);
                }
                localId = (await request(store.add(record))) as number;
              }
              known[index]?.set(hash, localId);
              idMap.set(`${index}:${row.id}`, localId);
            }
          }
          return summary;
        });
        return previewOf(pkg, counts);
      }),
  };
}
