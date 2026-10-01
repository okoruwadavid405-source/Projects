import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, startServer, type TestServer } from './helpers.js';

let srv: TestServer;
let alice: Client;

beforeEach(async () => {
  srv = await startServer('2026-10-01T15:00:00Z'); // 11:00 in Toronto
  alice = new Client(srv.url);
  await alice.register('Alice', 'alice@example.com');
});
afterEach(() => srv.close());

async function createCourse(c: Client, code = 'COMP 1805') {
  const res = await c.post('/courses', { code, name: 'Discrete Mathematics', color: 'indigo' });
  expect(res.status).toBe(201);
  return res.body.course;
}

async function createTopic(c: Client, courseId: number, extra: Record<string, unknown> = {}) {
  const res = await c.post('/topics', {
    courseId,
    title: 'Sets',
    description: 'Union, intersection, subset, power sets and set notation.',
    learnedOn: '2026-09-30',
    understanding: 4,
    questions: [
      { prompt: 'What is the union of two sets?', answer: 'All elements in either set.' },
      { prompt: 'What is the intersection of two sets?', answer: 'Elements common to both.' },
    ],
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.topic;
}

describe('authentication', () => {
  it('registers, reports the current user, logs out and logs back in', async () => {
    const me = await alice.get('/auth/me');
    expect(me.body.user).toMatchObject({ name: 'Alice', email: 'alice@example.com', timezone: 'America/Toronto' });
    expect(me.body.user.passwordHash).toBeUndefined();

    expect((await alice.post('/auth/logout')).status).toBe(204);
    expect((await alice.get('/auth/me')).body.user).toBeNull();

    const bad = await alice.post('/auth/login', { email: 'alice@example.com', password: 'wrong password' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe('Incorrect email or password.');

    const ok = await alice.post('/auth/login', { email: 'ALICE@example.com', password: 'correct horse battery' });
    expect(ok.status).toBe(200);
    expect((await alice.get('/auth/me')).body.user.email).toBe('alice@example.com');
  });

  it('sets an httpOnly SameSite session cookie', async () => {
    const c = new Client(srv.url);
    const res = await c.post('/auth/register', { name: 'Bo', email: 'bo@example.com', password: 'longenough1' });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects duplicate emails and weak passwords with readable messages', async () => {
    const c = new Client(srv.url);
    const dup = await c.post('/auth/register', { name: 'A', email: 'Alice@Example.com', password: 'abcdefgh' });
    expect(dup.status).toBe(409);
    const weak = await c.post('/auth/register', { name: 'A', email: 'a2@example.com', password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.fields.password).toMatch(/at least 8/);
    const email = await c.post('/auth/register', { name: 'A', email: 'not-an-email', password: 'abcdefgh' });
    expect(email.body.error.fields.email).toMatch(/valid email/);
  });

  it('requires authentication for study data', async () => {
    const anon = new Client(srv.url);
    for (const path of ['/courses', '/topics', '/dashboard', '/progress', '/upcoming']) {
      expect((await anon.get(path)).status).toBe(401);
    }
  });
});

describe('courses', () => {
  it('creates, edits, lists and deletes a course', async () => {
    const course = await createCourse(alice);
    expect(course).toMatchObject({ code: 'COMP 1805', topicCount: 0, isDemo: false });

    const edited = await alice.put(`/courses/${course.id}`, { code: 'COMP 1805', name: 'Discrete Math I', professor: 'Dr. M', color: 'teal' });
    expect(edited.body.course).toMatchObject({ name: 'Discrete Math I', professor: 'Dr. M', color: 'teal' });
    expect((await alice.get('/courses')).body.courses).toHaveLength(1);

    expect((await alice.del(`/courses/${course.id}`)).status).toBe(204);
    expect((await alice.get('/courses')).body.courses).toHaveLength(0);
    expect((await alice.del(`/courses/${course.id}`)).status).toBe(404);
  });

  it('rejects empty and duplicate courses', async () => {
    const empty = await alice.post('/courses', { code: '  ', name: '' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fields.code).toBe('Course code is required.');
    await createCourse(alice);
    const dup = await alice.post('/courses', { code: 'comp 1805', name: 'Again' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already have a course/);
  });

  it('deleting a course removes its topics', async () => {
    const course = await createCourse(alice);
    await createTopic(alice, course.id);
    await alice.del(`/courses/${course.id}`);
    expect((await alice.get('/topics')).body.topics).toHaveLength(0);
  });
});

describe('topics and questions', () => {
  it('creates a topic with questions and schedules the first review automatically', async () => {
    const course = await createCourse(alice);
    const topic = await createTopic(alice, course.id);
    expect(topic).toMatchObject({ title: 'Sets', stage: 'new', nextReviewOn: '2026-10-01', status: 'due', questionCount: 2 });
    expect(topic.projected).toEqual(['2026-10-01', '2026-10-03', '2026-10-07', '2026-10-15', '2026-10-31']);
  });

  it('validates topics: empty title, invalid date, future date, foreign course, duplicates', async () => {
    const course = await createCourse(alice);
    const base = { courseId: course.id, title: 'Sets', learnedOn: '2026-09-30' };
    expect((await alice.post('/topics', { ...base, title: ' ' })).body.error.fields.title).toBe('Topic is required.');
    expect((await alice.post('/topics', { ...base, learnedOn: '2026-02-30' })).body.error.fields.learnedOn).toBe('Enter a valid date.');
    expect((await alice.post('/topics', { ...base, learnedOn: '2026-10-02' })).body.error.fields.learnedOn).toMatch(/future/);
    expect((await alice.post('/topics', { ...base, courseId: 9999 })).status).toBe(400);
    await createTopic(alice, course.id);
    expect((await alice.post('/topics', { ...base, title: 'sets' })).status).toBe(409);
  });

  it('edits and deletes topics; editing the learned date re-plans an unreviewed topic', async () => {
    const course = await createCourse(alice);
    const topic = await createTopic(alice, course.id, { learnedOn: '2026-10-01' });
    expect(topic.nextReviewOn).toBe('2026-10-02');
    const edited = await alice.patch(`/topics/${topic.id}`, { title: 'Set Theory', learnedOn: '2026-09-20' });
    expect(edited.body.topic).toMatchObject({ title: 'Set Theory', learnedOn: '2026-09-20', nextReviewOn: '2026-10-01' });
    expect((await alice.del(`/topics/${topic.id}`)).status).toBe(204);
    expect((await alice.get(`/topics/${topic.id}`)).status).toBe(404);
  });

  it('creates, edits and deletes questions', async () => {
    const course = await createCourse(alice);
    const topic = await createTopic(alice, course.id, { questions: [] });
    const q = await alice.post(`/topics/${topic.id}/questions`, { prompt: 'What is ∅?', answer: 'The empty set.' });
    expect(q.status).toBe(201);
    const edited = await alice.put(`/questions/${q.body.question.id}`, { prompt: 'What is ∅?', answer: 'The set with no elements.' });
    expect(edited.body.question.answer).toBe('The set with no elements.');
    expect((await alice.post(`/topics/${topic.id}/questions`, { prompt: '', answer: 'x' })).status).toBe(400);
    expect((await alice.del(`/questions/${q.body.question.id}`)).status).toBe(204);
    expect((await alice.get(`/topics/${topic.id}`)).body.topic.questions).toHaveLength(0);
  });
});

describe('review workflow', () => {
  it('runs the full loop: create → review → rate → reschedule → review again', async () => {
    const course = await createCourse(alice);
    const topic = await createTopic(alice, course.id);

    const dash = await alice.get('/dashboard');
    expect(dash.body.dueTodayCount).toBe(1);
    expect(dash.body.groups[0].course.code).toBe('COMP 1805');

    const session = await alice.get(`/topics/${topic.id}/review-session`);
    expect(session.body.mode).toBe('questions');
    expect(session.body.questions).toHaveLength(2);

    const answers = session.body.questions.map((q: { id: number }) => ({ questionId: q.id, rating: 'good' }));
    const result = await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), answers });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ rating: 'good', previousInterval: 1, newInterval: 2, nextReviewOn: '2026-10-03' });
    expect(result.body.topic).toMatchObject({ stage: 'learning', status: 'learning', reviewCount: 1 });

    expect((await alice.get('/dashboard')).body.dueTodayCount).toBe(0);

    srv.setNow('2026-10-03T15:00:00Z');
    const easy = await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'easy' });
    expect(easy.body).toMatchObject({ rating: 'easy', previousInterval: 2, newInterval: 5, nextReviewOn: '2026-10-08' });

    const detail = await alice.get(`/topics/${topic.id}`);
    expect(detail.body.topic.reviews).toHaveLength(2);
  });

  it('a forgotten review resets the interval to one day', async () => {
    const course = await createCourse(alice);
    const topic = await createTopic(alice, course.id);
    await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'good' });
    srv.setNow('2026-10-03T15:00:00Z');
    const r = await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'forgot' });
    expect(r.body).toMatchObject({ newInterval: 1, nextReviewOn: '2026-10-04' });
    expect(r.body.topic.lapseCount).toBe(1);
  });

  it('marks missed reviews overdue and credits lateness without punishing', async () => {
    const course = await createCourse(alice);
    const topic = await createTopic(alice, course.id);
    await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'good' }); // due 10-03

    srv.setNow('2026-10-07T15:00:00Z');
    const dash = await alice.get('/dashboard');
    expect(dash.body.overdueCount).toBe(1);
    expect(dash.body.groups[0].topics[0]).toMatchObject({ status: 'overdue', daysUntilDue: -4 });
    expect((await alice.get('/upcoming')).body.overdue).toHaveLength(1);

    const r = await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'good' });
    expect(r.body.daysOverdue).toBe(4);
    expect(r.body.newInterval).toBe((2 + 4 / 2) * 2);
  });

  it('uses the student\'s time zone to decide what "today" is', async () => {
    const course = await createCourse(alice);
    await createTopic(alice, course.id, { learnedOn: '2026-10-01' }); // due 10-02 Toronto
    srv.setNow('2026-10-03T03:30:00Z'); // 23:30 on Oct 2 in Toronto
    expect((await alice.get('/dashboard')).body).toMatchObject({ today: '2026-10-02', dueTodayCount: 1, overdueCount: 0 });
    srv.setNow('2026-10-03T04:30:00Z'); // 00:30 on Oct 3 in Toronto
    expect((await alice.get('/dashboard')).body).toMatchObject({ today: '2026-10-03', overdueCount: 1 });
  });

  it('supports free-recall reviews for topics without questions', async () => {
    const course = await createCourse(alice);
    const topic = await createTopic(alice, course.id, { questions: [] });
    const s = await alice.get(`/topics/${topic.id}/review-session`);
    expect(s.body).toMatchObject({ mode: 'free', questions: [] });
    const r = await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'hard' });
    expect(r.status).toBe(201);
  });

  it('is idempotent for retried submissions and rejects invalid reviews', async () => {
    const course = await createCourse(alice);
    const topic = await createTopic(alice, course.id);
    const clientId = randomUUID();
    const first = await alice.post(`/topics/${topic.id}/reviews`, { clientId, rating: 'good' });
    const retry = await alice.post(`/topics/${topic.id}/reviews`, { clientId, rating: 'good' });
    expect(retry.body.nextReviewOn).toBe(first.body.nextReviewOn);
    expect((await alice.get(`/topics/${topic.id}`)).body.topic.reviewCount).toBe(1);

    expect((await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID() })).status).toBe(400);
    expect((await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'great' })).status).toBe(400);
    const missing = await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), answers: [{ questionId: 99999, rating: 'good' }] });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/no longer exists/);
  });
});

