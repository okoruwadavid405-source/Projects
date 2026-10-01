/**
 * Keeps every topic supplied with fresh, generated questions:
 *
 *  - drafts on demand (the "Generate questions" button), returned for the student to keep or discard;
 *  - a starter set, written in the background when a topic is saved without questions;
 *  - after each review, a couple of new questions that revisit what the student just missed from
 *    another angle. Review sessions favour never-asked questions, so each session brings new ones.
 *
 * Background work never blocks a request and never fails one: errors are logged and skipped.
 */
import type { z } from 'zod';
import type { QuestionDraft } from '../../shared/api.js';
import type { Rating } from '../../shared/scheduler.js';
import type { questionDraftRequestSchema } from '../../shared/validation.js';
import type { AppContext } from '../lib/context.js';
import { AppError, badRequest, tooManyRequests } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { countGeneratedQuestions, insertQuestion, listQuestions } from '../repositories/questions.js';
import { getTopicRow } from '../repositories/topics.js';
import { GenerationError, type GenerationRequest } from './questionGenerator.js';
import { requireTopic } from './topics.js';

type DraftRequest = z.output<typeof questionDraftRequestSchema>;

/** Questions written for a new topic that was saved without any. */
export const STARTER_QUESTION_COUNT = 5;
/** New questions added after each review. */
export const QUESTIONS_PER_REVIEW = 2;
/** Stop topping up once a topic has this many generated questions. */
export const MAX_GENERATED_PER_TOPIC = 24;
/** On-demand generations allowed per user per hour (each one is a paid API call). */
const DRAFTS_PER_HOUR = 30;

interface FlowState {
  jobs: Map<number, Promise<void>>;
  draftCounts: Map<number, { count: number; resetAt: number }>;
}
const states = new WeakMap<AppContext, FlowState>();
function state(ctx: AppContext): FlowState {
  let s = states.get(ctx);
  if (!s) states.set(ctx, (s = { jobs: new Map(), draftCounts: new Map() }));
  return s;
}

export const isGenerating = (ctx: AppContext, topicId: number) => state(ctx).jobs.has(topicId);

/** Resolves when any background generation for the topic has finished (used by tests and shutdown). */
export const backgroundJob = (ctx: AppContext, topicId: number) => state(ctx).jobs.get(topicId) ?? Promise.resolve();

function unavailable() {
  return new AppError(
    503,
    'generation_unavailable',
    "Question generation isn't set up on this server. You can still write questions yourself.",
  );
}

function courseOf(ctx: AppContext, userId: number, courseId: number) {
  const course = ctx.db.prepare('SELECT code, name FROM courses WHERE id = ? AND user_id = ?').get(courseId, userId) as
    | { code: string; name: string }
    | undefined;
  if (!course) throw badRequest('Choose one of your courses.', { courseId: 'Choose one of your courses.' });
  return course;
}

function checkDraftQuota(ctx: AppContext, userId: number) {
  const counts = state(ctx).draftCounts;
  const now = ctx.clock.now().getTime();
  let entry = counts.get(userId);
  if (!entry || entry.resetAt <= now) counts.set(userId, (entry = { count: 0, resetAt: now + 3_600_000 }));
  if (++entry.count > DRAFTS_PER_HOUR) {
    throw tooManyRequests("You've generated a lot of questions this hour. Please try again a little later.");
  }
}

export async function draftQuestions(ctx: AppContext, userId: number, input: DraftRequest): Promise<QuestionDraft[]> {
  const generator = ctx.questionGenerator;
  if (!generator) throw unavailable();
  const course = courseOf(ctx, userId, input.courseId);
  const existingPrompts = input.topicId !== undefined ? listQuestions(ctx.db, requireTopic(ctx, userId, input.topicId).id).map((q) => q.prompt) : [];
  checkDraftQuota(ctx, userId);
  try {
    return await generator.generate({
      course,
      topic: { title: input.title, description: input.description },
      notes: input.notes,
      count: input.count,
      existingPrompts,
      focusPrompts: [],
    });
  } catch (err) {
    if (err instanceof GenerationError) throw new AppError(err.retryable ? 503 : 422, 'generation_failed', err.message);
    throw err;
  }
}

/** Generate and store questions for a topic in the background. At most one job per topic at a time. */
function enqueue(ctx: AppContext, userId: number, topicId: number, build: () => GenerationRequest | null) {
  const generator = ctx.questionGenerator;
  const jobs = state(ctx).jobs;
  if (!generator || jobs.has(topicId)) return;

  const job = (async () => {
    const request = build();
    if (!request || request.count <= 0) return;
    const drafts = await generator.generate(request);
    // The topic may have been deleted (or its owner removed) while we were waiting.
    if (!getTopicRow(ctx.db, userId, topicId)) return;
    const room = MAX_GENERATED_PER_TOPIC - countGeneratedQuestions(ctx.db, topicId);
    const now = nowIso(ctx);
    for (const d of drafts.slice(0, Math.max(0, room))) {
      insertQuestion(ctx.db, topicId, { prompt: d.prompt, answer: d.answer, kind: d.kind, source: 'generated' }, now);
    }
  })()
    .catch((err) => {
      const reason = err instanceof GenerationError ? err.message : err;
      console.error(`[recall] Background question generation for topic ${topicId} failed:`, reason);
    })
    .finally(() => jobs.delete(topicId));
  jobs.set(topicId, job);
}

function baseRequest(ctx: AppContext, userId: number, topicId: number) {
  const topic = getTopicRow(ctx.db, userId, topicId);
  if (!topic) return null;
  return {
    course: { code: topic.course_code, name: topic.course_name },
    topic: { title: topic.title, description: topic.description },
    existingPrompts: listQuestions(ctx.db, topicId).map((q) => q.prompt),
  };
}

/** A new topic saved without questions gets a starter set. */
export function fillNewTopic(ctx: AppContext, userId: number, topicId: number) {
  enqueue(ctx, userId, topicId, () => {
    const base = baseRequest(ctx, userId, topicId);
    return base && { ...base, count: STARTER_QUESTION_COUNT, focusPrompts: [] };
  });
}

/** After a review, add fresh questions — aimed at whatever the student just missed. */
export function topUpAfterReview(
  ctx: AppContext,
  userId: number,
  topicId: number,
  answers: { questionId: number; rating: Rating }[],
) {
  enqueue(ctx, userId, topicId, () => {
    const base = baseRequest(ctx, userId, topicId);
    if (!base) return null;
    const room = MAX_GENERATED_PER_TOPIC - countGeneratedQuestions(ctx.db, topicId);
    const struggled = new Set(answers.filter((a) => a.rating === 'forgot' || a.rating === 'hard').map((a) => a.questionId));
    const focusPrompts = listQuestions(ctx.db, topicId)
      .filter((q) => struggled.has(q.id))
      .map((q) => q.prompt);
    return { ...base, count: Math.min(QUESTIONS_PER_REVIEW, room), focusPrompts };
  });
}
