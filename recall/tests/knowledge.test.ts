import { describe, expect, it } from 'vitest';
import { parseLocalDate } from '../shared/dates.js';
import {
  academicYear,
  aggregateTopics,
  classifySource,
  classifyUrl,
  courseCodeKey,
  formatCourseCode,
  sourceTier,
  termForDate,
  topicKey,
  type SourceFacts,
  type TopicEvidence,
  type TermRef,
} from '../shared/knowledge.js';

const FALL_2026: TermRef = { term: 'fall', year: 2026 };
const FALL_2025: TermRef = { term: 'fall', year: 2025 };

const src = (over: Partial<SourceFacts> = {}): SourceFacts => ({
  origin: 'official',
  documentType: 'course_outline',
  term: FALL_2026,
  academicYear: null,
  ...over,
});

function ev(sourceId: number, title: string, source: SourceFacts, names: string[]): TopicEvidence[] {
  return names.map((n, i) => ({
    sourceId,
    topicName: n,
    subtopics: [],
    description: null,
    week: i + 1,
    scheduledOn: null,
    source: { ...source, title },
  }));
}

describe('terms', () => {
  it('maps dates to terms and academic years', () => {
    expect(termForDate(parseLocalDate('2026-10-01'))).toEqual(FALL_2026);
    expect(termForDate(parseLocalDate('2027-02-10'))).toEqual({ term: 'winter', year: 2027 });
    expect(termForDate(parseLocalDate('2027-06-01'))).toEqual({ term: 'summer', year: 2027 });
    expect(academicYear(FALL_2026)).toBe('2026-27');
    expect(academicYear({ term: 'winter', year: 2027 })).toBe('2026-27');
    expect(academicYear({ term: 'fall', year: 2099 })).toBe('2099-00');
  });

  it('normalises course codes', () => {
    expect(courseCodeKey('comp 1805')).toBe('COMP1805');
    expect(formatCourseCode('comp1805')).toBe('COMP 1805');
    expect(formatCourseCode('CSC108H1')).toBe('CSC 108H1');
  });
});

describe('topicKey', () => {
  it('matches the same concept named differently across sources', () => {
    expect(topicKey('Mathematical Induction')).toBe(topicKey('Induction'));
    expect(topicKey('Graph Theory')).toBe(topicKey('Graphs'));
    expect(topicKey('Set Theory')).toBe(topicKey('Sets'));
    expect(topicKey('Propositional Logic')).not.toBe(topicKey('Logic'));
    expect(topicKey('Proofs by Induction')).not.toBe(topicKey('Proofs'));
    expect(topicKey('Asymptotic Analysis')).toBe('asymptotic analysis');
  });
});

describe('classifySource', () => {
  it('labels evidence relative to the student’s term', () => {
    expect(classifySource(src(), FALL_2026)).toBe('confirmed');
    expect(classifySource(src({ origin: 'instructor' }), FALL_2026)).toBe('confirmed');
    expect(classifySource(src({ term: FALL_2025 }), FALL_2026)).toBe('historical');
    expect(classifySource(src({ origin: 'student', documentType: 'syllabus' }), FALL_2026)).toBe('confirmed');
    expect(classifySource(src({ origin: 'student', documentType: 'lecture_notes' }), FALL_2026)).toBe('your_materials');
    expect(classifySource(src({ origin: 'student', documentType: 'notes', term: null }), FALL_2026)).toBe('your_materials');
    expect(classifySource(src({ origin: 'student', documentType: 'syllabus', term: FALL_2025 }), FALL_2026)).toBe('historical');
    expect(classifySource(src({ origin: 'public', documentType: 'oer' }), FALL_2026)).toBe('public');
    expect(classifySource(src({ origin: 'web', documentType: 'web_page' }), FALL_2026)).toBe('public');
    expect(classifySource(src({ origin: 'ai', documentType: 'ai_suggestion' }), FALL_2026)).toBe('suggested');
    expect(classifySource(src({ origin: 'unknown' }), FALL_2026)).toBe('unconfirmed');
    expect(classifySource(src({ origin: 'official', term: null, documentType: 'web_page' }), FALL_2026)).toBe('unconfirmed');
    const calendar = src({ documentType: 'calendar_entry', term: null, academicYear: '2026-27' });
    expect(classifySource(calendar, FALL_2026)).toBe('confirmed');
    expect(classifySource({ ...calendar, academicYear: '2024-25' }, FALL_2026)).toBe('historical');
  });
});

