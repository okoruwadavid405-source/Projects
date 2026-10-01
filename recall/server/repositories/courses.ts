import type { Course, CourseRef } from '../../shared/api.js';
import type { LocalDate } from '../../shared/dates.js';
import type { CourseColor } from '../../shared/validation.js';
import type { Database } from '../db/connection.js';

interface CourseRow {
  id: number;
  code: string;
  name: string;
  professor: string | null;
  description: string | null;
  color: CourseColor;
  is_demo: number;
  created_at: string;
  topic_count: number;
  due_count: number;
  mastered_count: number;
}

export interface CourseFields {
  code: string;
  name: string;
  professor: string | null;
  description: string | null;
  color: CourseColor;
}

const SELECT_COURSE = `
  SELECT c.*,
    (SELECT COUNT(*) FROM topics t WHERE t.course_id = c.id) AS topic_count,
    (SELECT COUNT(*) FROM topics t WHERE t.course_id = c.id AND t.next_review_at <= :today) AS due_count,
    (SELECT COUNT(*) FROM topics t WHERE t.course_id = c.id AND t.status = 'mastered') AS mastered_count
  FROM courses c
  WHERE c.user_id = :userId`;

const toCourse = (r: CourseRow): Course => ({
  id: r.id,
  code: r.code,
  name: r.name,
  professor: r.professor,
  description: r.description,
  color: r.color,
  isDemo: r.is_demo === 1,
  createdAt: r.created_at,
  topicCount: r.topic_count,
  dueCount: r.due_count,
  masteredCount: r.mastered_count,
});

export const toCourseRef = (c: { id: number; code: string; name: string; color: CourseColor }): CourseRef => ({
  id: c.id,
  code: c.code,
  name: c.name,
  color: c.color,
});

export function listCourses(db: Database, userId: number, today: LocalDate): Course[] {
  const rows = db.prepare(`${SELECT_COURSE} ORDER BY c.code COLLATE NOCASE`).all({ userId, today }) as unknown as CourseRow[];
  return rows.map(toCourse);
}

export function getCourse(db: Database, userId: number, id: number, today: LocalDate): Course | undefined {
  const row = db.prepare(`${SELECT_COURSE} AND c.id = :id`).get({ userId, id, today }) as CourseRow | undefined;
  return row && toCourse(row);
}

export function courseExists(db: Database, userId: number, id: number): boolean {
  return db.prepare('SELECT 1 FROM courses WHERE id = ? AND user_id = ?').get(id, userId) !== undefined;
}

export function insertCourse(db: Database, userId: number, f: CourseFields, now: string, isDemo = false): number {
  const result = db
    .prepare(
      `INSERT INTO courses (user_id, code, name, professor, description, color, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, f.code, f.name, f.professor, f.description, f.color, isDemo ? 1 : 0, now, now);
  return Number(result.lastInsertRowid);
}

export function updateCourse(db: Database, userId: number, id: number, f: CourseFields, now: string): boolean {
  const result = db
    .prepare(
      `UPDATE courses SET code = ?, name = ?, professor = ?, description = ?, color = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(f.code, f.name, f.professor, f.description, f.color, now, id, userId);
  return result.changes > 0;
}

export function deleteCourse(db: Database, userId: number, id: number): boolean {
  return db.prepare('DELETE FROM courses WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export function hasDemoCourses(db: Database, userId: number): boolean {
  return db.prepare('SELECT 1 FROM courses WHERE user_id = ? AND is_demo = 1 LIMIT 1').get(userId) !== undefined;
}

export function deleteDemoCourses(db: Database, userId: number): number {
  return Number(db.prepare('DELETE FROM courses WHERE user_id = ? AND is_demo = 1').run(userId).changes);
}
