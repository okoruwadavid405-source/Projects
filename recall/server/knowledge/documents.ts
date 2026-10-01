/**
 * Student documents: upload → text extraction → structured extraction (AI, or
 * pattern matching as a fallback) → the student reviews it → confirmed data
 * becomes a private source with topics and assessments.
 *
 * Nothing extracted is used until the student confirms it.
 */
import type { z } from 'zod';
import { isLocalDate, type LocalDate } from '../../shared/dates.js';
import { classifyUrl, termLabel, topicKey, type DocumentType } from '../../shared/knowledge.js';
import type { confirmExtractionSchema, DocumentInfo, Extraction } from '../../shared/knowledgeApi.js';
import { transaction } from '../db/connection.js';
import type { AppContext } from '../lib/context.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { useQuota } from '../lib/quota.js';
import { nowIso } from '../lib/time.js';
import { requireStudentCourse } from './courses.js';
import { extractWithPatterns } from './patternExtractor.js';
import { chunkText, parseDocument, UnsupportedDocumentError } from './parsers.js';
import { documentInfo, studentTermOf, type DocumentRow } from './profile.js';
import { ProviderError, type DocumentInput } from './providers.js';
import * as repo from './repository.js';

const ANALYSES_PER_HOUR = 20;

const jobs = new WeakMap<AppContext, Map<number, Promise<void>>>();
const jobMap = (ctx: AppContext) => {
  let m = jobs.get(ctx);
  if (!m) jobs.set(ctx, (m = new Map()));
  return m;
};
/** Resolves when background analysis of a document has finished (tests, shutdown). */
export const documentJob = (ctx: AppContext, id: number) => jobMap(ctx).get(id) ?? Promise.resolve();

function getRow(ctx: AppContext, userId: number, id: number): DocumentRow {
  const row = ctx.db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(id, userId) as DocumentRow | undefined;
  if (!row) throw notFound('That document');
  return row;
}

export function getDocument(ctx: AppContext, userId: number, id: number): DocumentInfo {
  const row = getRow(ctx, userId, id);
  return documentInfo(row, requireStudentCourse(ctx, userId, row.student_course_id));
}

/** Clean up whatever an extractor returned: trim, drop empties, validate dates and years, merge duplicate topics. */
export function sanitizeExtraction(x: Extraction): Extraction {
  const str = (s: string | null, max = 300) => (s && s.trim() ? s.trim().slice(0, max) : null);
  const date = (s: string | null) => (s && isLocalDate(s) ? s : null);
  const list = (items: string[], max = 50) => [...new Set(items.map((i) => i.trim()).filter(Boolean))].slice(0, max).map((i) => i.slice(0, 300));
  const topics = new Map<string, Extraction['topics'][number]>();
  for (const t of x.topics) {
    const name = str(t.name, 200);
    if (!name) continue;
    const key = topicKey(name);
    const existing = topics.get(key);
    if (existing) {
      existing.subtopics = list([...existing.subtopics, ...t.subtopics]);
      continue;
    }
    topics.set(key, {
      name,
      description: str(t.description, 2000),
      week: t.week !== null && t.week >= 0 && t.week <= 60 ? t.week : null,
      date: date(t.date),
      subtopics: list(t.subtopics),
    });
  }
  return {
    courseCode: str(x.courseCode, 20),
    courseTitle: str(x.courseTitle, 200),
    term: x.term,
    year: x.year !== null && x.year >= 1990 && x.year <= 2100 ? x.year : null,
    instructor: str(x.instructor, 160),
    description: str(x.description, 2000),
    learningObjectives: list(x.learningObjectives),
    topics: [...topics.values()].slice(0, 200),
    assessments: x.assessments
      .filter((a) => str(a.name))
      .slice(0, 50)
      .map((a) => ({ name: str(a.name, 200)!, kind: str(a.kind, 60), date: date(a.date), weight: a.weight !== null && a.weight >= 0 && a.weight <= 100 ? a.weight : null, topics: list(a.topics) })),
    readings: list(x.readings, 30),
    terminology: list(x.terminology, 100),
  };
}

function knownTopicNames(ctx: AppContext, userId: number, catalogCourseId: number): string[] {
  return [...new Set(repo.listVisibleTopicEvidence(ctx.db, userId, catalogCourseId).map((t) => t.name))].slice(0, 100);
}

