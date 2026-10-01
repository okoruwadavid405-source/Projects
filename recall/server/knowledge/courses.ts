/** Catalog search/creation and linking a student to a course version. */
import type { z } from 'zod';
import { courseCodeKey, termLabel, type TermRef } from '../../shared/knowledge.js';
import type {
  CatalogCourse,
  catalogCourseInputSchema,
  departmentInputSchema,
  StudentCourse,
  studentCourseInputSchema,
  universityInputSchema,
} from '../../shared/knowledgeApi.js';
import { COURSE_COLORS, type CourseColor } from '../../shared/validation.js';
import { transaction } from '../db/connection.js';
import type { AppContext } from '../lib/context.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { useQuota } from '../lib/quota.js';
import * as repo from './repository.js';

const CREATE_LIMIT = 30;
const createQuota = (ctx: AppContext, userId: number) =>
  useQuota(ctx, `catalog:${userId}`, CREATE_LIMIT, "You've added a lot of catalog entries this hour. Please try again later.");

export function createUniversity(ctx: AppContext, userId: number, input: z.output<typeof universityInputSchema>) {
  createQuota(ctx, userId);
  try {
    const id = repo.insertUniversity(ctx.db, input, userId, nowIso(ctx));
    return repo.searchUniversities(ctx.db, input.name).find((u) => u.id === id)!;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`${input.name} is already in the list — search for it instead.`, { name: 'Already exists.' });
    throw err;
  }
}

export function createDepartment(ctx: AppContext, userId: number, universityId: number, input: z.output<typeof departmentInputSchema>) {
  if (!repo.getUniversityRow(ctx.db, universityId)) throw notFound('That university');
  createQuota(ctx, userId);
  try {
    const id = repo.insertDepartment(ctx.db, universityId, input.name, userId, nowIso(ctx));
    return repo.listDepartments(ctx.db, universityId).find((d) => d.id === id)!;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('That department already exists — choose it from the list.', { name: 'Already exists.' });
    throw err;
  }
}

export function createCatalogCourse(ctx: AppContext, userId: number, input: z.output<typeof catalogCourseInputSchema>): CatalogCourse {
  const dept = repo.listDepartments(ctx.db, input.universityId).find((d) => d.id === input.departmentId);
  if (!dept) throw badRequest('Choose a department at this university.', { departmentId: 'Choose a department.' });
  const existing = repo.findCatalogCourseByCode(ctx.db, input.universityId, input.code);
  if (existing) return existing; // "find or create": the same code at the same school is the same course
  createQuota(ctx, userId);
  const id = repo.insertCatalogCourse(ctx.db, input, userId, nowIso(ctx));
  return repo.getCatalogCourse(ctx.db, id)!;
}

/** Link the student to a course version, creating the Recall course their reviews live in (or reusing one with the same code). */
export function enrollStudent(ctx: AppContext, userId: number, input: z.output<typeof studentCourseInputSchema>): StudentCourse {
  const course = repo.getCatalogCourse(ctx.db, input.catalogCourseId);
  if (!course) throw notFound('That course');
  const term: TermRef = { term: input.term, year: input.year };
  const now = nowIso(ctx);

  return transaction(ctx.db, () => {
    const versionId = repo.findOrCreateVersion(ctx.db, course.id, term, now);
    const existing = repo.findStudentCourseByVersion(ctx.db, userId, versionId);
    if (existing) return existing;

    // Reuse an unlinked Recall course with the same code, so existing reviews join the course profile.
    const candidates = ctx.db
      .prepare(
        `SELECT c.id, c.code FROM courses c
         WHERE c.user_id = ? AND NOT EXISTS (SELECT 1 FROM student_courses sc WHERE sc.course_id = c.id)`,
      )
      .all(userId) as { id: number; code: string }[];
    let recallCourseId = candidates.find((c) => courseCodeKey(c.code) === courseCodeKey(course.code))?.id;

    if (!recallCourseId) {
      const taken = (code: string) =>
        ctx.db.prepare('SELECT 1 FROM courses WHERE user_id = ? AND code = ? COLLATE NOCASE').get(userId, code) !== undefined;
      let code = course.code;
      if (taken(code)) code = `${course.code} ${input.term[0].toUpperCase()}${String(input.year).slice(2)}`.slice(0, 20);
      if (taken(code)) throw conflict(`You already have a course called ${code}.`);
      const used = new Set((ctx.db.prepare('SELECT color FROM courses WHERE user_id = ?').all(userId) as { color: CourseColor }[]).map((r) => r.color));
      const color = (COURSE_COLORS as readonly string[]).includes(input.color ?? '')
        ? (input.color as CourseColor)
        : (COURSE_COLORS.find((c) => !used.has(c)) ?? 'indigo');
      recallCourseId = Number(
        ctx.db
          .prepare(
            `INSERT INTO courses (user_id, code, name, professor, description, color, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
          )
          .run(userId, code, course.title.slice(0, 120), `${course.university.name} · ${termLabel(term)}`, color, now, now).lastInsertRowid,
      );
    }
    try {
      const id = repo.insertStudentCourse(ctx.db, userId, course.id, versionId, recallCourseId, now);
      return repo.getStudentCourse(ctx.db, userId, id)!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('That course is already linked.');
      throw err;
    }
  });
}

export function requireStudentCourse(ctx: AppContext, userId: number, id: number): StudentCourse {
  const sc = repo.getStudentCourse(ctx.db, userId, id);
  if (!sc) throw notFound('That course');
  return sc;
}

/** Unlink: removes the student's private course knowledge (uploads, extractions, AI suggestions). Reviews are kept. */
export function unlinkStudentCourse(ctx: AppContext, userId: number, id: number) {
  const sc = requireStudentCourse(ctx, userId, id);
  transaction(ctx.db, () => {
    // Uploaded documents (and the sources they produced) belong to this link.
    ctx.db
      .prepare(`DELETE FROM sources WHERE id IN (SELECT source_id FROM documents WHERE student_course_id = ? AND user_id = ?)`)
      .run(id, userId);
    // Other private material for the course (saved links, AI suggestions) goes too, unless another term of it is still linked.
    const otherLinks = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM student_courses WHERE user_id = ? AND catalog_course_id = ? AND id <> ?')
      .get(userId, sc.course.id, id) as { n: number };
    if (otherLinks.n === 0) {
      ctx.db.prepare(`DELETE FROM sources WHERE owner_user_id = ? AND course_id = ? AND visibility = 'private'`).run(userId, sc.course.id);
    }
    ctx.db.prepare('DELETE FROM student_courses WHERE id = ? AND user_id = ?').run(id, userId);
  });
}
