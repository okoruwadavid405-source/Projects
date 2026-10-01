import type { ReviewRecord } from '../../shared/api.js';
import { parseLocalDate, type LocalDate } from '../../shared/dates.js';
import type { Rating } from '../../shared/scheduler.js';
import type { Database } from '../db/connection.js';

interface ReviewRow {
  id: number;
  topic_id: number;
  reviewed_at: string;
  review_day: string;
  rating: Rating;
  previous_interval: number;
  new_interval: number;
  days_overdue: number;
  next_review_at: string;
}

export const toReviewRecord = (r: ReviewRow): ReviewRecord => ({
  id: r.id,
  topicId: r.topic_id,
  reviewedAt: r.reviewed_at,
  reviewDay: parseLocalDate(r.review_day),
  rating: r.rating,
  previousInterval: r.previous_interval,
  newInterval: r.new_interval,
  daysOverdue: r.days_overdue,
  nextReviewOn: parseLocalDate(r.next_review_at),
});

export interface NewReview {
  userId: number;
  topicId: number;
  clientId: string;
  reviewedAt: string;
  reviewDay: LocalDate;
  rating: Rating;
  previousInterval: number;
  newInterval: number;
  previousEase: number;
  newEase: number;
  daysOverdue: number;
  nextReviewOn: LocalDate;
  answers: { questionId: number; rating: Rating }[];
}

export function insertReview(db: Database, r: NewReview): number {
  const result = db
    .prepare(
      `INSERT INTO reviews (user_id, topic_id, client_id, reviewed_at, review_day, rating, previous_interval,
         new_interval, previous_ease, new_ease, days_overdue, next_review_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.userId,
      r.topicId,
      r.clientId,
      r.reviewedAt,
      r.reviewDay,
      r.rating,
      r.previousInterval,
      r.newInterval,
      r.previousEase,
      r.newEase,
      r.daysOverdue,
      r.nextReviewOn,
    );
  const reviewId = Number(result.lastInsertRowid);
  const insertAnswer = db.prepare('INSERT INTO review_answers (review_id, question_id, rating) VALUES (?, ?, ?)');
  for (const a of r.answers) insertAnswer.run(reviewId, a.questionId, a.rating);
  return reviewId;
}

export function findReviewByClientId(db: Database, userId: number, topicId: number, clientId: string): ReviewRecord | undefined {
  const row = db
    .prepare('SELECT * FROM reviews WHERE topic_id = ? AND client_id = ? AND user_id = ?')
    .get(topicId, clientId, userId) as ReviewRow | undefined;
  return row && toReviewRecord(row);
}

export function listTopicReviews(db: Database, userId: number, topicId: number, limit = 50): ReviewRecord[] {
  const rows = db
    .prepare('SELECT * FROM reviews WHERE topic_id = ? AND user_id = ? ORDER BY reviewed_at DESC, id DESC LIMIT ?')
    .all(topicId, userId, limit) as unknown as ReviewRow[];
  return rows.map(toReviewRecord);
}

/** Distinct local calendar days on which the user reviewed anything, newest first. */
export function listReviewDays(db: Database, userId: number): LocalDate[] {
  const rows = db
    .prepare('SELECT DISTINCT review_day FROM reviews WHERE user_id = ? ORDER BY review_day DESC')
    .all(userId) as { review_day: string }[];
  return rows.map((r) => parseLocalDate(r.review_day));
}

export function countReviewsOn(db: Database, userId: number, day: LocalDate): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND review_day = ?').get(userId, day) as { n: number }).n;
}

export function countReviewsByDay(db: Database, userId: number, from: LocalDate, to: LocalDate): { day: LocalDate; count: number }[] {
  const rows = db
    .prepare(
      `SELECT review_day AS day, COUNT(*) AS count FROM reviews
       WHERE user_id = ? AND review_day BETWEEN ? AND ? GROUP BY review_day`,
    )
    .all(userId, from, to) as { day: string; count: number }[];
  return rows.map((r) => ({ day: parseLocalDate(r.day), count: r.count }));
}

export function ratingCounts(db: Database, userId: number): Record<Rating, number> {
  const counts: Record<Rating, number> = { forgot: 0, hard: 0, good: 0, easy: 0 };
  const rows = db
    .prepare('SELECT rating, COUNT(*) AS n FROM reviews WHERE user_id = ? GROUP BY rating')
    .all(userId) as { rating: Rating; n: number }[];
  for (const r of rows) counts[r.rating] = r.n;
  return counts;
}

export function courseReviewStats(db: Database, userId: number): { courseId: number; total: number; recalled: number }[] {
  return db
    .prepare(
      `SELECT t.course_id AS courseId, COUNT(*) AS total, SUM(r.rating <> 'forgot') AS recalled
       FROM reviews r JOIN topics t ON t.id = r.topic_id
       WHERE r.user_id = ? GROUP BY t.course_id`,
    )
    .all(userId) as unknown as { courseId: number; total: number; recalled: number }[];
}

/** The most recent review per topic within the last `sinceDay`, newest first. */
export function recentReviews(db: Database, userId: number, sinceDay: LocalDate): (ReviewRecord & { topicTitle: string })[] {
  const rows = db
    .prepare(
      `SELECT r.*, t.title AS topic_title FROM reviews r JOIN topics t ON t.id = r.topic_id
       WHERE r.user_id = ? AND r.review_day >= ? ORDER BY r.reviewed_at DESC, r.id DESC`,
    )
    .all(userId, sinceDay) as unknown as (ReviewRow & { topic_title: string })[];
  return rows.map((r) => ({ ...toReviewRecord(r), topicTitle: r.topic_title }));
}
