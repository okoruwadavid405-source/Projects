import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionDraft } from '../shared/api.js';
import { backgroundJob, MAX_GENERATED_PER_TOPIC } from '../server/services/questionFlow.js';
import { GenerationError, type GenerationRequest, type QuestionGenerator } from '../server/services/questionGenerator.js';
import { Client, startServer, type TestServer } from './helpers.js';

/** Deterministic generator that records what it was asked for. */
class FakeGenerator implements QuestionGenerator {
  calls: GenerationRequest[] = [];
  fail: GenerationError | null = null;
  private n = 0;
  async generate(req: GenerationRequest): Promise<QuestionDraft[]> {
    this.calls.push(req);
    if (this.fail) throw this.fail;
    return Array.from({ length: req.count }, () => {
      const i = ++this.n;
      return { prompt: `Generated question ${i} about ${req.topic.title}?`, answer: `Answer ${i}.`, kind: 'apply' as const };
    });
  }
}

let srv: TestServer;
afterEach(() => srv.close());

async function setup(generator: QuestionGenerator | null) {
  srv = await startServer('2026-10-01T15:00:00Z', generator);
  const c = new Client(srv.url);
  await c.register('Ana', 'ana@example.com');
  const course = (await c.post('/courses', { code: 'COMP 1805', name: 'Discrete Mathematics' })).body.course;
  return { c, course };
}

