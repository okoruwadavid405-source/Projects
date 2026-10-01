import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import type { AppContext } from './lib/context.js';
import { loadSession, requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { csrfProtection, securityHeaders } from './middleware/security.js';
import { authRoutes } from './routes/auth.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { studyRoutes } from './routes/study.js';

export function createApp(ctx: AppContext, opts: { staticDir?: string; trustProxy?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders);

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(csrfProtection);
  api.use(loadSession(ctx));
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRoutes(ctx));
  api.use(requireAuth, studyRoutes(ctx));
  api.use(requireAuth, knowledgeRoutes(ctx));
  api.use(notFoundHandler);
  app.use('/api', api);

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = resolve(opts.staticDir);
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    // Client-side routing: any other GET returns the SPA shell.
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
