/**
 * Course knowledge: the rules for turning collected *evidence* about a course
 * into what a student is shown.
 *
 * Recall never "knows" what a course teaches. It stores sources (an official
 * outline, the student's syllabus, an old outline, a public web page, an AI
 * suggestion), each tied to a course version (term + year), and the topics each
 * source lists. Everything the student sees — Confirmed, Past versions,
 * AI suggestion… — is computed here, relative to the student's own term.
 */
import type { LocalDate } from './dates.js';

// ---------- Terms ----------

/** Terms in calendar order within a year. */
export const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;
export type Term = (typeof TERMS)[number];

export interface TermRef {
  term: Term;
  year: number;
}

export const termLabel = ({ term, year }: TermRef) => `${term[0].toUpperCase()}${term.slice(1)} ${year}`;

/** A sortable number for a term: later terms are larger. */
export const termOrdinal = ({ term, year }: TermRef) => year * 4 + TERMS.indexOf(term);

export const sameTerm = (a: TermRef, b: TermRef) => a.term === b.term && a.year === b.year;

/** The term a date falls in, using the common North American split (Jan–Apr, May–Aug, Sep–Dec). */
export function termForDate(date: LocalDate): TermRef {
  const [y, m] = date.split('-').map(Number);
  if (m <= 4) return { term: 'winter', year: y };
  if (m <= 8) return { term: 'summer', year: y };
  return { term: 'fall', year: y };
}

/** Academic year (as printed in university calendars) that a term belongs to: Fall 2026 → "2026-27". */
export function academicYear({ term, year }: TermRef): string {
  const start = term === 'fall' ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// ---------- Sources ----------

/** Who produced a source. */
export const SOURCE_ORIGINS = ['official', 'instructor', 'student', 'public', 'web', 'ai', 'unknown'] as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export const DOCUMENT_TYPES = [
  'syllabus',
  'course_outline',
  'calendar_entry',
  'lecture_notes',
  'study_guide',
  'notes',
  'practice',
  'review_sheet',
  'oer',
  'web_page',
  'ai_suggestion',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Document types the student can upload, with labels. */
export const UPLOAD_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'syllabus', label: 'Syllabus / course outline' },
  { value: 'lecture_notes', label: 'Lecture notes' },
  { value: 'study_guide', label: 'Study guide' },
  { value: 'notes', label: 'My own notes' },
  { value: 'practice', label: 'Practice questions' },
  { value: 'review_sheet', label: 'Review sheet' },
  { value: 'other', label: 'Other' },
];

/** Documents that list the whole course for a term — their silence about a topic is meaningful. */
const LISTING_TYPES: readonly DocumentType[] = ['syllabus', 'course_outline'];
export const isListingType = (t: DocumentType) => LISTING_TYPES.includes(t);

export interface SourceFacts {
  origin: SourceOrigin;
  documentType: DocumentType;
  /** The term the source describes, if known. */
  term: TermRef | null;
  /** For calendar entries: the academic year of the calendar, e.g. "2026-27". */
  academicYear: string | null;
}

// ---------- Evidence status ----------

