# Recall

**Remember what you learn.** Recall is a spaced-repetition study planner for students. You log what you learned, add a
few questions, and Recall schedules each topic for review at the right time. It then adapts every future date to how
well you actually remembered.

> Learn → Schedule → Recall → Rate → Adapt → Repeat

## Quick start

Requires **Node.js 22.13+**. Recall uses Node's built-in SQLite, so there's no database server or native build step.

```bash
cd recall
npm install
npm run dev          # API on :3001, UI on http://localhost:5173
```

Open http://localhost:5173, create an account, and either add your first course or use **Explore with demo data**.

Production build:

```bash
npm run build        # typecheck + client bundle + compiled server
npm start            # serves API and UI on http://localhost:3001
```

Configuration lives in environment variables (see `.env.example`). The only secret is the optional
`ANTHROPIC_API_KEY` for question generation.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `DATABASE_PATH` | `./data/recall.db` | SQLite file (`:memory:` for throwaway) |
| `NODE_ENV` | — | `production` serves `dist/client` and sets `Secure` cookies |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy (TLS terminator) |
| `INSECURE_COOKIES` | `false` | Allows production mode over plain HTTP (local testing only) |
| `ANTHROPIC_API_KEY` | — | Turns on question generation (see below). Server-side only |
| `QUESTION_GENERATION` | — | `on` to use an `ant auth login` profile instead of a key; `off` to disable |
| `QUESTION_MODEL` / `AI_MODEL` | `claude-opus-5-5` | Claude model used for questions, document reading and the assistant |
| `AI_FEATURES` | — | Same as `QUESTION_GENERATION`, for all AI features |
| `WEB_SEARCH` | on with a key | `off` disables public resource search and page import |

## Tests

```bash
npm test             # scheduler, date/time-zone, API, authorization and reminder tests (Vitest)
npm run build && npm run test:e2e   # real-browser workflow on desktop + mobile (Playwright/Chromium)
```

The E2E run drives the full workflow: register, create a course, add a topic with questions, review it, rate it, and
check the rescheduled date. It then covers question CRUD, demo data, logout/login, and mobile layouts. It fails on any
browser console error or horizontal scrolling, and saves screenshots to `e2e/screenshots/`.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React 19, Vite, TypeScript, React Router, TanStack Query | Fast, standard, typed; Query handles loading/error/refetch states |
| Styling | Hand-written CSS with design tokens | No framework needed; light/dark themes, responsive, accessible focus states |
| API | Express 5, TypeScript, zod | Small and familiar; zod schemas are shared with the client for identical validation |
| Database | SQLite via `node:sqlite` | Zero setup, real relational constraints, transactions and migrations |
| Tests | Vitest, Playwright | Unit + HTTP integration + browser end-to-end |

```
recall/
  shared/       scheduler.ts (the algorithm), dates.ts (calendar math), validation.ts, api.ts (types)
  server/       db/ (connection, migrations) · repositories/ (SQL) · services/ (logic) · routes/ · middleware/
  client/src/   pages/ · components/ · api/ · auth/ · lib/ (formatting, reminders) · styles/
  tests/        Vitest suites          e2e/   Playwright workflow
```

## The review algorithm

`shared/scheduler.ts` implements an SM-2-inspired rule. The server uses it to schedule reviews, and the UI uses the
same code to preview a topic's review plan.

Each topic has an **interval** `I` (days) and an **ease** `E` (1.3–3.0). New topics start with
`E₀ = 1.5 + 0.125 × understanding` (understanding is self-rated 1–5) and a first review the day after they were learned.
When a topic is reviewed, let `s` be its scheduled gap and `o` the number of days it is overdue:

| Rating | New interval | Ease |
| --- | --- | --- |
| Forgot | 1 day | −0.20 (−0.10 if the review was late) |
| Hard | `(s + o/4) × 1.2` | −0.15 |
| Good | `(s + o/2) × E` | — |
| Easy | `(s + o) × E × 1.3` | +0.15 |

Results are rounded, kept within 1–365 days, and ordered `s ≤ Hard < Good < Easy`. Examples:

- **Steady progress:** a student at understanding 4 who always answers "Good" reviews on day 1, 3, 7, 15, 31, 63 after
  learning.
- **Late reviews:** remembering something after its due date earns partial credit for the extra time. Forgetting it
  after a missed review costs only half the usual ease penalty. Missing a day slows a topic down rather than resetting
  it.
- **Early reviews** (such as a same-day review): only the time that actually passed counts. A Good or Easy result never
  pulls the due date earlier.
- **Topics with several questions:** each question is rated, and the topic rating is the mean score
  (Forgot 0 … Easy 3) rounded half-down. When the evidence is split, the review comes sooner.

Stages: **New** (never reviewed), **Learning** (gap under 7 days, or just forgotten), **Reviewing** (7–29 days),
**Mastered** (30+ days). **Due** and **Overdue** are computed live from the student's own calendar date.

### Dates and time zones

Due dates are calendar days (`YYYY-MM-DD`) in the student's time zone, which is detected at sign-up and changeable in
Settings. "Today" is computed on the server with `Intl` for that zone. All date arithmetic goes through integer epoch-day
math in `shared/dates.ts`, so month ends, leap years, year changes and DST are handled without string tricks. Tests
cover midnight in Toronto, Kiritimati's New Year, DST transitions and leap days.

## Generated questions

With Anthropic credentials on the server, Recall writes questions with Claude (`server/services/questionGenerator.ts`,
model `claude-opus-5-5` by default). Questions keep coming in three ways (`server/services/questionFlow.ts`):

1. **On demand.** **Generate questions** on the Add-topic page, and **Generate more** on a topic, return drafts. The
   student keeps, edits or discards each one, and nothing is saved until they do. Pasting lecture notes gives better
   questions; the notes are used for that request only and are never stored.
2. **Automatically for new topics.** A topic saved without questions gets 5 written in the background. The topic page
   shows progress and updates when they're ready.
3. **After every review.** Two fresh questions are added, aimed at whatever the student just rated Forgot or Hard and
   asked from a different angle. Review sessions favour never-asked questions, so each session brings new material.
   This stops at 24 generated questions per topic.

The prompt asks for **neutral** questions (no hints, leading wording, yes/no or multiple choice) that **make the
student think**. At most a quarter are plain recall; the rest ask the student to explain, apply to a concrete example,
compare, or spot the error in a flawed claim. Each comes with a concise model answer to grade against, and is labelled
with its kind in the UI. The student's notes are fenced off as study material, never treated as instructions.

How the request is made:

- Structured JSON output is validated with zod. Empty, oversized and duplicate questions are dropped, and nothing is
  invented to fill gaps.
- If Claude declines a request on safety grounds, it is retried server-side on a fallback model
  (`fallbacks: "default"`). A refusal that persists becomes a friendly message.
- Failures never break a review. On-demand generation is limited to 30 requests per user per hour, since each one is a
  paid API call.
- **Without credentials** the feature is off. The UI hides the buttons, the API answers `503` with a clear message, and
  students write questions by hand as before. Tests use a fake generator, so `npm test` and the E2E run need no key.

## Course knowledge

Recall also builds a **Course Knowledge Profile** for each course a student connects to their school
(Courses → *Add from your school*, or the *Course knowledge* tab on a course). The guiding rule is that **Recall never
"knows" what a course teaches.** It collects *evidence* from sources and shows how strong that evidence is for the
student's own term. The model and its rules live in `shared/knowledge.ts`; the services are in `server/knowledge/`.

```
University → Department → Course → Course version (term + year) → Sources → Topics → Subtopics
                                                                         ↘ Assessments
Student → Student course (their version) → their Recall course → reviews (personal memory)
```

**Evidence statuses** are computed per student, relative to their term, and shown as icon + text throughout the UI and
in the assistant's context:

| Status | When |
| --- | --- |
| Confirmed | Listed in a current-term syllabus or outline (official, the instructor's, or the student's own confirmed syllabus), or the current academic year's official calendar |
| In your materials | From notes or materials the student uploaded for this term |
| Past versions | Listed only in material from another term |
| Public resource | From an open educational resource or a general web page |
| AI suggestion | Suggested by AI; no course document supports it |
| Unconfirmed | Origin unknown, or a broader source lists it but the current syllabus doesn't |