describe('question generation', () => {
  it('reports availability and refuses cleanly when the server has no credentials', async () => {
    const { c, course } = await setup(null);
    expect((await c.get('/features')).body).toMatchObject({ questionGeneration: false, documentAI: false, webSearch: false });
    const res = await c.post('/question-drafts', { courseId: course.id, title: 'Sets' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/isn't set up/);
    // Topics without questions still work — they just aren't auto-filled.
    const topic = (await c.post('/topics', { courseId: course.id, title: 'Sets', learnedOn: '2026-09-30' })).body.topic;
    expect(topic.generatingQuestions).toBe(false);
  });

  it('returns editable drafts without saving them, avoiding existing questions', async () => {
    const gen = new FakeGenerator();
    const { c, course } = await setup(gen);
    expect((await c.get('/features')).body).toMatchObject({ questionGeneration: true });

    const drafts = await c.post('/question-drafts', { courseId: course.id, title: 'Sets', description: 'Unions', notes: 'my notes', count: 3 });
    expect(drafts.status).toBe(200);
    expect(drafts.body.drafts).toHaveLength(3);
    expect(gen.calls[0]).toMatchObject({ course: { code: 'COMP 1805' }, topic: { title: 'Sets', description: 'Unions' }, notes: 'my notes', count: 3 });

    const topic = (
      await c.post('/topics', {
        courseId: course.id,
        title: 'Sets',
        learnedOn: '2026-09-30',
        questions: [{ ...drafts.body.drafts[0], source: 'generated' }],
      })
    ).body.topic;
    expect(topic.questions[0]).toMatchObject({ source: 'generated', kind: 'apply' });

    await c.post('/question-drafts', { courseId: course.id, title: 'Sets', topicId: topic.id, count: 2 });
    expect(gen.calls[1].existingPrompts).toEqual([drafts.body.drafts[0].prompt]);
  });

  it('auto-generates a starter set for a topic saved without questions', async () => {
    const gen = new FakeGenerator();
    const { c, course } = await setup(gen);
    const created = (await c.post('/topics', { courseId: course.id, title: 'Logic', learnedOn: '2026-09-30' })).body.topic;
    expect(created.generatingQuestions).toBe(true);
    await backgroundJob(srv.ctx, created.id);
    const topic = (await c.get(`/topics/${created.id}`)).body.topic;
    expect(topic.generatingQuestions).toBe(false);
    expect(topic.questions).toHaveLength(5);
    expect(topic.questions.every((q: { source: string }) => q.source === 'generated')).toBe(true);
    const session = (await c.get(`/topics/${created.id}/review-session`)).body;
    expect(session.mode).toBe('questions');
    expect(session.questions.every((q: { isNew: boolean; kind: string }) => q.isNew && q.kind === 'apply')).toBe(true);
  });

  it('keeps a flow of fresh questions coming after each review, aimed at what was missed', async () => {
    const gen = new FakeGenerator();
    const { c, course } = await setup(gen);
    const topic = (
      await c.post('/topics', {
        courseId: course.id,
        title: 'Sets',
        learnedOn: '2026-09-30',
        questions: [
          { prompt: 'What is a power set?', answer: 'All subsets.' },
          { prompt: 'Define a subset.', answer: 'Every element of A is in B.' },
        ],
      })
    ).body.topic;
    const [q1, q2] = topic.questions;
    await c.post(`/topics/${topic.id}/reviews`, {
      clientId: randomUUID(),
      answers: [
        { questionId: q1.id, rating: 'forgot' },
        { questionId: q2.id, rating: 'good' },
      ],
    });
    await backgroundJob(srv.ctx, topic.id);

    expect(gen.calls).toHaveLength(1);
    expect(gen.calls[0]).toMatchObject({ count: 2, focusPrompts: ['What is a power set?'] });
    expect(gen.calls[0].existingPrompts).toEqual(['What is a power set?', 'Define a subset.']);
    const after = (await c.get(`/topics/${topic.id}`)).body.topic;
    expect(after.questions).toHaveLength(4);

    // The next session prefers the new, never-asked questions.
    const session = (await c.get(`/topics/${topic.id}/review-session`)).body;
    expect(session.questions.filter((q: { isNew: boolean }) => q.isNew).length).toBeGreaterThanOrEqual(1);
  });

  it('stops topping up at the per-topic cap, skips retried submissions, and survives failures', async () => {
    const gen = new FakeGenerator();
    const { c, course } = await setup(gen);
    const topic = (await c.post('/topics', { courseId: course.id, title: 'Sets', learnedOn: '2026-09-30', questions: [{ prompt: 'Q?', answer: 'A.' }] })).body.topic;
    const insert = srv.ctx.db.prepare("INSERT INTO questions (topic_id, prompt, answer, source, kind, created_at, updated_at) VALUES (?, ?, 'a', 'generated', 'recall', 'x', 'x')");
    for (let i = 0; i < MAX_GENERATED_PER_TOPIC; i++) insert.run(topic.id, `Existing ${i}?`);

    const clientId = randomUUID();
    await c.post(`/topics/${topic.id}/reviews`, { clientId, rating: 'good' });
    await backgroundJob(srv.ctx, topic.id);
    expect(gen.calls).toHaveLength(0); // already at the cap: no paid call is made

    srv.ctx.db.prepare("DELETE FROM questions WHERE prompt = 'Existing 0?'").run();
    await c.post(`/topics/${topic.id}/reviews`, { clientId, rating: 'good' }); // retry of the same review
    await backgroundJob(srv.ctx, topic.id);
    expect(gen.calls).toHaveLength(0);

    gen.fail = new GenerationError('busy', true);
    srv.setNow('2026-10-02T15:00:00Z');
    const res = await c.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'good' });
    expect(res.status).toBe(201); // a generation failure never fails the review
    await backgroundJob(srv.ctx, topic.id);
    expect(gen.calls).toHaveLength(1);
  });

  it('surfaces generation errors as friendly messages', async () => {
    const gen = new FakeGenerator();
    const { c, course } = await setup(gen);
    gen.fail = new GenerationError("Recall couldn't write questions for this topic.", false);
    const res = await c.post('/question-drafts', { courseId: course.id, title: 'Sets' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe("Recall couldn't write questions for this topic.");
  });

  it("never generates from another user's course or topic", async () => {
    const gen = new FakeGenerator();
    const { c, course } = await setup(gen);
    const topic = (await c.post('/topics', { courseId: course.id, title: 'Sets', learnedOn: '2026-09-30', questions: [{ prompt: 'Q?', answer: 'A.' }] })).body.topic;
    const eve = new Client(srv.url);
    await eve.register('Eve', 'eve@example.com');
    const own = (await eve.post('/courses', { code: 'EVE 1000', name: 'Mine' })).body.course;
    expect((await eve.post('/question-drafts', { courseId: course.id, title: 'Sets' })).status).toBe(400);
    expect((await eve.post('/question-drafts', { courseId: own.id, title: 'Sets', topicId: topic.id })).status).toBe(404);
    expect(gen.calls).toHaveLength(0);
  });
});
