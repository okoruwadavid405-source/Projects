/**
 * Optional demo data. Courses are flagged `is_demo` so they are labelled in the
 * UI and can be removed in one click. Each topic's history is produced by
 * running the real scheduling engine over a scripted sequence of past reviews,
 * so the resulting due dates and statistics are genuine outputs of the engine.
 */
import { randomUUID } from 'node:crypto';
import { addDays, compareDates, type LocalDate } from '../../shared/dates.js';
import { termForDate, termLabel, topicKey } from '../../shared/knowledge.js';
import * as knowledge from '../knowledge/repository.js';
import { applyReview, initialSchedule, stageFor, type Rating } from '../../shared/scheduler.js';
import type { CourseColor } from '../../shared/validation.js';
import { transaction } from '../db/connection.js';
import type { AppContext } from '../lib/context.js';
import { conflict } from '../lib/errors.js';
import { nowIso, todayFor } from '../lib/time.js';
import { deleteDemoCourses, hasDemoCourses, insertCourse } from '../repositories/courses.js';
import { insertQuestion } from '../repositories/questions.js';
import { insertReview } from '../repositories/reviews.js';
import { insertTopic, updateTopicSchedule } from '../repositories/topics.js';

interface DemoTopic {
  title: string;
  description: string;
  learnedDaysAgo: number;
  understanding: number;
  /** Past reviews: rating, and how many days after the due date it was done. */
  history: [Rating, number?][];
  questions: [string, string][];
}

interface DemoCourse {
  code: string;
  name: string;
  professor: string;
  color: CourseColor;
  topics: DemoTopic[];
}

export const DEMO_COURSES: DemoCourse[] = [
  {
    code: 'COMP 1805',
    name: 'Discrete Mathematics',
    professor: 'Dr. Morin',
    color: 'indigo',
    topics: [
      {
        title: 'Sets',
        description: 'Union, intersection, subset, power sets and set notation.',
        learnedDaysAgo: 31,
        understanding: 4,
        history: [['good'], ['good'], ['easy'], ['good']],
        questions: [
          ['What is the union of two sets A and B?', 'The set of all elements that belong to A, to B, or to both: A ∪ B = {x | x ∈ A or x ∈ B}.'],
          ['What is the intersection of two sets?', 'The set of elements common to both sets: A ∩ B = {x | x ∈ A and x ∈ B}.'],
          ['What is the difference between a subset and a proper subset?', 'A ⊆ B means every element of A is in B (A may equal B). A ⊂ B additionally requires A ≠ B.'],
          ['How many elements are in the power set of a set with n elements?', '2ⁿ — every element is either in or out of each subset.'],
        ],
      },
      {
        title: 'Logic',
        description: 'Propositions, connectives, truth tables, logical equivalence and quantifiers.',
        learnedDaysAgo: 9,
        understanding: 3,
        history: [['good'], ['hard'], ['good']],
        questions: [
          ['When is the implication p → q false?', 'Only when p is true and q is false.'],
          ['What is the contrapositive of p → q?', '¬q → ¬p. It is logically equivalent to p → q.'],
          ['State De Morgan\'s laws for propositions.', '¬(p ∧ q) ≡ ¬p ∨ ¬q and ¬(p ∨ q) ≡ ¬p ∧ ¬q.'],
        ],
      },
      {
        title: 'Functions',
        description: 'Injective, surjective and bijective functions; composition and inverses.',
        learnedDaysAgo: 5,
        understanding: 3,
        history: [['good'], ['forgot'], ['hard']],
        questions: [
          ['What does it mean for a function to be injective (one-to-one)?', 'Distinct inputs map to distinct outputs: f(a) = f(b) implies a = b.'],
          ['What does it mean for a function to be surjective (onto)?', 'Every element of the codomain is the image of at least one element of the domain.'],
          ['When does a function have an inverse?', 'Exactly when it is a bijection (both injective and surjective).'],
        ],
      },
      {
        title: 'Relations',
        description: 'Reflexive, symmetric, antisymmetric and transitive relations; equivalence relations.',
        learnedDaysAgo: 6,
        understanding: 3,
        history: [['good'], ['good']],
        questions: [
          ['What three properties make a relation an equivalence relation?', 'It is reflexive, symmetric and transitive.'],
          ['What is an antisymmetric relation?', 'If (a, b) and (b, a) are both in R, then a = b.'],
        ],
      },
      {
        title: 'Mathematical Induction',
        description: 'Base case, inductive hypothesis and inductive step.',
        learnedDaysAgo: 1,
        understanding: 2,
        history: [],
        questions: [
          ['What are the two steps of a proof by induction?', 'Base case: prove P(n₀). Inductive step: prove P(k) → P(k + 1) for every k ≥ n₀.'],
          ['What is the inductive hypothesis?', 'The assumption that P(k) holds for an arbitrary k, used to prove P(k + 1).'],
        ],
      },
    ],
  },
  {
    code: 'COMP 1406',
    name: 'Introduction to Computer Science II',
    professor: 'Dr. Nel',
    color: 'teal',
    topics: [
      {
        title: 'Arrays',
        description: 'Declaring, indexing and iterating over arrays in Java.',
        learnedDaysAgo: 20,
        understanding: 5,
        history: [['easy'], ['good'], ['good', 3]],
        questions: [
          ['What is the index of the last element of an array `a`?', '`a.length - 1`.'],
          ['What happens when you access an index outside an array\'s bounds in Java?', 'An `ArrayIndexOutOfBoundsException` is thrown at runtime.'],
        ],
      },
      {
        title: 'Objects and Classes',
        description: 'Constructors, instance variables, encapsulation and `this`.',
        learnedDaysAgo: 3,
        understanding: 4,
        history: [['good']],
        questions: [
          ['What is the purpose of a constructor?', 'To initialise a new object\'s state when it is created with `new`.'],
          ['What does `this` refer to inside an instance method?', 'The object on which the method was called.'],
        ],
      },
    ],
  },
  {
    code: 'STAT 2507',
    name: 'Introduction to Statistics',
    professor: 'Dr. Chen',
    color: 'amber',
    topics: [
      {
        title: 'Probability Rules',
        description: 'Complement, addition and multiplication rules; independence.',
        learnedDaysAgo: 14,
        understanding: 3,
        history: [['good'], ['good'], ['good', 4]],
        questions: [
          ['What is the addition rule for two events A and B?', 'P(A ∪ B) = P(A) + P(B) − P(A ∩ B).'],
          ['When are two events independent?', 'When P(A ∩ B) = P(A) · P(B), equivalently P(A | B) = P(A).'],
        ],
      },
      {
        title: 'Normal Distribution',
        description: 'Mean, standard deviation, z-scores and the empirical rule.',
        learnedDaysAgo: 0,
        understanding: 3,
        history: [],
        questions: [],
      },
    ],
  },
];

