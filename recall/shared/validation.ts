import { z } from 'zod';
import { isLocalDate, isValidTimeZone, type LocalDate } from './dates.js';
import { RATINGS } from './scheduler.js';

const trimmed = (label: string, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const localDateSchema = z
  .string({ error: 'Date is required.' })
  .refine(isLocalDate, 'Enter a valid date.')
  .transform((v) => v as LocalDate);

export const timeZoneSchema = z.string().refine(isValidTimeZone, 'Unknown time zone.');

export const COURSE_COLORS = ['indigo', 'teal', 'rose', 'amber', 'sky', 'violet', 'emerald', 'slate'] as const;
export type CourseColor = (typeof COURSE_COLORS)[number];

export const registerSchema = z.object({
  name: trimmed('Name', 80),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.')),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(200, 'Password must be 200 characters or fewer.'),
  timezone: timeZoneSchema.optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required.').max(254),
  password: z.string().min(1, 'Password is required.').max(200),
});

export const courseInputSchema = z.object({
  code: trimmed('Course code', 20),
  name: trimmed('Course name', 120),
  professor: optionalText('Professor', 80),
  description: optionalText('Description', 500),
  color: z.enum(COURSE_COLORS).default('indigo'),
});

/** What a question asks the student to do. Generated questions always carry one. */
export const QUESTION_KINDS = ['recall', 'explain', 'apply', 'compare', 'troubleshoot'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const QUESTION_SOURCES = ['manual', 'generated'] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export const QUESTION_PROMPT_MAX = 1000;
export const QUESTION_ANSWER_MAX = 4000;

export const questionInputSchema = z.object({
  prompt: trimmed('Question', QUESTION_PROMPT_MAX),
  answer: trimmed('Answer', QUESTION_ANSWER_MAX),
  source: z.enum(QUESTION_SOURCES).default('manual'),
  kind: z.enum(QUESTION_KINDS).nullable().default(null),
});

export const questionDraftRequestSchema = z.object({
  courseId: z.number().int().positive('Choose a course.'),
  title: trimmed('Topic', 120),
  description: optionalText('Description', 2000),
  notes: optionalText('Notes', 8000),
  /** When generating more questions for an existing topic. */
  topicId: z.number().int().positive().optional(),
  count: z.number().int().min(1).max(8).default(5),
});

export const topicCreateSchema = z.object({
  courseId: z.number().int().positive('Choose a course.'),
  title: trimmed('Topic', 120),
  description: optionalText('Description', 2000),
  learnedOn: localDateSchema,
  understanding: z.number().int().min(1).max(5).default(3),
  questions: z.array(questionInputSchema).max(50, 'Add at most 50 questions at a time.').default([]),
});

export const topicUpdateSchema = z.object({
  courseId: z.number().int().positive().optional(),
  title: trimmed('Topic', 120).optional(),
  description: optionalText('Description', 2000),
  learnedOn: localDateSchema.optional(),
});

export const reviewSubmitSchema = z
  .object({
    clientId: z.string().uuid('Invalid review id.'),
    answers: z
      .array(z.object({ questionId: z.number().int().positive(), rating: z.enum(RATINGS) }))
      .max(20)
      .default([]),
    rating: z.enum(RATINGS).optional(),
  })
  .refine((v) => v.answers.length > 0 || v.rating !== undefined, 'Rate how well you remembered the topic.');

export const settingsSchema = z.object({
  name: trimmed('Name', 80).optional(),
  timezone: timeZoneSchema.optional(),
  reminderEnabled: z.boolean().optional(),
  reminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 18:30.')
    .optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type CourseInput = z.input<typeof courseInputSchema>;
export type QuestionInput = z.input<typeof questionInputSchema>;
export type QuestionDraftRequest = z.input<typeof questionDraftRequestSchema>;
export type TopicCreateInput = z.input<typeof topicCreateSchema>;
export type TopicUpdateInput = z.input<typeof topicUpdateSchema>;
export type ReviewSubmitInput = z.input<typeof reviewSubmitSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
