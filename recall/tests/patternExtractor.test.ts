import { describe, expect, it } from 'vitest';
import { extractWithPatterns } from '../server/knowledge/patternExtractor.js';
import { chunkText, parseDocument, UnsupportedDocumentError } from '../server/knowledge/parsers.js';
import { makeDocx, makePdf } from './fixtures/make.js';
import { SYLLABUS_FALL_2026 } from './fixtures/syllabus.js';

const hints = { courseCode: 'COMP 1805', studentTerm: { term: 'fall' as const, year: 2026 } };

describe('pattern extractor', () => {
  const x = extractWithPatterns(SYLLABUS_FALL_2026, hints);

  it('reads course, term and instructor', () => {
    expect(x).toMatchObject({ courseCode: 'COMP 1805', courseTitle: 'Discrete Structures I', term: 'fall', year: 2026, instructor: 'Dr. Alex Example' });
    expect(x.description).toMatch(/^An introduction to discrete mathematics/);
  });

  it('reads the weekly schedule with dates and subtopics, skipping non-topic weeks', () => {
    expect(x.topics.map((t) => t.name)).toEqual(['Logic', 'Predicate Logic', 'Sets', 'Functions', 'Relations', 'Proofs', 'Counting']);
    expect(x.topics[2]).toEqual({
      name: 'Sets',
      description: null,
      week: 3,
      date: '2026-09-23',
      subtopics: ['set notation', 'union', 'intersection', 'power sets'],
    });
  });

  it('reads objectives, assessments and readings', () => {
    expect(x.learningObjectives).toHaveLength(3);
    const midterm = x.assessments.find((a) => a.kind === 'midterm');
    expect(midterm).toEqual({ name: 'Midterm Exam', kind: 'midterm', date: '2026-10-23', weight: 25, topics: ['Logic', 'Sets', 'Functions'] });
    expect(x.assessments.map((a) => a.name)).toContain('Final Exam');
    expect(x.readings).toEqual(['Discrete Mathematics, an open introduction']);
  });

  it('reads table-style schedules and returns nothing invented for unstructured text', () => {
    const table = extractWithPatterns('Course Schedule\n1 | Jan 8 | Limits\n2 | Jan 15 | Derivatives, Chain Rule\n3 | Jan 22 | Midterm', {
      courseCode: 'MATH 1007',
      studentTerm: { term: 'winter', year: 2027 },
    });
    expect(table.topics.map((t) => [t.week, t.name, t.date])).toEqual([
      [1, 'Limits', '2027-01-08'],
      [2, 'Derivatives', '2027-01-15'],
      [2, 'Chain Rule', '2027-01-15'],
    ]);
    const prose = extractWithPatterns('These are my thoughts about the course. I liked it.', hints);
    expect(prose.topics).toEqual([]);
    expect(prose.courseCode).toBeNull();
  });
});

describe('document parser', () => {
  it('extracts text from PDF, DOCX and TXT, detected by content', async () => {
    const pdf = await parseDocument(makePdf(['COMP 1805 Fall 2026', 'Week 1: Logic and more logic and even more']), 'outline.bin');
    expect(pdf).toMatchObject({ kind: 'text', mimeType: 'application/pdf' });
    const docx = await parseDocument(makeDocx(['Week 2: Sets', 'Week 3: Functions']), 'notes.docx');
    expect(docx).toEqual({ kind: 'text', mimeType: expect.stringContaining('wordprocessingml'), text: 'Week 2: Sets\n\nWeek 3: Functions' });
    const txt = await parseDocument(Buffer.from('Week 1: Logic\r\n'), 'syllabus.txt');
    expect(txt).toEqual({ kind: 'text', mimeType: 'text/plain', text: 'Week 1: Logic' });
  });

  it('routes scanned PDFs and images to the AI reader and rejects unsupported files', async () => {
    expect(await parseDocument(makePdf(['']), 'scan.pdf')).toMatchObject({ kind: 'needs_ai', mimeType: 'application/pdf' });
    const png = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(20)]);
    expect(await parseDocument(png, 'photo.png')).toMatchObject({ kind: 'needs_ai', mimeType: 'image/png' });
    await expect(parseDocument(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0]), 'old.doc')).rejects.toThrow(/\.doc files/);
    await expect(parseDocument(Buffer.from([0, 1, 2, 3]), 'x.bin')).rejects.toBeInstanceOf(UnsupportedDocumentError);
    await expect(parseDocument(Buffer.alloc(0), 'empty.txt')).rejects.toThrow(/empty/);
  });

  it('chunks long text on paragraph boundaries', () => {
    const chunks = chunkText(Array.from({ length: 30 }, (_, i) => `Paragraph ${i} `.repeat(10)).join('\n\n'));
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 1500)).toBe(true);
  });
});
