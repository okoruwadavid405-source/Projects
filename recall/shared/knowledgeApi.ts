/** Validation schemas and response types for the course knowledge system. */
import { z } from 'zod';
import { isLocalDate, type LocalDate } from './dates.js';
import { DOCUMENT_TYPES, TERMS, type DocumentType, type EvidenceStatus, type SourceOrigin, type Term } from './knowledge.js';
import type { Rating, TopicDisplayStatus, TopicStage } from './scheduler.js';
import type { CourseColor } from './validation.js';

const text = (label: string, max: number) =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const optionalDate = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v && isLocalDate(v) ? (v as LocalDate) : null));

// ---------- What an extractor (AI or pattern-based) returns ----------

export const extractionSchema = z.object({
  courseCode: z.string().nullable(),
  courseTitle: z.string().nullable(),
  term: z.enum(TERMS).nullable(),
  year: z.number().int().nullable(),
  instructor: z.string().nullable(),
  description: z.string().nullable(),
  learningObjectives: z.array(z.string()),
  topics: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      week: z.number().int().nullable(),
      date: z.string().nullable(),
      subtopics: z.array(z.string()),
    }),
  ),
  assessments: z.array(
    z.object({
      name: z.string(),
      kind: z.string().nullable(),
      date: z.string().nullable(),
      weight: z.number().nullable(),
      topics: z.array(z.string()),
    }),
  ),
  readings: z.array(z.string()),
  terminology: z.array(z.string()),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const emptyExtraction = (): Extraction => ({
  courseCode: null,
  courseTitle: null,
  term: null,
  year: null,
  instructor: null,
  description: null,
  learningObjectives: [],
  topics: [],
  assessments: [],
  readings: [],
  terminology: [],
});

// ---------- Requests ----------

export const universityInputSchema = z.object({
  name: text('University name', 160),
  city: optional(80),
  region: optional(80),
  country: optional(80),
  website: z
    .string()
    .trim()
    .max(300)
    .nullable()
    .optional()
    .refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v), 'Enter a full web address starting with https://')
    .transform((v) => (v ? v : null)),
});

export const departmentInputSchema = z.object({ name: text('Department', 160) });

export const catalogCourseInputSchema = z.object({
  universityId: z.number().int().positive(),
  departmentId: z.number().int().positive('Choose a department.'),
  code: text('Course code', 20).refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Course codes look like "COMP 1805".'),
  title: text('Course title', 200),
});

export const studentCourseInputSchema = z.object({
  catalogCourseId: z.number().int().positive(),
  term: z.enum(TERMS),
  year: z.number().int().min(1990).max(2100),
  color: z.string().optional(),
});

export const confirmExtractionSchema = z.object({
  /** The term the document describes — may differ from the student's term (then it is filed as past material). */
  term: z.enum(TERMS).nullable(),
  year: z.number().int().min(1990).max(2100).nullable(),
  instructor: optional(160),
  topics: z
    .array(
      z.object({
        name: text('Topic', 200),
        description: optional(2000),
        week: z.number().int().min(0).max(60).nullable().optional().transform((v) => v ?? null),
        date: optionalDate,
        subtopics: z.array(text('Subtopic', 200)).max(50).default([]),
      }),
    )
    .max(200),
  assessments: z
    .array(
      z.object({
        name: text('Assessment', 200),
        kind: optional(60),
        date: optionalDate,
        weight: z.number().min(0).max(100).nullable().optional().transform((v) => v ?? null),
        topics: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
      }),
    )
    .max(50)
    .default([]),
});
export type ConfirmExtractionInput = z.input<typeof confirmExtractionSchema>;

export const saveResourceSchema = z.object({
  url: z.string().trim().url('Enter a valid link.').max(2000).refine((u) => /^https?:/i.test(u), 'Links must start with http or https.'),
  title: text('Title', 300),
});

export const importUrlSchema = z.object({ url: saveResourceSchema.shape.url });

