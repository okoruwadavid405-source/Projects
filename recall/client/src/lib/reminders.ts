/**
 * Browser reminders.
 *
 * What works today: while Recall is open in a tab (foreground or background),
 * it schedules a local timer for the user's reminder time, asks the API how many
 * reviews are due, and shows a system notification via the Notification API.
 *
 * What does not: reminders when no Recall tab is open. That requires Web Push
 * (a service worker, a push subscription and a server holding VAPID keys that
 * sends pushes on a schedule). The server already exposes
 * `findUsersDueForReminder` (server/services/reminders.ts) for such a worker; see
 * README › Notifications.
 */
import { useEffect } from 'react';
import type { User } from '@shared/api';
import { localDateIn } from '@shared/dates';
import { fetchReminderDigest } from '../api/hooks';

export type ReminderSupport = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationSupport(): ReminderSupport {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<ReminderSupport> {
  if (notificationSupport() === 'unsupported') return 'unsupported';
  return Notification.requestPermission();
}

export function showNotification(title: string, body: string) {
  if (notificationSupport() !== 'granted') return false;
  const n = new Notification(title, { body, icon: '/favicon.svg', tag: 'recall-daily' });
  n.onclick = () => {
    window.focus();
    n.close();
  };
  return true;
}

const LAST_KEY = 'recall:last-reminder';

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function writeLast(value: string) {
  try {
    localStorage.setItem(LAST_KEY, value);
  } catch {
    /* storage unavailable — at worst a duplicate reminder */
  }
}

/** Minutes past midnight of "HH:MM" in the user's time zone right now. */
function minutesNow(timezone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/** True when it is at or past the reminder time today (user's zone) and no reminder has been sent today. */
export function reminderIsDue(user: Pick<User, 'timezone' | 'reminderTime'>, now: Date, lastSentDay: string | null): boolean {
  const [h, m] = user.reminderTime.split(':').map(Number);
  const today = localDateIn(user.timezone, now);
  return lastSentDay !== today && minutesNow(user.timezone, now) >= h * 60 + m;
}

export function useReminders(user: User) {
  useEffect(() => {
    if (!user.reminderEnabled) return;
    // Only notify when the reminder time arrives while Recall is open; if it had already
    // passed when the page loaded, the student is looking at their reviews anyway.
    const opened = new Date();
    if (reminderIsDue(user, opened, readLast())) writeLast(localDateIn(user.timezone, opened));

    let cancelled = false;
    const tick = async () => {
      const now = new Date();
      if (notificationSupport() !== 'granted' || !reminderIsDue(user, now, readLast())) return;
      writeLast(localDateIn(user.timezone, now)); // claim it first so other tabs don't duplicate
      try {
        const digest = await fetchReminderDigest();
        if (!cancelled && digest.dueCount > 0) showNotification('Time to review', digest.message);
      } catch {
        /* offline: skip this reminder rather than nag later */
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);
}