function setExtraction(ctx: AppContext, id: number, x: Extraction, extractor: 'ai' | 'pattern', note: string | null) {
  ctx.db
    .prepare(`UPDATE documents SET status = 'needs_review', extraction = ?, extractor = ?, error = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(sanitizeExtraction(x)), extractor, note, nowIso(ctx), id);
}

function fail(ctx: AppContext, id: number, message: string) {
  ctx.db.prepare(`UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(message, nowIso(ctx), id);
}

/** Run AI extraction in the background, falling back to pattern matching when there is text to match. */
function analyse(ctx: AppContext, userId: number, docId: number, input: DocumentInput, plainText: string | null) {
  const row = getRow(ctx, userId, docId);
  const sc = requireStudentCourse(ctx, userId, row.student_course_id);
  const hints = {
    university: sc.course.university.name,
    courseCode: sc.course.code,
    courseTitle: sc.course.title,
    studentTerm: studentTermOf(sc),
    documentType: row.document_type as DocumentType,
    knownTopicNames: knownTopicNames(ctx, userId, sc.course.id),
  };
  const ai = ctx.knowledge.ai;
  const patterns = () => (plainText ? extractWithPatterns(plainText, hints) : null);

  if (!ai) {
    const x = patterns();
    if (x) setExtraction(ctx, docId, x, 'pattern', null);
    else fail(ctx, docId, 'This file needs the AI document reader, which isn’t set up on this server.');
    return;
  }
  const job = ai
    .extractCourseInfo(input, hints)
    .then((x) => setExtraction(ctx, docId, x, 'ai', null))
    .catch((err) => {
      const reason = err instanceof ProviderError ? err.message : 'AI analysis failed.';
      if (!(err instanceof ProviderError)) console.error(`[recall] Document ${docId} analysis failed:`, err);
      const x = patterns();
      if (x) setExtraction(ctx, docId, x, 'pattern', `${reason} Showing what pattern matching found instead — please check it carefully.`);
      else fail(ctx, docId, reason);
    })
    .finally(() => jobMap(ctx).delete(docId));
  ctx.db.prepare(`UPDATE documents SET status = 'processing', updated_at = ? WHERE id = ?`).run(nowIso(ctx), docId);
  jobMap(ctx).set(docId, job);
}

export async function uploadDocument(
  ctx: AppContext,
  userId: number,
  studentCourseId: number,
  file: { filename: string; data: Buffer; documentType: DocumentType },
): Promise<DocumentInfo> {
  const sc = requireStudentCourse(ctx, userId, studentCourseId);
  let parsed;
  try {
    parsed = await parseDocument(file.data, file.filename);
  } catch (err) {
    if (err instanceof UnsupportedDocumentError) throw new AppError(422, 'unsupported_document', err.message);
    throw err;
  }
  if (parsed.kind === 'needs_ai' && !ctx.knowledge.ai) {
    throw new AppError(
      422,
      'needs_ai',
      `${parsed.reason} Reading it needs the AI document reader, which isn't set up on this server. Upload a text-based PDF, a Word document or a text file instead.`,
    );
  }
  if (ctx.knowledge.ai) useQuota(ctx, `analyse:${userId}`, ANALYSES_PER_HOUR, "You've analysed a lot of documents this hour. Please try again later.");

  const now = nowIso(ctx);
  const text = parsed.kind === 'text' ? parsed.text : null;
  const id = transaction(ctx.db, () => {
    const docId = Number(
      ctx.db
        .prepare(
          `INSERT INTO documents (user_id, student_course_id, kind, filename, mime_type, byte_size, document_type, status, text, created_at, updated_at)
           VALUES (?, ?, 'upload', ?, ?, ?, ?, 'processing', ?, ?, ?)`,
        )
        .run(userId, sc.id, file.filename.slice(0, 200), parsed.mimeType, file.data.length, file.documentType, text, now, now).lastInsertRowid,
    );
    // The student's own text is indexed for retrieval straight away (private to them).
    if (text) repo.indexChunks(ctx.db, docId, userId, chunkText(text));
    return docId;
  });

  const input: DocumentInput =
    parsed.kind === 'text'
      ? { kind: 'text', filename: file.filename, text: parsed.text }
      : { kind: 'file', filename: file.filename, mediaType: parsed.mimeType, data: file.data };
  analyse(ctx, userId, id, input, text);
  return getDocument(ctx, userId, id);
}

/** Read a public page (through the web provider) and extract it like an upload. The page text itself is not stored. */
export async function importFromUrl(ctx: AppContext, userId: number, studentCourseId: number, url: string): Promise<DocumentInfo> {
  const sc = requireStudentCourse(ctx, userId, studentCourseId);
  if (!ctx.knowledge.web || !ctx.knowledge.ai) {
    throw new AppError(503, 'unavailable', "Reading web pages isn't set up on this server. Download the document and upload it instead.");
  }
  useQuota(ctx, `analyse:${userId}`, ANALYSES_PER_HOUR, "You've analysed a lot of documents this hour. Please try again later.");
  let page;
  try {
    page = await ctx.knowledge.web.fetchPage(url);
  } catch (err) {
    if (err instanceof ProviderError) throw new AppError(err.retryable ? 503 : 422, 'fetch_failed', err.message);
    throw err;
  }
  const now = nowIso(ctx);
  const title = (page.title || url).slice(0, 200);
  const id = Number(
    ctx.db
      .prepare(
        `INSERT INTO documents (user_id, student_course_id, kind, filename, url, mime_type, byte_size, document_type, status, created_at, updated_at)
         VALUES (?, ?, 'web', ?, ?, ?, 0, 'web_page', 'processing', ?, ?)`,
      )
      .run(userId, sc.id, title, page.url, page.pdf ? 'application/pdf' : 'text/html', now, now).lastInsertRowid,
  );
  const input: DocumentInput = page.pdf
    ? { kind: 'file', filename: title, mediaType: 'application/pdf', data: page.pdf }
    : { kind: 'text', filename: title, text: page.text ?? '' };
  analyse(ctx, userId, id, input, page.text);
  return getDocument(ctx, userId, id);
}

/** Save what the student approved as a private source. The term they choose decides how it is labelled. */
export function confirmDocument(ctx: AppContext, userId: number, id: number, input: z.output<typeof confirmExtractionSchema>): DocumentInfo {
  const row = getRow(ctx, userId, id);
  if (row.status !== 'needs_review') throw badRequest(row.status === 'confirmed' ? 'This document is already saved.' : 'This document isn’t ready to confirm.');
  const sc = requireStudentCourse(ctx, userId, row.student_course_id);
  const now = nowIso(ctx);

  transaction(ctx.db, () => {
    const versionId = input.term && input.year ? repo.findOrCreateVersion(ctx.db, sc.course.id, { term: input.term, year: input.year }, now) : null;
    let origin: 'student' | 'official' | 'public' | 'web' = 'student';
    let documentType = row.document_type as DocumentType;
    if (row.kind === 'web' && row.url) {
      const uni = repo.getUniversityRow(ctx.db, sc.course.university.id);
      const c = classifyUrl(row.url, uni?.domain ?? null);
      origin = c.origin === 'official' ? 'official' : c.origin === 'public' ? 'public' : 'web';
      // An official page that the student confirmed as the course outline is treated as one.
      documentType = origin === 'official' && input.topics.length > 0 ? 'course_outline' : c.documentType;
    }
    const termText = input.term && input.year ? ` (${termLabel({ term: input.term, year: input.year })})` : '';
    const sourceId = repo.insertSource(
      ctx.db,
      {
        courseId: sc.course.id,
        versionId,
        origin,
        documentType,
        title: `${row.filename}${termText}`,
        url: row.url,
        instructor: input.instructor,
        visibility: 'private',
        ownerUserId: userId,
        retrievedAt: row.kind === 'web' ? row.created_at : null,
      },
      now,
    );
    repo.insertTopics(
      ctx.db,
      sourceId,
      input.topics.map((t) => ({
        name: t.name,
        topicKey: topicKey(t.name),
        description: t.description,
        week: t.week,
        scheduledOn: t.date as LocalDate | null,
        subtopics: t.subtopics,
      })),
      topicKey,
    );
    repo.insertAssessments(ctx.db, sourceId, input.assessments.map((a) => ({ ...a, date: a.date as LocalDate | null })));
    ctx.db.prepare(`UPDATE documents SET status = 'confirmed', source_id = ?, updated_at = ? WHERE id = ?`).run(sourceId, now, id);
  });
  return getDocument(ctx, userId, id);
}

/** Delete an upload, its text index and anything confirmed from it. */
export function deleteDocument(ctx: AppContext, userId: number, id: number) {
  const row = getRow(ctx, userId, id);
  transaction(ctx.db, () => {
    ctx.db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(id, userId);
    if (row.source_id) ctx.db.prepare(`DELETE FROM sources WHERE id = ? AND owner_user_id = ?`).run(row.source_id, userId);
  });
}

