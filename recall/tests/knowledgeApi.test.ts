import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionDraft } from '../shared/api.js';
import type { Extraction } from '../shared/knowledgeApi.js';
import { topicKey } from '../shared/knowledge.js';
import { ASSISTANT_SYSTEM } from '../server/knowledge/assistant.js';
import { documentJob } from '../server/knowledge/documents.js';
import { extractWithPatterns } from '../server/knowledge/patternExtractor.js';
import { NO_PROVIDERS, ProviderError, type AIProvider, type ChatMessage, type DocumentInput, type ExtractionHints, type KnowledgeProviders, type WebSearchProvider } from '../server/knowledge/providers.js';
import * as repo from '../server/knowledge/repository.js';
import { backgroundJob } from '../server/services/questionFlow.js';
import type { GenerationRequest, QuestionGenerator } from '../server/services/questionGenerator.js';
import { Client, startServer, type TestServer } from './helpers.js';
import { makePdf } from './fixtures/make.js';
import { SYLLABUS_FALL_2026 } from './fixtures/syllabus.js';

const OUTLINE_FALL_2025 = `COMP 1805 Discrete Structures I — Fall 2025
Instructor: Dr. Former Instructor
Week 1: Logic
Week 2: Set Theory
Week 3: Functions
Week 4: Relations
Week 5: Mathematical Induction
Week 6: Counting
Week 7: Graph Theory`;

/** AI stand-in: reads documents with the pattern extractor and records every call. */
class FakeAI implements AIProvider {
  extractions: { input: DocumentInput; hints: ExtractionHints }[] = [];
  answers: { system: string; messages: ChatMessage[] }[] = [];
  failExtraction = false;
  async extractCourseInfo(input: DocumentInput, hints: ExtractionHints): Promise<Extraction> {
    this.extractions.push({ input, hints });
    if (this.failExtraction) throw new ProviderError('Document analysis is busy right now.', true);
    const text = input.kind === 'text' ? input.text : SYLLABUS_FALL_2026;
    return extractWithPatterns(text, hints);
  }
  async suggestTopics() {
    return [
      { name: 'Pigeonhole Principle', reason: 'Often taught with counting.' },
      { name: 'Sets', reason: 'Already known — should be filtered out.' },
    ];
  }
  async *streamAnswer(req: { system: string; messages: ChatMessage[] }) {
    this.answers.push(req);
    yield 'Functions map each input ';
    yield 'to exactly one output [S1].';
  }
}

class FakeWeb implements WebSearchProvider {
  queries: string[] = [];
  async search(query: string) {
    this.queries.push(query);
    return [
      { title: 'Random blog: COMP 1805 notes', url: 'https://someblog.example/comp1805', pageAge: null },
      { title: 'Discrete Math — LibreTexts', url: 'https://math.libretexts.org/discrete', pageAge: null },
      { title: 'COMP 1805 Fall 2025 outline', url: 'https://carleton.ca/scs/comp1805-f25.html', pageAge: '2025-08-30' },
    ];
  }
  async fetchPage(url: string) {
    return { url, title: 'COMP 1805 Fall 2025 outline', text: OUTLINE_FALL_2025, pdf: null };
  }
}

class RecordingGenerator implements QuestionGenerator {
  calls: GenerationRequest[] = [];
  async generate(req: GenerationRequest): Promise<QuestionDraft[]> {
    this.calls.push(req);
    return Array.from({ length: req.count }, (_, i) => ({
      prompt: `Q${this.calls.length}.${i} about ${req.topic.title}?`,
      answer: 'A.',
      kind: 'apply' as const,
      difficulty: 'intermediate' as const,
    }));
  }
}

let srv: TestServer;
afterEach(() => srv.close());