describe('statistics', () => {
  it('reports progress, streaks and insights from real data', async () => {
    const course = await createCourse(alice);
    const topic = await createTopic(alice, course.id);
    srv.setNow('2026-10-01T15:00:00Z');
    await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'good' });
    srv.setNow('2026-10-02T15:00:00Z');
    await alice.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'forgot' });

    const p = (await alice.get('/progress')).body;
    expect(p.totals).toMatchObject({ topics: 1, learning: 1, reviews: 2 });
    expect(p.accuracy).toBe(0.5);
    expect(p.streak).toBe(2);
    expect(p.needsAttention[0]).toMatchObject({ title: 'Sets', reason: 'Forgotten at last review' });

    const dash = (await alice.get('/dashboard')).body;
    const texts = dash.insights.map((i: { text: string }) => i.text);
    expect(texts).toContain("You've kept a 2-day review streak. Keep it going!");
    expect(texts).toContain('You have 1 COMP 1805 review due tomorrow.');
    expect(texts.some((t: string) => t.startsWith('You struggled with Sets'))).toBe(true);
  });

  it('loads and removes clearly-labelled demo data', async () => {
    expect((await alice.post('/demo')).status).toBe(201);
    expect((await alice.post('/demo')).status).toBe(409);
    const courses = (await alice.get('/courses')).body.courses;
    expect(courses.length).toBe(3);
    expect(courses.every((c: { isDemo: boolean }) => c.isDemo)).toBe(true);
    const progress = (await alice.get('/progress')).body;
    expect(progress.totals.reviews).toBeGreaterThan(5);
    expect((await alice.get('/dashboard')).body.hasDemoData).toBe(true);
    await alice.del('/demo');
    expect((await alice.get('/courses')).body.courses).toHaveLength(0);
    expect((await alice.get('/progress')).body.totals.reviews).toBe(0);
  });
});

