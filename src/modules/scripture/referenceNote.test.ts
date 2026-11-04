import { describe, expect, it } from 'vitest';

import { buildReferenceNote, extractReferences } from './referenceNote';
import { nextSelection } from './selection';

describe('reference notes', () => {
  it('seeds a note with the canonical reference and an empty notes section', () => {
    expect(buildReferenceNote('Revelation 13:18', 'WEB')).toEqual({
      title: 'Revelation 13:18',
      body: 'Scripture reference: Revelation 13:18 (WEB)\n\nMy notes:\n',
    });
  });

  it('does not copy any Scripture text into the note', () => {
    const note = buildReferenceNote('John 3:16', 'WEB');
    expect(note.body).not.toContain('loved the world');
  });

  it('extracts references back out, in order and without repeats', () => {
    const body = [
      'Scripture reference: Revelation 13:16-18 (WEB)',
      'my thoughts',
      'Scripture reference: Psalm 23 (WEB)',
      'Scripture reference: Revelation 13:16-18 (WEB)',
    ].join('\n');
    expect(extractReferences(body)).toEqual(['Revelation 13:16-18', 'Psalm 23']);
  });

  it('round-trips a freshly built note', () => {
    const note = buildReferenceNote('1 John 4:1', 'WEB');
    expect(extractReferences(note.body)).toEqual(['1 John 4:1']);
  });

  it('tolerates Windows line endings and ignores lookalike text', () => {
    expect(extractReferences('Scripture reference: Genesis 1:1 (WEB)\r\nmore')).toEqual([
      'Genesis 1:1',
    ]);
    expect(extractReferences('I wrote Scripture reference: Genesis 1:1 (WEB) inline')).toEqual([]);
    expect(extractReferences('Scripture reference: <script> (WEB)')).toEqual([]);
    expect(extractReferences('')).toEqual([]);
  });

  it('caps the number of links for one note', () => {
    const body = Array.from({ length: 50 }, (_, i) => `Scripture reference: Psalm ${i + 1} (WEB)`);
    expect(extractReferences(body.join('\n'))).toHaveLength(20);
  });
});

describe('verse selection', () => {
  it('selects one verse, then toggles it off', () => {
    const one = nextSelection(null, 13, 18, false);
    expect(one).toEqual({ chapter: 13, anchor: 18, from: 18, to: 18 });
    expect(nextSelection(one, 13, 18, false)).toBeNull();
  });

  it('makes a range from a single verse, in either direction', () => {
    const start = nextSelection(null, 13, 18, false);
    expect(nextSelection(start, 13, 16, false)).toMatchObject({ from: 16, to: 18 });
  });

  it('starts over after a range, or in a different chapter; Shift extends', () => {
    const range = nextSelection(nextSelection(null, 13, 16, false), 13, 18, false);
    expect(nextSelection(range, 13, 3, false)).toEqual({
      chapter: 13,
      anchor: 3,
      from: 3,
      to: 3,
    });
    expect(nextSelection(range, 12, 2, false)).toMatchObject({ chapter: 12, from: 2, to: 2 });
    expect(nextSelection(range, 13, 10, true)).toMatchObject({ from: 10, to: 16 });
  });
});
