import type { Course } from '../../shared/api.js';
import type { courseInputSchema } from '../../shared/validation.js';
import type { z } from 'zod';
import type { AppContext } from '../lib/context.js';
import { conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { nowIso, todayFor } from '../lib/time.js';
import * as repo from '../repositories/courses.js';

type CourseFields = z.output<typeof courseInputSchema>;

const duplicate = (code: string) => {
  const message = `You already have a course with the code "${code}".`;
  return conflict(message, { code: message });
};

export function listCourses(ctx: AppContext, userId: number, timezone: string): Course[] {
  return repo.listCourses(ctx.db, userId, todayFor(ctx, timezone));
}

export function getCourse(ctx: AppContext, userId: number, timezone: string, id: number): Course {
  const course = repo.getCourse(ctx.db, userId, id, todayFor(ctx, timezone));
  if (!course) throw notFound('That course');
  return course;
}

export function createCourse(ctx: AppContext, userId: number, timezone: string, input: CourseFields): Course {
  try {
    const id = repo.insertCourse(ctx.db, userId, input, nowIso(ctx));
    return getCourse(ctx, userId, timezone, id);
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate(input.code);
    throw err;
  }
}

export function updateCourse(ctx: AppContext, userId: number, timezone: string, id: number, input: CourseFields): Course {
  try {
    if (!repo.updateCourse(ctx.db, userId, id, input, nowIso(ctx))) throw notFound('That course');
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate(input.code);
    throw err;
  }
  return getCourse(ctx, userId, timezone, id);
}

export function deleteCourse(ctx: AppContext, userId: number, id: number): void {
  if (!repo.deleteCourse(ctx.db, userId, id)) throw notFound('That course');
}
