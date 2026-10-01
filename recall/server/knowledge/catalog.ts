/**
 * Starter catalog: a few schools and course codes so the course search works out
 * of the box. It deliberately contains NO topics — course content only ever comes
 * from sources (a syllabus, an outline, a public page) with their provenance.
 *
 * Course titles here were entered from general knowledge and have not been checked
 * against an official calendar, so the UI labels them "unverified". More schools
 * can be added with `npm run catalog:import -- file.json` (same shape as below).
 */
import { courseCodeKey, formatCourseCode } from '../../shared/knowledge.js';
import { transaction, type Database } from '../db/connection.js';

export interface CatalogSeed {
  universities: {
    name: string;
    city?: string;
    region?: string;
    country?: string;
    website?: string;
    domain?: string;
    departments: { name: string; courses: { code: string; title: string; description?: string }[] }[];
  }[];
}

export const STARTER_CATALOG: CatalogSeed = {
  universities: [
    {
      name: 'Carleton University',
      city: 'Ottawa',
      region: 'Ontario',
      country: 'Canada',
      website: 'https://carleton.ca',
      domain: 'carleton.ca',
      departments: [
        {
          name: 'School of Computer Science',
          courses: [
            { code: 'COMP 1405', title: 'Introduction to Computer Science I' },
            { code: 'COMP 1406', title: 'Introduction to Computer Science II' },
            { code: 'COMP 1805', title: 'Discrete Structures I' },
            { code: 'COMP 2402', title: 'Abstract Data Types and Algorithms' },
            { code: 'COMP 2804', title: 'Discrete Structures II' },
          ],
        },
        {
          name: 'School of Mathematics and Statistics',
          courses: [
            { code: 'MATH 1007', title: 'Elementary Calculus I' },
            { code: 'STAT 2507', title: 'Introduction to Statistical Modeling I' },
          ],
        },
      ],
    },
    {
      name: 'University of Toronto',
      city: 'Toronto',
      region: 'Ontario',
      country: 'Canada',
      website: 'https://www.utoronto.ca',
      domain: 'utoronto.ca',
      departments: [
        {
          name: 'Department of Computer Science',
          courses: [
            { code: 'CSC 108H1', title: 'Introduction to Computer Programming' },
            { code: 'CSC 165H1', title: 'Mathematical Expression and Reasoning for Computer Science' },
          ],
        },
      ],
    },
    {
      name: 'University of Waterloo',
      city: 'Waterloo',
      region: 'Ontario',
      country: 'Canada',
      website: 'https://uwaterloo.ca',
      domain: 'uwaterloo.ca',
      departments: [
        { name: 'David R. Cheriton School of Computer Science', courses: [{ code: 'CS 135', title: 'Designing Functional Programs' }] },
        { name: 'Faculty of Mathematics', courses: [{ code: 'MATH 135', title: 'Algebra for Honours Mathematics' }] },
      ],
    },
  ],
};

/** Insert catalog entries that don't exist yet. Safe to run on every start. */
export function seedCatalog(db: Database, seed: CatalogSeed, now: string, origin: 'catalog' | 'student' = 'catalog'): { added: number } {
  let added = 0;
  transaction(db, () => {
    for (const u of seed.universities) {
      added += Number(
        db
          .prepare(
            `INSERT OR IGNORE INTO universities (name, city, region, country, website, domain, origin, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(u.name, u.city ?? null, u.region ?? null, u.country ?? null, u.website ?? null, u.domain ?? null, origin, now).changes,
      );
      const uni = db.prepare('SELECT id FROM universities WHERE name = ?').get(u.name) as { id: number };
      for (const d of u.departments) {
        added += Number(
          db
            .prepare('INSERT OR IGNORE INTO departments (university_id, name, origin, created_at) VALUES (?, ?, ?, ?)')
            .run(uni.id, d.name, origin, now).changes,
        );
        const dept = db.prepare('SELECT id FROM departments WHERE university_id = ? AND name = ?').get(uni.id, d.name) as { id: number };
        for (const c of d.courses) {
          added += Number(
            db
              .prepare(
                `INSERT OR IGNORE INTO catalog_courses (university_id, department_id, code, code_key, title, description, origin, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(uni.id, dept.id, formatCourseCode(c.code), courseCodeKey(c.code), c.title, c.description ?? null, origin, now).changes,
          );
        }
      }
    }
  });
  return { added };
}