describe('authorization — users cannot touch each other\'s data', () => {
  it('returns 404 for every cross-user read and write', async () => {
    const course = await createCourse(alice);
    const topic = await createTopic(alice, course.id);
    const qid = topic.questions[0].id;

    const mallory = new Client(srv.url);
    await mallory.register('Mallory', 'mallory@example.com');

    expect((await mallory.get('/courses')).body.courses).toHaveLength(0);
    expect((await mallory.get('/topics')).body.topics).toHaveLength(0);
    expect((await mallory.get(`/courses/${course.id}`)).status).toBe(404);
    expect((await mallory.put(`/courses/${course.id}`, { code: 'X', name: 'Hijack' })).status).toBe(404);
    expect((await mallory.del(`/courses/${course.id}`)).status).toBe(404);
    expect((await mallory.get(`/topics/${topic.id}`)).status).toBe(404);
    expect((await mallory.patch(`/topics/${topic.id}`, { title: 'Hijack' })).status).toBe(404);
    expect((await mallory.del(`/topics/${topic.id}`)).status).toBe(404);
    expect((await mallory.get(`/topics/${topic.id}/review-session`)).status).toBe(404);
    expect((await mallory.post(`/topics/${topic.id}/reviews`, { clientId: randomUUID(), rating: 'easy' })).status).toBe(404);
    expect((await mallory.post(`/topics/${topic.id}/questions`, { prompt: 'x', answer: 'y' })).status).toBe(404);
    expect((await mallory.put(`/questions/${qid}`, { prompt: 'x', answer: 'y' })).status).toBe(404);
    expect((await mallory.del(`/questions/${qid}`)).status).toBe(404);
    // Cannot attach a topic to someone else's course.
    expect((await mallory.post('/topics', { courseId: course.id, title: 'Sneaky', learnedOn: '2026-09-30' })).status).toBe(400);
    // Mallory's own course cannot receive Alice's topic either.
    const own = await createCourse(mallory, 'HACK 1000');
    expect((await alice.patch(`/topics/${topic.id}`, { courseId: own.id })).status).toBe(400);

    const after = await alice.get(`/topics/${topic.id}`);
    expect(after.body.topic).toMatchObject({ title: 'Sets', reviewCount: 0, questionCount: 2 });
    expect((await alice.get('/progress')).body.totals.reviews).toBe(0);
  });
});

