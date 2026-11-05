/**
 * Word search for the hosted browser demo ONLY (IndexedDB has no full-text index). Shared by the
 * Archive and Research stores. Native builds use SQLite FTS5 and never run this code.
 */
import { MATCH_END, MATCH_START } from './searchQuery';

// A deliberately simple approximation of what the native FTS5 index does: lower-cased,
// accent-folded word tokens; every query unit must appear; a quoted phrase must appear as
// consecutive words. It is NOT SQLite FTS5 (no stemming, ranking model or index), and the UI
// says so. Native search never falls back to this code.

interface Token {
  text: string;
  start: number;
  end: number;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const start = match.index ?? 0;
    tokens.push({
      text: match[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(),
      start,
      end: start + match[0].length,
    });
  }
  return tokens;
}

function findUnit(tokens: Token[], unit: string[]): number[] {
  if (unit.length === 0) return [];
  const starts: number[] = [];
  for (let i = 0; i + unit.length <= tokens.length; i += 1) {
    if (unit.every((word, offset) => tokens[i + offset]?.text === word)) starts.push(i);
  }
  return starts;
}

const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 100;

function buildSnippet(content: string, ranges: Array<[number, number]>): string {
  const first = ranges[0];
  if (first === undefined) return content.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER);
  const from = Math.max(0, first[0] - SNIPPET_BEFORE);
  const to = Math.min(content.length, first[1] + SNIPPET_AFTER);
  let out = from > 0 ? '…' : '';
  let cursor = from;
  for (const [start, end] of ranges) {
    if (end <= from || start >= to) continue;
    const s = Math.max(start, from);
    const e = Math.min(end, to);
    out += content.slice(cursor, s) + MATCH_START + content.slice(s, e) + MATCH_END;
    cursor = e;
  }
  out += content.slice(cursor, to);
  return to < content.length ? `${out}…` : out;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export function matchDocument(
  doc: { title: string; content: string },
  units: string[][],
): { score: number; snippet: string } | null {
  const contentTokens = tokenize(doc.content);
  const titleTokens = tokenize(doc.title);
  const ranges: Array<[number, number]> = [];
  let score = 0;
  for (const unit of units) {
    const inContent = findUnit(contentTokens, unit);
    const inTitle = findUnit(titleTokens, unit);
    if (inContent.length === 0 && inTitle.length === 0) return null;
    score += inContent.length + inTitle.length * 3;
    for (const index of inContent.slice(0, 50)) {
      const startToken = contentTokens[index];
      const endToken = contentTokens[index + unit.length - 1];
      if (startToken && endToken) ranges.push([startToken.start, endToken.end]);
    }
  }
  return { score, snippet: buildSnippet(doc.content, mergeRanges(ranges)) };
}
