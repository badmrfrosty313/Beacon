/**
 * Event and calendar dates for Watchtower. The TypeScript twin of
 * src-tauri/src/watchtower/dates.rs; both are tested against the shared
 * data/watchtower/date-vectors.json.
 *
 * An event date says when the event HAPPENED, at the precision the user knows: `2026`,
 * `2026-11`, `2026-11-05`, or an instant with an explicit zone (`2026-11-05T14:30Z`,
 * `2026-11-05T14:30-05:00`). A time without a zone is rejected and a missing date stays
 * missing. `sort` (minutes since 1970-01-01T00:00Z at the START of the stated period) is an
 * ordering key, not a claim about the event time.
 */
import type { DatePrecision } from '../../api/types';

export type DateErrorCode = 'malformed' | 'invalid_date';

export interface ParsedDate {
  /** The date exactly as it is stored (trimmed). */
  text: string;
  precision: DatePrecision;
  sort: number;
}

export class DateError extends Error {
  readonly code: DateErrorCode;

  constructor(code: DateErrorCode) {
    super(
      code === 'malformed'
        ? 'Use YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DDTHH:MM with a zone such as Z or -05:00.'
        : 'That date does not exist on the calendar.',
    );
    this.name = 'DateError';
    this.code = code;
  }
}

const WHITESPACE_ENDS = /^\p{White_Space}+|\p{White_Space}+$/gu;

/** Trim like Rust's `str::trim` (Unicode White_Space), not like `String.prototype.trim`. */
export function trimWhitespace(text: string): string {
  return text.replace(WHITESPACE_ENDS, '');
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return isLeap(year) ? 29 : 28;
}

/** Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's algorithm). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** ASCII digits only (so full-width digits and the like are not numbers). */
function digits(text: string, start: number, length: number): number {
  const slice = text.slice(start, start + length);
  if (slice.length !== length || !/^[0-9]+$/.test(slice)) throw new DateError('malformed');
  return Number(slice);
}

function expect(text: string, at: number, want: string): void {
  if (text.charAt(at) !== want) throw new DateError('malformed');
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  precision: DatePrecision;
}

function datePart(text: string): DateParts {
  const year = digits(text, 0, 4);
  let month = 1;
  let day = 1;
  let precision: DatePrecision = 'year';
  if (text.length > 4) {
    expect(text, 4, '-');
    month = digits(text, 5, 2);
    precision = 'month';
    if (text.length > 7) {
      expect(text, 7, '-');
      day = digits(text, 8, 2);
      precision = 'day';
    }
  }
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new DateError('invalid_date');
  }
  return { year, month, day, precision };
}

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Used for publication and retrieval dates. */
export function parseCalendarDate(input: string): ParsedDate {
  const text = trimWhitespace(input);
  if (![4, 7, 10].includes(text.length)) throw new DateError('malformed');
  const { year, month, day, precision } = datePart(text);
  return { text, precision, sort: daysFromCivil(year, month, day) * 1440 };
}

/** A calendar date, or `YYYY-MM-DDTHH:MM` plus `Z` or `+HH:MM` / `-HH:MM`. */
export function parseEventDate(input: string): ParsedDate {
  const text = trimWhitespace(input);
  if ([4, 7, 10].includes(text.length)) return parseCalendarDate(text);
  if (text.length !== 17 && text.length !== 22) throw new DateError('malformed');

  const { year, month, day } = datePart(text.slice(0, 10));
  expect(text, 10, 'T');
  const hour = digits(text, 11, 2);
  expect(text, 13, ':');
  const minute = digits(text, 14, 2);

  let offset = 0;
  if (text.length === 17) {
    expect(text, 16, 'Z');
  } else {
    const sign = text.charAt(16) === '+' ? 1 : text.charAt(16) === '-' ? -1 : 0;
    if (sign === 0) throw new DateError('malformed');
    const offHour = digits(text, 17, 2);
    expect(text, 19, ':');
    const offMinute = digits(text, 20, 2);
    if (offHour > 23 || offMinute > 59) throw new DateError('invalid_date');
    offset = sign * (offHour * 60 + offMinute);
  }
  if (hour > 23 || minute > 59) throw new DateError('invalid_date');

  return {
    text,
    precision: 'minute',
    sort: daysFromCivil(year, month, day) * 1440 + hour * 60 + minute - offset,
  };
}
