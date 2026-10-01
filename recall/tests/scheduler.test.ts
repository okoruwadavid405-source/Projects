import { describe, expect, it } from 'vitest';
import { addDays, parseLocalDate, type LocalDate } from '../shared/dates.js';
import {
  aggregateRating,
  applyReview,
  displayStatus,
  initialEase,
  initialSchedule,
  projectSchedule,
  stageFor,
  type Rating,
  type ScheduleState,
} from '../shared/scheduler.js';

const d = (s: string) => parseLocalDate(s);
const SEPT_30 = d('2026-09-30');

function reviewOnDue(state: ScheduleState, ratings: Rating[]): ScheduleState {
  for (const r of ratings) state = applyReview(state, r, state.nextReviewOn).state;
  return state;
}

describe('new topic', () => {
  it('schedules the first review the day after it was learned', () => {
    const s = initialSchedule(SEPT_30, 4, SEPT_30);
    expect(s.nextReviewOn).toBe('2026-10-01');
    expect(s.interval).toBe(1);
    expect(s.ease).toBe(2);
    expect(s.reviewCount).toBe(0);
  });

  it('never makes a brand-new topic overdue when learned long ago', () => {
    const s = initialSchedule(d('2026-08-01'), 3, SEPT_30);
    expect(s.nextReviewOn).toBe('2026-09-30');
    expect(displayStatus('new', s.nextReviewOn, SEPT_30)).toBe('due');
  });

  it('maps understanding 1–5 to increasing initial ease', () => {
    const eases = [1, 2, 3, 4, 5].map(initialEase);
    expect(eases).toEqual([...eases].sort((a, b) => a - b));
    expect(new Set(eases).size).toBe(5);
  });

  it('projects roughly day 1, 3, 7, 15, 31 when always rated Good', () => {
    const dates = projectSchedule(initialSchedule(SEPT_30, 4, SEPT_30), 5);
    expect(dates).toEqual(['2026-10-01', '2026-10-03', '2026-10-07', '2026-10-15', '2026-10-31']);
  });
});

describe('ratings', () => {
  const base = reviewOnDue(initialSchedule(SEPT_30, 4, SEPT_30), ['good', 'good', 'good']); // interval 8

  it('orders intervals forgot < hard < good < easy', () => {
    const today = base.nextReviewOn;
    const out = (['forgot', 'hard', 'good', 'easy'] as Rating[]).map((r) => applyReview(base, r, today).newInterval);
    expect(out[0]).toBe(1);
    expect(out[1]).toBeGreaterThan(base.interval);
    expect(out[2]).toBeGreaterThan(out[1]);
    expect(out[3]).toBeGreaterThan(out[2]);
  });

  it('Easy grows the interval significantly and raises ease', () => {
    const r = applyReview(base, 'easy', base.nextReviewOn);
    expect(r.newInterval).toBe(Math.round(8 * 2 * 1.3));
    expect(r.newEase).toBeCloseTo(2.15);
  });

  it('Hard grows the interval slightly and lowers ease', () => {
    const r = applyReview(base, 'hard', base.nextReviewOn);
    expect(r.newInterval).toBe(Math.round(8 * 1.2));
    expect(r.newEase).toBeCloseTo(1.85);
  });

  it('Forgot resets to a 1-day interval, counts a lapse, and lowers ease', () => {
    const r = applyReview(base, 'forgot', base.nextReviewOn);
    expect(r.newInterval).toBe(1);
    expect(r.state.lapseCount).toBe(1);
    expect(r.newEase).toBeCloseTo(1.8);
    expect(r.stage).toBe('learning');
    expect(r.state.nextReviewOn).toBe(addDays(base.nextReviewOn, 1));
  });

  it('rebuilds quickly after a lapse', () => {
    const lapsed = applyReview(base, 'forgot', base.nextReviewOn).state;
    const after = reviewOnDue(lapsed, ['good', 'good', 'good']);
    expect(after.interval).toBeGreaterThan(lapsed.interval);
    expect(after.ease).toBeCloseTo(1.8);
  });

  it('never lets ease drop below 1.3 or rise above 3.0', () => {
    expect(reviewOnDue(base, Array(15).fill('forgot')).ease).toBe(1.3);
    expect(reviewOnDue(base, Array(15).fill('easy')).ease).toBe(3);
  });

  it('caps intervals at one year', () => {
    expect(reviewOnDue(base, Array(12).fill('easy')).interval).toBe(365);
  });
});

