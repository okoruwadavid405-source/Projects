import type { Question } from '../../shared/api.js';
import type { Rating } from '../../shared/scheduler.js';
import type { QuestionKind, QuestionSource } from '../../shared/validation.js';
import type { Database } from '../db/connection.js';

interface QuestionRow {
  id: number;
  topic_id: number;
  prompt: string;
  answer: string;
  source: QuestionSource;
  kind: QuestionKind | null;
  created_at: string;
  updated_at: string;
}

const toQuestion = (r: QuestionRow): Question => ({
  id: r.id,
  topicId: r.topic_id,
  prompt: r.prompt,
  answer: r.answer,
  source: r.source,
  kind: r.kind,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Callers must already have verified that the topic belongs to the user. */
export function listQuestions(db: Database, topicId: number): Question[] {
  const rows = db.prepare('SELECT * FROM questions WHERE topic_id = ? ORDER BY id').all(topicId) as unknown as QuestionRow[];
  return rows.map(toQuestion);
}

/** Fetch a question only if its topic belongs to `userId`. */
export function getQuestion(db: Database, userId: number, id: number): Question | undefined {
  const row = db
    .prepare(
      `SELECT q.* FROM questions q JOIN topics t ON t.id = q.topic_id
       WHERE q.id = ? AND t.user_id = ?`,
    )
    .get(id, userId) as QuestionRow | undefined;
  return row && toQuestion(row);
}

export interface NewQuestion {
  prompt: string;
  answer: string;
  source?: QuestionSource;
  kind?: QuestionKind | null;
}

export function insertQuestion(db: Database, topicId: number, q: NewQuestion, now: string): number {
  const result = db
    .prepare('INSERT INTO questions (topic_id, prompt, answer, source, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(topicId, q.prompt, q.answer, q.source ?? 'manual', q.kind ?? null, now, now);
  return Number(result.lastInsertRowid);
}

export function countGeneratedQuestions(db: Database, topicId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM questions WHERE topic_id = ? AND source = 'generated'").get(topicId) as { n: number }).n;
}

export function updateQuestion(db: Database, id: number, prompt: string, answer: string, now: string): void {
  db.prepare('UPDATE questions SET prompt = ?, answer = ?, updated_at = ? WHERE id = ?').run(prompt, answer, now, id);
}

export function deleteQuestion(db: Database, id: number): void {
  db.prepare('DELETE FROM questions WHERE id = ?').run(id);
}

export interface QuestionHistory {
  id: number;
  prompt: string;
  answer: string;
  kind: QuestionKind | null;
  lastRating: Rating | null;
  timesAsked: number;
}

/** Questions of a topic with the result of the most recent time each was asked. */
export function listQuestionHistory(db: Database, topicId: number): QuestionHistory[] {
  return db
    .prepare(
      `SELECT q.id, q.prompt, q.answer, q.kind,
         (SELECT ra.rating FROM review_answers ra WHERE ra.question_id = q.id ORDER BY ra.id DESC LIMIT 1) AS lastRating,
         (SELECT COUNT(*) FROM review_answers ra WHERE ra.question_id = q.id) AS timesAsked
       FROM questions q WHERE q.topic_id = ? ORDER BY q.id`,
    )
    .all(topicId) as unknown as QuestionHistory[];
}
