import type { z } from 'zod';
import type { Question, TopicDetail, TopicSummary } from '../../shared/api.js';
import { compareDates, maxDate, addDays, type LocalDate } from '../../shared/dates.js';
import { initialSchedule, projectSchedule } from '../../shared/scheduler.js';
import type { questionInputSchema, topicCreateSchema, topicUpdateSchema } from '../../shared/validation.js';
import { transaction } from '../db/connection.js';
import type { AppContext } from '../lib/context.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { nowIso, todayFor } from '../lib/time.js';
import { courseExists } from '../repositories/courses.js';
import * as questions from '../repositories/questions.js';
import { listTopicReviews } from '../repositories/reviews.js';
import * as repo from '../repositories/topics.js';
import { fillNewTopic, isGenerating } from './questionFlow.js';

type TopicCreate = z.output<typeof topicCreateSchema>;
type TopicUpdate = z.output<typeof topicUpdateSchema>;
type QuestionFields = z.output<typeof questionInputSchema>;

const duplicate = (title: string) => {
  const message = `This course already has a topic called "${title}".`;
  return conflict(message, { title: message });
};

function assertNotFuture(learnedOn: LocalDate, today: LocalDate) {
  if (compareDates(learnedOn, today) > 0) {
    const message = 'The date learned cannot be in the future.';
    throw badRequest(message, { learnedOn: message });
  }
}

function requireCourse(ctx: AppContext, userId: number, courseId: number) {
  if (!courseExists(ctx.db, userId, courseId)) {
    throw badRequest('Choose one of your courses.', { courseId: 'Choose one of your courses.' });
  }
}

export function requireTopic(ctx: AppContext, userId: number, id: number): repo.TopicRow {
  const row = repo.getTopicRow(ctx.db, userId, id);
  if (!row) throw notFound('That topic');
  return row;
}

export function listTopics(ctx: AppContext, userId: number, timezone: string, courseId?: number): TopicSummary[] {
  const today = todayFor(ctx, timezone);
  return repo.listTopics(ctx.db, userId, { courseId }).map((r) => repo.toTopicSummary(r, today));
}

export function getTopicDetail(ctx: AppContext, userId: number, timezone: string, id: number): TopicDetail {
  const today = todayFor(ctx, timezone);
  const row = requireTopic(ctx, userId, id);
  const state = repo.scheduleStateOf(row);
  return {
    ...repo.toTopicSummary(row, today),
    understanding: row.understanding,
    ease: row.ease,
    questions: questions.listQuestions(ctx.db, id),
    reviews: listTopicReviews(ctx.db, userId, id),
    // Review dates if every upcoming review goes well; an overdue topic is projected from today.
    projected: projectSchedule({ ...state, nextReviewOn: maxDate(state.nextReviewOn, today) }, 5),
    generatingQuestions: isGenerating(ctx, id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTopic(ctx: AppContext, userId: number, timezone: string, input: TopicCreate): TopicDetail {
  const today = todayFor(ctx, timezone);
  assertNotFuture(input.learnedOn, today);
  requireCourse(ctx, userId, input.courseId);
  const now = nowIso(ctx);
  try {
    const id = transaction(ctx.db, () => {
      const topicId = repo.insertTopic(
        ctx.db,
        userId,
        {
          courseId: input.courseId,
          title: input.title,
          description: input.description,
          understanding: input.understanding,
          schedule: initialSchedule(input.learnedOn, input.understanding, today),
        },
        now,
      );
      for (const q of input.questions) questions.insertQuestion(ctx.db, topicId, q, now);
      return topicId;
    });
    if (input.questions.length === 0) fillNewTopic(ctx, userId, id);
    return getTopicDetail(ctx, userId, timezone, id);
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate(input.title);
    throw err;
  }
}

export function updateTopic(ctx: AppContext, userId: number, timezone: string, id: number, input: TopicUpdate): TopicDetail {
  const today = todayFor(ctx, timezone);
  const row = requireTopic(ctx, userId, id);
  const courseId = input.courseId ?? row.course_id;
  if (courseId !== row.course_id) requireCourse(ctx, userId, courseId);
  const learnedOn = input.learnedOn ?? (row.learned_on as LocalDate);
  assertNotFuture(learnedOn, today);

  // Before the first review the due date follows the learned date; afterwards the review history owns it.
  let nextReviewOn = row.next_review_at as LocalDate;
  if (row.review_count === 0 && learnedOn !== row.learned_on) {
    nextReviewOn = maxDate(addDays(learnedOn, row.current_interval), today);
  }
  try {
    repo.updateTopicFields(
      ctx.db,
      userId,
      id,
      {
        courseId,
        title: input.title ?? row.title,
        description: input.description === undefined ? row.description : input.description,
        learnedOn,
        nextReviewOn,
      },
      nowIso(ctx),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate(input.title ?? row.title);
    throw err;
  }
  return getTopicDetail(ctx, userId, timezone, id);
}

export function deleteTopic(ctx: AppContext, userId: number, id: number): void {
  if (!repo.deleteTopic(ctx.db, userId, id)) throw notFound('That topic');
}

export function addQuestion(ctx: AppContext, userId: number, topicId: number, input: QuestionFields): Question {
  requireTopic(ctx, userId, topicId);
  const id = questions.insertQuestion(ctx.db, topicId, input, nowIso(ctx));
  return questions.getQuestion(ctx.db, userId, id)!;
}

export function editQuestion(ctx: AppContext, userId: number, id: number, input: QuestionFields): Question {
  if (!questions.getQuestion(ctx.db, userId, id)) throw notFound('That question');
  questions.updateQuestion(ctx.db, id, input.prompt, input.answer, nowIso(ctx));
  return questions.getQuestion(ctx.db, userId, id)!;
}

export function removeQuestion(ctx: AppContext, userId: number, id: number): void {
  if (!questions.getQuestion(ctx.db, userId, id)) throw notFound('That question');
  questions.deleteQuestion(ctx.db, id);
}
