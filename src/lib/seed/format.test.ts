import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../sha256';
import {
  RECORDS_PATH,
  SeedFormatError,
  buildPackage,
  identityOf,
  parseOriginalPath,
  parsePackage,
  type Entry,
} from './format';
import { TABLES } from './spec';

const enc = (text: string) => new TextEncoder().encode(text);
const META = { appVersion: 'test', schemaVersion: 5, createdAt: '2026-01-01T00:00:00Z' };

function records(extra: Record<string, unknown[]> = {}): Entry {
  const tables: Record<string, unknown[]> = {};
  for (const table of TABLES) tables[table.name] = [];
  Object.assign(tables, extra);
  return { path: RECORDS_PATH, bytes: enc(JSON.stringify({ tables })) };
}

/** Assemble a package from raw parts so hostile manifests can be forged. */
function forge(entries: Entry[], patch: (manifest: Record<string, unknown>) => void = () => {}) {
  const manifest: Record<string, unknown> = {
    format: 'beacon-seed',
    formatVersion: 1,
    appVersion: 't',
    schemaVersion: 5,
    createdAt: 'x',
    entries: entries.map((e) => ({
      path: e.path,
      size: e.bytes.length,
      sha256: sha256Hex(e.bytes),
    })),
  };
  patch(manifest);
  const json = enc(JSON.stringify(manifest));
  const total = 12 + json.length + entries.reduce((n, e) => n + e.bytes.length, 0);
  const out = new Uint8Array(total);
  out.set(enc('BCNSEED1'));
  new DataView(out.buffer).setUint32(8, json.length, true);
  out.set(json, 12);
  let offset = 12 + json.length;
  for (const e of entries) {
    out.set(e.bytes, offset);
    offset += e.bytes.length;
  }
  return out;
}

