/**
 * Boots the compiled production app for the E2E run with a deterministic
 * question generator in place of Claude, so the generation UI can be tested
 * without credentials or network access. Not used outside tests.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../dist/server/server/app.js';
import { openDatabase } from '../dist/server/server/db/connection.js';

const fakeGenerator = {
  n: 0,
  async generate(req) {
    await new Promise((r) => setTimeout(r, 400)); // behave like a real network call
    return Array.from({ length: req.count }, () => {
      const i = ++this.n;
      return {
        prompt: `Practice ${i}: work through a small example of ${req.topic.title} and explain each step.`,
        answer: `Model answer ${i} for ${req.topic.title}.`,
        kind: ['apply', 'explain', 'compare', 'troubleshoot', 'recall'][i % 5],
      };
    });
  },
};

const ctx = {
  db: openDatabase(process.env.DATABASE_PATH),
  clock: { now: () => new Date() },
  secureCookies: false,
  questionGenerator: process.env.E2E_NO_GENERATOR ? null : fakeGenerator,
};
const staticDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/client');
createApp(ctx, { staticDir }).listen(Number(process.env.PORT), () => console.log('e2e server ready'));
