/**
 * Course material used to ground generated questions for a study topic that is
 * linked to course knowledge: its status, description and subtopics, plus the
 * best-matching passages from the student's own uploads.
 */
import { STATUS_META, termLabel } from '../../shared/knowledge.js';
import type { AppContext } from '../lib/context.js';
import type { TopicRow } from '../repositories/topics.js';
import { buildProfile } from './profile.js';
import * as repo from './repository.js';

export interface GroundingMaterial {
  notes: string;
  sourceId: number | null;
}

export function groundingMaterialFor(ctx: AppContext, userId: number, topic: TopicRow): GroundingMaterial | null {
  if (!topic.knowledge_key) return null;
  const sc = repo.getStudentCourseByRecallCourse(ctx.db, userId, topic.course_id);
  if (!sc) return null;
  const tz = (ctx.db.prepare('SELECT timezone FROM users WHERE id = ?').get(userId) as { timezone: string } | undefined)?.timezone ?? 'UTC';
  const known = buildProfile(ctx, userId, sc.id, tz).topics.find((t) => t.key === topic.knowledge_key);
  if (!known) return null;

  const lines = [
    `Course: ${sc.course.code} — ${sc.course.title}, ${sc.course.university.name} (${termLabel(sc.version)}).`,
    `Topic status: ${STATUS_META[known.status].label} — ${known.evidence.map((e) => e.sourceTitle).join('; ')}.`,
  ];
  if (known.status !== 'confirmed' && known.status !== 'your_materials') {
    lines.push('This topic is not confirmed for the student’s term; the student chose to study it as general practice.');
  }
  if (known.description) lines.push(`Description: ${known.description}`);
  if (known.subtopics.length > 0) lines.push(`Subtopics listed in the course material: ${known.subtopics.join(', ')}.`);
  lines.push('Cover the listed subtopics where possible, and stay within the scope the material describes.');

  const hits = repo.searchChunks(ctx.db, userId, sc.id, [known.name, ...known.subtopics].join(' '), 3);
  for (const h of hits) lines.push(`Excerpt from the student's document "${h.filename}":\n${h.content.slice(0, 1500)}`);
  return { notes: lines.join('\n'), sourceId: known.evidence[0]?.sourceId ?? null };
}
