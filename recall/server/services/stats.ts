import type {
  CourseStat,
  Dashboard,
  DayCount,
  Insight,
  Progress,
  ReminderDigest,
  TopicSummary,
  Upcoming,
} from '../../shared/api.js';
import { addDays, diffDays, type LocalDate } from '../../shared/dates.js';
import type { User } from '../../shared/api.js';
import type { AppContext } from '../lib/context.js';
import { todayFor } from '../lib/time.js';
import { hasDemoCourses, listCourses, toCourseRef } from '../repositories/courses.js';
import * as reviews from '../repositories/reviews.js';
import { listTopics, listTopicsDueBetween, toTopicSummary } from '../repositories/topics.js';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Consecutive days with at least one review, ending today — or yesterday, since today isn't over yet. */
export function computeStreaks(days: LocalDate[], today: LocalDate): { current: number; longest: number } {
  const sorted = [...new Set(days)].sort().reverse();
  let longest = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && diffDays(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  let current = 0;
  if (sorted.length > 0 && diffDays(today, sorted[0]) <= 1) {
    current = 1;
    while (current < sorted.length && diffDays(sorted[current - 1], sorted[current]) === 1) current++;
  }
  return { current, longest };
}

function fillDays(from: LocalDate, count: number, counts: Map<string, number>): DayCount[] {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(from, i);
    return { date, count: counts.get(date) ?? 0 };
  });
}

function allTopics(ctx: AppContext, userId: number, today: LocalDate): TopicSummary[] {
  return listTopics(ctx.db, userId).map((r) => toTopicSummary(r, today));
}

function buildInsights(ctx: AppContext, userId: number, today: LocalDate, topics: TopicSummary[], streak: number): Insight[] {
  const insights: Insight[] = [];
  const overdue = topics.filter((t) => t.status === 'overdue');
  if (overdue.length > 0) {
    insights.push({
      id: 'overdue',
      tone: 'warning',
      text: `${plural(overdue.length, 'review is', 'reviews are')} overdue. Start with the oldest — a few late days won't erase your progress.`,
    });
  }

  const recent = reviews.recentReviews(ctx.db, userId, addDays(today, -7));
  const struggled = recent.find((r) => r.rating === 'forgot' || r.rating === 'hard');
  if (struggled) {
    const topic = topics.find((t) => t.id === struggled.topicId);
    // Only mention it if the struggle is still the latest result for that topic.
    if (topic && (topic.lastRating === 'forgot' || topic.lastRating === 'hard')) {
      insights.push({
        id: `struggled-${topic.id}`,
        tone: 'info',
        text: `You struggled with ${topic.title} during your last review. It's scheduled again ${
          topic.daysUntilDue <= 0 ? 'today' : topic.daysUntilDue === 1 ? 'tomorrow' : `in ${topic.daysUntilDue} days`
        }.`,
        topicId: topic.id,
      });
    }
  }

  if (streak >= 2) {
    insights.push({ id: 'streak', tone: 'positive', text: `You've kept a ${streak}-day review streak. Keep it going!` });
  }

  const tomorrow = addDays(today, 1);
  const byCourse = new Map<string, number>();
  for (const t of topics) if (t.nextReviewOn === tomorrow) byCourse.set(t.course.code, (byCourse.get(t.course.code) ?? 0) + 1);
  const busiest = [...byCourse.entries()].sort((a, b) => b[1] - a[1])[0];
  if (busiest) {
    insights.push({
      id: 'tomorrow',
      tone: 'info',
      text: `You have ${plural(busiest[1], `${busiest[0]} review`)} due tomorrow.`,
    });
  }

  const week = topics.filter((t) => t.daysUntilDue >= 1 && t.daysUntilDue <= 7).length;
  if (week > 0) {
    insights.push({ id: 'week', tone: 'info', text: `You have ${plural(week, 'review')} scheduled over the next 7 days.` });
  }

  const noQuestions = topics.filter((t) => t.questionCount === 0);
  if (noQuestions.length > 0) {
    insights.push({
      id: 'no-questions',
      tone: 'info',
      text: `${plural(noQuestions.length, 'topic has', 'topics have')} no questions yet. Add a few so Recall can test your memory.`,
      topicId: noQuestions.length === 1 ? noQuestions[0].id : undefined,
    });
  }
  return insights.slice(0, 4);
}

export function getDashboard(ctx: AppContext, user: User): Dashboard {
  const today = todayFor(ctx, user.timezone);
  const topics = allTopics(ctx, user.id, today);
  const due = topics.filter((t) => t.daysUntilDue <= 0);
  const { current: streak } = computeStreaks(reviews.listReviewDays(ctx.db, user.id), today);

  const groups = new Map<number, Dashboard['groups'][number]>();
  for (const t of due) {
    if (!groups.has(t.course.id)) groups.set(t.course.id, { course: t.course, topics: [] });
    groups.get(t.course.id)!.topics.push(t);
  }

  const upcomingCounts = new Map<string, number>();
  for (const t of topics) if (t.daysUntilDue >= 1) upcomingCounts.set(t.nextReviewOn, (upcomingCounts.get(t.nextReviewOn) ?? 0) + 1);

  return {
    today,
    dueTodayCount: due.filter((t) => t.status === 'due').length,
    overdueCount: due.filter((t) => t.status === 'overdue').length,
    courseCount: listCourses(ctx.db, user.id, today).length,
    topicCount: topics.length,
    reviewedTodayCount: reviews.countReviewsOn(ctx.db, user.id, today),
    streak,
    groups: [...groups.values()].sort((a, b) => a.course.code.localeCompare(b.course.code)),
    nextDays: fillDays(addDays(today, 1), 7, upcomingCounts),
    insights: buildInsights(ctx, user.id, today, topics, streak),
    hasDemoData: hasDemoCourses(ctx.db, user.id),
  };
}

