import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  diffDays,
  isLocalDate,
  isValidTimeZone,
  localDateIn,
  parseLocalDate,
} from '../shared/dates.js';

describe('LocalDate validation', () => {
  it('rejects impossible dates and non-ISO formats', () => {
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2026-04-31')).toBe(false);
    expect(isLocalDate('10/01/2026')).toBe(false);
    expect(isLocalDate('2026-1-1')).toBe(false);
    expect(isLocalDate(20261001)).toBe(false);
    expect(() => parseLocalDate('nope')).toThrow(RangeError);
  });
});

describe('arithmetic', () => {
  it('adds and diffs across months, years and DST changes', () => {
    const d = parseLocalDate;
    expect(addDays(d('2026-01-31'), 1)).toBe('2026-02-01');
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28');
    expect(addDays(d('2026-12-25'), 10)).toBe('2027-01-04');
    expect(diffDays(d('2027-01-04'), d('2026-12-25'))).toBe(10);
    // US DST starts 2026-03-08 and ends 2026-11-01 — still exactly one day apart.
    expect(diffDays(d('2026-03-09'), d('2026-03-08'))).toBe(1);
    expect(diffDays(d('2026-11-02'), d('2026-11-01'))).toBe(1);
    expect(dayOfWeek(d('2026-10-01'))).toBe(4); // Thursday
  });
});

describe('time zones', () => {
  it('computes "today" in the student\'s own time zone around midnight', () => {
    const instant = new Date('2026-10-01T03:30:00Z');
    expect(localDateIn('UTC', instant)).toBe('2026-10-01');
    expect(localDateIn('America/Toronto', instant)).toBe('2026-09-30'); // 23:30 EDT
    expect(localDateIn('Asia/Tokyo', instant)).toBe('2026-10-01');
    expect(localDateIn('Pacific/Kiritimati', new Date('2026-12-31T10:00:00Z'))).toBe('2027-01-01');
  });

  it('validates IANA time zone names', () => {
    expect(isValidTimeZone('America/Toronto')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
