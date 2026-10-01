import type { NextFunction, Request, Response } from 'express';
import { AppError, tooManyRequests } from '../lib/errors.js';

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence in depth, on top of SameSite=Lax cookies: state-changing API
 * requests must be JSON (which a cross-site HTML form cannot send without a
 * CORS preflight) and, when the browser sends an Origin header, it must match
 * the host the request was sent to.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (!UNSAFE.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let originHost: string | undefined;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = undefined;
    }
    // X-Forwarded-Host is only honoured behind a trusted proxy (or the Vite dev proxy).
    const forwarded = req.app.get('trust proxy') ? req.headers['x-forwarded-host'] : undefined;
    const host = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined) ?? req.headers.host;
    if (!originHost || originHost !== host) {
      return next(new AppError(403, 'bad_origin', 'This request was blocked for your security. Please reload the page.'));
    }
  }
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (hasBody && !req.is('application/json')) {
    return next(new AppError(415, 'unsupported_media_type', 'Requests must be sent as JSON.'));
  }
  next();
}

/** Fixed-window in-memory rate limiter — adequate for a single-process deployment. */
export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string; message: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = opts.key(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    if (entry.count > opts.max) return next(tooManyRequests(opts.message));
    next();
  };
}
