import type { AppContext } from './context.js';
import { tooManyRequests } from './errors.js';

const buckets = new WeakMap<AppContext, Map<string, { count: number; resetAt: number }>>();

/** Per-user hourly allowance for paid or expensive operations (in-memory; one process). */
export function useQuota(ctx: AppContext, key: string, perHour: number, message: string) {
  let map = buckets.get(ctx);
  if (!map) buckets.set(ctx, (map = new Map()));
  const now = ctx.clock.now().getTime();
  let entry = map.get(key);
  if (!entry || entry.resetAt <= now) map.set(key, (entry = { count: 0, resetAt: now + 3_600_000 }));
  if (++entry.count > perHour) throw tooManyRequests(message);
}
