/**
 * Recall scheduling engine — an adaptive spaced-repetition rule inspired by SM-2.
 *
 * Every topic carries two numbers:
 *   I  — the current interval in days (the gap the student was last scheduled for)
 *   E  — the ease factor, a per-topic growth multiplier in [1.3, 3.0]
 *
 * When a topic is reviewed on day `t`, let
 *   a = t − (day of the previous review, or the day it was learned)   elapsed days
 *   s = I                                                             scheduled gap
 *   o = max(0, a − s)                                                 days overdue
 *
 * On-time or late reviews (a ≥ s). Remembering something *after* its due date is
 * evidence the memory is stronger than predicted, so part of the overdue time is
 * credited (Hard ¼, Good ½, Easy all of it):
 *   Forgot: I′ = 1                         E′ = E − 0.20  (− 0.10 if overdue: lateness, not the student, is the likely cause)
 *   Hard:   I′ = (s + o/4) · 1.2           E′ = E − 0.15
 *   Good:   I′ = (s + o/2) · E             E′ = E
 *   Easy:   I′ = (s + o)   · E · 1.3       E′ = E + 0.15
 * and the results are ordered s ≤ Hard < Good < Easy (an on-time Hard never shrinks the interval).
 *
 * Early reviews (a < s, e.g. a same-day or "review ahead" session). Only the time
 * that actually passed counts, so the base is `a` instead of `s`. Good/Easy never
 * pull the due date earlier than it already was, but Hard can (the student is
 * struggling) and Forgot always resets to tomorrow.
 *
 * All intervals are rounded to whole days and kept within [1, 365].
 *
 * The initial ease comes from the student's self-rated understanding u ∈ 1..5:
 *   E₀ = 1.5 + 0.125 · u      (u = 4 → E₀ = 2.0)
 * so a student who always answers "Good" on a u = 4 topic is reviewed after
 * 1, 2, 4, 8, 16, 32 … days — i.e. day 1, 3, 7, 15, 31, 63 after learning.
 */

import { addDays, diffDays, maxDate, type LocalDate } from './dates.js';

export const RATINGS = ['forgot', 'hard', 'good', 'easy'] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_SCORE: Record<Rating, number> = { forgot: 0, hard: 1, good: 2, easy: 3 };

export const TOPIC_STAGES = ['new', 'learning', 'reviewing', 'mastered'] as const;
export type TopicStage = (typeof TOPIC_STAGES)[number];
export type TopicDisplayStatus = TopicStage | 'due' | 'overdue';

export const SCHEDULER = {
  initialInterval: 1,
  minEase: 1.3,
  maxEase: 3.0,
  maxInterval: 365,
  hardMultiplier: 1.2,
  easyBonus: 1.3,
  easeDelta: { forgot: -0.2, hard: -0.15, good: 0, easy: 0.15 } satisfies Record<Rating, number>,
  /** Fraction of the forgot ease penalty applied when the review was overdue. */
  overdueForgotPenaltyFactor: 0.5,
  /** Fraction of overdue days credited to the interval for each rating. */
  overdueCredit: { hard: 0.25, good: 0.5, easy: 1 },
  /** Intervals below this many days count as "learning". */
  learningBelowDays: 7,
  /** Intervals of at least this many days count as "mastered". */
  masteredFromDays: 30,
} as const;

export interface ScheduleState {
  learnedOn: LocalDate;
  lastReviewedOn: LocalDate | null;
  nextReviewOn: LocalDate;
  interval: number;
  ease: number;
  reviewCount: number;
  lapseCount: number;
}

