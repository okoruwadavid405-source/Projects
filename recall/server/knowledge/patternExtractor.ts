/**
 * Rule-based syllabus reader, used when no AI provider is configured (or the AI
 * call fails). It only reports what matches clear patterns — weekly schedules,
 * "Instructor:" lines, term headings, assessment lines — and everything it finds
 * is shown to the student for review before it is saved.
 */
import { isLocalDate, type LocalDate } from '../../shared/dates.js';
import { courseCodeKey, formatCourseCode, TERMS, type Term, type TermRef } from '../../shared/knowledge.js';
import { emptyExtraction, type Extraction } from '../../shared/knowledgeApi.js';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DATE_RE = new RegExp(`(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+)?(?:${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?|(20\\d{2})-(\\d{2})-(\\d{2}))`, 'i');

const NON_TOPIC = /^(reading week|study break|fall break|winter break|no class(es)?|holiday|thanksgiving|family day|review( session)?|tba|tbd|catch[- ]?up|midterm|final exam|exam|test|quiz)\b/i;
const ASSESSMENT = /\b(midterm|final exam|exam|quiz(?:zes)?|assignment|test|project|lab report|presentation|tutorial participation)\b/i;

function parseDate(text: string, termRef: TermRef | null): LocalDate | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (m[4]) {
    [y, mo, d] = [Number(m[4]), Number(m[5]), Number(m[6])];
  } else {
    mo = MONTHS[m[1].toLowerCase().replace('.', '')];
    d = Number(m[2]);
    if (m[3]) y = Number(m[3]);
    else if (termRef) y = termRef.term === 'fall' && mo < 5 ? termRef.year + 1 : termRef.year;
    else return null;
  }
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isLocalDate(iso) ? (iso as LocalDate) : null;
}

