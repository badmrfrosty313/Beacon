/**
 * The `.beacon` SEED container: the TypeScript mirror of src-tauri/src/seed/mod.rs (ADR-017).
 *
 *   "BCNSEED1" | u32 LE manifest length | manifest JSON (UTF-8) | entry bytes, back to back
 *
 * SHA-256 digests detect corruption relative to the manifest; they do not authenticate the
 * author, and packages are neither encrypted nor signed.
 */
import { sha256Hex } from '../sha256';
import { TABLES, tableIndex, type TableSpec } from './spec';

export const FORMAT_NAME = 'beacon-seed';
export const FORMAT_VERSION = 1;
export const MIN_SCHEMA_VERSION = 5;
export const RECORDS_PATH = 'data/records.json';
export const DOC_DIR = 'originals';
export const RESEARCH_DIR = 'research_originals';
export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_RECORDS_BYTES = 32 * 1024 * 1024;
export const MAX_ROWS = 50_000;
export const MAX_ENTRIES = 20_002;
export const MAX_DOC_ORIGINAL = 1024 * 1024;
export const MAX_RESEARCH_ORIGINAL = 20 * 1024 * 1024;

export const SENSITIVITY_WARNING =
  'SEED packages are not encrypted or signed. Anyone who can read the file can read every note, document and research record inside it. Store it somewhere private.';

const MAGIC = new TextEncoder().encode('BCNSEED1');

/** The package is not acceptable. The message is safe to show and never echoes file content. */
export class SeedFormatError extends Error {}

function reject(message: string): never {
  throw new SeedFormatError(`Invalid SEED package: ${message}`);
}

export type CellValue = string | number | null;

export interface SeedRow {
  id: number;
  values: Record<string, CellValue>;
}

export function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function extensionAllowed(dir: string, ext: string): boolean {
  if (dir === DOC_DIR) return ext === 'md' || ext === 'txt';
  if (dir === RESEARCH_DIR) return ext === 'md' || ext === 'txt' || ext === 'pdf';
  return false;
}

/** `originals|research_originals/<64 hex>.<ext>` exactly; anything else is not an original. */
export function parseOriginalPath(path: string): { dir: string; sha: string; ext: string } | null {
  const match = /^(originals|research_originals)\/([0-9a-f]{64})\.([a-z]+)$/.exec(path);
  if (match === null) return null;
  const [, dir, sha, ext] = match as unknown as [string, string, string, string];
  return extensionAllowed(dir, ext) ? { dir, sha, ext } : null;
}

export interface Manifest {
  format: string;
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  entries: { path: string; size: number; sha256: string }[];
}

export interface Entry {
  path: string;
  bytes: Uint8Array;
}

export interface ParsedPackage {
  manifest: Manifest;
  packageSha256: string;
  byteLength: number;
  files: Map<string, Uint8Array>;
  rows: SeedRow[][];
}

export function buildPackage(
  meta: { appVersion: string; schemaVersion: number; createdAt: string },
  entries: Entry[],
): Uint8Array {
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      format: FORMAT_NAME,
      formatVersion: FORMAT_VERSION,
      appVersion: meta.appVersion,
      schemaVersion: meta.schemaVersion,
      createdAt: meta.createdAt,
      encrypted: false,
      authenticated: false,
      warning: SENSITIVITY_WARNING,
      entries: entries.map((entry) => ({
        path: entry.path,
        size: entry.bytes.length,
        sha256: sha256Hex(entry.bytes),
      })),
    }),
  );
  if (manifest.length > MAX_MANIFEST_BYTES) reject('the library has too many files.');
  if (entries.length > MAX_ENTRIES) reject('the library has too many files.');
  const records = entries.find((entry) => entry.path === RECORDS_PATH);
  if (records !== undefined && records.bytes.length > MAX_RECORDS_BYTES) {
    reject('the records are larger than a v0.1 package allows.');
  }
  const payload = entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
  const total = MAGIC.length + 4 + manifest.length + payload;
  if (total > MAX_PACKAGE_BYTES) {
    reject(`the library is larger than the ${MAX_PACKAGE_BYTES / (1024 * 1024)} MiB limit.`);
  }
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(8, manifest.length, true);
  out.set(manifest, 12);
  let offset = 12 + manifest.length;
  for (const entry of entries) {
    out.set(entry.bytes, offset);
    offset += entry.bytes.length;
  }
  return out;
}

const short = (text: string): string => text.slice(0, 80);