**Conflicts are never resolved silently.** When a current syllabus exists, a topic it doesn't list can't be Confirmed by
an older or broader source. Instead it shows "Sources differ: listed in Fall 2025 outline but not in your Fall 2026
syllabus." **What am I missing?** lists past-version topics with that warning. Sources are ranked from current official
to current instructor, current student material, past official, past student material, open educational resources,
general web, and finally AI. Web results are classified by domain (the school's own domain counts as official), never
by what a page claims about itself.

**Syllabus flow.**
1. Upload a PDF, Word (.docx) or text file; images and scanned PDFs need the AI reader.
2. Text is extracted locally and indexed for retrieval.
3. Claude extracts the course code, term, instructor, weekly topics with dates and subtopics, objectives, assessments,
   readings and terms. Without AI, a pattern-based syllabus reader is used instead.
4. The student reviews and edits the result. Warnings flag a different course code or term, and a different term
   files the document as past-term material.
5. Nothing is used until the student confirms it.

**Studying.** *Start studying* moves a course topic into the existing spaced-repetition engine as a Recall topic linked
by key. Only Confirmed or own-material topics can be added without an explicit "study it anyway". Generated questions
are grounded in that topic's subtopics and the best-matching passages from the student's uploads, and record their
difficulty and source. Reviews, ratings and scheduling are unchanged, and course knowledge is never altered by
personal performance.

**What should I study?** ranks topics using real signals only, each shown with its reasons: due or overdue reviews,
recent Forgot/Hard ratings, pinned priorities, assessments within 21 days that cover the topic, and syllabus topics
already taught but not yet in reviews. Past-version, public and AI topics are never recommended.

**Study assistant (RAG).** Each question is answered after Recall assembles a context block:
- the course, school and term;
- every source with its reliability tier;
- topics grouped by evidence status, plus any conflicts;
- assessments;
- the student's review record, including what they struggled with in the last 14 days;
- the top BM25 passages from their uploads.

The system prompt requires the model to prefer that context, cite `[S1]`/`[D1]`, never state an unconfirmed topic as
course content, and say when information is missing. Answers stream to the browser as Server-Sent Events.

**Resources.** *Search the web* builds queries such as `"Carleton University" COMP 1805 mathematical induction` and
runs them through Claude's server-side web search tool. Results come from the tool's own result blocks, never from
model-written text, and are ranked by the tiers above. Students can save links (metadata only) or *Read topics* from a
page. Page fetching happens on Anthropic's side, and the page text itself is not stored, only the extracted facts and
the link.

**Global vs personal, privacy, copyright.**
- **Shared:** the catalog (schools, departments, courses, versions) and public sources.
- **Private:** everything a student uploads, extracts, saves or asks the AI to suggest. All queries filter
  `visibility = 'public' OR owner = me`, and tests check that another student can't see any of it.
- **Retrieval stays private:** the full-text index of a student's uploads is filtered by owner.
- **Unlinking** a course deletes that student's private course material but keeps their reviews.
- **Student discoveries stay private:** sharing them globally would need moderation, which isn't built.

**Adapters** (`server/knowledge/providers.ts`):

| Adapter | What it does | Implementation |
| --- | --- | --- |
| Course repository | Stores the catalog, versions, sources and topics | `repository.ts` (SQL) |
| Document parser | Reads uploaded files | `parsers.ts` (unpdf, mammoth, file-type detection by content) |
| AI provider | Extraction, suggestions, assistant | `claude.ts` |
| Web search provider | Search and page fetch | `claude.ts` (Claude's server-side web tools) |
| Embedding provider | Semantic retrieval | Interface only, not configured: Anthropic has no embeddings endpoint, so retrieval uses SQLite FTS5 (BM25). Plug in a provider here for semantic search. |
| Reminder channel | Delivers reminders | `server/services/reminders.ts` |

**Starter catalog.** Carleton University, the University of Toronto and the University of Waterloo, with a few course
codes (`server/knowledge/catalog.ts`). It contains **no topics**, and course titles are entered from general knowledge
and labelled unverified. Students can add schools, departments and courses, which are marked "Added by a student". To
add more in bulk:

```bash
npm run catalog:import -- my-schools.json   # { "universities": [{ "name", "city", "website", "domain", "departments": [{ "name", "courses": [{ "code", "title" }] }] }] }
```

## Data model

`users` · `sessions` · `courses` · `topics` · `questions` · `reviews` · `review_answers`, plus course knowledge:
`universities` · `departments` · `catalog_courses` · `course_versions` · `sources` · `knowledge_topics` · `assessments`
· `student_courses` · `documents` · `document_chunks` (FTS5) (schema: `server/db/migrations.ts`, migrations 1–3)

- Topics carry `user_id` alongside `course_id`, enforced by a composite foreign key to `courses(id, user_id)`. Every
  query is scoped by owner, and a topic can never point at another user's course.
- Reviews store the before/after interval and ease, days overdue, and the local review day (for streaks). Per-question
  ratings live in `review_answers`.
- Deleting a course cascades to its topics, questions and reviews. Deleting an account removes everything.
- Indexes: `topics(user_id, next_review_at)` for the dashboard, `reviews(user_id, review_day)` for streaks and activity.

## Security

- Passwords: scrypt (N=2¹⁵) with per-user salt and constant-time comparison. Unknown emails still run a full hash check,
  so response time doesn't reveal which accounts exist.
- Sessions: random 256-bit tokens in `HttpOnly; SameSite=Lax` cookies (`Secure` in production). Only a SHA-256 of each
  token is stored. Sessions expire after 30 days.
- CSRF: writes must be JSON and, if the browser sends an `Origin`, it must match the host.
- Rate limiting on login/register, a strict Content-Security-Policy, and other security headers.
- All SQL uses bound parameters. All input is validated with zod. Errors are converted to friendly messages, and raw
  database errors are only logged on the server.
- The Anthropic key lives only on the server. Generation requests are checked for course and topic ownership.
- Authorization: other users' records return 404. Tests attempt every cross-user read and write.

## Notifications

- **Works now:** Settings → Daily reminder lets students turn reminders on or off and pick a time. While a Recall tab is
  open (even in the background), the browser shows a system notification at that time, e.g. "You have 7 topics waiting
  for review today." The text comes from live data (`GET /api/reminders/digest`). Duplicates across tabs are suppressed.
- **Needs production infrastructure:** reminders when no tab is open require Web Push (a service worker, per-device
  push subscriptions, and a server with **VAPID keys**) or an email provider. The scheduling half is already built and
  tested: `findUsersDueForReminder()` in `server/services/reminders.ts` returns each user whose local reminder time
  falls in a time window and who has reviews due. A production deployment would add a `ReminderChannel`
  implementation and a job that calls it every few minutes. No channel is configured here, and the UI says so.

## Known limitations

- Single-process deployment: the login rate limiter is in-memory, and SQLite suits one server instance. Moving to
  Postgres means replacing the repository layer only.
- There is no password reset or email change, since both need an email provider.
- Questions are text-only (no images or LaTeX rendering).
- Generated questions depend on Claude knowing the subject. Students should check answers against their course
  material, and the UI tells them to. Automatic generation adds API cost per review (two questions); set
  `QUESTION_GENERATION=off` to disable it.
- The Upcoming page shows each topic's *next* review. Later dates depend on future ratings, so they aren't plotted.
- **Course knowledge:**
  - The starter catalog is unverified. This build environment couldn't reach university websites, so no official
    course content ships with Recall; it arrives only from syllabi, imports and public pages.
  - Images and scanned PDFs need the AI reader. The pattern-based reader handles common "Week N: Topic" schedules
    and tables, but not every syllabus layout.
  - Retrieval is keyword-based (BM25) until an embedding provider is added.
- **Not exercised against the live API:** the Claude-backed features (document reading, assistant, web search,
  suggestions, questions). No credentials were available here; they are tested with stand-ins that check request
  shapes and error handling.
- `node:sqlite` still prints an "experimental" warning on Node 22. The npm scripts suppress it.
