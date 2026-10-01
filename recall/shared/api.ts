/** Response shapes shared by the API and the client. */
import type { LocalDate } from './dates.js';
import type { Rating, TopicDisplayStatus, TopicStage } from './scheduler.js';
import type { CourseColor, QuestionKind, QuestionSource } from './validation.js';

export interface User {
  id: number;
  name: string;
  email: string;
  timezone: string;
  reminderEnabled: boolean;
  reminderTime: string;
  createdAt: string;
}

export interface Course {
  id: number;
  code: string;
  name: string;
  professor: string | null;
  description: string | null;
  color: CourseColor;
  isDemo: boolean;
  createdAt: string;
  topicCount: number;
  dueCount: number;
  masteredCount: number;
}

export interface CourseRef {
  id: number;
  code: string;
  name: string;
  color: CourseColor;
}

export interface TopicSummary {
  id: number;
  courseId: number;
  title: string;
  description: string | null;
  learnedOn: LocalDate;
  stage: TopicStage;
  status: TopicDisplayStatus;
  nextReviewOn: LocalDate;
  daysUntilDue: number;
  interval: number;
  reviewCount: number;
  lapseCount: number;
  lastRating: Rating | null;
  lastReviewedOn: LocalDate | null;
  questionCount: number;
  course: CourseRef;
}

export interface Question {
  id: number;
  topicId: number;
  prompt: string;
  answer: string;
  source: QuestionSource;
  kind: QuestionKind | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRecord {
  id: number;
  topicId: number;
  reviewedAt: string;
  reviewDay: LocalDate;
  rating: Rating;
  previousInterval: number;
  newInterval: number;
  daysOverdue: number;
  nextReviewOn: LocalDate;
}

export interface TopicDetail extends TopicSummary {
  understanding: number;
  ease: number;
  questions: Question[];
  reviews: ReviewRecord[];
  projected: LocalDate[];
  /** True while Recall is writing questions for this topic in the background. */
  generatingQuestions: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSession {
  topic: TopicSummary;
  mode: 'questions' | 'free';
  questions: (Pick<Question, 'id' | 'prompt' | 'answer' | 'kind'> & { isNew: boolean })[];
  today: LocalDate;
}

export interface ReviewResult {
  rating: Rating;
  previousInterval: number;
  newInterval: number;
  daysOverdue: number;
  early: boolean;
  nextReviewOn: LocalDate;
  topic: TopicSummary;
}

export interface Insight {
  id: string;
  tone: 'info' | 'positive' | 'warning';
  text: string;
  topicId?: number;
}

export interface DayCount {
  date: LocalDate;
  count: number;
}

export interface Dashboard {
  today: LocalDate;
  dueTodayCount: number;
  overdueCount: number;
  courseCount: number;
  topicCount: number;
  reviewedTodayCount: number;
  streak: number;
  groups: { course: CourseRef; topics: TopicSummary[] }[];
  nextDays: DayCount[];
  insights: Insight[];
  hasDemoData: boolean;
}

export interface UpcomingDay {
  date: LocalDate;
  topics: TopicSummary[];
}

export interface Upcoming {
  today: LocalDate;
  overdue: TopicSummary[];
  days: UpcomingDay[];
  weeks: { start: LocalDate; count: number }[];
}

export interface CourseStat {
  course: CourseRef;
  topicCount: number;
  masteredCount: number;
  reviewCount: number;
  accuracy: number | null;
}

export interface Progress {
  today: LocalDate;
  totals: {
    topics: number;
    new: number;
    learning: number;
    reviewing: number;
    mastered: number;
    dueToday: number;
    overdue: number;
    reviews: number;
  };
  streak: number;
  longestStreak: number;
  accuracy: number | null;
  ratingCounts: Record<Rating, number>;
  activity: DayCount[];
  courses: CourseStat[];
  strongestCourse: CourseStat | null;
  needsAttention: (TopicSummary & { reason: string })[];
}

export interface ReminderDigest {
  enabled: boolean;
  reminderTime: string;
  timezone: string;
  dueCount: number;
  message: string;
}

export interface QuestionDraft {
  prompt: string;
  answer: string;
  kind: QuestionKind;
}

export interface Features {
  /** Whether this server can generate questions (it needs Anthropic API credentials). */
  questionGeneration: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}