async function upload(c: Client, scId: number, filename: string, data: Buffer | string, type = 'syllabus') {
  const res = await fetch(`${srv.url}/api/knowledge/student-courses/${scId}/documents?type=${type}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(filename), Cookie: c.cookie },
    body: typeof data === 'string' ? Buffer.from(data) : data,
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function enroll(c: Client, code = 'comp1805') {
  const found = (await c.get(`/catalog/courses?q=${code}`)).body.courses;
  expect(found[0]).toMatchObject({ code: 'COMP 1805', university: { name: 'Carleton University' }, verified: true });
  const res = await c.post('/knowledge/student-courses', { catalogCourseId: found[0].id, term: 'fall', year: 2026 });
  expect(res.status).toBe(201);
  return res.body.studentCourse;
}

/** An official Fall 2025 outline as a curator would import it into the shared catalog. */
function addPublicHistoricalOutline(catalogCourseId: number) {
  const db = srv.ctx.db;
  const versionId = repo.findOrCreateVersion(db, catalogCourseId, { term: 'fall', year: 2025 }, 'x');
  const id = repo.insertSource(
    db,
    { courseId: catalogCourseId, versionId, origin: 'official', documentType: 'course_outline', title: 'Fall 2025 course outline', url: 'https://carleton.ca/x', visibility: 'public', ownerUserId: null },
    'x',
  );
  const names = ['Logic', 'Set Theory', 'Functions', 'Relations', 'Mathematical Induction', 'Counting', 'Graph Theory'];
  repo.insertTopics(db, id, names.map((n) => ({ name: n, topicKey: topicKey(n) })), topicKey);
}

describe('test case: Carleton University · COMP 1805 · Fall 2026 (no AI configured)', () => {
  it('runs the whole loop: find course → version → syllabus → topics → compare → study → review → personalise', async () => {
    srv = await startServer('2026-10-01T15:00:00Z');
    const c = new Client(srv.url);
    await c.register('David', 'david@example.com', 'America/Toronto');

    // 1–2. Find the course and create the course version + the Recall course reviews will live in.
    const sc = await enroll(c);
    expect(sc.version).toMatchObject({ term: 'fall', year: 2026, label: 'Fall 2026' });
    const recallCourses = (await c.get('/courses')).body.courses;
    expect(recallCourses).toEqual([expect.objectContaining({ id: sc.recallCourseId, code: 'COMP 1805', name: 'Discrete Structures I' })]);
    // Enrolling again is idempotent.
    expect((await c.post('/knowledge/student-courses', { catalogCourseId: sc.course.id, term: 'fall', year: 2026 })).body.studentCourse.id).toBe(sc.id);

    // Before any evidence: say so, don't invent.
    let profile = (await c.get(`/knowledge/student-courses/${sc.id}/profile`)).body;
    expect(profile.topics).toEqual([]);
    expect(profile.notice).toMatch(/don't have reliable information about what COMP 1805 \(Fall 2026\) covers/);

    // Historical evidence alone is not presented as the current course.
    addPublicHistoricalOutline(sc.course.id);
    profile = (await c.get(`/knowledge/student-courses/${sc.id}/profile`)).body;
    expect(profile.counts.confirmed).toBe(0);
    expect(profile.counts.historical).toBe(7);
    expect(profile.notice).toMatch(/couldn't find a current course outline.*won't assume/);

    // 3–5. Upload the syllabus; pattern extraction is shown for review and NOT applied yet.
    const up = await upload(c, sc.id, 'COMP1805_F26_syllabus.txt', SYLLABUS_FALL_2026);
    expect(up.status).toBe(202);
    expect(up.body.document).toMatchObject({ status: 'needs_review', extractor: 'pattern', warnings: [] });
    const x: Extraction = up.body.document.extraction;
    expect(x.topics.map((t) => t.name)).toEqual(['Logic', 'Predicate Logic', 'Sets', 'Functions', 'Relations', 'Proofs', 'Counting']);
    expect((await c.get(`/knowledge/student-courses/${sc.id}/profile`)).body.counts.confirmed).toBe(0);

    // The student unticks "Predicate Logic" and confirms the rest.
    const confirmed = await c.post(`/knowledge/documents/${up.body.document.id}/confirm`, {
      term: 'fall',
      year: 2026,
      instructor: x.instructor,
      topics: x.topics.filter((t) => t.name !== 'Predicate Logic'),
      assessments: x.assessments,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.document.status).toBe('confirmed');

    // 6–7. Topics with source/confidence; comparison with history; conflicts explained.
    profile = (await c.get(`/knowledge/student-courses/${sc.id}/profile`)).body;
    const by = Object.fromEntries(profile.topics.map((t: any) => [t.name, t]));
    expect(profile.topics.filter((t: any) => t.status === 'confirmed').map((t: any) => t.name)).toEqual(['Logic', 'Sets', 'Functions', 'Relations', 'Proofs', 'Counting']);
    expect(by.Sets.evidence.map((e: any) => e.status)).toEqual(['confirmed', 'historical']);
    expect(by.Sets.subtopics).toEqual(['set notation', 'union', 'intersection', 'power sets']);
    expect(profile.missing.map((t: any) => t.name).sort()).toEqual(['Graph Theory', 'Mathematical Induction']);
    expect(by['Graph Theory'].conflict).toBe('Sources differ: listed in Fall 2025 course outline but not in COMP1805_F26_syllabus.txt (Fall 2026).');
    expect(profile.instructor).toEqual({ name: 'Dr. Alex Example', sourceTitle: 'COMP1805_F26_syllabus.txt (Fall 2026)' });
    expect(profile.assessments.find((a: any) => a.kind === 'midterm')).toMatchObject({ dueOn: '2026-10-23', weight: 25, status: 'confirmed' });
    expect(profile.sources.map((s: any) => s.tierLabel)).toEqual(['Your material', 'Official · past term']);
    expect(profile.notice).toBeNull();

    // 8. "What should I study?" — only from confirmed material and real signals.
    let recs = (await c.get(`/knowledge/student-courses/${sc.id}/recommendations`)).body.recommendations;
    const recFor = (name: string) => recs.find((r: any) => r.topicName === name);
    // The midterm (Oct 23) is 22 days away — outside the 21-day window, so it isn't a reason yet.
    expect(recFor('Sets').reasons).toEqual(['Covered on Sep 23 according to COMP1805_F26_syllabus.txt (Fall 2026) — not in your reviews yet']);
    expect(recs.some((r: any) => r.topicName === 'Graph Theory' || r.topicName === 'Mathematical Induction')).toBe(false);

    // A historical-only topic can't be studied by accident…
    const blocked = await c.post(`/knowledge/student-courses/${sc.id}/study`, { topicKey: topicKey('Graph Theory'), learnedOn: '2026-10-01' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/isn't confirmed for your Fall 2026 course \(Past versions\)/);
    // …only deliberately.
    expect((await c.post(`/knowledge/student-courses/${sc.id}/study`, { topicKey: topicKey('Graph Theory'), learnedOn: '2026-10-01', allowUnconfirmed: true })).status).toBe(201);

    // 9–11. Add confirmed topics to the review system; reviews get scheduled.
    const sets = (await c.post(`/knowledge/student-courses/${sc.id}/study`, { topicKey: topicKey('Sets'), learnedOn: '2026-09-23', understanding: 3 })).body.topic;
    expect(sets).toMatchObject({ title: 'Sets', courseId: sc.recallCourseId, knowledgeKey: 'set', description: 'Covers: set notation, union, intersection, power sets.' });
    expect((await c.post(`/knowledge/student-courses/${sc.id}/study`, { topicKey: 'set', learnedOn: '2026-09-23' })).status).toBe(409);
    const fns = (await c.post(`/knowledge/student-courses/${sc.id}/study`, { topicKey: topicKey('Functions'), learnedOn: '2026-09-30' })).body.topic;
    expect(fns.nextReviewOn).toBe('2026-10-01');
    expect(sets.status).toBe('due');

    // 12. Track performance.
    await c.post(`/topics/${fns.id}/reviews`, { clientId: randomUUID(), rating: 'forgot' });
    await c.post(`/topics/${sets.id}/reviews`, { clientId: randomUUID(), rating: 'good' });
    profile = (await c.get(`/knowledge/student-courses/${sc.id}/profile`)).body;
    const fnsProfile = profile.topics.find((t: any) => t.name === 'Functions');
    expect(fnsProfile.personal).toMatchObject({ reviewCount: 1, lastRating: 'forgot', nextReviewOn: '2026-10-02' });
    expect(fnsProfile.status).toBe('confirmed'); // personal performance never changes course knowledge

    // 13. Performance personalises future recommendations.
    srv.setNow('2026-10-12T15:00:00Z');
    await c.patch(`/topics/${sets.id}`, { pinned: true });
    recs = (await c.get(`/knowledge/student-courses/${sc.id}/recommendations`)).body.recommendations;
    expect(recFor('Functions').reasons).toEqual(expect.arrayContaining(["You couldn't remember it at your last review", 'Midterm Exam on Oct 23 covers this (in 11 days)']));
    expect(recFor('Sets').reasons).toContain('You marked this as a priority');
    expect(recFor('Logic').reasons).toEqual([
      'Covered on Sep 9 according to COMP1805_F26_syllabus.txt (Fall 2026) — not in your reviews yet',
      'Midterm Exam on Oct 23 covers this (in 11 days)',
    ]);
    expect(recFor('Counting')).toBeUndefined(); // Oct 28 hasn't happened yet and the midterm doesn't cover it
    expect((await c.get('/recommendations')).body.recommendations.length).toBeGreaterThan(0);
  });

  it('flags documents for another course or term instead of silently applying them', async () => {
    srv = await startServer('2026-10-01T15:00:00Z');
    const c = new Client(srv.url);
    await c.register('David', 'david@example.com');
    const sc = await enroll(c);
    const doc = (await upload(c, sc.id, 'old.txt', OUTLINE_FALL_2025.replace('COMP 1805', 'COMP 1405'))).body.document;
    expect(doc.warnings).toEqual([
      'This document appears to be for COMP 1405, not COMP 1805. Check it\'s the right file.',
      expect.stringMatching(/is for Fall 2025, not your term \(Fall 2026\)\. It will be saved as past-term material/),
    ]);
    await c.post(`/knowledge/documents/${doc.id}/confirm`, { term: 'fall', year: 2025, topics: doc.extraction.topics });
    const profile = (await c.get(`/knowledge/student-courses/${sc.id}/profile`)).body;
    expect(profile.counts.confirmed).toBe(0);
    expect(profile.counts.historical).toBe(7);
  });

  it('rejects unsupported files and files that need AI with a clear message', async () => {
    srv = await startServer();
    const c = new Client(srv.url);
    await c.register('David', 'david@example.com');
    const sc = await enroll(c);
    expect((await upload(c, sc.id, 'x.bin', Buffer.from([0, 1, 2]))).body.error.message).toMatch(/Unsupported file type/);
    const scan = await upload(c, sc.id, 'scan.pdf', makePdf(['']));
    expect(scan.status).toBe(422);
    expect(scan.body.error.message).toMatch(/no selectable text.*AI document reader, which isn't set up/);
    expect((await c.get(`/knowledge/student-courses/${sc.id}/discover`)).status).toBe(503);
    expect((await c.post(`/knowledge/student-courses/${sc.id}/assistant`, { messages: [{ role: 'user', content: 'hi' }] })).status).toBe(503);
  });
});

describe('with AI and web providers configured', () => {
  async function setup() {
    const ai = new FakeAI();
    const web = new FakeWeb();
    const gen = new RecordingGenerator();
    const providers: KnowledgeProviders = { ai, web, embeddings: null };
    srv = await startServer('2026-10-01T15:00:00Z', gen, providers);
    const c = new Client(srv.url);
    await c.register('David', 'david@example.com', 'America/Toronto');
    const sc = await enroll(c);
    return { ai, web, gen, c, sc };
  }

  it('extracts with AI in the background, then grounds generated questions in the course material', async () => {
    const { ai, gen, c, sc } = await setup();
    const up = await upload(c, sc.id, 'syllabus.pdf', makePdf(SYLLABUS_FALL_2026.split('\n')));
    expect(up.body.document.status).toBe('processing');
    await documentJob(srv.ctx, up.body.document.id);
    expect(ai.extractions[0].hints).toMatchObject({ courseCode: 'COMP 1805', studentTerm: { term: 'fall', year: 2026 }, documentType: 'syllabus' });
    const doc = (await c.get(`/knowledge/documents/${up.body.document.id}`)).body.document;
    expect(doc).toMatchObject({ status: 'needs_review', extractor: 'ai' });
    await c.post(`/knowledge/documents/${doc.id}/confirm`, { term: 'fall', year: 2026, topics: doc.extraction.topics, assessments: doc.extraction.assessments });

    const topic = (await c.post(`/knowledge/student-courses/${sc.id}/study`, { topicKey: 'set', learnedOn: '2026-09-23' })).body.topic;
    await backgroundJob(srv.ctx, topic.id);
    expect(gen.calls).toHaveLength(1);
    expect(gen.calls[0].notes).toMatch(/Topic status: Confirmed/);
    expect(gen.calls[0].notes).toMatch(/Subtopics listed in the course material: set notation, union, intersection, power sets/);
    expect(gen.calls[0].notes).toMatch(/Excerpt from the student's document "syllabus.pdf"/);
    const saved = srv.ctx.db.prepare('SELECT difficulty, grounding_source_id, source FROM questions WHERE topic_id = ?').all(topic.id) as any[];
    expect(saved).toHaveLength(5);
    expect(saved[0]).toMatchObject({ difficulty: 'intermediate', source: 'generated', grounding_source_id: doc.sourceId ?? expect.any(Number) });
  });

  it('falls back to pattern extraction when the AI fails', async () => {
    const { ai, c, sc } = await setup();
    ai.failExtraction = true;
    const up = await upload(c, sc.id, 'syllabus.txt', SYLLABUS_FALL_2026);
    await documentJob(srv.ctx, up.body.document.id);
    const doc = (await c.get(`/knowledge/documents/${up.body.document.id}`)).body.document;
    expect(doc).toMatchObject({ status: 'needs_review', extractor: 'pattern' });
    expect(doc.error).toMatch(/busy right now.*pattern matching/);
  });

  it('answers with retrieved course context (RAG) and streams the reply', async () => {
    const { ai, c, sc } = await setup();
    addPublicHistoricalOutline(sc.course.id);
    const up = await upload(c, sc.id, 'notes.txt', 'Functions lecture\n\nA function is injective when distinct inputs give distinct outputs.', 'lecture_notes');
    await documentJob(srv.ctx, up.body.document.id);
    const doc = (await c.get(`/knowledge/documents/${up.body.document.id}`)).body.document;
    await c.post(`/knowledge/documents/${doc.id}/confirm`, { term: 'fall', year: 2026, topics: [{ name: 'Functions', subtopics: ['injective'] }] });
    const fns = (await c.post(`/knowledge/student-courses/${sc.id}/study`, { topicKey: 'function', learnedOn: '2026-09-30' })).body.topic;
    await c.post(`/topics/${fns.id}/reviews`, { clientId: randomUUID(), rating: 'hard' });

    const res = await fetch(`${srv.url}/api/knowledge/student-courses/${sc.id}/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: c.cookie },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Explain injective functions to me' }] }),
    });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events = (await res.text()).split('\n\n').filter(Boolean).map((e) => JSON.parse(e.replace(/^data: /, '')));
    expect(events.map((e) => e.type)).toEqual(['citations', 'text', 'text', 'done']);
    expect(events[0].citations.map((x: any) => x.tag)).toEqual(['S1', 'S2', 'D1']);

    const { system, messages } = ai.answers[0];
    expect(system).toBe(ASSISTANT_SYSTEM);
    const ctxText = messages[0].content;
    expect(ctxText).toMatch(/School: Carleton University, School of Computer Science/);
    expect(ctxText).toMatch(/In your materials — .*\n- Functions/);
    expect(ctxText).toMatch(/Past versions — .*[\s\S]*- Graph Theory/);
    expect(ctxText).toMatch(/Struggled in the last 14 days:\n- Functions: rated hard on 2026-10-01/);
    expect(ctxText).toMatch(/<excerpt tag="D1" document="notes.txt">[\s\S]*injective when distinct inputs/);
    expect(ctxText).toMatch(/Student's message:\nExplain injective functions to me$/);
  });

  it('discovers resources ranked by reliability and imports a public page for review', async () => {
    const { web, c, sc } = await setup();
    const found = (await c.get(`/knowledge/student-courses/${sc.id}/discover?topic=mathematical induction`)).body;
    expect(web.queries[0]).toBe('"Carleton University" COMP 1805 mathematical induction');
    expect(found.results.map((r: any) => [r.origin, r.tierLabel])).toEqual([
      ['official', 'Official university site'],
      ['public', 'Open educational resource'],
      ['web', 'General web'],
    ]);
    const saved = (await c.post(`/knowledge/student-courses/${sc.id}/resources`, { url: found.results[1].url, title: found.results[1].title })).body.source;
    expect(saved).toMatchObject({ origin: 'public', isPrivate: true, topicCount: 0 });

    const imported = (await c.post(`/knowledge/student-courses/${sc.id}/import-url`, { url: found.results[0].url })).body.document;
    await documentJob(srv.ctx, imported.id);
    const doc = (await c.get(`/knowledge/documents/${imported.id}`)).body.document;
    expect(doc).toMatchObject({ kind: 'web', status: 'needs_review', origin: 'web' });
    expect(doc.extraction.term).toBe('fall');
    await c.post(`/knowledge/documents/${doc.id}/confirm`, { term: 'fall', year: 2025, topics: doc.extraction.topics });
    const profile = (await c.get(`/knowledge/student-courses/${sc.id}/profile`)).body;
    const official = profile.sources.find((s: any) => s.url === found.results[0].url);
    expect(official).toMatchObject({ origin: 'official', documentType: 'course_outline', tierLabel: 'Official · past term', status: 'historical' });
    // The page text is not stored — only the extracted facts and the link.
    expect(srv.ctx.db.prepare('SELECT text FROM documents WHERE id = ?').get(doc.id)).toEqual({ text: null });
  });

  it('stores AI suggestions as suggestions, never as course content', async () => {
    const { c, sc } = await setup();
    addPublicHistoricalOutline(sc.course.id);
    expect((await c.post(`/knowledge/student-courses/${sc.id}/suggestions`)).body).toEqual({ added: 1 });
    expect((await c.post(`/knowledge/student-courses/${sc.id}/suggestions`)).body).toEqual({ added: 1 }); // replaces, doesn't pile up
    const profile = (await c.get(`/knowledge/student-courses/${sc.id}/profile`)).body;
    const pigeon = profile.topics.find((t: any) => t.name === 'Pigeonhole Principle');
    expect(pigeon).toMatchObject({ status: 'suggested', description: 'Often taught with counting.' });
    expect(profile.counts.suggested).toBe(1);
    expect(profile.counts.confirmed).toBe(0);
    const recs = (await c.get(`/knowledge/student-courses/${sc.id}/recommendations`)).body.recommendations;
    expect(recs).toEqual([]);
  });
});

