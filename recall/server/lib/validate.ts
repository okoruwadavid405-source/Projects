import type { z } from 'zod';
import { badRequest, notFound } from './errors.js';

/** Parse untrusted input; on failure throw a 400 with a per-field message map. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    fields[key] ??= issue.message;
  }
  const first = Object.values(fields)[0] ?? 'Please check the form and try again.';
  throw badRequest(first, fields);
}

/** Route ids must be positive integers; anything else is simply "not found". */
export function parseId(value: unknown, what: string): number {
  const n = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound(what);
  return n;
}