describe('multiple reviews and stages', () => {
  it('moves new → learning → reviewing → mastered under repeated Good', () => {
    let s = initialSchedule(SEPT_30, 4, SEPT_30);
    const stages: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = applyReview(s, 'good', s.nextReviewOn);
      stages.push(r.stage);
      s = r.state;
    }
    expect(stages).toEqual(['learning', 'learning', 'reviewing', 'reviewing', 'mastered', 'mastered']);
    expect(s.reviewCount).toBe(6);
    expect(stageFor(1, 0, null)).toBe('new');
  });
});

describe('overdue reviews', () => {
  const base = reviewOnDue(initialSchedule(SEPT_30, 4, SEPT_30), ['good', 'good', 'good']); // interval 8

  it('credits half of the overdue time on Good', () => {
    const late = addDays(base.nextReviewOn, 4);
    const r = applyReview(base, 'good', late);
    expect(r.daysOverdue).toBe(4);
    expect(r.newInterval).toBe((8 + 2) * 2);
    expect(r.state.nextReviewOn).toBe(addDays(late, 20));
  });

  it('halves the ease penalty when a late review is forgotten', () => {
    const r = applyReview(base, 'forgot', addDays(base.nextReviewOn, 10));
    expect(r.newEase).toBeCloseTo(1.9);
    expect(r.newInterval).toBe(1);
  });

  it('is not punished more than an on-time review for Hard', () => {
    const onTime = applyReview(base, 'hard', base.nextReviewOn).newInterval;
    const late = applyReview(base, 'hard', addDays(base.nextReviewOn, 8)).newInterval;
    expect(late).toBeGreaterThanOrEqual(onTime);
  });
});

describe('early, same-day and future reviews', () => {
  it('handles a same-day review of a topic learned today', () => {
    const s = initialSchedule(SEPT_30, 4, SEPT_30);
    const r = applyReview(s, 'good', SEPT_30);
    expect(r.early).toBe(true);
    expect(r.newInterval).toBe(1);
    expect(r.state.nextReviewOn).toBe('2026-10-01');
  });

  it('never pulls the due date earlier on an early Good review', () => {
    const base = reviewOnDue(initialSchedule(SEPT_30, 4, SEPT_30), ['good', 'good', 'good', 'good']); // interval 16
    const reviewDay = addDays(base.lastReviewedOn!, 3);
    const r = applyReview(base, 'good', reviewDay);
    expect(r.early).toBe(true);
    expect(r.state.nextReviewOn >= base.nextReviewOn).toBe(true);
  });

  it('lets an early Hard review pull the due date earlier', () => {
    const base = reviewOnDue(initialSchedule(SEPT_30, 4, SEPT_30), ['good', 'good', 'good', 'good']);
    const r = applyReview(base, 'hard', addDays(base.lastReviewedOn!, 3));
    expect(r.state.nextReviewOn < base.nextReviewOn).toBe(true);
  });
});

describe('aggregateRating', () => {
  it('rounds the mean score half-down', () => {
    expect(aggregateRating(['good'])).toBe('good');
    expect(aggregateRating(['easy', 'good'])).toBe('good');
    expect(aggregateRating(['good', 'forgot'])).toBe('hard');
    expect(aggregateRating(['forgot', 'hard'])).toBe('forgot');
    expect(aggregateRating(['easy', 'easy', 'good'])).toBe('easy');
    expect(() => aggregateRating([])).toThrow();
  });
});

describe('date boundaries', () => {
  it('crosses month and year boundaries correctly', () => {
    const s = initialSchedule(d('2026-12-31'), 4, d('2026-12-31'));
    expect(s.nextReviewOn).toBe('2027-01-01');
    const r = applyReview(s, 'good', s.nextReviewOn);
    expect(r.state.nextReviewOn).toBe('2027-01-03');
    const leap: LocalDate = d('2028-02-28');
    expect(addDays(leap, 1)).toBe('2028-02-29');
    expect(addDays(leap, 2)).toBe('2028-03-01');
  });
});