describe('request hardening', () => {
  it('rejects cross-origin writes, non-JSON bodies and malformed JSON without leaking internals', async () => {
    const cross = await alice.request('POST', '/courses', { code: 'X', name: 'Y' }, { Origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    const form = await fetch(`${srv.url}/api/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: alice.cookie },
      body: 'code=X&name=Y',
    });
    expect(form.status).toBe(415);
    const bad = await fetch(`${srv.url}/api/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
      body: '{"code":',
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toBe('The request body is not valid JSON.');
    expect((await alice.get('/topics/abc')).status).toBe(404);
    expect((await alice.get('/topics/1%20OR%201=1')).status).toBe(404);
  });

  it('treats SQL-looking input as plain data', async () => {
    const res = await alice.post('/courses', { code: "X' OR 1=1--", name: "Robert'); DROP TABLE courses;--" });
    expect(res.status).toBe(201);
    expect((await alice.get('/courses')).body.courses[0]).toMatchObject({ code: "X' OR 1=1--", name: "Robert'); DROP TABLE courses;--" });
  });

  it('updates settings and validates them', async () => {
    const ok = await alice.patch('/settings', { reminderEnabled: true, reminderTime: '19:30', timezone: 'Europe/London' });
    expect(ok.body.user).toMatchObject({ reminderEnabled: true, reminderTime: '19:30', timezone: 'Europe/London' });
    expect((await alice.patch('/settings', { reminderTime: '25:00' })).status).toBe(400);
    expect((await alice.patch('/settings', { timezone: 'Nowhere/City' })).status).toBe(400);
    const digest = (await alice.get('/reminders/digest')).body;
    expect(digest).toMatchObject({ enabled: true, dueCount: 0 });
  });

  it('deletes the account and all its data', async () => {
    const course = await createCourse(alice);
    await createTopic(alice, course.id);
    expect((await alice.del('/account')).status).toBe(204);
    const counts = srv.ctx.db.prepare('SELECT (SELECT COUNT(*) FROM courses) c, (SELECT COUNT(*) FROM topics) t, (SELECT COUNT(*) FROM questions) q').get();
    expect(counts).toEqual({ c: 0, t: 0, q: 0 });
  });
});
