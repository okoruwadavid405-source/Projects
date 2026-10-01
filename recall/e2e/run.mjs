/**
 * End-to-end check of the core student workflow in a real browser.
 *
 *   npm run build && npm run test:e2e
 *
 * Starts the production server on a throwaway database (or uses E2E_BASE_URL),
 * drives the UI on desktop and mobile viewports, fails on any console error,
 * page error or horizontal overflow, and saves screenshots to e2e/screenshots/.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'e2e', 'screenshots');
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });

const port = 3200 + Math.floor(Math.random() * 500);
let base = process.env.E2E_BASE_URL;
let server;
let tmp;

async function startServer() {
  tmp = mkdtempSync(join(tmpdir(), 'recall-e2e-'));
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'e2e/server.mjs'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), DATABASE_PATH: join(tmp, 'e2e.db'), INSECURE_COOKIES: 'true' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
}

const problems = [];
let step = 0;
function log(msg) {
  console.log(`  ✓ ${msg}`);
}
function check(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${label}] console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${label}] page error: ${e.message}`));
}

async function shot(page, name) {
  await page.screenshot({ path: join(shots, `${String(++step).padStart(2, '0')}-${name}.png`), fullPage: true });
}

async function noHorizontalOverflow(page, where) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(sw <= cw + 1, `${where}: page scrolls horizontally (${sw} > ${cw})`);
}

/** A syllabus for the current term, with class dates around today. */
function makeSyllabus() {
  const now = new Date();
  const m = now.getMonth() + 1;
  const term = m <= 4 ? 'Winter' : m <= 8 ? 'Summer' : 'Fall';
  const label = `${term} ${now.getFullYear()}`;
  const day = (offset) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const weeks = [
    ['Logic', -35, 'propositions, truth tables'],
    ['Predicate Logic', -28, 'quantifiers'],
    ['Sets', -21, 'set notation, power sets'],
    ['Functions', -14, 'injective, surjective'],
    ['Relations', -7, 'equivalence relations, partial orders'],
    ['Proofs', 7, 'direct proof, contradiction'],
    ['Counting', 14, 'permutations, combinations'],
  ];
  const syllabus = [
    'COMP 1805: Discrete Structures I',
    label,
    'Instructor: Dr. Test Instructor',
    '',
    'Weekly Schedule',
    ...weeks.map(([name, offset, subs], i) => `Week ${i + 1} (${day(offset)}): ${name} - ${subs}`),
    '',
    `Midterm Exam (25%) - ${day(10)} - covers Logic, Sets, Functions`,
  ].join('\n');
  return { label, syllabus };
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function desktopFlow(browser) {
  console.log('Desktop (1366×900)');
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');

  await page.goto(`${base}/`);
  await page.waitForURL('**/login');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Name is required.').waitFor();
  log('register form validates empty fields');
  await page.getByLabel('Name').fill('Sam Student');
  await page.getByLabel('Email').fill('sam@example.com');
  await page.getByLabel('Password').fill('study-hard-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText("You don't have any courses yet.").waitFor();
  await shot(page, 'empty-dashboard');
  log('new user sees onboarding empty state');

  // Step 1: create a course
  await page.getByRole('button', { name: 'Add your first course' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create course' }).click();
  await dialog.getByText('Course code is required.').waitFor();
  await dialog.getByLabel('Course code').fill('COMP 1805');
  await dialog.getByLabel('Course name').fill('Discrete Mathematics');
  await dialog.getByLabel('Professor').fill('Dr. Morin');
  await shot(page, 'course-modal');
  await dialog.getByRole('button', { name: 'Create course' }).click();
  await page.getByText('What did you learn recently?').waitFor();
  log('course created');

  // Duplicate course shows a readable error
  await page.goto(`${base}/courses`);
  await page.getByRole('button', { name: 'New course' }).click();
  await dialog.getByLabel('Course code').fill('comp 1805');
  await dialog.getByLabel('Course name').fill('Again');
  await dialog.getByRole('button', { name: 'Create course' }).click();
  await dialog.getByText('You already have a course with the code "comp 1805".').waitFor();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  for (let i = problems.length - 1; i >= 0; i--) if (/409/.test(problems[i])) problems.splice(i, 1);
  log('duplicate course rejected with a friendly message');

  // Steps 2–4: add a topic with questions; schedule is generated automatically
  await page.getByRole('link', { name: 'Add topic' }).first().click();
  await page.getByRole('button', { name: 'Save topic' }).click();
  await page.getByText('Topic is required.').waitFor();
  await page.getByLabel('Topic', { exact: true }).fill('Sets');
  await page.getByLabel('Description').fill('Union, intersection, subset, power sets and set notation.');
  await page.getByLabel('Date learned').fill(isoDaysAgo(1));
  await page.locator('.segmented label', { hasText: 'Good' }).click();
  await page.getByLabel('Question', { exact: true }).fill('What is the union of two sets?');
  await page.getByLabel('Answer', { exact: true }).fill('The set of elements in either set.');
  await page.getByRole('button', { name: 'Add another question' }).click();
  await page.getByLabel('Question', { exact: true }).nth(1).fill('What is the intersection of two sets?');
  await page.getByLabel('Answer', { exact: true }).nth(1).fill('The set of elements common to both sets.');
  await page.getByText('Your review plan').waitFor();
  const planCount = await page.locator('.schedule-dates li').count();
  check(planCount === 5, 'review plan shows 5 projected dates');
  await shot(page, 'new-topic');
  await page.getByRole('button', { name: 'Save topic' }).click();
  await page.getByRole('heading', { name: 'Sets' }).waitFor();
  await page.getByText('Due today').first().waitFor();
  await shot(page, 'topic-detail');
  log('topic created with questions and first review scheduled');

  // Step 5–6: dashboard shows what is due
  await page.getByRole('link', { name: 'Today' }).first().click();
  await page.getByText('1 review due').waitFor();
  await page.getByRole('link', { name: 'Review Sets now' }).waitFor();
  await shot(page, 'dashboard-due');
  log('dashboard shows 1 review due, grouped by course');

  // Steps 7–9: active recall, rating and rescheduling
  await page.getByRole('link', { name: 'Start reviewing' }).click();
  await page.getByRole('button', { name: 'Show answer' }).waitFor();
  await page.getByPlaceholder('Type what you remember…').fill('elements in A or B');
  await shot(page, 'review-question');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.locator('.answer').waitFor();
  await shot(page, 'review-answer');
  await page.locator('.rating-btn.good').click();
  await page.getByRole('button', { name: 'Show answer' }).waitFor();
  await page.keyboard.press('Space');
  await page.locator('.answer').waitFor();
  await page.keyboard.press('4'); // Easy, via keyboard
  await page.getByRole('heading', { name: /Next review in \d+ days/ }).waitFor();
  const resultText = await page.locator('.flashcard').innerText();
  check(/Interval 1 day → 2 days/.test(resultText), `result explains interval change (got: ${resultText})`);
  await shot(page, 'review-result');
  log('active recall review completed (mouse + keyboard), next review scheduled in 2 days');
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByText('Session complete').waitFor();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.getByText("You're all caught up").first().waitFor();
  await shot(page, 'dashboard-caught-up');
  log('dashboard reports all caught up after review');

  // Topic history reflects the review
  await page.goto(`${base}/courses`);
  await page.getByRole('link', { name: /COMP 1805/ }).click();
  await page.getByRole('link', { name: 'Sets' }).click();
  await page.getByText('Gap 1 day → 2 days').waitFor();
  log('review history recorded on the topic');

  // Question CRUD on the topic page
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.locator('.question-draft').getByLabel('Question').fill('What is a power set?');
  await page.locator('.question-draft').getByLabel('Answer').fill('The set of all subsets.');
  await page.locator('.question-draft').getByRole('button', { name: 'Add question' }).click();
  await page.locator('.question-item .q', { hasText: 'What is a power set?' }).waitFor();
  await page.locator('.question-draft').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Edit question: What is a power set?' }).click();
  await page.locator('.question-draft').getByLabel('Answer').fill('The set of all subsets of a set.');
  await page.locator('.question-draft').getByRole('button', { name: 'Save' }).click();
  await page.getByText('The set of all subsets of a set.').waitFor();
  await page.getByRole('button', { name: 'Delete question: What is a power set?' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete question' }).click();
  await page.locator('.question-item .q', { hasText: 'What is a power set?' }).waitFor({ state: 'detached' });
  log('questions added, edited and deleted');

  // Generated questions: drafts on the form, background fill, "generate more", review badges
  await page.getByRole('link', { name: 'Add topic' }).first().click();
  await page.getByLabel('Topic', { exact: true }).fill('Relations');
  await page.getByRole('button', { name: 'Generate questions' }).click();
  await page.locator('.question-draft .badge', { hasText: /Apply it|Explain|Compare|Spot the error|Recall/ }).first().waitFor();
  const generatedCount = await page.locator('.question-draft').count();
  check(generatedCount === 5, `5 generated drafts replace the blank row (got ${generatedCount})`);
  await page.getByRole('button', { name: 'Remove question 5' }).click();
  await shot(page, 'generated-drafts');
  await page.getByRole('button', { name: 'Save topic' }).click();
  await page.getByRole('heading', { name: 'Relations' }).waitFor();
  check((await page.locator('.question-item').count()) === 4, 'the 4 kept drafts are saved');
  log('questions generated as editable drafts on the form, then saved');

  await page.getByRole('link', { name: 'Add topic' }).first().click();
  await page.getByLabel('Topic', { exact: true }).fill('Functions');
  await page.getByRole('button', { name: 'Save topic' }).click();
  await page.getByText('Recall is writing new questions for this topic').waitFor();
  await page.locator('.question-item').nth(4).waitFor();
  await page.getByText('Recall is writing new questions for this topic').waitFor({ state: 'detached' });
  await shot(page, 'auto-generated');
  log('a topic saved without questions is filled automatically in the background');

  await page.getByRole('button', { name: 'Generate more' }).click();
  await page.getByRole('heading', { name: 'Suggested questions' }).waitFor();
  await page.locator('.question-suggestion').first().getByRole('button', { name: /Discard question/ }).click();
  await page.getByRole('button', { name: 'Keep all' }).click();
  await page.getByRole('heading', { name: 'Suggested questions' }).waitFor({ state: 'detached' });
  check((await page.locator('.question-item').count()) === 9, 'kept suggestions are added (5 + 4)');
  log('"Generate more" suggestions can be kept or discarded');

  await page.getByRole('link', { name: 'Review early' }).click();
  await page.locator('.flashcard .badge', { hasText: 'New question' }).waitFor();
  await shot(page, 'review-generated');
  await page.goto(`${base}/`);
  log('review shows the question kind and marks new questions');

  // ===== Course knowledge: school → course → term → syllabus → review → confirm → study → ask =====
  const { label: termName, syllabus } = makeSyllabus();
  await page.getByRole('link', { name: 'Courses' }).first().click();
  await page.getByRole('link', { name: 'Add from your school' }).click();
  await page.getByLabel('Search for your university or college').fill('carleton');
  await page.getByRole('button', { name: /Carleton University/ }).click();
  await page.getByRole('button', { name: /School of Computer Science/ }).click();
  await page.getByLabel('Search by course code or title').fill('1805');
  await page.getByRole('button', { name: /COMP 1805 — Discrete Structures I/ }).click();
  await page.getByRole('heading', { name: 'Which semester?' }).waitFor();
  await shot(page, 'connect-semester');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Do you have your syllabus?' }).waitFor();
  await page.getByLabel('Syllabus file').setInputFiles({ name: 'COMP1805_syllabus.txt', mimeType: 'text/plain', buffer: Buffer.from(syllabus) });
  await page.getByRole('button', { name: 'Build my course profile' }).click();
  log('onboarding: school → department → course → semester → syllabus upload');

  const review = page.getByRole('dialog');
  await review.getByRole('heading', { name: 'Review what Recall found' }).waitFor();
  await review.getByLabel('Include Predicate Logic').waitFor();
  check((await review.getByLabel(/^Include /).count()) === 7, 'review lists the 7 extracted topics');
  await review.getByLabel('Include Predicate Logic').uncheck();
  await shot(page, 'syllabus-review');
  await review.getByRole('button', { name: 'Confirm and save' }).click();
  await review.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Course knowledge profile' }).waitFor();
  await page.getByRole('heading', { name: 'What am I missing?' }).waitFor();
  const missingText = await page.locator('section', { has: page.getByRole('heading', { name: 'What am I missing?' }) }).innerText();
  check(/Graph Theory/.test(missingText) && /Mathematical Induction/.test(missingText) && /not confirmed/.test(missingText), 'historical-only topics listed as unconfirmed');
  check(!/Predicate Logic/.test(await page.locator('#ktopics-title').locator('..').locator('..').innerText()), 'unticked topic was not saved');
  await shot(page, 'course-profile');
  log(`syllabus reviewed and confirmed; ${termName} topics confirmed, past-only topics flagged`);

  // The manually created "Sets" topic (reviewed earlier) is recognised as the student's personal memory.
  const setsRow = page.locator('.ktopic', { has: page.locator('.name', { hasText: /^Sets$/ }) });
  await setsRow.getByRole('link', { name: 'Open Sets in your reviews' }).waitFor();
  log('existing reviews are linked to the matching course topic');

  await page.getByRole('button', { name: 'Start studying Logic' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add to my reviews' }).click();
  await page.getByRole('heading', { name: 'Logic', exact: true }).waitFor();
  await page.locator('.question-item').first().waitFor({ timeout: 15000 });
  log('a confirmed topic was added to reviews with questions written from course material');

  await page.goBack();
  await page.getByRole('button', { name: 'Start studying Graph Theory' }).click();
  const studyDialog = page.getByRole('dialog');
  await studyDialog.getByText('Past versions:').waitFor();
  check(await studyDialog.getByRole('button', { name: 'Add to my reviews' }).isDisabled(), 'past-only topic needs explicit confirmation');
  await studyDialog.getByRole('button', { name: 'Cancel' }).click();
  log('past-version topics cannot be studied by accident');

  await page.getByRole('tab', { name: 'Ask Recall' }).click();
  await page.getByRole('button', { name: 'What should I review today?' }).click();
  await page.locator('.msg.assistant', { hasText: 'Your syllabus lists it as confirmed' }).waitFor();
  await page.locator('.msg.assistant .cites').waitFor();
  await shot(page, 'assistant');
  log('course-aware assistant streams an answer with source citations');

  await page.getByRole('link', { name: 'Today' }).first().click();
  await page.getByRole('heading', { name: 'What should I study?' }).waitFor();
  log('Today shows recommendations with reasons');

  // Demo data, upcoming, progress
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await page.getByRole('button', { name: 'Remove demo data' }).waitFor();
  await page.getByRole('link', { name: 'Today' }).first().click();
  await page.getByText("You're exploring demo data.").waitFor();
  await page.locator('.insight').first().waitFor();
  await shot(page, 'dashboard-demo');
  log('demo data loaded and labelled');

  await page.getByRole('link', { name: 'Upcoming' }).first().click();
  await page.getByText('Weekly workload').waitFor();
  await page.locator('.timeline-day').first().waitFor();
  await shot(page, 'upcoming');
  await page.getByRole('link', { name: 'Progress' }).first().click();
  await page.getByText('Recall accuracy').waitFor();
  await page.getByText('Needs attention').waitFor();
  await shot(page, 'progress');
  log('upcoming timeline and progress stats render');

  // Unknown topic shows a not-found state, not a crash
  await page.goto(`${base}/topics/999999`);
  await page.getByText("We couldn't find that topic").waitFor();
  log('missing topic shows a friendly not-found state');
  // The 404 for the missing topic is expected; drop that console line.
  for (let i = problems.length - 1; i >= 0; i--) if (/404/.test(problems[i])) problems.splice(i, 1);

  // Log out, failed login, log back in
  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: 'Log out' }).last().click();
  await page.waitForURL('**/login');
  await page.getByLabel('Email').fill('sam@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByText('Incorrect email or password.').waitFor();
  for (let i = problems.length - 1; i >= 0; i--) if (/401/.test(problems[i])) problems.splice(i, 1);
  await page.getByLabel('Password').fill('study-hard-123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('heading', { name: /Sam/ }).waitFor();
  log('logout, failed login message, and login work');

  await ctx.close();
}

async function mobileFlow(browser) {
  console.log('Mobile (390×844)');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'mobile');
  await page.goto(`${base}/login`);
  await noHorizontalOverflow(page, 'login');
  await page.getByLabel('Email').fill('sam@example.com');
  await page.getByLabel('Password').fill('study-hard-123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.bottom-nav').waitFor();
  check(!(await page.locator('.sidebar').isVisible()), 'sidebar hidden on mobile');
  await page.locator('.hero').waitFor();
  await page.getByRole('heading', { name: 'What to review today' }).waitFor();
  await noHorizontalOverflow(page, 'today');
  await shot(page, 'mobile-today');

  for (const [name, path, ready] of [
    ['courses', '/courses', 'Courses'],
    ['upcoming', '/upcoming', 'Weekly workload'],
    ['progress', '/progress', 'Where your topics are'],
    ['settings', '/settings', 'Daily reminder'],
    ['new-topic', '/topics/new', 'What did you learn?'],
    ['connect', '/connect', 'Where do you study?'],
  ]) {
    await page.goto(`${base}${path}`);
    await page.getByRole('heading', { name: ready }).first().waitFor();
    await noHorizontalOverflow(page, name);
    await shot(page, `mobile-${name}`);
  }
  log('every main page fits a 390px screen without horizontal scrolling');

  await page.goto(`${base}/courses`);
  await page.getByRole('link', { name: /COMP 1805\b/ }).first().click();
  await page.getByRole('tab', { name: 'Course knowledge' }).click();
  await page.getByRole('heading', { name: 'Course knowledge profile' }).waitFor();
  await noHorizontalOverflow(page, 'course knowledge');
  await shot(page, 'mobile-course-knowledge');
  await page.goto(`${base}/`);
  await page.locator('.bottom-nav').getByRole('link', { name: 'Courses' }).click();
  await page.waitForURL('**/courses');
  await page.goto(`${base}/review`);
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.locator('.rating-btn.good').waitFor();
  await noHorizontalOverflow(page, 'review');
  await shot(page, 'mobile-review');
  log('bottom navigation and review screen work on mobile');
  await ctx.close();
}

let failed = false;
try {
  if (!base) await startServer();
  const browser = await chromium.launch();
  try {
    await desktopFlow(browser);
    await mobileFlow(browser);
  } finally {
    await browser.close();
  }
  if (problems.length) {
    failed = true;
    console.error('\nBrowser problems:\n' + problems.join('\n'));
  } else {
    console.log(`\nAll end-to-end checks passed. Screenshots: ${shots}`);
  }
} catch (err) {
  failed = true;
  console.error('\nE2E failure:', err);
  if (problems.length) console.error(problems.join('\n'));
} finally {
  server?.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
