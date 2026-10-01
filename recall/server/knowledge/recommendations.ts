/**
 * "What should I study?" — a ranked list built only from real signals:
 * the review schedule, the student's recent performance, their priorities,
 * upcoming assessments and topics confirmed in their current course material.
 * Past-version, public and AI-suggested topics are never recommended.
 */
import { diffDays, type LocalDate } from '../../shared/dates.js';
import { topicKey } from '../../shared/knowledge.js';
import type { AssessmentInfo, Recommendation, StudentCourse } from '../../shared/knowledgeApi.js';
import type { User } from '../../shared/api.js';
import type { AppContext } from '../lib/context.js';
import { todayFor } from '../lib/time.js';
import { listTopics, toTopicSummary } from '../repositories/topics.js';
import { buildProfile } from './profile.js';
import * as repo from './repository.js';

const ASSESSMENT_WINDOW_DAYS = 21;

const shortDate = (d: LocalDate) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${d}T00:00:00Z`));
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

function upcomingAssessments(assessments: AssessmentInfo[], today: LocalDate) {
  return assessments.filter(
    (a) =>
      a.dueOn &&
      (a.status === 'confirmed' || a.status === 'your_materials') &&
      diffDays(a.dueOn, today) >= 0 &&
      diffDays(a.dueOn, today) <= ASSESSMENT_WINDOW_DAYS,
  );
}

function assessmentBoost(key: string, assessments: AssessmentInfo[], today: LocalDate): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  for (const a of assessments) {
    if (!a.topics.some((t) => topicKey(t) === key)) continue;
    const inDays = diffDays(a.dueOn!, today);
    score += Math.max(10, 60 - inDays * 2);
    reasons.push(`${a.name} on ${shortDate(a.dueOn!)} covers this (${inDays === 0 ? 'today' : `in ${days(inDays)}`})`);
  }
  return { score, reasons };
}

export function recommend(ctx: AppContext, user: User, options: { studentCourseId?: number; limit?: number } = {}): Recommendation[] {
  const today = todayFor(ctx, user.timezone);
  const links = repo.listStudentCourses(ctx.db, user.id);
  const linkByCourse = new Map<number, StudentCourse>(links.map((l) => [l.recallCourseId, l]));
  const onlyCourse = options.studentCourseId !== undefined ? links.find((l) => l.id === options.studentCourseId)?.recallCourseId : undefined;
  if (options.studentCourseId !== undefined && onlyCourse === undefined) return [];

  const profiles = new Map(
    links
      .filter((l) => onlyCourse === undefined || l.recallCourseId === onlyCourse)
      .map((l) => [l.recallCourseId, buildProfile(ctx, user.id, l.id, user.timezone)]),
  );
  const out: Recommendation[] = [];

  // 1. Topics already in the student's reviews.
  for (const row of listTopics(ctx.db, user.id, onlyCourse !== undefined ? { courseId: onlyCourse } : {})) {
    const t = toTopicSummary(row, today);
    const key = t.knowledgeKey ?? topicKey(t.title);
    const profile = profiles.get(t.courseId);
    const reasons: string[] = [];
    let score = 0;
    if (t.daysUntilDue < 0) {
      score += 100 + Math.min(30, -t.daysUntilDue * 3);
      reasons.push(`Overdue by ${days(-t.daysUntilDue)}`);
    } else if (t.daysUntilDue === 0) {
      score += 90;
      reasons.push('Due for review today');
    }
    if (t.lastRating === 'forgot') {
      score += 40;
      reasons.push("You couldn't remember it at your last review");
    } else if (t.lastRating === 'hard') {
      score += 25;
      reasons.push('You found it hard at your last review');
    }
    if (t.pinned) {
      score += 30;
      reasons.push('You marked this as a priority');
    }
    if (profile) {
      const boost = assessmentBoost(key, upcomingAssessments(profile.assessments, today), today);
      score += boost.score;
      reasons.push(...boost.reasons);
    }
    if (score === 0) continue;
    const link = linkByCourse.get(t.courseId);
    out.push({
      kind: t.daysUntilDue <= 0 ? 'review' : t.pinned ? 'pinned' : t.lastRating === 'forgot' || t.lastRating === 'hard' ? 'struggled' : 'assessment',
      topicName: t.title,
      topicKey: key,
      recallTopicId: t.id,
      studentCourseId: link?.id ?? null,
      course: { id: t.course.id, code: t.course.code, color: t.course.color },
      reasons,
      score,
    });
  }

  // 2. Confirmed course topics the student hasn't started yet.
  for (const [recallCourseId, profile] of profiles) {
    const course = ctx.db.prepare('SELECT id, code, color FROM courses WHERE id = ?').get(recallCourseId) as Recommendation['course'];
    const assessments = upcomingAssessments(profile.assessments, today);
    const notStarted = profile.topics.filter((t) => (t.status === 'confirmed' || t.status === 'your_materials') && !t.personal);
    let undatedShown = 0;
    for (const t of [...notStarted].sort((a, b) => (a.week ?? 99) - (b.week ?? 99))) {
      const reasons: string[] = [];
      let score = 0;
      const source = t.evidence[0]?.sourceTitle ?? 'your course material';
      if (t.scheduledOn && diffDays(t.scheduledOn, today) <= 0) {
        score += 50;
        reasons.push(`Covered on ${shortDate(t.scheduledOn)} according to ${source} — not in your reviews yet`);
      }
      const boost = assessmentBoost(t.key, assessments, today);
      if (boost.score > 0) {
        score += boost.score;
        reasons.push(...boost.reasons);
        if (!reasons.some((r) => r.includes('not in your reviews'))) reasons.push('Not in your reviews yet');
      }
      if (score === 0 && !t.scheduledOn && undatedShown < 2) {
        undatedShown++;
        score = 12;
        reasons.push(`Appears in ${source}${t.week ? ` (week ${t.week})` : ''} — not in your reviews yet`);
      }
      if (score === 0) continue;
      out.push({
        kind: boost.score > 0 ? 'assessment' : 'syllabus',
        topicName: t.name,
        topicKey: t.key,
        recallTopicId: null,
        studentCourseId: profile.studentCourse.id,
        course,
        reasons,
        score,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score || a.topicName.localeCompare(b.topicName)).slice(0, options.limit ?? 8);
}

