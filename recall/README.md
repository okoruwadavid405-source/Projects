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
| `QUESTION_MODEL` | `claude-opus-5-5` | Claude model used to write questions |

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

## Data model

`users` · `sessions` · `courses` · `topics` · `questions` · `reviews` · `review_answers`
(schema: `server/db/migrations.ts`)

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
- `node:sqlite` still prints an "experimental" warning on Node 22. The npm scripts suppress it.