const stripDates = (text: string) =>
  text
    .replace(new RegExp(DATE_RE.source, 'gi'), ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(/^[\s,;:|–—-]+|[\s,;:|–—-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

const clean = (s: string) => s.replace(/^[\s•*·▪◦‣-]+/, '').replace(/[\s.;,]+$/, '').trim();

/** "Sets – union, intersection" → ["Sets", ["union", "intersection"]]; "Sets, Relations" → two topics. */
function splitTopicText(raw: string): { name: string; subtopics: string[] }[] {
  const text = clean(stripDates(raw));
  if (!text) return [];
  const sep = /\s*(?::|\s[–—-]\s)\s*/;
  if (sep.test(text)) {
    const [head, ...rest] = text.split(sep);
    const subtopics = rest.join(', ').split(/[,;]/).map(clean).filter(Boolean);
    return head ? [{ name: clean(head), subtopics }] : [];
  }
  const parts = text.includes(',') || text.includes(';') ? text.split(/\s*[,;]\s*(?:and\s+)?|\s+and\s+(?=[^,]*$)/) : [text];
  return parts.map(clean).filter((p) => p.length > 1).map((name) => ({ name, subtopics: [] }));
}

export function extractWithPatterns(text: string, hints: { courseCode: string; studentTerm: TermRef }): Extraction {
  const out = emptyExtraction();
  const lines = text.split('\n').map((l) => l.trim());

  // Course code: prefer the one the student selected if it appears at all.
  const codes = [...text.matchAll(/\b([A-Z]{2,5})[ -]?(\d{3,4}[A-Z0-9]{0,3})\b/g)].map((m) => `${m[1]} ${m[2]}`);
  const wanted = courseCodeKey(hints.courseCode);
  const code = codes.find((c) => courseCodeKey(c) === wanted) ?? codes[0] ?? null;
  out.courseCode = code ? formatCourseCode(code) : null;

  if (out.courseCode) {
    const key = courseCodeKey(out.courseCode);
    for (const line of lines.slice(0, 40)) {
      const idx = courseCodeKey(line).indexOf(key);
      if (idx === -1) continue;
      const after = line.replace(/^.*?\b[A-Z]{2,5}[ -]?\d{3,4}[A-Z0-9]{0,3}\b\s*[:\-–—]?\s*/, '');
      const title = stripDates(after.replace(new RegExp(`\\b(${TERMS.join('|')})\\b\\s*(20\\d{2})?`, 'ig'), '')).replace(/[()|]/g, '').trim();
      if (title.length >= 4 && title.length <= 120 && /[a-z]/i.test(title)) {
        out.courseTitle = title;
        break;
      }
    }
  }

  const termMatch = /\b(fall|autumn|winter|spring|summer)\s*(?:term|semester|session)?\s*,?\s*(20\d{2})\b/i.exec(text);
  if (termMatch) {
    out.term = (termMatch[1].toLowerCase() === 'autumn' ? 'fall' : termMatch[1].toLowerCase()) as Term;
    out.year = Number(termMatch[2]);
  }
  const termRef: TermRef = out.term && out.year ? { term: out.term, year: out.year } : hints.studentTerm;

  const instructor = /^(?:course\s+)?(?:instructor|professor|lecturer|taught by)s?\s*[:\-–]\s*(.+)$/im.exec(text);
  if (instructor) {
    out.instructor = clean(instructor[1].split(/[,(<|]|\s{2,}|\bemail\b|\boffice\b/i)[0]) || null;
  }

  const desc = /course description\s*:?\s*\n?([\s\S]{20,800}?)(\n\s*\n|\n[A-Z][A-Za-z ]{3,40}:?\n)/i.exec(text);
  if (desc) out.description = desc[1].replace(/\s+/g, ' ').trim();

  // Weekly schedule: "Week 3 (Sep 22): Functions – injective, surjective" or table rows "3 | Sep 22 | Functions".
  let inSchedule = false;
  const seen = new Map<string, Extraction['topics'][number]>();
  for (const line of lines) {
    if (/^(course |class |weekly |tentative )?(schedule|calendar|outline|topics)\b/i.test(line)) inSchedule = true;
    let week: number | null = null;
    let rest: string | null = null;
    const labelled = /^(?:week|wk|lecture|module|unit|class)\s*(\d{1,2})\b\s*(?:\(([^)]*)\))?\s*[:.|–—-]?\s*(.*)$/i.exec(line);
    if (labelled) {
      week = Number(labelled[1]);
      rest = [labelled[2] ?? '', labelled[3]].join(' ').trim();
    } else if (inSchedule) {
      const row = /^(\d{1,2})\s*(?:\||\t|\s{2,})\s*(.+)$/.exec(line);
      if (row && Number(row[1]) <= 20) {
        week = Number(row[1]);
        rest = row[2];
      }
    }
    if (week === null || !rest) continue;
    const cells = rest.split(/\s*\|\s*|\t+/).filter(Boolean);
    const date = parseDate(rest, termRef);
    const topicText = cells.length > 1 ? cells.filter((c) => !DATE_RE.test(c) || stripDates(c).length > 3).map(stripDates).join(' – ') : rest;
    if (NON_TOPIC.test(clean(stripDates(topicText)))) continue;
    for (const t of splitTopicText(topicText)) {
      if (t.name.length > 120) continue;
      const k = t.name.toLowerCase();
      const existing = seen.get(k);
      if (existing) {
        existing.subtopics.push(...t.subtopics.filter((s) => !existing.subtopics.includes(s)));
        continue;
      }
      const topic = { name: t.name, description: null, week, date, subtopics: t.subtopics };
      seen.set(k, topic);
      out.topics.push(topic);
    }
  }

  // Learning objectives: bullet lines under an "objectives/outcomes" heading.
  const objIdx = lines.findIndex((l) => /learning (objectives|outcomes)|course objectives/i.test(l));
  if (objIdx !== -1) {
    for (const line of lines.slice(objIdx + 1)) {
      if (!line) {
        if (out.learningObjectives.length > 0) break;
        continue;
      }
      if (/^([-•*·▪◦‣]|\d+[.)])\s+/.test(line)) out.learningObjectives.push(clean(line.replace(/^\d+[.)]\s+/, '')));
      else if (out.learningObjectives.length > 0) break;
    }
  }

  // Assessments: lines naming an assessment with a weight or a date.
  const assessmentNames = new Set<string>();
  for (const line of lines) {
    const kind = ASSESSMENT.exec(line);
    if (!kind || /^(week|wk)\s*\d/i.test(line)) continue;
    const weight = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(line);
    const date = parseDate(line, termRef);
    if (!weight && !date) continue;
    const name = clean(line.split(/\s*[(:|–—]|\s-\s|\s\d{1,3}\s*%/)[0]) || kind[1];
    if (name.length > 80 || assessmentNames.has(name.toLowerCase())) continue;
    assessmentNames.add(name.toLowerCase());
    const covers = /\bcover(?:s|ing)?\s*:?\s*(.+)$/i.exec(line);
    out.assessments.push({
      name,
      kind: kind[1].toLowerCase(),
      date,
      weight: weight ? Number(weight[1]) : null,
      topics: covers ? covers[1].split(/\s*[,;]\s*|\s+and\s+/).map((s) => clean(stripDates(s))).filter((s) => s && !/^weeks?\s*\d/i.test(s)) : [],
    });
  }

  for (const line of lines) {
    const m = /^(?:required\s+)?(?:textbook|text|reading)s?\s*:\s*(.+)$/i.exec(line);
    if (m) out.readings.push(clean(m[1]));
  }
  return out;
}
