import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '../db/connection.js';

export const SESSION_TTL_DAYS = 30;

/** Only a SHA-256 of the session token is stored, so a leaked database cannot be used to log in. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSession(db: Database, userId: number, now: Date): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now.toISOString(),
    expiresAt.toISOString(),
  );
  return { token, expiresAt };
}

export function findSessionUserId(db: Database, token: string, now: Date): number | undefined {
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(hashToken(token)) as { user_id: number; expires_at: string } | undefined;
  if (!row) return undefined;
  if (Date.parse(row.expires_at) <= now.getTime()) {
    deleteSession(db, token);
    return undefined;
  }
  return row.user_id;
}

export function deleteSession(db: Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function deleteExpiredSessions(db: Database, now: Date): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
}
