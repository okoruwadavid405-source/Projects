/**
 * Builds a student's Course Knowledge Profile: global evidence about the course
 * (shared + their private sources), aggregated for their term, joined with
 * their personal study record. Personal data is only *read* here — it never
 * changes the shared course knowledge.
 */
import { parseLocalDate, type LocalDate } from '../../shared/dates.js';
import {
  aggregateTopics,
  classifySource,
  EVIDENCE_STATUSES,
  isCurrentListing,
  sourceTier,
  STATUS_META,
  TIER_LABEL,
  termLabel,
  topicKey,
  type EvidenceStatus,
  type SourceFacts,
  type TermRef,
} from '../../shared/knowledge.js';
import { emptyExtraction, type CourseProfile, type DocumentInfo, type Extraction, type PersonalTopicMemory, type ProfileTopic, type SourceSummary, type StudentCourse } from '../../shared/knowledgeApi.js';
import { displayStatus } from '../../shared/scheduler.js';
import type { AppContext } from '../lib/context.js';
import { todayFor } from '../lib/time.js';
import { listTopics } from '../repositories/topics.js';
import { requireStudentCourse } from './courses.js';
import * as repo from './repository.js';

export const studentTermOf = (sc: StudentCourse): TermRef => ({ term: sc.version.term, year: sc.version.year });

export const sourceFacts = (s: repo.SourceRow): SourceFacts => ({
  origin: s.origin,
  documentType: s.document_type,
  term: s.term && s.year ? { term: s.term, year: s.year } : null,
  academicYear: s.academic_year,
});

export function summarizeSource(s: repo.SourceRow, studentTerm: TermRef): SourceSummary {
  const facts = sourceFacts(s);
  const tier = sourceTier(facts, studentTerm);
  return {
    id: s.id,
    title: s.title,
    url: s.url,
    origin: s.origin,
    documentType: s.document_type,
    termLabel: facts.term ? termLabel(facts.term) : null,
    academicYear: s.academic_year,
    instructor: s.instructor,
    tier,
    tierLabel: TIER_LABEL[tier],
    status: classifySource(facts, studentTerm),
    isPrivate: s.visibility === 'private',
    isDemo: s.is_demo === 1,
    topicCount: s.topic_count,
    documentId: s.document_id,
  };
}

/** The student's study record per knowledge key, from their Recall topics in this course. */
export function personalMemory(ctx: AppContext, userId: number, recallCourseId: number, today: LocalDate): Map<string, PersonalTopicMemory> {
  const map = new Map<string, PersonalTopicMemory>();
  for (const t of listTopics(ctx.db, userId, { courseId: recallCourseId })) {
    // Topics added from the profile carry their key; hand-made topics match by name.
    const key = t.knowledge_key ?? topicKey(t.title);
    const next = parseLocalDate(t.next_review_at);
    if (map.has(key)) continue;
    map.set(key, {
      recallTopicId: t.id,
      stage: t.status,
      status: displayStatus(t.status, next, today),
      reviewCount: t.review_count,
      lastRating: t.last_rating,
      nextReviewOn: next,
      learnedOn: parseLocalDate(t.learned_on),
      pinned: t.pinned === 1,
    });
  }
  return map;
}

export function documentInfo(row: DocumentRow, sc: StudentCourse): DocumentInfo {
  let extraction: Extraction | null = null;
  if (row.extraction) {
    try {
      extraction = { ...emptyExtraction(), ...(JSON.parse(row.extraction) as Partial<Extraction>) };
    } catch {
      extraction = null;
    }
  }
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    url: row.url,
    documentType: row.document_type as DocumentInfo['documentType'],
    status: row.status,
    error: row.error,
    extractor: row.extractor,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    sourceId: row.source_id,
    extraction,
    warnings: extraction ? extractionWarnings(extraction, sc) : [],
    origin: row.kind === 'upload' ? 'student' : 'web',
  };
}

export interface DocumentRow {
  id: number;
  user_id: number;
  student_course_id: number;
  source_id: number | null;
  kind: 'upload' | 'web';
  filename: string;
  url: string | null;
  mime_type: string | null;
  byte_size: number;
  document_type: string;
  status: 'processing' | 'needs_review' | 'confirmed' | 'failed';
  error: string | null;
  extractor: 'ai' | 'pattern' | null;
  text: string | null;
  extraction: string | null;
  created_at: string;
}

