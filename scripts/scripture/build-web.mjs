#!/usr/bin/env node
// Builds BEACON's packaged Scripture data from the OFFICIAL World English Bible (engwebp) USFM
// archive. Dev/CI tool only: nothing here runs inside the app, and it never touches the network.
//
//   node scripts/scripture/build-web.mjs           regenerate data/scripture/engwebp.{tsv,meta.txt}
//   node scripts/scripture/build-web.mjs --check   regenerate in memory and fail if the committed
//                                                  files differ (used by CI and `npm run scripture:verify`)
//
// Inputs : data/scripture/source/engwebp_usfm.zip (kept byte-for-byte as downloaded from eBible.org)
//          data/scripture/canon-protestant66.txt
// Outputs: data/scripture/engwebp.tsv        verse text, one row per verse
//          data/scripture/engwebp.meta.txt   provenance, license and checksums
//
// The parser is deliberately strict. Any USFM marker it has not been told how to handle fails
// the build, so text can never be dropped or merged silently. Verse numbers must be contiguous
// (1..N) and chapter numbers contiguous (1..N) in every book.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(ROOT, 'data', 'scripture');
const ZIP_PATH = join(DATA, 'source', 'engwebp_usfm.zip');
const CANON_PATH = join(DATA, 'canon-protestant66.txt');
const TSV_PATH = join(DATA, 'engwebp.tsv');
const META_PATH = join(DATA, 'engwebp.meta.txt');
const COPR_PATH = join(DATA, 'source', 'copr.htm');

/** SHA-256 of the archive as acquired from eBible.org and independently verified. */
export const EXPECTED_ZIP_SHA256 =
  'a93df5571009fed56f77e3ac1d3ce71c9a3a3df1486f7570cc7a8f823192fdba';

/** Totals independently counted from the source (`\c` and `\v` markers) and checked on every build. */
export const EXPECTED_TOTALS = { books: 66, chapters: 1189, verses: 31103 };

/**
 * Verses that exist in the official USFM with NO main text: the source gives only a verse number
 * and a translator footnote (a textual variant). They are kept as real verses with empty text
 * (never dropped, merged or filled in); the UI shows an explicit notice. This list is pinned so
 * a change in the source fails the build instead of passing silently.
 */
export const EXPECTED_EMPTY_VERSES = [
  'ACT 15:34',
  'ACT 24:7',
  'ACT 8:37',
  'LUK 17:36',
  'ROM 16:25',
];

const RETRIEVED = '2026-11-04';
const SOURCE_FILES_DATED = '2026-10-30';

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------------------------
// Minimal in-memory ZIP reader (stored + deflate only; no extraction to disk, no dependencies).
// ---------------------------------------------------------------------------------------------

const MAX_ENTRIES = 200;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

export function readZip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (end-of-central-directory not found).');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new Error(`Archive has too many entries (${count}).`);

  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt central directory.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error(`Unexpected path in archive: ${name}`);
    }
    if (size > MAX_ENTRY_BYTES) throw new Error(`Entry too large: ${name}`);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Corrupt local header.');
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    let content;
    if (method === 0) content = Buffer.from(raw);
    else if (method === 8) content = inflateRawSync(raw);
    else throw new Error(`Unsupported compression method ${method} for ${name}.`);
    if (content.length !== size) throw new Error(`Size mismatch for ${name}.`);
    files.set(name, content);
  }
  return files;
}

// ---------------------------------------------------------------------------------------------
// Canon
// ---------------------------------------------------------------------------------------------

export function parseCanon(text) {
  const books = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const [id, order, testament, name, citation, aliases] = line.split('|');
    books.push({
      id,
      order: Number(order),
      testament,
      name,
      citation: citation || name,
      aliases: aliases ? aliases.split(',') : [],
    });
  }
  return books;
}

// ---------------------------------------------------------------------------------------------
// USFM -> verses
// ---------------------------------------------------------------------------------------------

/** Markers whose content is not verse text (titles, headings, speaker labels, introductions). */
const IGNORED_MARKERS = new Set([
  'id',
  'ide',
  'h',
  'toc1',
  'toc2',
  'toc3',
  'mt1',
  'mt2',
  'mt3',
  'ms1',
  'sp',
  'cl',
  'ip',
  'is1',
  'ili',
  'b',
]);
/** Paragraph markers: a paragraph break inside a verse becomes a single space. */
const SPACE_MARKERS = new Set(['p', 'm', 'mi', 'pi1', 'nb']);
/** Poetry and list-line markers: the line break inside a verse is preserved as "\n". */
const LINE_MARKERS = new Set(['q1', 'q2', 'q3', 'li1']);