export const EVIDENCE_STATUSES = ['confirmed', 'your_materials', 'historical', 'public', 'suggested', 'unconfirmed'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** Higher is stronger evidence that a topic is part of the student's current course. */
export const STATUS_RANK: Record<EvidenceStatus, number> = {
  confirmed: 6,
  your_materials: 5,
  historical: 4,
  public: 3,
  suggested: 2,
  unconfirmed: 1,
};

export const STATUS_META: Record<EvidenceStatus, { label: string; explanation: string }> = {
  confirmed: { label: 'Confirmed', explanation: 'Listed in current course material for your term.' },
  your_materials: { label: 'In your materials', explanation: 'Appears in notes or materials you uploaded for this term.' },
  historical: { label: 'Past versions', explanation: 'Appeared in a previous version of this course. Not confirmed for your term.' },
  public: { label: 'Public resource', explanation: 'Found in a public resource about this course. Not an official course document.' },
  suggested: { label: 'AI suggestion', explanation: 'Suggested by AI as a related concept. No course document supports it.' },
  unconfirmed: { label: 'Unconfirmed', explanation: 'No reliable current source confirms this topic.' },
};

/** How strongly one source supports a topic for the student's term. */
export function classifySource(source: SourceFacts, studentTerm: TermRef): EvidenceStatus {
  switch (source.origin) {
    case 'ai':
      return 'suggested';
    case 'unknown':
      return 'unconfirmed';
    case 'public':
    case 'web':
      return 'public';
  }
  if (source.documentType === 'calendar_entry') {
    if (!source.academicYear) return 'unconfirmed';
    return source.academicYear === academicYear(studentTerm) ? 'confirmed' : 'historical';
  }
  if (!source.term) {
    // Undated material: the student's own notes still count as their materials; anything else is unplaced.
    return source.origin === 'student' ? 'your_materials' : 'unconfirmed';
  }
  if (!sameTerm(source.term, studentTerm)) return 'historical';
  if (source.origin === 'student') return isListingType(source.documentType) ? 'confirmed' : 'your_materials';
  return 'confirmed'; // official or instructor material for this very term
}

/** True when a source is a complete topic listing for the student's term (its omissions are evidence). */
export const isCurrentListing = (s: SourceFacts, studentTerm: TermRef) =>
  isListingType(s.documentType) && s.term !== null && sameTerm(s.term, studentTerm) && s.origin !== 'ai';

// ---------- Topic identity ----------

const FILLER = new Set(['introduction', 'intro', 'to', 'the', 'of', 'and', 'an', 'a', 'in', 'on', 'by', 'basic', 'basics', 'fundamentals', 'theory', 'mathematical', 'elementary', 'overview']);

/** Simple English singularisation for matching ("Sets" ~ "Set", "Proofs" ~ "Proof", "Relations" ~ "Relation"). */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('is') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

/**
 * A matching key for topic names from different sources:
 * "Mathematical Induction" ~ "Induction", "Graph Theory" ~ "Graphs", "Set Theory" ~ "Sets".
 */
export function topicKey(name: string): string {
  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const kept = words.filter((w) => !FILLER.has(w)).map(singular);
  return (kept.length > 0 ? kept : words.map(singular)).join(' ');
}

// ---------- Aggregation ----------

export interface TopicEvidence {
  sourceId: number;
  topicName: string;
  subtopics: string[];
  description: string | null;
  week: number | null;
  scheduledOn: LocalDate | null;
  source: SourceFacts & { title: string };
}

export interface AggregatedTopic {
  key: string;
  /** Display name, taken from the strongest source. */
  name: string;
  status: EvidenceStatus;
  description: string | null;
  week: number | null;
  scheduledOn: LocalDate | null;
  subtopics: string[];
  evidence: { sourceId: number; sourceTitle: string; status: EvidenceStatus }[];
  /** Set when sources disagree about this topic. */
  conflict: string | null;
}

/**
 * Merge every source's topics into one list for the student's term.
 *
 * Current material wins: if a current syllabus or outline exists, a topic it
 * does not list cannot be "Confirmed" by a broader source (e.g. the calendar
 * description), and the disagreement is reported rather than silently resolved.
 */
export function aggregateTopics(evidence: TopicEvidence[], studentTerm: TermRef): AggregatedTopic[] {
  const currentListings = new Set(evidence.filter((e) => isCurrentListing(e.source, studentTerm)).map((e) => e.sourceId));
  const listingTitles = [...new Map(evidence.filter((e) => currentListings.has(e.sourceId)).map((e) => [e.sourceId, e.source.title])).values()];

  const groups = new Map<string, TopicEvidence[]>();
  for (const e of evidence) {
    const key = topicKey(e.topicName);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const topics: AggregatedTopic[] = [];
  for (const [key, items] of groups) {
    const rated = items
      .map((e) => ({ e, status: classifySource(e.source, studentTerm) }))
      .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || (b.e.source.term ? termOrdinal(b.e.source.term) : 0) - (a.e.source.term ? termOrdinal(a.e.source.term) : 0));

    const inCurrentListing = items.some((e) => currentListings.has(e.sourceId));
    let status = rated[0].status;
    let conflict: string | null = null;

    if (currentListings.size > 0 && !inCurrentListing) {
      const others = rated.filter((r) => r.status === 'confirmed' || r.status === 'historical').map((r) => r.e.source.title);
      if (status === 'confirmed') status = 'unconfirmed';
      if (others.length > 0) {
        conflict = `Sources differ: listed in ${joinTitles(others)} but not in ${joinTitles(listingTitles)}.`;
      }
    }

    const best = rated[0].e;
    const subtopics = [...new Map(items.flatMap((e) => e.subtopics).map((s) => [topicKey(s), s])).values()];
    const dated = rated.find((r) => r.status === status && (r.e.week !== null || r.e.scheduledOn !== null))?.e;
    topics.push({
      key,
      name: best.topicName,
      status,
      description: rated.find((r) => r.e.description)?.e.description ?? null,
      week: status === 'confirmed' ? (dated?.week ?? null) : null,
      scheduledOn: status === 'confirmed' ? (dated?.scheduledOn ?? null) : null,
      subtopics,
      evidence: rated.map((r) => ({ sourceId: r.e.sourceId, sourceTitle: r.e.source.title, status: r.status })),
      conflict,
    });
  }

  return topics.sort(
    (a, b) =>
      STATUS_RANK[b.status] - STATUS_RANK[a.status] ||
      (a.week ?? 999) - (b.week ?? 999) ||
      a.name.localeCompare(b.name),
  );
}

function joinTitles(titles: string[]): string {
  const unique = [...new Set(titles)];
  if (unique.length <= 2) return unique.join(' and ');
  return `${unique.slice(0, 2).join(', ')} and ${unique.length - 2} more`;
}

// ---------- Source ranking ----------

/**
 * Reliability tier of a source for the student's term (1 = most reliable).
 * Current official → current instructor → current student → historical official →
 * historical student → open educational resource → general web → AI.
 */
export function sourceTier(source: SourceFacts, studentTerm: TermRef): number {
  const current =
    source.documentType === 'calendar_entry'
      ? source.academicYear === academicYear(studentTerm)
      : source.term !== null && sameTerm(source.term, studentTerm);
  switch (source.origin) {
    case 'official':
      return current ? 1 : 4;
    case 'instructor':
      return current ? 2 : 4;
    case 'student':
      return current || !source.term ? 3 : 5;
    case 'public':
      return 6;
    case 'web':
      return 7;
    case 'ai':
      return 8;
    default:
      return 9;
  }
}

export const TIER_LABEL: Record<number, string> = {
  1: 'Official · current',
  2: 'Instructor · current',
  3: 'Your material',
  4: 'Official · past term',
  5: 'Your material · past term',
  6: 'Open educational resource',
  7: 'General web',
  8: 'AI suggestion',
  9: 'Unknown origin',
};

// ---------- Web result classification ----------

/** Well-known open educational resource hosts. */
export const OER_DOMAINS = [
  'openstax.org',
  'libretexts.org',
  'ocw.mit.edu',
  'open.umn.edu',
  'opentextbc.ca',
  'khanacademy.org',
  'oercommons.org',
  'merlot.org',
  'pressbooks.pub',
  'saylor.org',
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * Classify a URL by rule, never by the page's own claims: the university's own
 * domain is official, known OER hosts are public resources, anything else is web.
 */
export function classifyUrl(url: string, universityDomain: string | null): { origin: SourceOrigin; documentType: DocumentType } {
  const host = hostOf(url);
  if (universityDomain && onDomain(host, universityDomain.toLowerCase().replace(/^www\./, ''))) {
    return { origin: 'official', documentType: 'web_page' };
  }
  if (OER_DOMAINS.some((d) => onDomain(host, d))) return { origin: 'public', documentType: 'oer' };
  return { origin: 'web', documentType: 'web_page' };
}

/** Course codes are compared without spaces or case: "comp1805" = "COMP 1805". */
export const courseCodeKey = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "comp1805" → "COMP 1805" (letters, a space, then the rest). */
export function formatCourseCode(code: string): string {
  const key = courseCodeKey(code);
  const m = /^([A-Z]+)(\d.*)$/.exec(key);
  return m ? `${m[1]} ${m[2]}` : code.trim().toUpperCase();
}