export interface ReviewOutcome {
  state: ScheduleState;
  stage: TopicStage;
  rating: Rating;
  previousInterval: number;
  newInterval: number;
  previousEase: number;
  newEase: number;
  elapsedDays: number;
  daysOverdue: number;
  early: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round2 = (value: number) => Math.round(value * 100) / 100;

export function initialEase(understanding: number): number {
  const u = clamp(Math.round(understanding), 1, 5);
  return round2(1.5 + 0.125 * u);
}

/**
 * Schedule for a freshly created topic. The first review is the day after it was
 * learned — or today, if it was learned a while ago (it is never overdue on day one).
 */
export function initialSchedule(learnedOn: LocalDate, understanding: number, today: LocalDate): ScheduleState {
  return {
    learnedOn,
    lastReviewedOn: null,
    nextReviewOn: maxDate(addDays(learnedOn, SCHEDULER.initialInterval), today),
    interval: SCHEDULER.initialInterval,
    ease: initialEase(understanding),
    reviewCount: 0,
    lapseCount: 0,
  };
}

/** The next interval (days) each rating would produce if reviewed on `today`. */
export function previewIntervals(state: ScheduleState, today: LocalDate): Record<Rating, number> {
  const anchor = state.lastReviewedOn ?? state.learnedOn;
  const a = Math.max(0, diffDays(today, anchor));
  const s = Math.max(1, state.interval);
  const E = state.ease;
  const early = a < s;
  const o = Math.max(0, a - s);
  const { hardMultiplier, easyBonus, overdueCredit, maxInterval } = SCHEDULER;
  const cap = (n: number) => clamp(Math.round(n), 1, maxInterval);

  let hard: number;
  let good: number;
  let easy: number;
  if (early) {
    const remaining = s - a;
    hard = cap(a * hardMultiplier);
    good = cap(Math.max(a * E, remaining));
    easy = cap(Math.max(a * E * easyBonus, remaining));
    good = Math.max(good, hard);
    easy = Math.max(easy, good);
  } else {
    hard = cap(Math.max((s + o * overdueCredit.hard) * hardMultiplier, s));
    good = cap(Math.max((s + o * overdueCredit.good) * E, hard + 1));
    easy = cap(Math.max((s + o * overdueCredit.easy) * E * easyBonus, good + 1));
  }
  return { forgot: 1, hard, good, easy };
}

export function stageFor(interval: number, reviewCount: number, lastRating: Rating | null): TopicStage {
  if (reviewCount === 0) return 'new';
  if (lastRating === 'forgot' || interval < SCHEDULER.learningBelowDays) return 'learning';
  if (interval < SCHEDULER.masteredFromDays) return 'reviewing';
  return 'mastered';
}

export function applyReview(state: ScheduleState, rating: Rating, today: LocalDate): ReviewOutcome {
  const anchor = state.lastReviewedOn ?? state.learnedOn;
  const elapsedDays = Math.max(0, diffDays(today, anchor));
  const s = Math.max(1, state.interval);
  const daysOverdue = Math.max(0, elapsedDays - s);
  const early = elapsedDays < s;

  const newInterval = previewIntervals(state, today)[rating];

  let easeDelta: number = SCHEDULER.easeDelta[rating];
  if (rating === 'forgot' && daysOverdue > 0) easeDelta *= SCHEDULER.overdueForgotPenaltyFactor;
  const newEase = round2(clamp(state.ease + easeDelta, SCHEDULER.minEase, SCHEDULER.maxEase));

  const next: ScheduleState = {
    learnedOn: state.learnedOn,
    lastReviewedOn: today,
    nextReviewOn: addDays(today, newInterval),
    interval: newInterval,
    ease: newEase,
    reviewCount: state.reviewCount + 1,
    lapseCount: state.lapseCount + (rating === 'forgot' ? 1 : 0),
  };

  return {
    state: next,
    stage: stageFor(newInterval, next.reviewCount, rating),
    rating,
    previousInterval: state.interval,
    newInterval,
    previousEase: state.ease,
    newEase,
    elapsedDays,
    daysOverdue,
    early,
  };
}

/**
 * Combine per-question ratings into one topic rating: the mean score, rounded
 * half-down — when the evidence is split, Recall schedules the review sooner.
 */
export function aggregateRating(ratings: readonly Rating[]): Rating {
  if (ratings.length === 0) throw new RangeError('At least one rating is required');
  const mean = ratings.reduce((sum, r) => sum + RATING_SCORE[r], 0) / ratings.length;
  return RATINGS[clamp(Math.ceil(mean - 0.5), 0, 3)];
}

/** Projected review dates if every future review is rated "Good". */
export function projectSchedule(state: ScheduleState, count: number): LocalDate[] {
  const dates: LocalDate[] = [];
  let current = state;
  for (let i = 0; i < count; i++) {
    dates.push(current.nextReviewOn);
    current = applyReview(current, 'good', current.nextReviewOn).state;
  }
  return dates;
}

export function displayStatus(stage: TopicStage, nextReviewOn: LocalDate, today: LocalDate): TopicDisplayStatus {
  const delta = diffDays(nextReviewOn, today);
  if (delta < 0) return 'overdue';
  if (delta === 0) return 'due';
  return stage;
}
