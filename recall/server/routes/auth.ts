import { Router } from 'express';
import { loginSchema, registerSchema } from '../../shared/validation.js';
import type { AppContext } from '../lib/context.js';
import { parse } from '../lib/validate.js';
import { clearSessionCookie, setSessionCookie } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import { deleteSession } from '../repositories/sessions.js';
import { login, register } from '../services/auth.js';

export function authRoutes(ctx: AppContext): Router {
  const router = Router();
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 20,
    key: (req) => `auth:${req.ip}`,
    message: 'Too many attempts. Please wait a few minutes and try again.',
  });

  router.post('/register', authLimiter, async (req, res) => {
    const input = parse(registerSchema, req.body);
    const { user, token, expiresAt } = await register(ctx, input);
    setSessionCookie(ctx, res, token, expiresAt);
    res.status(201).json({ user });
  });

  router.post('/login', authLimiter, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const { user, token, expiresAt } = await login(ctx, email, password);
    setSessionCookie(ctx, res, token, expiresAt);
    res.json({ user });
  });

  router.post('/logout', (req, res) => {
    if (req.sessionToken) deleteSession(ctx.db, req.sessionToken);
    clearSessionCookie(ctx, res);
    res.status(204).end();
  });

  // Returns `user: null` (not 401) for visitors, so checking the session is not an error.
  router.get('/me', (req, res) => {
    res.json({ user: req.user ?? null });
  });

  return router;
}