describe('aggregateTopics', () => {
  it('reproduces the spec scenario: current syllabus vs historical outline', () => {
    const evidence = [
      ...ev(1, 'Your Fall 2026 syllabus', src({ origin: 'student', documentType: 'syllabus' }), ['Logic', 'Sets', 'Functions', 'Relations', 'Proofs', 'Counting']),
      ...ev(2, 'Fall 2025 outline', src({ term: FALL_2025 }), ['Logic', 'Set Theory', 'Functions', 'Relations', 'Mathematical Induction', 'Counting', 'Graph Theory']),
      ...ev(3, 'AI suggestions', src({ origin: 'ai', documentType: 'ai_suggestion', term: null }), ['Pigeonhole Principle']),
    ];
    const topics = aggregateTopics(evidence, FALL_2026);
    const by = Object.fromEntries(topics.map((t) => [t.name, t]));

    expect(topics.filter((t) => t.status === 'confirmed').map((t) => t.name)).toEqual(['Logic', 'Sets', 'Functions', 'Relations', 'Proofs', 'Counting']);
    expect(by['Sets'].evidence).toHaveLength(2);
    expect(by['Mathematical Induction'].status).toBe('historical');
    expect(by['Mathematical Induction'].conflict).toBe('Sources differ: listed in Fall 2025 outline but not in Your Fall 2026 syllabus.');
    expect(by['Graph Theory'].status).toBe('historical');
    expect(by['Pigeonhole Principle'].status).toBe('suggested');
    expect(by['Pigeonhole Principle'].conflict).toBeNull();
    // Weeks come from the confirming source, never from a historical one.
    expect(by['Logic'].week).toBe(1);
    expect(by['Graph Theory'].week).toBeNull();
  });

  it('does not let a broad calendar description confirm a topic the current syllabus omits', () => {
    const evidence = [
      ...ev(1, 'Calendar 2026-27', src({ documentType: 'calendar_entry', term: null, academicYear: '2026-27' }), ['Logic', 'Finite Automata']),
      ...ev(2, 'Fall 2026 outline', src(), ['Logic']),
    ];
    const by = Object.fromEntries(aggregateTopics(evidence, FALL_2026).map((t) => [t.name, t]));
    expect(by['Logic'].status).toBe('confirmed');
    expect(by['Finite Automata'].status).toBe('unconfirmed');
    expect(by['Finite Automata'].conflict).toMatch(/Sources differ: listed in Calendar 2026-27 but not in Fall 2026 outline/);
  });

  it('confirms calendar topics when no current syllabus exists', () => {
    const evidence = ev(1, 'Calendar 2026-27', src({ documentType: 'calendar_entry', term: null, academicYear: '2026-27' }), ['Logic']);
    expect(aggregateTopics(evidence, FALL_2026)[0]).toMatchObject({ status: 'confirmed', conflict: null });
  });
});

describe('source ranking and URL classification', () => {
  it('ranks current official above everything and AI last', () => {
    const tiers = [
      sourceTier(src(), FALL_2026),
      sourceTier(src({ origin: 'instructor' }), FALL_2026),
      sourceTier(src({ origin: 'student', documentType: 'syllabus' }), FALL_2026),
      sourceTier(src({ term: FALL_2025 }), FALL_2026),
      sourceTier(src({ origin: 'student', term: FALL_2025 }), FALL_2026),
      sourceTier(src({ origin: 'public', documentType: 'oer' }), FALL_2026),
      sourceTier(src({ origin: 'web', documentType: 'web_page' }), FALL_2026),
      sourceTier(src({ origin: 'ai', documentType: 'ai_suggestion' }), FALL_2026),
    ];
    expect(tiers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('classifies URLs by domain, not by what the page claims', () => {
    expect(classifyUrl('https://calendar.carleton.ca/undergrad/courses/COMP/', 'carleton.ca').origin).toBe('official');
    expect(classifyUrl('https://carleton.ca.evil.com/outline', 'carleton.ca').origin).toBe('web');
    expect(classifyUrl('https://math.libretexts.org/Bookshelves/Combinatorics', 'carleton.ca')).toEqual({ origin: 'public', documentType: 'oer' });
    expect(classifyUrl('https://someblog.example/comp1805-official-outline', 'carleton.ca').origin).toBe('web');
    expect(classifyUrl('not a url', null).origin).toBe('web');
  });
});
