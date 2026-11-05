import { describe, expect, it } from 'vitest';

import {
  MAX_EXPLANATION_CHARS,
  MAX_SHORT_CHARS,
  ValidationFailure,
  claimKind,
  hypothesisStatus,
  linkRelation,
  optionalCalendarDate,
  optionalEventDate,
  optionalLine,
  optionalScriptureReference,
  optionalText,
  optionalUrl,
  requiredLine,
  requiredText,
} from './validation';

const fails = (work: () => unknown) => expect(work).toThrow(ValidationFailure);

describe('text fields', () => {
  it('trims, requires and counts by code point', () => {
    expect(requiredLine('The title', '  Hello  ')).toBe('Hello');
    fails(() => requiredLine('The title', '   '));
    expect(requiredLine('The title', '😀'.repeat(MAX_SHORT_CHARS))).toHaveLength(
      MAX_SHORT_CHARS * 2,
    );
    fails(() => requiredLine('The title', '😀'.repeat(MAX_SHORT_CHARS + 1)));
  });

  it('rejects control characters but allows line breaks in long text', () => {
    fails(() => requiredLine('The title', 'a\nb'));
    fails(() => requiredLine('The title', 'a\u0000b'));
    expect(requiredText('The text', 'a\nb\tc', 50)).toBe('a\nb\tc');
    fails(() => requiredText('The text', 'a\u0007b', 50));
    fails(() =>
      requiredText('The text', 'x'.repeat(MAX_EXPLANATION_CHARS + 1), MAX_EXPLANATION_CHARS),
    );
  });

  it('treats blank optional values as not stated', () => {
    expect(optionalLine('Author', '  ')).toBeNull();
    expect(optionalLine('Author', undefined)).toBeNull();
    expect(optionalText('Note', null)).toBeNull();
  });

  it('never echoes the rejected input in its message', () => {
    try {
      requiredLine('The title', 'topsecret\u0000');
    } catch (error) {
      expect((error as Error).message).not.toContain('topsecret');
    }
  });
});

describe('urls, references, enums, dates', () => {
  it('accepts only http and https URLs with a host and no credentials', () => {
    expect(optionalUrl('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    expect(optionalUrl('')).toBeNull();
    for (const bad of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'ftp://example.org',
      'https://',
      'https://user:pw@example.org',
      'https://example.org/\u0000',
      `https://example.org/${'a'.repeat(2100)}`,
    ]) {
      fails(() => optionalUrl(bad));
    }
  });

  it('accepts plain citations and rejects other characters', () => {
    expect(optionalScriptureReference(' Revelation 13:16-18 ')).toBe('Revelation 13:16-18');
    fails(() => optionalScriptureReference('Rev 13\n18'));
    fails(() => optionalScriptureReference('<b>Rev</b>'));
  });

  it('accepts only the defined classes, relations and statuses', () => {
    expect(claimKind('forecast')).toBe('forecast');
    expect(hypothesisStatus('under_review')).toBe('under_review');
    expect(linkRelation('context')).toBe('context');
    fails(() => claimKind('fact'));
    fails(() => hypothesisStatus('proven'));
    fails(() => linkRelation('proves'));
  });

  it('validates event and calendar dates', () => {
    expect(optionalEventDate('2026-03-10')?.precision).toBe('day');
    expect(optionalEventDate('')).toBeNull();
    fails(() => optionalEventDate('2026-03-10T14:30'));
    expect(optionalCalendarDate('Published date', '2026-03-10')).toBe('2026-03-10');
    expect(optionalCalendarDate('Published date', '2026-03')).toBe('2026-03');
    fails(() => optionalCalendarDate('Published date', '2026-03-10T10:00Z'));
    fails(() => optionalCalendarDate('Published date', '2026-02-30'));
  });
});