describe('SEED package format', () => {
  it('agrees with the Rust side on record identity (shared vector)', () => {
    const row = {
      id: 7,
      values: { title: 'T', body: 'B', created_at: '2026-01-01T00:00:00.000Z' },
    };
    expect(identityOf(0, row, new Map())).toBe(
      'ebd3675b71c2b6e8212091a463c4730966f7797e915f4c4957781072253f0d65',
    );
  });

  it('round-trips a package with an original', () => {
    const original = enc('Invented archive text.');
    const sha = sha256Hex(original);
    const doc = {
      id: 1,
      title: 'D',
      original_name: 'd.txt',
      format: 'txt',
      sha256: sha,
      byte_length: original.length,
      content: 'Invented archive text.',
      imported_at: '2026-01-01T00:00:00.000Z',
    };
    const bytes = buildPackage(META, [
      records({ documents: [doc] }),
      { path: `originals/${sha}.txt`, bytes: original },
    ]);
    const parsed = parsePackage(bytes, 5);
    expect(parsed.rows[1]).toHaveLength(1);
    expect(Array.from(parsed.files.get(`originals/${sha}.txt`) ?? [])).toEqual(
      Array.from(original),
    );
    expect(parsed.packageSha256).toBe(sha256Hex(bytes));
  });

  it('rejects every byte flip in the header and payload', () => {
    const bytes = buildPackage(META, [records()]);
    const manifestLength = new DataView(bytes.buffer).getUint32(8, true);
    const positions = [
      ...Array.from({ length: 12 }, (_, i) => i),
      ...Array.from(
        { length: bytes.length - 12 - manifestLength },
        (_, i) => 12 + manifestLength + i,
      ),
    ];
    for (const position of positions) {
      const damaged = bytes.slice();
      damaged[position] = (damaged[position] as number) ^ 1;
      expect(() => parsePackage(damaged, 5), `flip at ${position}`).toThrow(SeedFormatError);
    }
  });

  it('rejects truncated, padded and foreign files', () => {
    const bytes = buildPackage(META, [records()]);
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes);
    for (const bad of [bytes.slice(0, -1), padded, new Uint8Array(0), enc('PK\u0003\u0004zip')]) {
      expect(() => parsePackage(bad, 5)).toThrow(SeedFormatError);
    }
  });

  it('rejects unsupported versions, wrong formats and lying manifests', () => {
    expect(() => parsePackage(forge([records()]), 5)).not.toThrow();
    const patches: ((m: Record<string, unknown>) => void)[] = [
      (m) => (m['formatVersion'] = 2),
      (m) => (m['schemaVersion'] = 6),
      (m) => (m['schemaVersion'] = 4),
      (m) => (m['format'] = 'other'),
      (m) => (m['entries'] = []),
      (m) => ((m['entries'] as { size: number }[])[0]!.size = 1),
      (m) => ((m['entries'] as { sha256: string }[])[0]!.sha256 = '0'.repeat(64)),
      (m) => (m['entries'] = 'nope'),
    ];
    for (const patch of patches) {
      expect(() => parsePackage(forge([records()], patch), 5)).toThrow(SeedFormatError);
    }
  });

  it('only accepts exact content-addressed original paths', () => {
    const sha = 'a'.repeat(64);
    expect(parseOriginalPath(`originals/${sha}.md`)).not.toBeNull();
    expect(parseOriginalPath(`research_originals/${sha}.pdf`)).not.toBeNull();
    for (const bad of [
      `originals/${sha}.pdf`,
      '../originals/x.md',
      `originals/../${sha}.md`,
      `/originals/${sha}.md`,
      `originals\\${sha}.md`,
      `originals/sub/${sha}.md`,
      `originals/${'A'.repeat(64)}.md`,
      `originals/${sha}.md\n`,
      `C:/originals/${sha}.md`,
      `elsewhere/${sha}.md`,
    ]) {
      expect(parseOriginalPath(bad), bad).toBeNull();
    }
  });

  it('rejects unsafe, unreferenced and duplicate entries', () => {
    const payload = enc('owned');
    const sha = sha256Hex(payload);
    for (const path of [
      '../escape.txt',
      '/etc/passwd',
      'originals/../../x.md',
      `originals/${sha}.exe`,
    ]) {
      expect(() => parsePackage(forge([records(), { path, bytes: payload }]), 5), path).toThrow(
        SeedFormatError,
      );
    }
    expect(() =>
      parsePackage(forge([records(), { path: `originals/${sha}.md`, bytes: payload }]), 5),
    ).toThrow(SeedFormatError);
    expect(() => parsePackage(forge([records(), records()]), 5)).toThrow(SeedFormatError);
  });

  it('rejects records with unknown tables, bad types, bad enums or dangling references', () => {
    const base = (tables: Record<string, unknown>) =>
      forge([{ path: RECORDS_PATH, bytes: enc(JSON.stringify({ tables })) }]);
    const empty: Record<string, unknown> = {};
    for (const table of TABLES) empty[table.name] = [];
    expect(() => parsePackage(base({ ...empty, extra: [] }), 5)).toThrow(SeedFormatError);
    expect(() =>
      parsePackage(
        base({ ...empty, notes: [{ id: 1, title: 1.5, body: '', created_at: 'x' }] }),
        5,
      ),
    ).toThrow(SeedFormatError);
    const claim = {
      id: 1,
      event_id: 99,
      source_id: null,
      kind: 'observation',
      text: 'x',
      attribution: null,
      scripture_reference: null,
      created_at: 'x',
      updated_at: 'x',
    };
    expect(() =>
      parsePackage(base({ ...empty, watchtower_claims: [{ ...claim, kind: 'rumour' }] }), 5),
    ).toThrow(SeedFormatError);
    // Dangling references parse (they are checked when identities are computed at restore).
    const parsed = parsePackage(base({ ...empty, watchtower_claims: [claim] }), 5);
    expect(() => identityOf(6, parsed.rows[6]![0]!, new Map())).toThrow(SeedFormatError);
  });

  it('accepts undated events (null date precision) but rejects nulls and wrong types elsewhere', () => {
    const base = (tables: Record<string, unknown>) =>
      forge([{ path: RECORDS_PATH, bytes: enc(JSON.stringify({ tables })) }]);
    const empty: Record<string, unknown> = {};
    for (const table of TABLES) empty[table.name] = [];
    const undated = {
      id: 1,
      title: 'Undated',
      description: null,
      event_date: null,
      date_precision: null,
      event_sort: null,
      created_at: 'x',
      updated_at: 'x',
    };
    expect(() => parsePackage(base({ ...empty, watchtower_events: [undated] }), 5)).not.toThrow();
    const collection = { id: 1, name: 'C', description: null, created_at: 'x' };
    expect(() =>
      parsePackage(base({ ...empty, research_collections: [collection] }), 5),
    ).not.toThrow();
    for (const bad of [{ name: null }, { name: 5 }, { created_at: null }]) {
      expect(() =>
        parsePackage(base({ ...empty, research_collections: [{ ...collection, ...bad }] }), 5),
      ).toThrow(SeedFormatError);
    }
    expect(() =>
      parsePackage(base({ ...empty, watchtower_events: [{ ...undated, event_sort: 'soon' }] }), 5),
    ).toThrow(SeedFormatError);
  });

  it('folds case like SQLite (ASCII only) when identifying collections', () => {
    const row = (name: string) => ({ id: 1, values: { name, description: null, created_at: 'x' } });
    const a = identityOf(2, row('Plain'), new Map());
    expect(identityOf(2, row('PLAIN'), new Map())).toBe(a);
    expect(identityOf(2, row('Ä'), new Map())).not.toBe(identityOf(2, row('ä'), new Map()));
  });

  it('refuses to build a package its own parser would reject', () => {
    const big = { path: RECORDS_PATH, bytes: new Uint8Array(32 * 1024 * 1024 + 1) };
    expect(() => buildPackage(META, [big])).toThrow(SeedFormatError);
  });
});
