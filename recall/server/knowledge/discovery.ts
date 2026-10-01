/**
 * Public resource discovery, saved links and AI topic suggestions.
 *
 * Search results are ranked by rule (the school's own domain first, known open
 * educational resources next, general web last). Only metadata and the link are
 * stored — never a copy of the page.
 */
import { classifyUrl, sourceTier, STATUS_META, TIER_LABEL, termLabel, topicKey } from '../../shared/knowledge.js';
import type { Discovery, SourceSummary } from '../../shared/knowledgeApi.js';
import type { User } from '../../shared/api.js';
import { transaction } from '../db/connection.js';
import type { AppContext } from '../lib/context.js';
import { AppError } from '../lib/errors.js';
import { useQuota } from '../lib/quota.js';
import { nowIso } from '../lib/time.js';
import { requireStudentCourse } from './courses.js';
import { buildProfile, studentTermOf, summarizeSource } from './profile.js';
import { ProviderError } from './providers.js';
import * as repo from './repository.js';

const SEARCHES_PER_HOUR = 30;
const SUGGESTIONS_PER_HOUR = 10;

function providerFailure(err: unknown): never {
  if (err instanceof ProviderError) throw new AppError(err.retryable ? 503 : 422, 'provider_failed', err.message);
  throw err;
}

export async function discoverResources(ctx: AppContext, userId: number, studentCourseId: number, topic?: string): Promise<Discovery> {
  const sc = requireStudentCourse(ctx, userId, studentCourseId);
  const web = ctx.knowledge.web;
  if (!web) throw new AppError(503, 'unavailable', "Web search isn't set up on this server. You can still add links and upload documents yourself.");
  useQuota(ctx, `search:${userId}`, SEARCHES_PER_HOUR, "You've searched a lot this hour. Please try again a little later.");

  const query = [`"${sc.course.university.name}"`, sc.course.code, topic?.trim() ? topic.trim() : `${sc.course.title} course outline`].join(' ');
  let raw;
  try {
    raw = await web.search(query);
  } catch (err) {
    providerFailure(err);
  }
  const domain = repo.getUniversityRow(ctx.db, sc.course.university.id)?.domain ?? null;
  const term = studentTermOf(sc);
  const results = raw
    .map((r) => {
      const c = classifyUrl(r.url, domain);
      // A search result's term is unknown, so official pages rank as "official, term unknown" (tier 4) until confirmed.
      const tier = sourceTier({ origin: c.origin, documentType: c.documentType, term: null, academicYear: null }, term);
      return { title: r.title, url: r.url, pageAge: r.pageAge, origin: c.origin, tier, tierLabel: c.origin === 'official' ? 'Official university site' : TIER_LABEL[tier] };
    })
    .sort((a, b) => a.tier - b.tier)
    .slice(0, 12);
  return { query, results };
}

/** Save a link as a private resource (metadata only). */
export function saveResource(ctx: AppContext, userId: number, studentCourseId: number, input: { url: string; title: string }): SourceSummary {
  const sc = requireStudentCourse(ctx, userId, studentCourseId);
  const domain = repo.getUniversityRow(ctx.db, sc.course.university.id)?.domain ?? null;
  const c = classifyUrl(input.url, domain);
  const id = repo.insertSource(
    ctx.db,
    {
      courseId: sc.course.id,
      versionId: null,
      origin: c.origin,
      documentType: c.documentType,
      title: input.title,
      url: input.url,
      visibility: 'private',
      ownerUserId: userId,
      retrievedAt: nowIso(ctx),
    },
    nowIso(ctx),
  );
  const row = repo.listVisibleSources(ctx.db, userId, sc.course.id).find((s) => s.id === id)!;
  return summarizeSource(row, studentTermOf(sc));
}

export function deleteSavedSource(ctx: AppContext, userId: number, sourceId: number) {
  const row = ctx.db.prepare(`SELECT id FROM sources WHERE id = ? AND owner_user_id = ? AND visibility = 'private'`).get(sourceId, userId);
  if (!row) throw new AppError(404, 'not_found', 'That resource could not be found.');
  ctx.db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
}

/** Ask the AI for related concepts. Stored as a private "AI suggestions" source — never as course content. */
export async function suggestTopics(ctx: AppContext, user: User, studentCourseId: number) {
  const ai = ctx.knowledge.ai;
  if (!ai) throw new AppError(503, 'unavailable', "AI suggestions aren't set up on this server.");
  const profile = buildProfile(ctx, user.id, studentCourseId, user.timezone);
  const sc = profile.studentCourse;
  useQuota(ctx, `suggest:${user.id}`, SUGGESTIONS_PER_HOUR, "You've asked for a lot of suggestions this hour. Please try again later.");
  let suggestions;
  try {
    suggestions = await ai.suggestTopics({
      university: sc.course.university.name,
      courseCode: sc.course.code,
      courseTitle: sc.course.title,
      termLabel: termLabel(sc.version),
      knownTopics: profile.topics.filter((t) => t.status !== 'suggested').map((t) => ({ name: t.name, statusLabel: STATUS_META[t.status].label })),
    });
  } catch (err) {
    providerFailure(err);
  }
  const known = new Set(profile.topics.filter((t) => t.status !== 'suggested').map((t) => t.key));
  const fresh = suggestions.filter((s) => s.name.trim() && !known.has(topicKey(s.name))).slice(0, 6);
  const now = nowIso(ctx);
  transaction(ctx.db, () => {
    ctx.db.prepare(`DELETE FROM sources WHERE owner_user_id = ? AND course_id = ? AND origin = 'ai'`).run(user.id, sc.course.id);
    if (fresh.length === 0) return;
    const sourceId = repo.insertSource(
      ctx.db,
      { courseId: sc.course.id, versionId: null, origin: 'ai', documentType: 'ai_suggestion', title: 'AI suggestions', visibility: 'private', ownerUserId: user.id },
      now,
    );
    repo.insertTopics(
      ctx.db,
      sourceId,
      fresh.map((s) => ({ name: s.name.trim().slice(0, 200), topicKey: topicKey(s.name), description: s.reason.slice(0, 500) })),
      topicKey,
    );
  });
  return { added: fresh.length };
}