/** Plain-language checks shown on the review screen before anything is saved. */
export function extractionWarnings(x: Extraction, sc: StudentCourse): string[] {
  const warnings: string[] = [];
  const code = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (x.courseCode && code(x.courseCode) !== code(sc.course.code)) {
    warnings.push(`This document appears to be for ${x.courseCode}, not ${sc.course.code}. Check it's the right file.`);
  }
  if (x.term && x.year && (x.term !== sc.version.term || x.year !== sc.version.year)) {
    warnings.push(
      `This document is for ${termLabel({ term: x.term, year: x.year })}, not your term (${sc.version.label}). It will be saved as past-term material, so its topics will show as "Past versions" rather than confirmed.`,
    );
  }
  if (!x.term || !x.year) warnings.push(`No term was found in the document. Choose the term it describes before saving.`);
  if (x.topics.length === 0) warnings.push('No topics were found. You can add them below, or save the document for search only.');
  return warnings;
}

export function buildProfile(ctx: AppContext, userId: number, studentCourseId: number, timezone: string): CourseProfile {
  const sc = requireStudentCourse(ctx, userId, studentCourseId);
  const today = todayFor(ctx, timezone);
  const studentTerm = studentTermOf(sc);

  const sourceRows = repo.listVisibleSources(ctx.db, userId, sc.course.id);
  const byId = new Map(sourceRows.map((s) => [s.id, s]));
  const evidence = repo.listVisibleTopicEvidence(ctx.db, userId, sc.course.id).map((t) => {
    const s = byId.get(t.source_id)!;
    return {
      sourceId: t.source_id,
      topicName: t.name,
      subtopics: t.subtopics ? (JSON.parse(t.subtopics) as string[]) : [],
      description: t.description,
      week: t.week,
      scheduledOn: t.scheduled_on ? parseLocalDate(t.scheduled_on) : null,
      source: { ...sourceFacts(s), title: s.title },
    };
  });

  const memory = personalMemory(ctx, userId, sc.recallCourseId, today);
  const topics: ProfileTopic[] = aggregateTopics(evidence, studentTerm).map((t) => ({ ...t, personal: memory.get(t.key) ?? null }));

  const counts = Object.fromEntries(EVIDENCE_STATUSES.map((s) => [s, 0])) as Record<EvidenceStatus, number>;
  for (const t of topics) counts[t.status]++;

  const sources = sourceRows.map((s) => summarizeSource(s, studentTerm)).sort((a, b) => a.tier - b.tier || b.id - a.id);
  const hasCurrentListing = sourceRows.some((s) => isCurrentListing(sourceFacts(s), studentTerm));
  const instructorSource = sources.find((s) => s.instructor && s.tier <= 3);

  const assessments = repo.listVisibleAssessments(ctx.db, userId, sc.course.id).map((a) => {
    const s = byId.get(a.source_id)!;
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      dueOn: a.due_on ? parseLocalDate(a.due_on) : null,
      weight: a.weight,
      topics: JSON.parse(a.topics) as string[],
      sourceTitle: s.title,
      status: classifySource(sourceFacts(s), studentTerm),
    };
  });

  const documents = (
    ctx.db
      .prepare('SELECT * FROM documents WHERE student_course_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC')
      .all(sc.id, userId) as unknown as DocumentRow[]
  ).map((d) => documentInfo(d, sc));

  let notice: string | null = null;
  if (counts.confirmed === 0) {
    const label = `${sc.course.code} (${sc.version.label})`;
    notice =
      counts.historical > 0
        ? `We couldn't find a current course outline for ${label}. We found information from past terms, but we won't assume it describes your course. Upload your syllabus to confirm your topics.`
        : `We don't have reliable information about what ${label} covers yet. Upload your syllabus, or search for the official course page.`;
  }

  return {
    studentCourse: sc,
    today,
    instructor: instructorSource ? { name: instructorSource.instructor!, sourceTitle: instructorSource.title } : null,
    topics,
    counts,
    missing: topics.filter((t) => t.status === 'historical' || (t.status === 'unconfirmed' && t.conflict)),
    conflicts: topics.filter((t) => t.conflict).map((t) => ({ topic: t.name, message: t.conflict! })),
    sources,
    assessments,
    documents,
    hasCurrentListing,
    notice,
  };
}

export const statusLabel = (s: EvidenceStatus) => STATUS_META[s].label;
