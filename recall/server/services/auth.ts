import type { User } from '../../shared/api.js';
import type { RegisterInput } from '../../shared/validation.js';
import { transaction } from '../db/connection.js';
import type { AppContext } from '../lib/context.js';
import { conflict, isUniqueViolation, unauthorized } from '../lib/errors.js';
import { getDummyHash, hashPassword, verifyPassword } from '../lib/password.js';
import { nowIso } from '../lib/time.js';
import { createSession } from '../repositories/sessions.js';
import { findUserByEmail, findUserById, insertUser, toPublicUser } from '../repositories/users.js';

export interface AuthResult {
  user: User;
  token: string;
  expiresAt: Date;
}

const EMAIL_TAKEN = 'An account with this email already exists. Try logging in instead.';

export async function register(ctx: AppContext, input: RegisterInput): Promise<AuthResult> {
  if (findUserByEmail(ctx.db, input.email)) throw conflict(EMAIL_TAKEN, { email: EMAIL_TAKEN });
  const passwordHash = await hashPassword(input.password);
  try {
    return transaction(ctx.db, () => {
      const id = insertUser(ctx.db, {
        name: input.name,
        email: input.email,
        passwordHash,
        timezone: input.timezone ?? 'UTC',
        now: nowIso(ctx),
      });
      const session = createSession(ctx.db, id, ctx.clock.now());
      return { user: toPublicUser(findUserById(ctx.db, id)!), ...session };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(EMAIL_TAKEN, { email: EMAIL_TAKEN });
    throw err;
  }
}

export async function login(ctx: AppContext, email: string, password: string): Promise<AuthResult> {
  const user = findUserByEmail(ctx.db, email);
  // Always run a full password check so response time does not reveal whether the email exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) throw unauthorized('Incorrect email or password.');
  const session = createSession(ctx.db, user.id, ctx.clock.now());
  return { user: toPublicUser(user), ...session };
}