function asManifest(value: unknown): Manifest {
  if (typeof value !== 'object' || value === null) reject('the manifest is malformed.');
  const m = value as Record<string, unknown>;
  const entries = m['entries'];
  if (
    typeof m['format'] !== 'string' ||
    typeof m['formatVersion'] !== 'number' ||
    typeof m['appVersion'] !== 'string' ||
    typeof m['schemaVersion'] !== 'number' ||
    typeof m['createdAt'] !== 'string' ||
    !Array.isArray(entries)
  ) {
    reject('the manifest is malformed.');
  }
  const parsed = (entries as unknown[]).map((entry) => {
    const e = entry as Record<string, unknown> | null;
    if (
      typeof e !== 'object' ||
      e === null ||
      typeof e['path'] !== 'string' ||
      typeof e['size'] !== 'number' ||
      !Number.isSafeInteger(e['size']) ||
      e['size'] < 0 ||
      typeof e['sha256'] !== 'string'
    ) {
      reject('the manifest is malformed.');
    }
    return { path: e['path'] as string, size: e['size'] as number, sha256: e['sha256'] as string };
  });
  return {
    format: m['format'],
    formatVersion: m['formatVersion'],
    appVersion: m['appVersion'],
    schemaVersion: m['schemaVersion'],
    createdAt: m['createdAt'],
    entries: parsed,
  };
}

export function parsePackage(bytes: Uint8Array, latestSchema: number): ParsedPackage {
  if (bytes.length > MAX_PACKAGE_BYTES) reject('the file is too large.');
  if (bytes.length < 12 || MAGIC.some((byte, index) => bytes[index] !== byte)) {
    reject('this is not a BEACON SEED package.');
  }
  const manifestLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(
    8,
    true,
  );
  if (
    manifestLength === 0 ||
    manifestLength > MAX_MANIFEST_BYTES ||
    12 + manifestLength > bytes.length
  ) {
    reject('the manifest length is invalid.');
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(12, 12 + manifestLength)),
    );
  } catch {
    reject('the manifest is malformed.');
  }
  const manifest = asManifest(manifestJson);
  if (manifest.format !== FORMAT_NAME) reject('this is not a BEACON SEED package.');
  if (manifest.formatVersion !== FORMAT_VERSION) {
    reject(
      `format version ${manifest.formatVersion} is not supported by this version of BEACON (supports ${FORMAT_VERSION}).`,
    );
  }
  if (manifest.schemaVersion > latestSchema || manifest.schemaVersion < MIN_SCHEMA_VERSION) {
    reject(
      `it was written for database schema ${manifest.schemaVersion}, which this version cannot restore.`,
    );
  }
  if (manifest.entries.length === 0 || manifest.entries.length > MAX_ENTRIES) {
    reject('the file list has an invalid size.');
  }

  const payloadStart = 12 + manifestLength;
  let declared = 0;
  for (const entry of manifest.entries) {
    declared += entry.size;
    if (!Number.isSafeInteger(declared)) reject('the declared sizes overflow.');
  }
  if (declared !== bytes.length - payloadStart) {
    reject('the declared file sizes do not match the package (truncated or padded).');
  }

  const files = new Map<string, Uint8Array>();
  let offset = payloadStart;
  for (const entry of manifest.entries) {
    const original = parseOriginalPath(entry.path);
    if (entry.path !== RECORDS_PATH && original === null) {
      reject(`unsafe or unknown path "${short(entry.path)}".`);
    }
    if (!isSha(entry.sha256)) reject(`bad digest for "${short(entry.path)}".`);
    const limit =
      original === null
        ? MAX_RECORDS_BYTES
        : original.dir === DOC_DIR
          ? MAX_DOC_ORIGINAL
          : MAX_RESEARCH_ORIGINAL;
    if (entry.size > limit) reject(`"${short(entry.path)}" exceeds its size limit.`);
    const data = bytes.subarray(offset, offset + entry.size);
    offset += entry.size;
    if (sha256Hex(data) !== entry.sha256) {
      reject(`"${short(entry.path)}" failed its SHA-256 check (corrupt or altered).`);
    }
    if (original !== null && original.sha !== entry.sha256) {
      reject(`"${short(entry.path)}" does not match its content-addressed name.`);
    }
    if (files.has(entry.path)) reject(`duplicate path "${short(entry.path)}".`);
    files.set(entry.path, data);
  }

  const records = files.get(RECORDS_PATH);
  if (records === undefined) reject('the records file is missing.');
  const rows = parseRecords(records);
  checkOriginals(rows, files);
  return {
    manifest,
    packageSha256: sha256Hex(bytes),
    byteLength: bytes.length,
    files,
    rows,
  };
}

