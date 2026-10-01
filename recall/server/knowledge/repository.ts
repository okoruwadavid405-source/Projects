/**
 * CourseRepository: SQL for the course catalog, evidence and the student's
 * course links. Visibility rule used everywhere: a source is readable when it is
 * public or owned by the requesting user.
 */
import type { LocalDate } from '../../shared/dates.js';
import { courseCodeKey, formatCourseCode, termLabel, type DocumentType, type SourceOrigin, type Term, type TermRef } from '../../shared/knowledge.js';
import type { CatalogCourse, Department, StudentCourse, University } from '../../shared/knowledgeApi.js';
import type { Database } from '../db/connection.js';

export const VISIBLE = `(s.visibility = 'public' OR s.owner_user_id = :userId)`;

// ---------- Catalog ----------

interface UniversityRow {
  id: number;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  website: string | null;
  domain: string | null;
  origin: 'catalog' | 'student';
}

const toUniversity = (r: UniversityRow): University => ({
  id: r.id,
  name: r.name,
  city: r.city,
  region: r.region,
  country: r.country,
  website: r.website,
  verified: r.origin === 'catalog',
});

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function searchUniversities(db: Database, q: string): University[] {
  const rows = db
    .prepare(
      `SELECT * FROM universities WHERE name LIKE :q ESCAPE '\\' OR city LIKE :q ESCAPE '\\'
       ORDER BY origin = 'catalog' DESC, name LIMIT 25`,
    )
    .all({ q: likePattern(q.trim()) }) as unknown as UniversityRow[];
  return rows.map(toUniversity);
}

export function getUniversityRow(db: Database, id: number): UniversityRow | undefined {
  return db.prepare('SELECT * FROM universities WHERE id = ?').get(id) as UniversityRow | undefined;
}

export function insertUniversity(
  db: Database,
  u: { name: string; city: string | null; region: string | null; country: string | null; website: string | null },
  userId: number,
  now: string,
): number {
  let domain: string | null = null;
  if (u.website) {
    try {
      domain = new URL(u.website).hostname.replace(/^www\./, '');
    } catch {
      domain = null;
    }
  }
  return Number(
    db
      .prepare(
        `INSERT INTO universities (name, city, region, country, website, domain, origin, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'student', ?, ?)`,
      )
      .run(u.name, u.city, u.region, u.country, u.website, domain, userId, now).lastInsertRowid,
  );
}

export function listDepartments(db: Database, universityId: number): Department[] {
  const rows = db
    .prepare('SELECT * FROM departments WHERE university_id = ? ORDER BY name')
    .all(universityId) as { id: number; university_id: number; name: string; origin: string }[];
  return rows.map((r) => ({ id: r.id, universityId: r.university_id, name: r.name, verified: r.origin === 'catalog' }));
}

export function insertDepartment(db: Database, universityId: number, name: string, userId: number, now: string): number {
  return Number(
    db
      .prepare(`INSERT INTO departments (university_id, name, origin, created_by, created_at) VALUES (?, ?, 'student', ?, ?)`)
      .run(universityId, name, userId, now).lastInsertRowid,
  );
}

const COURSE_SELECT = `
  SELECT c.*, u.name AS university_name, d.name AS department_name
  FROM catalog_courses c
  JOIN universities u ON u.id = c.university_id
  JOIN departments d ON d.id = c.department_id`;

interface CourseRow {
  id: number;
  code: string;
  title: string;
  description: string | null;
  origin: string;
  university_id: number;
  university_name: string;
  department_id: number;
  department_name: string;
}

const toCatalogCourse = (r: CourseRow): CatalogCourse => ({
  id: r.id,
  code: r.code,
  title: r.title,
  description: r.description,
  verified: r.origin === 'catalog',
  university: { id: r.university_id, name: r.university_name },
  department: { id: r.department_id, name: r.department_name },
});

/** Search by course code ("comp1805", "COMP 18") and/or title words, optionally within one school. */
export function searchCourses(db: Database, q: string, universityId?: number): CatalogCourse[] {
  const key = courseCodeKey(q);
  const rows = db
    .prepare(
      `${COURSE_SELECT}
       WHERE (:key <> '' AND c.code_key LIKE :keyPrefix ESCAPE '\\' OR c.title LIKE :titleQ ESCAPE '\\')
         AND (:uni IS NULL OR c.university_id = :uni)
       ORDER BY c.code_key = :key DESC, c.origin = 'catalog' DESC, c.code_key LIMIT 25`,
    )
    .all({ key, keyPrefix: `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, titleQ: likePattern(q.trim()), uni: universityId ?? null }) as unknown as CourseRow[];
  return rows.map(toCatalogCourse);
}

export function getCatalogCourse(db: Database, id: number): CatalogCourse | undefined {
  const row = db.prepare(`${COURSE_SELECT} WHERE c.id = ?`).get(id) as CourseRow | undefined;
  return row && toCatalogCourse(row);
}

export function findCatalogCourseByCode(db: Database, universityId: number, code: string): CatalogCourse | undefined {
  const row = db.prepare(`${COURSE_SELECT} WHERE c.university_id = ? AND c.code_key = ?`).get(universityId, courseCodeKey(code)) as CourseRow | undefined;
  return row && toCatalogCourse(row);
}

export function insertCatalogCourse(
  db: Database,
  c: { universityId: number; departmentId: number; code: string; title: string },
  userId: number,
  now: string,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO catalog_courses (university_id, department_id, code, code_key, title, origin, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'student', ?, ?)`,
      )
      .run(c.universityId, c.departmentId, formatCourseCode(c.code), courseCodeKey(c.code), c.title, userId, now).lastInsertRowid,
  );
}

