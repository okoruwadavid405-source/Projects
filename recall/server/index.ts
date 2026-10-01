import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './db/connection.js';
import { systemClock, type AppContext } from './lib/context.js';
import { deleteExpiredSessions } from './repositories/sessions.js';
import { createQuestionGenerator } from './services/questionGenerator.js';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DATABASE_PATH ?? './data/recall.db';

const ctx: AppContext = {
  db: openDatabase(dbPath),
  clock: systemClock,
  secureCookies: production && process.env.INSECURE_COOKIES !== 'true',
  questionGenerator: createQuestionGenerator(),
};

deleteExpiredSessions(ctx.db, ctx.clock.now());
setInterval(() => deleteExpiredSessions(ctx.db, ctx.clock.now()), 6 * 3_600_000).unref();

// In production the compiled server lives at dist/server/server/index.js and the client at dist/client.
const staticDir = production ? resolve(fileURLToPath(import.meta.url), '../../../client') : undefined;
const app = createApp(ctx, { staticDir, trustProxy: process.env.TRUST_PROXY === 'true' || !production });

const server = app.listen(port, () => {
  console.log(`[recall] API listening on http://localhost:${port}${production ? '' : ' (dev — UI on http://localhost:5173)'}`);
  console.log(`[recall] Question generation: ${ctx.questionGenerator ? 'on' : 'off (set ANTHROPIC_API_KEY to enable)'}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      ctx.db.close();
      process.exit(0);
    });
  });
}
