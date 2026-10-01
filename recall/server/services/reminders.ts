/**
 * Reminder scheduling, independent of how reminders are delivered.
 *
 * The browser delivers reminders today (client/src/lib/reminders.ts) while a
 * Recall tab is open. To remind students whose browser is closed, a production
 * deployment adds a delivery channel — Web Push needs VAPID keys and a stored
 * push subscription per device; email needs an SMTP/API credential — plus a job
 * that runs every few minutes:
 *
 *   for (const { user, digest } of findUsersDueForReminder(ctx, windowStart, now)) {
 *     await channel.send(user, digest);   // ← the only part needing credentials
 *   }
 *
 * No such channel is configured in this repository, so nothing here pretends to send.
 */
import type { ReminderDigest, User } from '../../shared/api.js';
import { localDateIn } from '../../shared/dates.js';
import type { AppContext } from '../lib/context.js';
import { findUserById, toPublicUser } from '../repositories/users.js';
import { getReminderDigest } from './stats.js';

export interface ReminderChannel {
  send(user: User, digest: ReminderDigest): Promise<void>;
}

/** Minutes after local midnight for an instant in a time zone. */
function localMinutes(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/**
 * Users whose local reminder time falls in (from, to] and who have reviews due.
 * `to - from` should match the job interval so each reminder fires exactly once.
 */
export function findUsersDueForReminder(ctx: AppContext, from: Date, to: Date): { user: User; digest: ReminderDigest }[] {
  const rows = ctx.db.prepare('SELECT id FROM users WHERE reminder_enabled = 1').all() as { id: number }[];
  const out: { user: User; digest: ReminderDigest }[] = [];
  for (const { id } of rows) {
    const user = toPublicUser(findUserById(ctx.db, id)!);
    const [h, m] = user.reminderTime.split(':').map(Number);
    const target = h * 60 + m;
    const sameDay = localDateIn(user.timezone, from) === localDateIn(user.timezone, to);
    const a = localMinutes(user.timezone, from);
    const b = localMinutes(user.timezone, to);
    const inWindow = sameDay ? target > a && target <= b : target > a || target <= b;
    if (!inWindow) continue;
    const digest = getReminderDigest(ctx, user);
    if (digest.dueCount > 0) out.push({ user, digest });
  }
  return out;
}
