import { diffDays, parseLocalDate, type LocalDate } from '@shared/dates';
import type { Rating, TopicDisplayStatus } from '@shared/scheduler';
import type { QuestionKind } from '@shared/validation';

const dateFmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
const toUtcDate = (d: LocalDate | string) => {
  const [y, m, day] = parseLocalDate(d).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};

/** "Thu, Oct 1" (adds the year when it differs from `today`'s). */
export function formatDate(d: LocalDate | string, today?: LocalDate): string {
  const sameYear = today ? d.slice(0, 4) === today.slice(0, 4) : true;
  return dateFmt({ weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(toUtcDate(d));
}

export const formatLongDate = (d: LocalDate | string) =>
  dateFmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(toUtcDate(d));

export const formatShortDate = (d: LocalDate | string) => dateFmt({ month: 'short', day: 'numeric' }).format(toUtcDate(d));

export const formatWeekday = (d: LocalDate | string) => dateFmt({ weekday: 'short' }).format(toUtcDate(d));

/** "Today", "Tomorrow", "In 5 days", "Yesterday", "3 days ago". */
export function relativeDay(d: LocalDate, today: LocalDate): string {
  const n = diffDays(d, today);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

export function dueLabel(daysUntilDue: number): string {
  if (daysUntilDue < 0) return `${-daysUntilDue} ${daysUntilDue === -1 ? 'day' : 'days'} overdue`;
  if (daysUntilDue === 0) return 'Due today';
  if (daysUntilDue === 1) return 'Due tomorrow';
  return `Due in ${daysUntilDue} days`;
}

export const formatInterval = (days: number) => (days === 1 ? '1 day' : `${days} days`);

export const pluralize = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const percent = (ratio: number | null) => (ratio === null ? '—' : `${Math.round(ratio * 100)}%`);

export const STATUS_LABEL: Record<TopicDisplayStatus, string> = {
  overdue: 'Overdue',
  due: 'Due today',
  new: 'New',
  learning: 'Learning',
  reviewing: 'Reviewing',
  mastered: 'Mastered',
};

export const RATING_META: Record<Rating, { label: string; description: string }> = {
  forgot: { label: 'Forgot', description: "I couldn't remember it." },
  hard: { label: 'Hard', description: 'I remembered it, but it was difficult.' },
  good: { label: 'Good', description: 'I remembered it correctly.' },
  easy: { label: 'Easy', description: 'I remembered it immediately.' },
};

export const KIND_LABEL: Record<QuestionKind, string> = {
  recall: 'Recall',
  explain: 'Explain',
  apply: 'Apply it',
  compare: 'Compare',
  troubleshoot: 'Spot the error',
};

export const UNDERSTANDING_LABELS = ['Lost', 'Shaky', 'Okay', 'Good', 'Solid'] as const;

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

/** RFC 4122 v4 id; falls back to getRandomValues where randomUUID is unavailable (non-secure origins). */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
