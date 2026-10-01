import type { TopicSummary } from '../../shared/api.js';
import { diffDays, parseLocalDate, type LocalDate } from '../../shared/dates.js';
import { displayStatus, type Rating, type ScheduleState, type TopicStage } from '../../shared/scheduler.js';
import type { CourseColor } from '../../shared/validation.js';
import type { Database } from '../db/connection.js';

export interface TopicRow {
  id: number;
  user_id: number;
  course_id: number;
  title: string;
  description: string | null;
  learned_on: string;
  understanding: number;
  status: TopicStage;
  ease: number;
  current_interval: number;
  next_review_at: string;
  last_reviewed_on: string | null;
  last_rating: Rating | null;
  review_count: number;
  lapse_count: number;
  created_at: string;
  updated_at: string;
  course_code: string;
  course_name: string;
  course_color: CourseColor;
  question_count: number;
}

const SELECT_TOPIC = `
  SELECT t.*, c.code AS course_code, c.name AS course_name, c.color AS course_color,
    (SELECT COUNT(*) FROM questions q WHERE q.topic_id = t.id) AS question_count
  FROM topics t
  JOIN courses c ON c.id = t.course_id
  WHERE t.user_id = :userId`;

export function toTopicSummary(r: TopicRow, today: LocalDate): TopicSummary {
  const nextReviewOn = parseLocalDate(r.next_review_at);
  return {
    id: r.id,
    courseId: r.course_id,
    title: r.title,
    description: r.description,
    learnedOn: parseLocalDate(r.learned_on),
    stage: r.status,
    status: displayStatus(r.status, nextReviewOn, today),
    nextReviewOn,
    daysUntilDue: diffDays(nextReviewOn, today),
    interval: r.current_interval,
    reviewCount: r.review_count,
    lapseCount: r.lapse_count,
    lastRating: r.last_rating,
    lastReviewedOn: r.last_reviewed_on ? parseLocalDate(r.last_reviewed_on) : null,
    questionCount: r.question_count,
    course: { id: r.course_id, code: r.course_code, name: r.course_name, color: r.course_color },
  };
}

export function scheduleStateOf(r: TopicRow): ScheduleState {
  return {
    learnedOn: parseLocalDate(r.learned_on),
    lastReviewedOn: r.last_reviewed_on ? parseLocalDate(r.last_reviewed_on) : null,
    nextReviewOn: parseLocalDate(r.next_review_at),
    interval: r.current_interval,
    ease: r.ease,
    reviewCount: r.review_count,
    lapseCount: r.lapse_count,
  };
}

const ORDER = 'ORDER BY t.next_review_at, c.code COLLATE NOCASE, t.title COLLATE NOCASE';

export function listTopics(db: Database, userId: number, filter: { courseId?: number; dueOnOrBefore?: LocalDate } = {}): TopicRow[] {
  let sql = SELECT_TOPIC;
  const params: Record<string, string | number> = { userId };
  if (filter.courseId !== undefined) {
    sql += ' AND t.course_id = :courseId';
    params.courseId = filter.courseId;
  }
  if (filter.dueOnOrBefore !== undefined) {
    sql += ' AND t.next_review_at <= :due';
    params.due = filter.dueOnOrBefore;
  }
  return db.prepare(`${sql} ${ORDER}`).all(params) as unknown as TopicRow[];
}

export function listTopicsDueBetween(db: Database, userId: number, from: LocalDate, to: LocalDate): TopicRow[] {
  return db
    .prepare(`${SELECT_TOPIC} AND t.next_review_at BETWEEN :from AND :to ${ORDER}`)
    .all({ userId, from, to }) as unknown as TopicRow[];
}

export function getTopicRow(db: Database, userId: number, id: number): TopicRow | undefined {
  return db.prepare(`${SELECT_TOPIC} AND t.id = :id`).get({ userId, id }) as TopicRow | undefined;
}

export function insertTopic(
  db: Database,
  userId: number,
  t: { courseId: number; title: string; description: string | null; understanding: number; schedule: ScheduleState },
  now: string,
): number {
  const result = db
    .prepare(
      `INSERT INTO topics (user_id, course_id, title, description, learned_on, understanding, status, ease,
         current_interval, next_review_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      t.courseId,
      t.title,
      t.description,
      t.schedule.learnedOn,
      t.understanding,
      t.schedule.ease,
      t.schedule.interval,
      t.schedule.nextReviewOn,
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function updateTopicFields(
  db: Database,
  userId: number,
  id: number,
  f: { courseId: number; title: string; description: string | null; learnedOn: LocalDate; nextReviewOn: LocalDate },
  now: string,
): void {
  db.prepare(
    `UPDATE topics SET course_id = ?, title = ?, description = ?, learned_on = ?, next_review_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(f.courseId, f.title, f.description, f.learnedOn, f.nextReviewOn, now, id, userId);
}

export function updateTopicSchedule(
  db: Database,
  userId: number,
  id: number,
  s: ScheduleState,
  stage: TopicStage,
  lastRating: Rating,
  now: string,
): void {
  db.prepare(
    `UPDATE topics SET status = ?, ease = ?, current_interval = ?, next_review_at = ?, last_reviewed_on = ?,
       last_rating = ?, review_count = ?, lapse_count = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(stage, s.ease, s.interval, s.nextReviewOn, s.lastReviewedOn, lastRating, s.reviewCount, s.lapseCount, now, id, userId);
}

export function deleteTopic(db: Database, userId: number, id: number): boolean {
  return db.prepare('DELETE FROM topics WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}