export function findOrCreateVersion(db: Database, courseId: number, t: TermRef, now: string): number {
  db.prepare('INSERT OR IGNORE INTO course_versions (course_id, term, year, created_at) VALUES (?, ?, ?, ?)').run(courseId, t.term, t.year, now);
  return (db.prepare('SELECT id FROM course_versions WHERE course_id = ? AND term = ? AND year = ?').get(courseId, t.term, t.year) as { id: number }).id;
}

// ---------- Student courses ----------

interface StudentCourseRow {
  id: number;
  user_id: number;
  catalog_course_id: number;
  course_version_id: number;
  course_id: number;
  term: Term;
  year: number;
}

const STUDENT_COURSE_SELECT = `
  SELECT sc.*, v.term, v.year FROM student_courses sc
  JOIN course_versions v ON v.id = sc.course_version_id`;

function toStudentCourse(db: Database, r: StudentCourseRow): StudentCourse {
  return {
    id: r.id,
    recallCourseId: r.course_id,
    course: getCatalogCourse(db, r.catalog_course_id)!,
    version: { id: r.course_version_id, term: r.term, year: r.year, label: termLabel(r) },
  };
}

export function getStudentCourse(db: Database, userId: number, id: number): StudentCourse | undefined {
  const row = db.prepare(`${STUDENT_COURSE_SELECT} WHERE sc.id = ? AND sc.user_id = ?`).get(id, userId) as StudentCourseRow | undefined;
  return row && toStudentCourse(db, row);
}

export function getStudentCourseByRecallCourse(db: Database, userId: number, recallCourseId: number): StudentCourse | undefined {
  const row = db.prepare(`${STUDENT_COURSE_SELECT} WHERE sc.course_id = ? AND sc.user_id = ?`).get(recallCourseId, userId) as StudentCourseRow | undefined;
  return row && toStudentCourse(db, row);
}

export function listStudentCourses(db: Database, userId: number): StudentCourse[] {
  const rows = db.prepare(`${STUDENT_COURSE_SELECT} WHERE sc.user_id = ? ORDER BY sc.id`).all(userId) as unknown as StudentCourseRow[];
  return rows.map((r) => toStudentCourse(db, r));
}

export function findStudentCourseByVersion(db: Database, userId: number, versionId: number): StudentCourse | undefined {
  const row = db.prepare(`${STUDENT_COURSE_SELECT} WHERE sc.user_id = ? AND sc.course_version_id = ?`).get(userId, versionId) as StudentCourseRow | undefined;
  return row && toStudentCourse(db, row);
}

export function insertStudentCourse(db: Database, userId: number, catalogCourseId: number, versionId: number, recallCourseId: number, now: string): number {
  return Number(
    db
      .prepare('INSERT INTO student_courses (user_id, catalog_course_id, course_version_id, course_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, catalogCourseId, versionId, recallCourseId, now).lastInsertRowid,
  );
}

// ---------- Sources & topics ----------

export interface SourceRow {
  id: number;
  course_id: number;
  course_version_id: number | null;
  origin: SourceOrigin;
  document_type: DocumentType;
  title: string;
  url: string | null;
  academic_year: string | null;
  instructor: string | null;
  summary: string | null;
  visibility: 'public' | 'private';
  owner_user_id: number | null;
  is_demo: number;
  retrieved_at: string | null;
  created_at: string;
  term: Term | null;
  year: number | null;
  topic_count: number;
  document_id: number | null;
}

export function listVisibleSources(db: Database, userId: number, catalogCourseId: number): SourceRow[] {
  return db
    .prepare(
      `SELECT s.*, v.term, v.year,
         (SELECT COUNT(*) FROM knowledge_topics k WHERE k.source_id = s.id AND k.parent_id IS NULL) AS topic_count,
         (SELECT d.id FROM documents d WHERE d.source_id = s.id AND d.user_id = :userId) AS document_id
       FROM sources s LEFT JOIN course_versions v ON v.id = s.course_version_id
       WHERE s.course_id = :courseId AND ${VISIBLE}
       ORDER BY s.created_at`,
    )
    .all({ userId, courseId: catalogCourseId }) as unknown as SourceRow[];
}

export interface NewSource {
  courseId: number;
  versionId: number | null;
  origin: SourceOrigin;
  documentType: DocumentType;
  title: string;
  url?: string | null;
  academicYear?: string | null;
  instructor?: string | null;
  summary?: string | null;
  visibility: 'public' | 'private';
  ownerUserId: number | null;
  isDemo?: boolean;
  retrievedAt?: string | null;
}

export function insertSource(db: Database, s: NewSource, now: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO sources (course_id, course_version_id, origin, document_type, title, url, academic_year, instructor, summary,
           visibility, owner_user_id, is_demo, retrieved_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.courseId,
        s.versionId,
        s.origin,
        s.documentType,
        s.title.slice(0, 300),
        s.url ?? null,
        s.academicYear ?? null,
        s.instructor ?? null,
        s.summary ?? null,
        s.visibility,
        s.ownerUserId,
        s.isDemo ? 1 : 0,
        s.retrievedAt ?? null,
        now,
      ).lastInsertRowid,
  );
}

