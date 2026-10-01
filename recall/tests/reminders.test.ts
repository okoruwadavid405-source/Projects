import { afterEach, describe, expect, it } from 'vitest';
import { findUsersDueForReminder } from '../server/services/reminders.js';
import { Client, startServer, type TestServer } from './helpers.js';

let srv: TestServer;
afterEach(() => srv.close());

describe('findUsersDueForReminder', () => {
  it('selects users whose local reminder time falls in the window and who have reviews due', async () => {
    srv = await startServer('2026-10-01T15:00:00Z');
    const toronto = new Client(srv.url);
    await toronto.register('T', 't@example.com', 'America/Toronto');
    await toronto.patch('/settings', { reminderEnabled: true, reminderTime: '18:00' });
    const course = (await toronto.post('/courses', { code: 'C1', name: 'Course' })).body.course;
    await toronto.post('/topics', { courseId: course.id, title: 'Sets', learnedOn: '2026-09-30' });

    const idle = new Client(srv.url); // reminder on, nothing due
    await idle.register('I', 'i@example.com', 'America/Toronto');
    await idle.patch('/settings', { reminderEnabled: true, reminderTime: '18:00' });

    // 18:00 in Toronto (EDT) is 22:00 UTC.
    const hit = findUsersDueForReminder(srv.ctx, new Date('2026-10-01T21:55:00Z'), new Date('2026-10-01T22:00:00Z'));
    expect(hit.map((r) => r.user.email)).toEqual(['t@example.com']);
    expect(hit[0].digest.message).toBe('You have 1 topic waiting for review today.');

    expect(findUsersDueForReminder(srv.ctx, new Date('2026-10-01T22:00:00Z'), new Date('2026-10-01T22:05:00Z'))).toEqual([]);
  });
});