export const studyTopicSchema = z.object({
  topicKey: text('Topic', 200),
  learnedOn: z.string().refine(isLocalDate, 'Enter a valid date.').transform((v) => v as LocalDate),
  understanding: z.number().int().min(1).max(5).default(3),
  generateQuestions: z.boolean().default(true),
  /** Required to study a topic no current course document confirms. */
  allowUnconfirmed: z.boolean().default(false),
});

export const assistantRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(8000) }))
    .min(1)
    .max(40)
    .refine((m) => m[m.length - 1].role === 'user', 'The last message must be from you.'),
});

export const uploadDocumentTypeSchema = z.enum(DOCUMENT_TYPES);

// ---------- Responses ----------

export interface University {
  id: number;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  website: string | null;
  verified: boolean;
}

export interface Department {
  id: number;
  universityId: number;
  name: string;
  verified: boolean;
}

export interface CatalogCourse {
  id: number;
  code: string;
  title: string;
  description: string | null;
  verified: boolean;
  university: { id: number; name: string };
  department: { id: number; name: string };
}

export interface StudentCourse {
  id: number;
  recallCourseId: number;
  course: CatalogCourse;
  version: { id: number; term: Term; year: number; label: string };
}

export interface SourceSummary {
  id: number;
  title: string;
  url: string | null;
  origin: SourceOrigin;
  documentType: DocumentType;
  termLabel: string | null;
  academicYear: string | null;
  instructor: string | null;
  tier: number;
  tierLabel: string;
  status: EvidenceStatus;
  isPrivate: boolean;
  isDemo: boolean;
  topicCount: number;
  documentId: number | null;
}

export interface PersonalTopicMemory {
  recallTopicId: number;
  stage: TopicStage;
  status: TopicDisplayStatus;
  reviewCount: number;
  lastRating: Rating | null;
  nextReviewOn: LocalDate;
  learnedOn: LocalDate;
  pinned: boolean;
}

export interface ProfileTopic {
  key: string;
  name: string;
  status: EvidenceStatus;
  description: string | null;
  week: number | null;
  scheduledOn: LocalDate | null;
  subtopics: string[];
  evidence: { sourceId: number; sourceTitle: string; status: EvidenceStatus }[];
  conflict: string | null;
  /** The student's own study record for this topic, if they have started it. */
  personal: PersonalTopicMemory | null;
}

export interface AssessmentInfo {
  id: number;
  name: string;
  kind: string | null;
  dueOn: LocalDate | null;
  weight: number | null;
  topics: string[];
  sourceTitle: string;
  status: EvidenceStatus;
}

export interface DocumentInfo {
  id: number;
  kind: 'upload' | 'web';
  filename: string;
  url: string | null;
  documentType: DocumentType;
  status: 'processing' | 'needs_review' | 'confirmed' | 'failed';
  error: string | null;
  extractor: 'ai' | 'pattern' | null;
  byteSize: number;
  createdAt: string;
  sourceId: number | null;
  extraction: Extraction | null;
  warnings: string[];
  origin: SourceOrigin;
}

export interface CourseProfile {
  studentCourse: StudentCourse;
  today: LocalDate;
  instructor: { name: string; sourceTitle: string } | null;
  topics: ProfileTopic[];
  counts: Record<EvidenceStatus, number>;
  /** Topics from past versions that no current source confirms. */
  missing: ProfileTopic[];
  conflicts: { topic: string; message: string }[];
  sources: SourceSummary[];
  assessments: AssessmentInfo[];
  documents: DocumentInfo[];
  hasCurrentListing: boolean;
  notice: string | null;
}

export interface Recommendation {
  kind: 'review' | 'struggled' | 'assessment' | 'syllabus' | 'pinned';
  topicName: string;
  topicKey: string | null;
  recallTopicId: number | null;
  studentCourseId: number | null;
  course: { id: number; code: string; color: CourseColor };
  reasons: string[];
  score: number;
}

export interface WebResult {
  title: string;
  url: string;
  pageAge: string | null;
  origin: SourceOrigin;
  tier: number;
  tierLabel: string;
}

export interface Discovery {
  query: string;
  results: WebResult[];
}

export interface KnowledgeFeatures {
  documentAI: boolean;
  assistant: boolean;
  webSearch: boolean;
  suggestions: boolean;
}
