/**
 * Field validation for Watchtower records: the TypeScript mirror of
 * src-tauri/src/watchtower/validation.rs. The desktop app validates in Rust; this module is
 * what the browser demo's IndexedDB backend uses, so both reject the same input.
 * Failures are thrown as `ValidationFailure` with a user-facing message that never echoes input.
 */
import { CLAIM_KINDS, HYPOTHESIS_STATUSES, LINK_RELATIONS } from '../../api/types';
import {
  DateError,
  parseCalendarDate,
  parseEventDate,
  trimWhitespace,
  type ParsedDate,
} from './dates';

export const MAX_SHORT_CHARS = 200;
export const MAX_TEXT_CHARS = 5000;
export const MAX_EXPLANATION_CHARS = 2000;
export const MAX_URL_CHARS = 2048;
export const MAX_SCRIPTURE_REFERENCE_CHARS = 100;
export const MAX_RECORDS_PER_TABLE = 5000;

export class ValidationFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationFailure';
  }
}

const CONTROL = /\p{Cc}/u;
const CONTROL_OR_SPACE = /[\p{Cc}\p{White_Space}]/u;

function chars(text: string): number {
  return Array.from(text).length;
}

function present(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = trimWhitespace(value);
  return text === '' ? null : text;
}

function singleLine(label: string, value: string | null | undefined, max: number): string | null {
  const text = present(value);
  if (text === null) return null;
  if (chars(text) > max) throw new ValidationFailure(`${label} must be at most ${max} characters.`);
  if (CONTROL.test(text)) {
    throw new ValidationFailure(`${label} must not contain control characters.`);
  }
  return text;
}

export function requiredLine(label: string, value: string): string {
  const text = singleLine(label, value, MAX_SHORT_CHARS);
  if (text === null) throw new ValidationFailure(`${label} is required.`);
  return text;
}

export function optionalLine(label: string, value: string | null | undefined): string | null {
  return singleLine(label, value, MAX_SHORT_CHARS);
}

function multiLine(label: string, value: string | null | undefined, max: number): string | null {
  const text = present(value);
  if (text === null) return null;
  if (chars(text) > max) throw new ValidationFailure(`${label} must be at most ${max} characters.`);
  for (const c of text) {
    if (CONTROL.test(c) && c !== '\n' && c !== '\r' && c !== '\t') {
      throw new ValidationFailure(
        `${label} must not contain control characters other than line breaks and tabs.`,
      );
    }
  }
  return text;
}

export function requiredText(label: string, value: string, max: number = MAX_TEXT_CHARS): string {
  const text = multiLine(label, value, max);
  if (text === null) throw new ValidationFailure(`${label} is required.`);
  return text;
}

export function optionalText(label: string, value: string | null | undefined): string | null {
  return multiLine(label, value, MAX_TEXT_CHARS);
}

/** A web address kept as data. Never fetched; credentials in the address are refused. */
export function optionalUrl(value: string | null | undefined): string | null {
  const text = present(value);
  if (text === null) return null;
  if (chars(text) > MAX_URL_CHARS) {
    throw new ValidationFailure(`The source URL must be at most ${MAX_URL_CHARS} characters.`);
  }
  if (CONTROL_OR_SPACE.test(text)) {
    throw new ValidationFailure('The source URL must not contain spaces or control characters.');
  }
  // The scheme is matched without writing a full URL literal, so the offline source guard
  // (which forbids URLs in application code) stays meaningful.
  const scheme = /^(https?):\/\//i.exec(text);
  if (scheme === null) {
    throw new ValidationFailure('The source URL must be an http or https address.');
  }
  const rest = text.slice(scheme[0].length);
  const authority = rest.split(/[/?#]/, 1)[0] ?? '';
  if (authority === '') throw new ValidationFailure('The source URL needs a host name.');
  if (authority.includes('@')) {
    throw new ValidationFailure('The source URL must not contain a user name or password.');
  }
  return text;
}

export function optionalScriptureReference(value: string | null | undefined): string | null {
  const text = present(value);
  if (text === null) return null;
  if (chars(text) > MAX_SCRIPTURE_REFERENCE_CHARS) {
    throw new ValidationFailure(
      `The Scripture reference must be at most ${MAX_SCRIPTURE_REFERENCE_CHARS} characters.`,
    );
  }
  if (!/^[A-Za-z0-9 .:-]+$/.test(text)) {
    throw new ValidationFailure(
      "The Scripture reference may only contain letters, numbers, spaces, '.', ':' and '-'.",
    );
  }
  return text;
}

function dateFailure(label: string, error: unknown): never {
  if (error instanceof DateError) throw new ValidationFailure(`${label}: ${error.message}`);
  throw error;
}

export function optionalCalendarDate(
  label: string,
  value: string | null | undefined,
): string | null {
  if (present(value) === null) return null;
  try {
    return parseCalendarDate(value as string).text;
  } catch (error) {
    return dateFailure(label, error);
  }
}

export function optionalEventDate(value: string | null | undefined): ParsedDate | null {
  if (present(value) === null) return null;
  try {
    return parseEventDate(value as string);
  } catch (error) {
    return dateFailure('Event date', error);
  }
}

export function oneOf<T extends string>(label: string, value: string, allowed: readonly T[]): T {
  const text = trimWhitespace(value);
  const match = allowed.find((candidate) => candidate === text);
  if (match === undefined) {
    throw new ValidationFailure(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return match;
}

export const claimKind = (value: string) => oneOf('The record type', value, CLAIM_KINDS);
export const hypothesisStatus = (value: string) => oneOf('The status', value, HYPOTHESIS_STATUSES);
export const linkRelation = (value: string) => oneOf('The relationship', value, LINK_RELATIONS);