export interface NewTopic {
  name: string;
  topicKey: string;
  description?: string | null;
  week?: number | null;
  scheduledOn?: LocalDate | null;
  subtopics?: string[];
}

export function insertTopics(db: Database, sourceId: number, topics: NewTopic[], topicKeyOf: (name: string) => string) {
  const insert = db.prepare(
    `INSERT INTO knowledge_topics (source_id, parent_id, name, topic_key, description, week, scheduled_on, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  topics.forEach((t, i) => {
    const id = Number(insert.run(sourceId, null, t.name, t.topicKey, t.description ?? null, t.week ?? null, t.scheduledOn ?? null, i).lastInsertRowid);
    (t.subtopics ?? []).forEach((sub, j) => insert.run(sourceId, id, sub, topicKeyOf(sub), null, null, null, j));
  });
}

export interface TopicEvidenceRow {
  id: number;
  source_id: number;
  name: string;
  description: string | null;
  week: number | null;
  scheduled_on: string | null;
  subtopics: string | null;
}

export function listVisibleTopicEvidence(db: Database, userId: number, catalogCourseId: number): TopicEvidenceRow[] {
  return db
    .prepare(
      `SELECT k.id, k.source_id, k.name, k.description, k.week, k.scheduled_on,
         (SELECT json_group_array(c.name) FROM (SELECT name FROM knowledge_topics WHERE parent_id = k.id ORDER BY position) c) AS subtopics
       FROM knowledge_topics k JOIN sources s ON s.id = k.source_id
       WHERE k.parent_id IS NULL AND s.course_id = :courseId AND ${VISIBLE}
       ORDER BY k.source_id, k.position`,
    )
    .all({ userId, courseId: catalogCourseId }) as unknown as TopicEvidenceRow[];
}

export function insertAssessments(
  db: Database,
  sourceId: number,
  items: { name: string; kind: string | null; date: LocalDate | null; weight: number | null; topics: string[] }[],
) {
  const insert = db.prepare('INSERT INTO assessments (source_id, name, kind, due_on, weight, topics) VALUES (?, ?, ?, ?, ?, ?)');
  for (const a of items) insert.run(sourceId, a.name, a.kind, a.date, a.weight, JSON.stringify(a.topics));
}

export interface AssessmentRow {
  id: number;
  source_id: number;
  name: string;
  kind: string | null;
  due_on: string | null;
  weight: number | null;
  topics: string;
}

export function listVisibleAssessments(db: Database, userId: number, catalogCourseId: number): AssessmentRow[] {
  return db
    .prepare(
      `SELECT a.* FROM assessments a JOIN sources s ON s.id = a.source_id
       WHERE s.course_id = :courseId AND ${VISIBLE} ORDER BY a.due_on IS NULL, a.due_on, a.id`,
    )
    .all({ userId, courseId: catalogCourseId }) as unknown as AssessmentRow[];
}

// ---------- Retrieval ----------

/** Turn free text into a safe FTS5 query: quoted terms OR-ed together (no operators from user input). */
export function ftsQuery(text: string): string | null {
  const stop = new Set(['the', 'and', 'for', 'with', 'what', 'how', 'why', 'can', 'you', 'are', 'this', 'that', 'about', 'from', 'into', 'explain', 'give', 'tell', 'does']);
  const words = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !stop.has(w)))].slice(0, 12);
  return words.length > 0 ? words.map((w) => `"${w}"`).join(' OR ') : null;
}

export interface ChunkHit {
  documentId: number;
  filename: string;
  content: string;
}

/** BM25-ranked passages from the student's own documents for one course. */
export function searchChunks(db: Database, userId: number, studentCourseId: number, text: string, limit = 5): ChunkHit[] {
  const q = ftsQuery(text);
  if (!q) return [];
  return db
    .prepare(
      `SELECT c.document_id AS documentId, d.filename, c.content
       FROM document_chunks c JOIN documents d ON d.id = c.document_id
       WHERE document_chunks MATCH :q AND c.user_id = :userId AND d.user_id = :userId AND d.student_course_id = :sc
       ORDER BY bm25(document_chunks) LIMIT :limit`,
    )
    .all({ q, userId, sc: studentCourseId, limit }) as unknown as ChunkHit[];
}

export function indexChunks(db: Database, documentId: number, userId: number, chunks: string[]) {
  const insert = db.prepare('INSERT INTO document_chunks (content, document_id, user_id) VALUES (?, ?, ?)');
  for (const c of chunks) insert.run(c, documentId, userId);
}
