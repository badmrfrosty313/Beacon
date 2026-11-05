import { describe, expect, it } from 'vitest';

import vectors from '../../../data/watchtower/date-vectors.json';
import { DateError, parseCalendarDate, parseEventDate } from './dates';

interface Vector {
  input: string;
  ok: boolean;
  text?: string;
  precision?: string;
  sort?: number;
  code?: string;
}

const data = vectors as unknown as { event: Vector[]; calendar: Vector[] };

function check(
  parse: (input: string) => { text: string; precision: string; sort: number },
  v: Vector,
) {
  if (v.ok) {
    const result = parse(v.input);
    expect(result).toEqual({ text: v.text, precision: v.precision, sort: v.sort });
  } else {
    let thrown: unknown;
    try {
      parse(v.input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DateError);
    expect((thrown as DateError).code).toBe(v.code);
  }
}

describe('event dates (shared vectors, also run by the Rust parser)', () => {
  it('has a substantial vector set', () => {
    expect(data.event.length).toBeGreaterThanOrEqual(40);
  });
  for (const v of data.event) {
    it(`${JSON.stringify(v.input)} → ${v.ok ? `${v.precision} ${v.sort}` : v.code}`, () =>
      check(parseEventDate, v));
  }
});

describe('calendar dates (shared vectors)', () => {
  for (const v of data.calendar) {
    it(`${JSON.stringify(v.input)} → ${v.ok ? v.precision : v.code}`, () =>
      check(parseCalendarDate, v));
  }
});

describe('ordering semantics', () => {
  it('orders by instant, not by the digits written', () => {
    // 09:30-05:00 is 14:30Z, later than 14:00Z.
    expect(parseEventDate('2026-11-05T09:30-05:00').sort).toBeGreaterThan(
      parseEventDate('2026-11-05T14:00Z').sort,
    );
  });
  it('a coarser date sorts at the start of its period', () => {
    expect(parseEventDate('2026').sort).toBe(parseEventDate('2026-01-01').sort);
    expect(parseEventDate('2026-02').sort).toBeLessThan(parseEventDate('2026-02-02').sort);
  });
});