export function loadDemoData(ctx: AppContext, userId: number, timezone: string): void {
  if (hasDemoCourses(ctx.db, userId)) throw conflict('Demo data is already loaded.');
  const today = todayFor(ctx, timezone);
  const now = nowIso(ctx);

  transaction(ctx.db, () => {
    for (const course of DEMO_COURSES) {
      const taken = ctx.db.prepare('SELECT 1 FROM courses WHERE user_id = ? AND code = ? COLLATE NOCASE').get(userId, course.code);
      const courseId = insertCourse(
        ctx.db,
        userId,
        {
          code: taken ? `${course.code} (demo)`.slice(0, 20) : course.code,
          name: course.name,
          professor: course.professor,
          description: 'Demo course — remove it any time from Settings.',
          color: course.color,
        },
        now,
        true,
      );

      if (course.code === 'COMP 1805') addDemoCourseKnowledge(ctx, userId, courseId, today, now);

      for (const topic of course.topics) {
        const learnedOn = addDays(today, -topic.learnedDaysAgo);
        // Seed with the learned day as "today" so the first review is learnedOn + 1, as it would have been.
        let state = initialSchedule(learnedOn, topic.understanding, learnedOn);
        const topicId = insertTopic(
          ctx.db,
          userId,
          { courseId, title: topic.title, description: topic.description, understanding: topic.understanding, schedule: state },
          now,
        );
        const questionIds = topic.questions.map(([q, a]) => insertQuestion(ctx.db, topicId, { prompt: q, answer: a }, now));

        let lastRating: Rating | null = null;
        for (const [rating, daysLate = 0] of topic.history) {
          const day: LocalDate = addDays(state.nextReviewOn, daysLate);
          if (compareDates(day, today) >= 0) break; // only simulate reviews that would already have happened
          const outcome = applyReview(state, rating, day);
          insertReview(ctx.db, {
            userId,
            topicId,
            clientId: randomUUID(),
            reviewedAt: `${day}T16:00:00.000Z`,
            reviewDay: day,
            rating,
            previousInterval: outcome.previousInterval,
            newInterval: outcome.newInterval,
            previousEase: outcome.previousEase,
            newEase: outcome.newEase,
            daysOverdue: outcome.daysOverdue,
            nextReviewOn: outcome.state.nextReviewOn,
            answers: questionIds.slice(0, 3).map((questionId) => ({ questionId, rating })),
          });
          state = outcome.state;
          lastRating = rating;
        }
        if (lastRating) {
          updateTopicSchedule(ctx.db, userId, topicId, state, stageFor(state.interval, state.reviewCount, lastRating), lastRating, now);
        } else if (compareDates(state.nextReviewOn, today) < 0) {
          // A never-reviewed demo topic is due today, exactly as a newly created topic would be.
          ctx.db.prepare('UPDATE topics SET next_review_at = ? WHERE id = ?').run(today, topicId);
        }
      }
    }
  });
}