describe('privacy: global knowledge vs private student material', () => {
  it("never shows one student's uploads, extractions or retrieval passages to another", async () => {
    srv = await startServer('2026-10-01T15:00:00Z', null, { ...NO_PROVIDERS, ai: new FakeAI() });
    const david = new Client(srv.url);
    await david.register('David', 'david@example.com');
    const sc1 = await enroll(david);
    addPublicHistoricalOutline(sc1.course.id);
    const up = await upload(david, sc1.id, 'private-notes.txt', SYLLABUS_FALL_2026);
    await documentJob(srv.ctx, up.body.document.id);
    const doc = (await david.get(`/knowledge/documents/${up.body.document.id}`)).body.document;
    await david.post(`/knowledge/documents/${doc.id}/confirm`, { term: 'fall', year: 2026, topics: doc.extraction.topics });

    const eve = new Client(srv.url);
    await eve.register('Eve', 'eve@example.com');
    const sc2 = await enroll(eve);
    const profile = (await eve.get(`/knowledge/student-courses/${sc2.id}/profile`)).body;
    expect(profile.sources.map((s: any) => s.title)).toEqual(['Fall 2025 course outline']); // shared public source only
    expect(profile.counts.confirmed).toBe(0);
    expect(profile.documents).toEqual([]);
    expect(profile.assessments).toEqual([]);

    expect((await eve.get(`/knowledge/documents/${doc.id}`)).status).toBe(404);
    expect((await eve.post(`/knowledge/documents/${doc.id}/confirm`, { term: 'fall', year: 2026, topics: [] })).status).toBe(404);
    expect((await eve.del(`/knowledge/documents/${doc.id}`)).status).toBe(404);
    expect((await eve.get(`/knowledge/student-courses/${sc1.id}/profile`)).status).toBe(404);
    expect((await eve.post(`/knowledge/student-courses/${sc1.id}/study`, { topicKey: 'set', learnedOn: '2026-09-23' })).status).toBe(404);
    expect((await eve.del(`/knowledge/sources/${doc.sourceId}`)).status).toBe(404);
    expect(repo.searchChunks(srv.ctx.db, 2, sc2.id, 'Logic Sets Functions')).toEqual([]);
    expect(repo.searchChunks(srv.ctx.db, 1, sc1.id, 'Logic Sets Functions').length).toBeGreaterThan(0);
  });

  it('unlinking removes the student’s private course material but keeps their reviews', async () => {
    srv = await startServer();
    const c = new Client(srv.url);
    await c.register('David', 'david@example.com');
    const sc = await enroll(c);
    const doc = (await upload(c, sc.id, 's.txt', SYLLABUS_FALL_2026)).body.document;
    await c.post(`/knowledge/documents/${doc.id}/confirm`, { term: 'fall', year: 2026, topics: doc.extraction.topics });
    await c.post(`/knowledge/student-courses/${sc.id}/study`, { topicKey: 'logic', learnedOn: '2026-09-09' });
    expect((await c.del(`/knowledge/student-courses/${sc.id}`)).status).toBe(204);
    const counts = srv.ctx.db
      .prepare(`SELECT (SELECT COUNT(*) FROM sources WHERE visibility = 'private') s, (SELECT COUNT(*) FROM documents) d, (SELECT COUNT(*) FROM document_chunks) ch, (SELECT COUNT(*) FROM topics) t`)
      .get();
    expect(counts).toEqual({ s: 0, d: 0, ch: 0, t: 1 });
  });
});