function parseRecords(bytes: Uint8Array): SeedRow[][] {
  let root: unknown;
  try {
    root = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    reject('the records file is malformed.');
  }
  const tables = (root as { tables?: unknown } | null)?.tables;
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) {
    reject('the records file has no tables.');
  }
  const record = tables as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (tableIndex(key) < 0) reject(`unknown table "${short(key)}".`);
  }
  let total = 0;
  return TABLES.map((table: TableSpec) => {
    const list = record[table.name];
    if (!Array.isArray(list)) reject(`table "${table.name}" is missing.`);
    total += list.length;
    if (total > MAX_ROWS) reject('too many records.');
    const seen = new Set<number>();
    return (list as unknown[]).map((item): SeedRow => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        reject(`a ${table.name} record is not an object.`);
      }
      const object = item as Record<string, unknown>;
      if (Object.keys(object).length !== table.cols.length + 1) {
        reject(`a ${table.name} record has the wrong fields.`);
      }
      const id = object['id'];
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
        reject(`a ${table.name} record has no valid id.`);
      }
      if (seen.has(id)) reject(`duplicate ${table.name} id ${id}.`);
      seen.add(id);
      const values: Record<string, CellValue> = {};
      for (const column of table.cols) {
        if (!Object.prototype.hasOwnProperty.call(object, column)) {
          reject(`a ${table.name} record lacks "${column}".`);
        }
        const value = object[column];
        if (value === null) {
          if (table.required.includes(column)) reject(`${table.name}.${column} is required.`);
        } else if (table.ints.includes(column)) {
          if (!Number.isSafeInteger(value)) reject(`${table.name}.${column} must be an integer.`);
        } else if (typeof value !== 'string') {
          reject(`${table.name}.${column} must be text.`);
        }
        const allowed = table.enums[column];
        if (allowed !== undefined && value !== null && !allowed.includes(value as string)) {
          reject(`${table.name}.${column} has an unsupported value.`);
        }
        values[column] = value as CellValue;
      }
      return { id, values };
    });
  });
}

/** Every archive row needs its original (right hash and length); nothing may be unreferenced. */
function checkOriginals(rows: SeedRow[][], files: Map<string, Uint8Array>): void {
  const referenced = new Set<string>();
  for (const [table, dir] of [
    ['documents', DOC_DIR],
    ['research_documents', RESEARCH_DIR],
  ] as const) {
    for (const row of rows[tableIndex(table)] ?? []) {
      const sha = row.values['sha256'];
      const format = row.values['format'];
      if (!isSha(sha) || typeof format !== 'string' || !extensionAllowed(dir, format)) {
        reject(`a ${table} record has an invalid hash or format.`);
      }
      const path = `${dir}/${sha}.${format}`;
      const data = files.get(path);
      if (data === undefined) reject(`the original for a ${table} record is missing.`);
      if (row.values['byte_length'] !== data.length) {
        reject(`a ${table} record has the wrong byte length.`);
      }
      referenced.add(path);
    }
  }
  for (const path of files.keys()) {
    if (path !== RECORDS_PATH && !referenced.has(path)) {
      reject(`unreferenced file "${short(path)}".`);
    }
  }
}

// ---- Identity ------------------------------------------------------------------------------

/** SQLite's lower() folds ASCII only; identity must follow the database's uniqueness rule. */
export const asciiLower = (text: string): string =>
  text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/**
 * Identity hash of a row (same canonical JSON as the Rust side, so a library exported on
 * desktop recognises its own records in the browser demo and vice versa). `parents` maps
 * `"<table index>:<id>"` to the parent's identity.
 */
export function identityOf(tableIdx: number, row: SeedRow, parents: Map<string, string>): string {
  const table = TABLES[tableIdx] as TableSpec;
  const key = table.keyCols.map((column) => {
    let value = row.values[column] ?? null;
    if (table.lower.includes(column) && typeof value === 'string') value = asciiLower(value);
    return [column, value];
  });
  const parentPart: [string, CellValue][] = [];
  for (const [column, parent] of table.fks) {
    if (!table.keyFks.includes(column)) continue;
    const value = row.values[column] ?? null;
    if (value === null) {
      parentPart.push([column, null]);
      continue;
    }
    if (typeof value !== 'number') reject(`${table.name}.${column} is not an integer id.`);
    const found = parents.get(`${tableIndex(parent)}:${value}`);
    if (found === undefined) {
      reject(`${table.name} record ${row.id} points at a missing ${parent} record.`);
    }
    parentPart.push([column, found]);
  }
  return sha256Hex(new TextEncoder().encode(JSON.stringify([table.name, key, parentPart])));
}

export function identitiesOf(rows: SeedRow[][]): { hashes: string[][]; byId: Map<string, string> } {
  const byId = new Map<string, string>();
  const hashes = rows.map((tableRows, tableIdx) =>
    tableRows.map((row) => {
      const hash = identityOf(tableIdx, row, byId);
      byId.set(`${tableIdx}:${row.id}`, hash);
      return hash;
    }),
  );
  return { hashes, byId };
}
