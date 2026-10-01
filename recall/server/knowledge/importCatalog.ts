/** CLI: add schools/departments/courses from a JSON file shaped like STARTER_CATALOG. */
import { readFileSync } from 'node:fs';
import { openDatabase } from '../db/connection.js';
import { seedCatalog, type CatalogSeed } from './catalog.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run catalog:import -- path/to/catalog.json');
  process.exit(1);
}
const seed = JSON.parse(readFileSync(file, 'utf8')) as CatalogSeed;
if (!Array.isArray(seed.universities)) {
  console.error('The file must contain { "universities": [...] }');
  process.exit(1);
}
const db = openDatabase(process.env.DATABASE_PATH ?? './data/recall.db');
const { added } = seedCatalog(db, seed, new Date().toISOString());
console.log(`Imported ${added} new catalog entries.`);
db.close();
