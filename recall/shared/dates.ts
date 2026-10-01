/**
 * Calendar-date utilities.
 *
 * Reviews are scheduled on *calendar days in the student's own time zone*, not
 * on instants. A `LocalDate` is an ISO "YYYY-MM-DD" string that is always
 * validated on the way in. All arithmetic converts to an integer "epoch day"
 * (days since 1970-01-01 on the proleptic Gregorian calendar, computed in UTC),
 * so month ends, leap years, year changes and DST transitions are handled by
 * integer math rather than by string manipulation or local-time Date objects.
 */

export type LocalDate = string & { readonly __brand: 'LocalDate' };

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function parseLocalDate(value: string): LocalDate {
  if (!isLocalDate(value)) throw new RangeError(`Invalid calendar date: ${value}`);
  return value;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toEpochDay(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromEpochDay(epochDay: number): LocalDate {
  const dt = new Date(epochDay * MS_PER_DAY);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}` as LocalDate;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + Math.trunc(days));
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function diffDays(to: LocalDate, from: LocalDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return compareDates(a, b) <= 0 ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return compareDates(a, b) >= 0 ? a : b;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date it currently is in `timeZone` at instant `now`. */
export function localDateIn(timeZone: string, now: Date = new Date()): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return parseLocalDate(`${get('year')}-${get('month')}-${get('day')}`);
}

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: LocalDate): number {
  // 1970-01-01 was a Thursday (4).
  return (((toEpochDay(date) + 4) % 7) + 7) % 7;
}
