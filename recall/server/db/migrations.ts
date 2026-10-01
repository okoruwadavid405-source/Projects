/**
 * Ordered, append-only schema migrations. Never edit a migration that has
 * shipped — add a new one instead.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: /* sql */ `
      CREATE TABLE users (
        id               INTEGER PRIMARY KEY,
        name             TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        email            TEXT    NOT NULL COLLATE NOCASE UNIQUE,
        password_hash    TEXT    NOT NULL,
        timezone         TEXT    NOT NULL DEFAULT 'UTC',
        reminder_enabled INTEGER NOT NULL DEFAULT 0 CHECK (reminder_enabled IN (0, 1)),
        reminder_time    TEXT    NOT NULL DEFAULT '18:00',
        created_at       TEXT    NOT NULL,
        updated_at       TEXT    NOT NULL
      );

      CREATE TABLE sessions (
        token_hash   TEXT    PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT    NOT NULL,
        expires_at   TEXT    NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE courses (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code        TEXT    NOT NULL CHECK (length(code) BETWEEN 1 AND 20),
        name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        professor   TEXT,
        description TEXT,
        color       TEXT    NOT NULL DEFAULT 'indigo',
        is_demo     INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL,
        UNIQUE (user_id, code COLLATE NOCASE),
        UNIQUE (id, user_id)
      );

      -- user_id is denormalised onto topics so every query can be scoped to the
      -- owner with one indexed predicate; the composite foreign key guarantees it
      -- always matches the owning course.
      CREATE TABLE topics (
        id               INTEGER PRIMARY KEY,
        user_id          INTEGER NOT NULL,
        course_id        INTEGER NOT NULL,
        title            TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
        description      TEXT,
        learned_on       TEXT    NOT NULL CHECK (learned_on = date(learned_on)),
        understanding    INTEGER NOT NULL CHECK (understanding BETWEEN 1 AND 5),
        status           TEXT    NOT NULL DEFAULT 'new'
                                 CHECK (status IN ('new', 'learning', 'reviewing', 'mastered')),
        ease             REAL    NOT NULL CHECK (ease BETWEEN 1.3 AND 3.0),
        current_interval INTEGER NOT NULL CHECK (current_interval >= 1),
        next_review_at   TEXT    NOT NULL CHECK (next_review_at = date(next_review_at)),
        last_reviewed_on TEXT    CHECK (last_reviewed_on IS NULL OR last_reviewed_on = date(last_reviewed_on)),
        last_rating      TEXT    CHECK (last_rating IS NULL OR last_rating IN ('forgot', 'hard', 'good', 'easy')),
        review_count     INTEGER NOT NULL DEFAULT 0,
        lapse_count      INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT    NOT NULL,
        updated_at       TEXT    NOT NULL,
        FOREIGN KEY (course_id, user_id) REFERENCES courses(id, user_id) ON DELETE CASCADE ON UPDATE CASCADE,
        UNIQUE (course_id, title COLLATE NOCASE)
      );
      CREATE INDEX idx_topics_user_due ON topics(user_id, next_review_at);
      CREATE INDEX idx_topics_course ON topics(course_id);

      CREATE TABLE questions (
        id         INTEGER PRIMARY KEY,
        topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        prompt     TEXT    NOT NULL CHECK (length(prompt) BETWEEN 1 AND 1000),
        answer     TEXT    NOT NULL CHECK (length(answer) BETWEEN 1 AND 4000),
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
      );
      CREATE INDEX idx_questions_topic ON questions(topic_id);

      CREATE TABLE reviews (
        id                INTEGER PRIMARY KEY,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic_id          INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        client_id         TEXT    NOT NULL,
        reviewed_at       TEXT    NOT NULL,
        review_day        TEXT    NOT NULL CHECK (review_day = date(review_day)),
        rating            TEXT    NOT NULL CHECK (rating IN ('forgot', 'hard', 'good', 'easy')),
        previous_interval INTEGER NOT NULL,
        new_interval      INTEGER NOT NULL,
        previous_ease     REAL    NOT NULL,
        new_ease          REAL    NOT NULL,
        days_overdue      INTEGER NOT NULL DEFAULT 0,
        next_review_at    TEXT    NOT NULL CHECK (next_review_at = date(next_review_at)),
        UNIQUE (topic_id, client_id)
      );
      CREATE INDEX idx_reviews_user_day ON reviews(user_id, review_day);
      CREATE INDEX idx_reviews_topic ON reviews(topic_id, reviewed_at);

      CREATE TABLE review_answers (
        id          INTEGER PRIMARY KEY,
        review_id   INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
        rating      TEXT    NOT NULL CHECK (rating IN ('forgot', 'hard', 'good', 'easy'))
      );
      CREATE INDEX idx_review_answers_review ON review_answers(review_id);
      CREATE INDEX idx_review_answers_question ON review_answers(question_id);
    `,
  },
  {
    id: 2,
    name: 'question_source_and_kind',
    sql: /* sql */ `
      ALTER TABLE questions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'generated'));
      ALTER TABLE questions ADD COLUMN kind TEXT
        CHECK (kind IS NULL OR kind IN ('recall', 'explain', 'apply', 'compare', 'troubleshoot'));
    `,
  },
];