describe('catalog', () => {
  it('searches by code or title, and supports adding a school, department and course', async () => {
    srv = await startServer();
    const c = new Client(srv.url);
    await c.register('David', 'david@example.com');
    expect((await c.get('/catalog/universities?q=carl')).body.universities[0]).toMatchObject({ name: 'Carleton University', city: 'Ottawa', verified: true });
    expect((await c.get('/catalog/courses?q=COMP 18')).body.courses.map((x: any) => x.code)).toEqual(['COMP 1805']);
    expect((await c.get('/catalog/courses?q=discrete')).body.courses.map((x: any) => x.code)).toEqual(['COMP 1805', 'COMP 2804']);
    expect((await c.get("/catalog/courses?q=%25' OR 1=1--")).body.courses).toEqual([]);

    const uni = (await c.post('/catalog/universities', { name: 'University of Ottawa', city: 'Ottawa', country: 'Canada', website: 'https://www.uottawa.ca' })).body.university;
    expect(uni).toMatchObject({ verified: false });
    expect((await c.post('/catalog/universities', { name: 'university of ottawa' })).status).toBe(409);
    const dept = (await c.post(`/catalog/universities/${uni.id}/departments`, { name: 'Mathematics and Statistics' })).body.department;
    const course = (await c.post('/catalog/courses', { universityId: uni.id, departmentId: dept.id, code: 'mat1348', title: 'Discrete Mathematics for Computing' })).body.course;
    expect(course).toMatchObject({ code: 'MAT 1348', verified: false, university: { name: 'University of Ottawa' } });
    // "Find or create": the same code returns the existing course.
    expect((await c.post('/catalog/courses', { universityId: uni.id, departmentId: dept.id, code: 'MAT 1348', title: 'x' })).body.course.id).toBe(course.id);
    expect((await c.post('/catalog/courses', { universityId: uni.id, departmentId: dept.id, code: 'Discrete', title: 'x' })).status).toBe(400);
  });
});

describe('demo data', () => {
  it('includes a clearly-labelled course profile that removes cleanly', async () => {
    srv = await startServer('2026-10-01T15:00:00Z');
    const c = new Client(srv.url);
    await c.register('David', 'david@example.com', 'America/Toronto');
    await c.post('/demo');
    const [sc] = (await c.get('/knowledge/student-courses')).body.studentCourses;
    const profile = (await c.get(`/knowledge/student-courses/${sc.id}/profile`)).body;
    expect(profile.sources.every((s: any) => s.isDemo && s.isPrivate && /demo data/.test(s.title))).toBe(true);
    expect(profile.counts).toMatchObject({ confirmed: 6, historical: 2 });
    expect(profile.topics.find((t: any) => t.name === 'Sets').personal).toMatchObject({ reviewCount: 4 });
    expect(profile.missing.map((t: any) => t.name).sort()).toEqual(['Graph Theory', 'Mathematical Induction']);
    await c.del('/demo');
    expect((await c.get('/knowledge/student-courses')).body.studentCourses).toEqual([]);
    expect(srv.ctx.db.prepare('SELECT COUNT(*) AS n FROM sources').get()).toEqual({ n: 0 });
  });
});