/** Strip USFM character markup from one verse's raw text, keeping every word and punctuation mark. */
export function cleanVerseText(raw, where) {
  let text = raw;
  // Translator footnotes and cross-references are NOT included (see DECISIONS.md ADR-014).
  text = text.replace(/\\f\s[\s\S]*?\\f\*/g, '');
  text = text.replace(/\\x\s[\s\S]*?\\x\*/g, '');
  // Strong's-tagged words: \w word|strong="H123"\w*  (nested form inside \wj is \+w ... \+w*).
  text = text.replace(/\\\+?w\s+([^|\\]*)(?:\|[^\\]*)?\\\+?w\*/g, '$1');
  // Remaining character styles: keep their content, drop the markers.
  text = text.replace(/\\\+?(?:wj|qs|k|bk)(?:\*| )/g, '');
  if (text.includes('\\')) throw new Error(`Unhandled USFM markup in ${where}: ${raw}`);
  if (text.includes('|')) throw new Error(`Unhandled attribute text in ${where}: ${raw}`);
  return text.replace(/[ \t]+/g, ' ').trim();
}

/**
 * Parse one USFM book file.
 * @returns {{chapters: {superscription: string, verses: string[]}[], ignored: Record<string, number>}}
 */
export function parseUsfmBook(bookId, source) {
  const chapters = [];
  const ignored = {};
  const emptyVerses = [];
  let chapter = null;
  let verse = null; // { number, parts: [] } for the verse being collected
  let pendingJoin = ' ';

  const closeVerse = () => {
    if (!verse) return;
    const where = `${bookId} ${chapters.length}:${verse.number}`;
    let out = '';
    for (const part of verse.parts) {
      const cleaned = cleanVerseText(part.raw, where);
      if (cleaned === '') continue;
      out = out === '' ? cleaned : out + part.join + cleaned;
    }
    if (out === '') emptyVerses.push(where);
    chapter.verses.push(out);
    verse = null;
  };

  const lines = source.replace(/^﻿/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === '') continue;
    const where = `${bookId} line ${index + 1}`;
    const match = /^\\([a-z0-9]+)(?:[ \t]+(.*))?$/.exec(line);
    if (!match) throw new Error(`Unexpected line without a marker at ${where}: ${line}`);
    const marker = match[1];
    let content = (match[2] ?? '').trim();

    if (SPACE_MARKERS.has(marker) || LINE_MARKERS.has(marker)) {
      pendingJoin = LINE_MARKERS.has(marker) ? '\n' : ' ';
      if (content === '') continue;
      if (content.startsWith('\\v ')) {
        // e.g. "\q1 \v 3 ..." — treat the remainder as a verse line.
        const inner = /^\\v[ \t]+(\d+)(?:[ \t]+(.*))?$/.exec(content);
        if (!inner) throw new Error(`Unsupported verse line at ${where}: ${line}`);
        startVerse(Number(inner[1]), inner[2] ?? '');
        continue;
      }
      if (!verse) throw new Error(`Text outside a verse at ${where}: ${line}`);
      verse.parts.push({ raw: content, join: pendingJoin });
      continue;
    }

    switch (marker) {
      case 'c': {
        closeVerse();
        const number = Number(content);
        if (!/^\d+$/.test(content) || number !== chapters.length + 1) {
          throw new Error(`Non-contiguous chapter "${content}" at ${where}`);
        }
        chapter = { superscription: '', verses: [] };
        chapters.push(chapter);
        break;
      }
      case 'd': {
        // Psalm 119 uses \d for its 22 acrostic section labels (ALEPH, BETH, ...). They are
        // headings, not verse text or a superscription, so they are excluded and counted.
        if (bookId === 'PSA' && chapters.length === 119) {
          ignored['d-acrostic'] = (ignored['d-acrostic'] ?? 0) + 1;
          break;
        }
        // Any other \d is a Psalm superscription: allowed only before verse 1 of a chapter.
        if (!chapter || verse || chapter.verses.length > 0) {
          throw new Error(`Superscription not before verse 1 at ${where}`);
        }
        chapter.superscription = cleanVerseText(content, where);
        break;
      }
      case 'v': {
        const inner = /^(\d+)(?:[ \t]+(.*))?$/.exec(content);
        if (!inner)
          throw new Error(`Unsupported verse marker (bridge/letter?) at ${where}: ${line}`);
        startVerse(Number(inner[1]), inner[2] ?? '');
        break;
      }
      default:
        if (!IGNORED_MARKERS.has(marker)) {
          throw new Error(`Unknown USFM marker \\${marker} at ${where}`);
        }
        // Headings and speaker labels (e.g. \sp in Song of Solomon) can sit in the middle of a
        // verse; they are skipped and the verse continues on the following lines.
        ignored[marker] = (ignored[marker] ?? 0) + 1;
    }
  }
  closeVerse();

  function startVerse(number, rest) {
    if (!chapter) throw new Error(`Verse before any chapter in ${bookId}`);
    closeVerse();
    if (number !== chapter.verses.length + 1) {
      throw new Error(`Non-contiguous verse ${number} in ${bookId} ${chapters.length}`);
    }
    verse = { number, parts: [{ raw: rest, join: ' ' }] };
  }

  return { chapters, ignored, emptyVerses };
}

