import type { z } from 'zod';
import type { ReviewResult, ReviewSession, TopicSummary } from '../../shared/api.js';
import { aggregateRating, applyReview, type Rating } from '../../shared/scheduler.js';
import type { reviewSubmitSchema } from '../../shared/validation.js';
import { transaction } from '../db/connection.js';
import type { AppContext } from '../lib/context.js';
import { badRequest, isUniqueViolation } from '../lib/errors.js';
import { nowIso, todayFor } from '../lib/time.js';
import { listQuestionHistory, type QuestionHistory } from '../repositories/questions.js';
import { findReviewByClientId, insertReview } from '../repositories/reviews.js';
import * as topics from '../repositories/topics.js';
import { topUpAfterReview } from './questionFlow.js';
import { requireTopic } from './topics.js';

type ReviewSubmit = z.output<typeof reviewSubmitSchema>;

export const QUESTIONS_PER_SESSION = 3;

/**
 * Pick up to `count` questions at random, weighted toward questions that were
 * missed last time or have never been asked (Efraimidis–Spirakis sampling:
 * each item gets key = U^(1/w) and the largest keys win).
 */
export function selectQuestions(history: QuestionHistory[], count: number, random: () => number = Math.random) {
  const weight = (q: QuestionHistory) => {
    if (q.lastRating === null) return 3;
    return { forgot: 4, hard: 3, good: 1.5, easy: 1 }[q.lastRating];
  };
  return history
    .map((q) => ({ q, key: Math.pow(random() || Number.EPSILON, 1 / weight(q)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map(({ q }) => ({ id: q.id, prompt: q.prompt, answer: q.answer, kind: q.kind, isNew: q.timesAsked === 0 }));
}

export function getReviewSession(ctx: AppContext, userId: number, timezone: string, topicId: number): ReviewSession {
  const today = todayFor(ctx, timezone);
  const row = requireTopic(ctx, userId, topicId);
  const picked = selectQuestions(listQuestionHistory(ctx.db, topicId), QUESTIONS_PER_SESSION);
  return {
    topic: topics.toTopicSummary(row, today),
    mode: picked.length > 0 ? 'questions' : 'free',
    questions: picked,
    today,
  };
}

/** Topics due today or overdue, most overdue first. */
export function getReviewQueue(ctx: AppContext, userId: number, timezone: string): TopicSummary[] {
  const today = todayFor(ctx, timezone);
  return topics.listTopics(ctx.db, userId, { dueOnOrBefore: today }).map((r) => topics.toTopicSummary(r, today));
}

export function submitReview(
  ctx: AppContext,
  userId: number,
  timezone: string,
  topicId: number,
  input: ReviewSubmit,
): ReviewResult {
  const today = todayFor(ctx, timezone);

  const { result, isNew } = transaction(ctx.db, (): { result: ReviewResult; isNew: boolean } => {
    const row = requireTopic(ctx, userId, topicId);

    // A retried request (e.g. after a network failure) returns the original result instead of double-counting.
    const existing = findReviewByClientId(ctx.db, userId, topicId, input.clientId);
    if (existing) {
      const replay: ReviewResult = {
        rating: existing.rating,
        previousInterval: existing.previousInterval,
        newInterval: existing.newInterval,
        daysOverdue: existing.daysOverdue,
        early: false,
        nextReviewOn: existing.nextReviewOn,
        topic: topics.toTopicSummary(row, today),
      };
      return { result: replay, isNew: false };
    }

    let rating: Rating;
    if (input.answers.length > 0) {
      const valid = new Set(listQuestionHistory(ctx.db, topicId).map((q) => q.id));
      const seen = new Set<number>();
      for (const a of input.answers) {
        if (!valid.has(a.questionId)) {
          throw badRequest('One of the questions in this review no longer exists. Please restart the review.');
        }
        if (seen.has(a.questionId)) throw badRequest('Each question can only be rated once per review.');
        seen.add(a.questionId);
      }
      rating = aggregateRating(input.answers.map((a) => a.rating));
    } else {
      rating = input.rating!;
    }

    const outcome = applyReview(topics.scheduleStateOf(row), rating, today);
    const now = nowIso(ctx);
    try {
      insertReview(ctx.db, {
        userId,
        topicId,
        clientId: input.clientId,
        reviewedAt: now,
        reviewDay: today,
        rating,
        previousInterval: outcome.previousInterval,
        newInterval: outcome.newInterval,
        previousEase: outcome.previousEase,
        newEase: outcome.newEase,
        daysOverdue: outcome.daysOverdue,
        nextReviewOn: outcome.state.nextReviewOn,
        answers: input.answers,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw badRequest('This review was already recorded.');
      throw err;
    }
    topics.updateTopicSchedule(ctx.db, userId, topicId, outcome.state, outcome.stage, rating, now);

    const recorded: ReviewResult = {
      rating,
      previousInterval: outcome.previousInterval,
      newInterval: outcome.newInterval,
      daysOverdue: outcome.daysOverdue,
      early: outcome.early,
      nextReviewOn: outcome.state.nextReviewOn,
      topic: topics.toTopicSummary(requireTopic(ctx, userId, topicId), today),
    };
    return { result: recorded, isNew: true };
  });
  // After the transaction commits (and not for a retried submission): keep fresh questions coming.
  if (isNew) topUpAfterReview(ctx, userId, topicId, input.answers);
  return result;
}