export function getUpcoming(ctx: AppContext, user: User, days: number): Upcoming {
  const today = todayFor(ctx, user.timezone);
  const end = addDays(today, days - 1);
  const overdue = listTopics(ctx.db, user.id, { dueOnOrBefore: addDays(today, -1) }).map((r) => toTopicSummary(r, today));
  const scheduled = listTopicsDueBetween(ctx.db, user.id, today, end).map((r) => toTopicSummary(r, today));

  const byDay = new Map<string, TopicSummary[]>();
  for (const t of scheduled) {
    if (!byDay.has(t.nextReviewOn)) byDay.set(t.nextReviewOn, []);
    byDay.get(t.nextReviewOn)!.push(t);
  }
  const weeks = Array.from({ length: Math.ceil(days / 7) }, (_, i) => {
    const start = addDays(today, i * 7);
    return { start, count: scheduled.filter((t) => t.daysUntilDue >= i * 7 && t.daysUntilDue < (i + 1) * 7).length };
  });
  return {
    today,
    overdue,
    days: [...byDay.entries()].map(([date, topics]) => ({ date: date as LocalDate, topics })),
    weeks,
  };
}

export function getProgress(ctx: AppContext, user: User): Progress {
  const today = todayFor(ctx, user.timezone);
  const topics = allTopics(ctx, user.id, today);
  const counts = reviews.ratingCounts(ctx.db, user.id);
  const totalReviews = counts.forgot + counts.hard + counts.good + counts.easy;
  const { current, longest } = computeStreaks(reviews.listReviewDays(ctx.db, user.id), today);

  const activityStart = addDays(today, -27);
  const activity = fillDays(
    activityStart,
    28,
    new Map(reviews.countReviewsByDay(ctx.db, user.id, activityStart, today).map((r) => [r.day, r.count])),
  );

  const perCourse = new Map(reviews.courseReviewStats(ctx.db, user.id).map((s) => [s.courseId, s]));
  const courses: CourseStat[] = listCourses(ctx.db, user.id, today).map((c) => {
    const s = perCourse.get(c.id);
    return {
      course: toCourseRef(c),
      topicCount: c.topicCount,
      masteredCount: c.masteredCount,
      reviewCount: s?.total ?? 0,
      accuracy: s && s.total > 0 ? s.recalled / s.total : null,
    };
  });
  const strongestCourse =
    courses
      .filter((c) => c.reviewCount >= 3 && c.accuracy !== null)
      .sort((a, b) => b.accuracy! - a.accuracy! || b.masteredCount - a.masteredCount)[0] ?? null;

  const needsAttention = topics
    .map((t) => {
      let reason = '';
      let severity = 0;
      if (t.lastRating === 'forgot') [reason, severity] = ['Forgotten at last review', 3];
      else if (t.lapseCount >= 2) [reason, severity] = [`Forgotten ${t.lapseCount} times`, 2.5];
      else if (t.status === 'overdue') [reason, severity] = [`Overdue by ${plural(-t.daysUntilDue, 'day')}`, 2];
      else if (t.lastRating === 'hard') [reason, severity] = ['Hard at last review', 1];
      return { ...t, reason, severity };
    })
    .filter((t) => t.severity > 0)
    .sort((a, b) => b.severity - a.severity || a.daysUntilDue - b.daysUntilDue)
    .slice(0, 8)
    .map(({ severity: _s, ...t }) => t);

  const byStage = (stage: TopicSummary['stage']) => topics.filter((t) => t.stage === stage).length;
  return {
    today,
    totals: {
      topics: topics.length,
      new: byStage('new'),
      learning: byStage('learning'),
      reviewing: byStage('reviewing'),
      mastered: byStage('mastered'),
      dueToday: topics.filter((t) => t.status === 'due').length,
      overdue: topics.filter((t) => t.status === 'overdue').length,
      reviews: totalReviews,
    },
    streak: current,
    longestStreak: longest,
    accuracy: totalReviews > 0 ? (totalReviews - counts.forgot) / totalReviews : null,
    ratingCounts: counts,
    activity,
    courses,
    strongestCourse,
    needsAttention,
  };
}

export function getReminderDigest(ctx: AppContext, user: User): ReminderDigest {
  const today = todayFor(ctx, user.timezone);
  const dueCount = listTopics(ctx.db, user.id, { dueOnOrBefore: today }).length;
  return {
    enabled: user.reminderEnabled,
    reminderTime: user.reminderTime,
    timezone: user.timezone,
    dueCount,
    message:
      dueCount > 0
        ? `You have ${plural(dueCount, 'topic')} waiting for review today.`
        : "You're all caught up — nothing to review today.",
  };
}