// ---------------------------------------------------------------------------------------------
// Whole build
// ---------------------------------------------------------------------------------------------

function escapeField(value) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function usfmFileFor(files, bookId) {
  const matches = [...files.keys()].filter((name) =>
    new RegExp(`^\\d+-${bookId}engwebp\\.usfm$`).test(name),
  );
  if (matches.length !== 1) throw new Error(`Expected exactly one USFM file for ${bookId}.`);
  return matches[0];
}

/** Count `\c` and `\v` markers with a deliberately naive method, independent of the parser. */
function naiveCounts(source) {
  let chapters = 0;
  let verses = 0;
  for (const line of source.split(/\r?\n/)) {
    if (/^\\c\s/.test(line)) chapters++;
    if (/^\\v\s/.test(line)) verses++;
  }
  return { chapters, verses };
}

export function build(zipBuffer, canonText, copr) {
  const zipSha = sha256Hex(zipBuffer);
  if (zipSha !== EXPECTED_ZIP_SHA256) {
    throw new Error(`Archive checksum mismatch: expected ${EXPECTED_ZIP_SHA256}, got ${zipSha}`);
  }
  const files = readZip(zipBuffer);

  // 1. Verify every file against the manifest embedded (and PGP-signed) by eBible.org.
  const signature = files.get('signature.txt.asc')?.toString('utf8');
  if (!signature) throw new Error('signature.txt.asc missing from archive.');
  const manifest = new Map();
  for (const line of signature.split(/\r?\n/)) {
    const entry = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    if (entry) manifest.set(entry[2], entry[1]);
  }
  if (manifest.size !== 70)
    throw new Error(`Expected 70 manifest entries, found ${manifest.size}.`);
  for (const [name, expected] of manifest) {
    const content = files.get(name);
    if (!content) throw new Error(`Manifest lists ${name}, which is not in the archive.`);
    if (sha256Hex(content) !== expected) throw new Error(`Manifest checksum mismatch: ${name}`);
  }
  if (!copr.equals(files.get('copr.htm'))) throw new Error('source/copr.htm differs from archive.');

  // 2. Parse the 66 canonical books.
  const canon = parseCanon(canonText);
  if (canon.length !== EXPECTED_TOTALS.books) throw new Error('Canon must list 66 books.');

  const rows = ['#BEACON-SCRIPTURE-TSV 1', '#columns: kind(V|D)\tbook\tchapter\tverse\ttext'];
  const totals = { books: 0, chapters: 0, verses: 0 };
  const ignoredTotals = {};
  const emptyVerses = [];
  for (const book of canon) {
    const fileName = usfmFileFor(files, book.id);
    const source = files.get(fileName).toString('utf8');
    const idLine = /^\\id (\S+)/m.exec(source);
    if (!idLine || idLine[1] !== book.id) throw new Error(`${fileName} has the wrong \\id.`);

    const parsed = parseUsfmBook(book.id, source);
    const naive = naiveCounts(source);
    const verseCount = parsed.chapters.reduce((sum, c) => sum + c.verses.length, 0);
    if (parsed.chapters.length !== naive.chapters || verseCount !== naive.verses) {
      throw new Error(`${book.id}: parser and independent marker count disagree.`);
    }
    parsed.chapters.forEach((chapter, ci) => {
      if (chapter.superscription)
        rows.push(`D\t${book.id}\t${ci + 1}\t\t${escapeField(chapter.superscription)}`);
      chapter.verses.forEach((text, vi) => {
        rows.push(`V\t${book.id}\t${ci + 1}\t${vi + 1}\t${escapeField(text)}`);
      });
    });
    emptyVerses.push(...parsed.emptyVerses);
    totals.books++;
    totals.chapters += parsed.chapters.length;
    totals.verses += verseCount;
    for (const [marker, n] of Object.entries(parsed.ignored)) {
      ignoredTotals[marker] = (ignoredTotals[marker] ?? 0) + n;
    }
  }
  for (const key of Object.keys(EXPECTED_TOTALS)) {
    if (totals[key] !== EXPECTED_TOTALS[key]) {
      throw new Error(`Total ${key}: expected ${EXPECTED_TOTALS[key]}, got ${totals[key]}.`);
    }
  }

  if (JSON.stringify([...emptyVerses].sort()) !== JSON.stringify(EXPECTED_EMPTY_VERSES)) {
    throw new Error(`Unexpected set of empty verses: ${emptyVerses.join(', ')}`);
  }

  const tsv = rows.join('\n') + '\n';
  const meta =
    [
      '# BEACON packaged Scripture: provenance, license and checksums. key=value, UTF-8.',
      '# Generated by scripts/scripture/build-web.mjs. Do not edit by hand.',
      'format=1',
      'translation.id=engwebp',
      'translation.abbreviation=WEB',
      'translation.name=World English Bible',
      'translation.edition=Protestant edition (engwebp, 66 books), 2020 stable text edition',
      'translation.language=en',
      'translation.canon=protestant66',
      'source.page=https://ebible.org/find/show.php?id=engwebp',
      'source.url=https://eBible.org/Scriptures/engwebp_usfm.zip',
      'source.publisher=eBible.org',
      `source.filesDated=${SOURCE_FILES_DATED}`,
      `source.retrieved=${RETRIEVED}`,
      `source.zip.sha256=${zipSha}`,
      `source.zip.bytes=${zipBuffer.length}`,
      'source.signature.signer=World English Bible editors <editors@eBible.org>',
      'source.signature.fingerprint=54D714D76956DA6673DC1EEA5F62009D93505F26',
      'source.signature.note=Verified with gpg on 2026-11-04 against the key shipped inside the archive; that key was not independently trust-anchored, so this proves the files are unchanged since signing, not who signed them.',
      'license.status=Public Domain, per copr.htm in the official archive',
      'license.trademark="World English Bible" is a trademark of eBible.org. If the text of the WEB is CHANGED, the result must not be called the World English Bible. BEACON packages the words unchanged.',
      'license.file=data/scripture/source/copr.htm',
      'content.included=Verse text (words, punctuation and verse numbers unchanged); Psalm superscriptions (stored separately); five verses that the source gives only as a number plus a footnote are kept as verses with empty text (see data.emptyVerses).',
      "content.excluded=Strong's numbers, translator footnotes, cross-references, book titles, section and speaker headings, introductions, glossary and preface.",
      'content.lineBreaks=Poetry lines inside a verse are kept as line breaks; paragraph breaks inside a verse become a single space.',
      `data.file=engwebp.tsv`,
      `data.sha256=${sha256Hex(Buffer.from(tsv, 'utf8'))}`,
      `data.books=${totals.books}`,
      `data.chapters=${totals.chapters}`,
      `data.verses=${totals.verses}`,
      `data.emptyVerses=${[...EXPECTED_EMPTY_VERSES].sort().join(',')}`,
      `data.ignoredMarkers=${Object.entries(ignoredTotals)
        .sort()
        .map(([k, v]) => `${k}:${v}`)
        .join(',')}`,
      ...[...manifest].sort().map(([name, hash]) => `source.file.${name}.sha256=${hash}`),
    ].join('\n') + '\n';

  return { tsv, meta, totals };
}

function main() {
  const check = process.argv.includes('--check');
  if (!existsSync(ZIP_PATH)) throw new Error(`Missing source archive: ${ZIP_PATH}`);
  const { tsv, meta, totals } = build(
    readFileSync(ZIP_PATH),
    readFileSync(CANON_PATH, 'utf8'),
    readFileSync(COPR_PATH),
  );
  if (check) {
    const sameTsv = existsSync(TSV_PATH) && readFileSync(TSV_PATH, 'utf8') === tsv;
    const sameMeta = existsSync(META_PATH) && readFileSync(META_PATH, 'utf8') === meta;
    if (!sameTsv || !sameMeta) {
      console.error(
        'Committed Scripture data does not match a fresh build from the source archive.',
      );
      process.exit(1);
    }
    console.log(
      `OK: packaged data reproduces from the source archive (${JSON.stringify(totals)}).`,
    );
    return;
  }
  writeFileSync(TSV_PATH, tsv);
  writeFileSync(META_PATH, meta);
  console.log(`Wrote ${TSV_PATH} and ${META_PATH}: ${JSON.stringify(totals)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
