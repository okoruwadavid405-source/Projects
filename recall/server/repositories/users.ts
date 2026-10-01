import type { User } from '../../shared/api.js';
import type { Database } from '../db/connection.js';

interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  timezone: string;
  reminder_enabled: number;
  reminder_time: string;
  created_at: string;
}

export type UserWithHash = User & { passwordHash: string };

const toUser = (r: UserRow): UserWithHash => ({
  id: r.id,
  name: r.name,
  email: r.email,
  timezone: r.timezone,
  reminderEnabled: r.reminder_enabled === 1,
  reminderTime: r.reminder_time,
  createdAt: r.created_at,
  passwordHash: r.password_hash,
});

export function toPublicUser({ passwordHash: _omit, ...user }: UserWithHash): User {
  return user;
}

export function findUserByEmail(db: Database, email: string): UserWithHash | undefined {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  return row && toUser(row);
}

export function findUserById(db: Database, id: number): UserWithHash | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row && toUser(row);
}

export function insertUser(
  db: Database,
  input: { name: string; email: string; passwordHash: string; timezone: string; now: string },
): number {
  const result = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.name, input.email, input.passwordHash, input.timezone, input.now, input.now);
  return Number(result.lastInsertRowid);
}

export function updateUserSettings(
  db: Database,
  id: number,
  patch: { name?: string; timezone?: string; reminderEnabled?: boolean; reminderTime?: string },
  now: string,
): void {
  db.prepare(
    `UPDATE users SET
       name = COALESCE(?, name),
       timezone = COALESCE(?, timezone),
       reminder_enabled = COALESCE(?, reminder_enabled),
       reminder_time = COALESCE(?, reminder_time),
       updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.name ?? null,
    patch.timezone ?? null,
    patch.reminderEnabled === undefined ? null : patch.reminderEnabled ? 1 : 0,
    patch.reminderTime ?? null,
    now,
    id,
  );
}

export function deleteUser(db: Database, id: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}