/**
 * Links the demo COMP 1805 course to the Carleton catalog entry with two private,
 * clearly-labelled sample sources: a "current" syllabus and a past-term outline,
 * so the course profile can show confirmed vs. historical topics.
 */
function addDemoCourseKnowledge(ctx: AppContext, userId: number, recallCourseId: number, today: LocalDate, now: string) {
  const catalog = knowledge.searchCourses(ctx.db, 'COMP 1805').find((c) => c.university.name === 'Carleton University' && c.code === 'COMP 1805');
  if (!catalog) return;
  const term = termForDate(today);
  const past = { term: term.term, year: term.year - 1 };
  const versionId = knowledge.findOrCreateVersion(ctx.db, catalog.id, term, now);
  if (knowledge.findStudentCourseByVersion(ctx.db, userId, versionId)) return; // already linked to a real course
  const pastVersionId = knowledge.findOrCreateVersion(ctx.db, catalog.id, past, now);
  knowledge.insertStudentCourse(ctx.db, userId, catalog.id, versionId, recallCourseId, now);

  const outline = knowledge.insertSource(
    ctx.db,
    {
      courseId: catalog.id,
      versionId: pastVersionId,
      origin: 'official',
      documentType: 'course_outline',
      title: `Sample ${termLabel(past)} course outline (demo data — not a real Carleton document)`,
      visibility: 'private',
      ownerUserId: userId,
      isDemo: true,
      instructor: 'Dr. Past Instructor (demo)',
    },
    now,
  );
  knowledge.insertTopics(
    ctx.db,
    outline,
    ['Logic', 'Set Theory', 'Functions', 'Relations', 'Mathematical Induction', 'Counting', 'Graph Theory'].map((name) => ({ name, topicKey: topicKey(name) })),
    topicKey,
  );

  const syllabus = knowledge.insertSource(
    ctx.db,
    {
      courseId: catalog.id,
      versionId,
      origin: 'student',
      documentType: 'syllabus',
      title: `Sample ${termLabel(term)} syllabus (demo data)`,
      visibility: 'private',
      ownerUserId: userId,
      isDemo: true,
      instructor: 'Dr. Demo Instructor',
    },
    now,
  );
  const weekly: [string, number, string[]][] = [
    ['Logic', -28, ['propositions', 'truth tables', 'logical equivalence']],
    ['Sets', -21, ['set notation', 'union', 'intersection', 'power sets']],
    ['Functions', -14, ['injective', 'surjective', 'bijective']],
    ['Relations', -7, ['equivalence relations', 'partial orders']],
    ['Proofs', 7, ['direct proof', 'contradiction', 'contrapositive']],
    ['Counting', 14, ['permutations', 'combinations']],
  ];
  knowledge.insertTopics(
    ctx.db,
    syllabus,
    weekly.map(([name, offset, subtopics], i) => ({ name, topicKey: topicKey(name), week: i + 1, scheduledOn: addDays(today, offset), subtopics })),
    topicKey,
  );
  knowledge.insertAssessments(ctx.db, syllabus, [
    { name: 'Midterm Exam', kind: 'midterm', date: addDays(today, 12), weight: 25, topics: ['Logic', 'Sets', 'Functions'] },
  ]);
}

export function removeDemoData(ctx: AppContext, userId: number): number {
  return transaction(ctx.db, () => {
    ctx.db.prepare('DELETE FROM sources WHERE owner_user_id = ? AND is_demo = 1').run(userId);
    return deleteDemoCourses(ctx.db, userId);
  });
}
