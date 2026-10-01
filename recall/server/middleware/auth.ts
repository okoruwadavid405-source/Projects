import type { NextFunction, Request, Response } from 'express';
import type { User } from '../../shared/api.js';
import type { AppContext } from '../lib/context.js';
import { unauthorized } from '../lib/errors.js';
import { findSessionUserId } from '../repositories/sessions.js';
import { findUserById, toPublicUser } from '../repositories/users.js';

export const SESSION_COOKIE = 'recall_session';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    sessionToken?: string;
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function setSessionCookie(ctx: AppContext, res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.secureCookies,
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(ctx: AppContext, res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies, path: '/' });
}

/** Attaches `req.user` when a valid session cookie is present. */
export function loadSession(ctx: AppContext) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token && token.length <= 128) {
      const userId = findSessionUserId(ctx.db, token, ctx.clock.now());
      const user = userId !== undefined ? findUserById(ctx.db, userId) : undefined;
      if (user) {
        req.user = toPublicUser(user);
        req.sessionToken = token;
      }
    }
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Narrow `req.user` inside handlers mounted behind `requireAuth`. */
export function currentUser(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}
