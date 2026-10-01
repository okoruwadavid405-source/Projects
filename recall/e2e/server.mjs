/**
 * Boots the compiled production app for the E2E run with deterministic stand-ins
 * for Claude (question writer, document reader, assistant, web search), so the AI
 * features can be exercised without credentials or network access. Test-only.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../dist/server/server/app.js';
import { openDatabase } from '../dist/server/server/db/connection.js';
import { seedCatalog, STARTER_CATALOG } from '../dist/server/server/knowledge/catalog.js';
import { extractWithPatterns } from '../dist/server/server/knowledge/patternExtractor.js';
import * as repo from '../dist/server/server/knowledge/repository.js';
import { topicKey } from '../dist/server/shared/knowledge.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const questionGenerator = {
  n: 0,
  async generate(req) {
    await wait(400);
    return Array.from({ length: req.count }, () => {
      const i = ++this.n;
      return {
        prompt: `Practice ${i}: work through a small example of ${req.topic.title} and explain each step.`,
        answer: `Model answer ${i} for ${req.topic.title}.`,
        kind: ['apply', 'explain', 'compare', 'troubleshoot', 'recall'][i % 5],
        difficulty: 'intermediate',
      };
    });
  },
};

const ai = {
  async extractCourseInfo(input, hints) {
    await wait(600);
    return extractWithPatterns(input.kind === 'text' ? input.text : '', hints);
  },
  async suggestTopics() {
    return [{ name: 'Pigeonhole Principle', reason: 'Commonly studied alongside counting.' }];
  },
  async *streamAnswer({ messages }) {
    const ctx = messages[messages.length - 1].content;
    const due = /Student's study record:\n- (.+?):/.exec(ctx)?.[1] ?? 'your confirmed topics';
    for (const part of [`Based on your study record, start with ${due}. `, 'Your syllabus lists it as confirmed [S1].']) {
      await wait(150);
      yield part;
    }
  },
};

const web = {
  async search() {
    return [
      { title: 'General blog post about COMP 1805', url: 'https://someblog.example/comp1805', pageAge: null },
      { title: 'COMP 1805 course page', url: 'https://carleton.ca/scs/comp1805', pageAge: null },
    ];
  },
  async fetchPage(url) {
    return { url, title: 'COMP 1805 course page', text: 'Week 1: Logic', pdf: null };
  },
};

const ctx = {
  db: openDatabase(process.env.DATABASE_PATH),
  clock: { now: () => new Date() },
  secureCookies: false,
  questionGenerator: process.env.E2E_NO_GENERATOR ? null : questionGenerator,
  knowledge: process.env.E2E_NO_GENERATOR ? { ai: null, web: null, embeddings: null } : { ai, web, embeddings: null },
};
const now = new Date().toISOString();
seedCatalog(ctx.db, STARTER_CATALOG, now);

// A shared past-term outline, as a curator would import it, so "What am I missing?" has something to compare.
const comp1805 = repo.searchCourses(ctx.db, 'COMP 1805').find((c) => c.university.name === 'Carleton University');
const year = new Date().getFullYear();
const pastVersion = repo.findOrCreateVersion(ctx.db, comp1805.id, { term: 'fall', year: year - 1 }, now);
const outline = repo.insertSource(
  ctx.db,
  { courseId: comp1805.id, versionId: pastVersion, origin: 'official', documentType: 'course_outline', title: `Fall ${year - 1} course outline (E2E fixture)`, visibility: 'public', ownerUserId: null },
  now,
);
repo.insertTopics(
  ctx.db,
  outline,
  ['Logic', 'Set Theory', 'Functions', 'Relations', 'Mathematical Induction', 'Counting', 'Graph Theory'].map((name) => ({ name, topicKey: topicKey(name) })),
  topicKey,
);

const staticDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/client');
createApp(ctx, { staticDir }).listen(Number(process.env.PORT), () => console.log('e2e server ready'));
