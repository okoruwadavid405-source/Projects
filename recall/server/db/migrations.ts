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
  {
    id: 3,
    name: 'course_knowledge',
    sql: /* sql */ `
      -- ===== Global course catalog (shared by everyone) =====
      -- origin: 'catalog' = shipped starter data, 'student' = added by a student (unverified).
      CREATE TABLE universities (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(name) BETWEEN 2 AND 160),
        city       TEXT,
        region     TEXT,
        country    TEXT,
        website    TEXT,
        domain     TEXT,
        origin     TEXT NOT NULL DEFAULT 'student' CHECK (origin IN ('catalog', 'student')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE departments (
        id            INTEGER PRIMARY KEY,
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        name          TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
        origin        TEXT NOT NULL DEFAULT 'student' CHECK (origin IN ('catalog', 'student')),
        created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL,
        UNIQUE (university_id, name COLLATE NOCASE)
      );

      CREATE TABLE catalog_courses (
        id            INTEGER PRIMARY KEY,
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        code          TEXT NOT NULL CHECK (length(code) BETWEEN 2 AND 20),
        code_key      TEXT NOT NULL,
        title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        description   TEXT,
        origin        TEXT NOT NULL DEFAULT 'student' CHECK (origin IN ('catalog', 'student')),
        created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL,
        UNIQUE (university_id, code_key)
      );
      CREATE INDEX idx_catalog_courses_code ON catalog_courses(code_key);

      CREATE TABLE course_versions (
        id         INTEGER PRIMARY KEY,
        course_id  INTEGER NOT NULL REFERENCES catalog_courses(id) ON DELETE CASCADE,
        term       TEXT NOT NULL CHECK (term IN ('winter', 'spring', 'summer', 'fall')),
        year       INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2200),
        created_at TEXT NOT NULL,
        UNIQUE (course_id, term, year)
      );

      -- ===== Evidence =====
      -- A source is one piece of evidence about a course (an outline, a syllabus, a web page, an AI suggestion).
      -- Private sources (student uploads, their AI suggestions and saved links) are visible only to their owner.
      CREATE TABLE sources (
        id                INTEGER PRIMARY KEY,
        course_id         INTEGER NOT NULL REFERENCES catalog_courses(id) ON DELETE CASCADE,
        course_version_id INTEGER REFERENCES course_versions(id) ON DELETE CASCADE,
        origin            TEXT NOT NULL CHECK (origin IN ('official', 'instructor', 'student', 'public', 'web', 'ai', 'unknown')),
        document_type     TEXT NOT NULL,
        title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
        url               TEXT,
        academic_year     TEXT,
        instructor        TEXT,
        summary           TEXT,
        visibility        TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
        owner_user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_demo           INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
        retrieved_at      TEXT,
        created_at        TEXT NOT NULL,
        CHECK (visibility = 'public' OR owner_user_id IS NOT NULL)
      );
      CREATE INDEX idx_sources_course ON sources(course_id, visibility, owner_user_id);

      -- A topic as listed by one source. The same concept from several sources = several rows (matched by topic_key).
      CREATE TABLE knowledge_topics (
        id           INTEGER PRIMARY KEY,
        source_id    INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        parent_id    INTEGER REFERENCES knowledge_topics(id) ON DELETE CASCADE,
        name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
        topic_key    TEXT NOT NULL,
        description  TEXT,
        week         INTEGER,
        scheduled_on TEXT CHECK (scheduled_on IS NULL OR scheduled_on = date(scheduled_on)),
        position     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_knowledge_topics_source ON knowledge_topics(source_id);
      CREATE INDEX idx_knowledge_topics_key ON knowledge_topics(topic_key);

      CREATE TABLE assessments (
        id         INTEGER PRIMARY KEY,
        source_id  INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        kind       TEXT,
        due_on     TEXT CHECK (due_on IS NULL OR due_on = date(due_on)),
        weight     REAL,
        topics     TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX idx_assessments_source ON assessments(source_id);

      -- ===== Personal (per student) =====
      CREATE TABLE student_courses (
        id                INTEGER PRIMARY KEY,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        catalog_course_id INTEGER NOT NULL REFERENCES catalog_courses(id) ON DELETE CASCADE,
        course_version_id INTEGER NOT NULL REFERENCES course_versions(id) ON DELETE CASCADE,
        -- The student's Recall course (where their reviews live).
        course_id         INTEGER NOT NULL UNIQUE,
        created_at        TEXT NOT NULL,
        FOREIGN KEY (course_id, user_id) REFERENCES courses(id, user_id) ON DELETE CASCADE,
        UNIQUE (user_id, course_version_id)
      );

      CREATE TABLE documents (
        id                INTEGER PRIMARY KEY,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_course_id INTEGER NOT NULL REFERENCES student_courses(id) ON DELETE CASCADE,
        source_id         INTEGER REFERENCES sources(id) ON DELETE SET NULL,
        kind              TEXT NOT NULL CHECK (kind IN ('upload', 'web')),
        filename          TEXT NOT NULL,
        url               TEXT,
        mime_type         TEXT,
        byte_size         INTEGER NOT NULL DEFAULT 0,
        document_type     TEXT NOT NULL,
        status            TEXT NOT NULL CHECK (status IN ('processing', 'needs_review', 'confirmed', 'failed')),
        error             TEXT,
        extractor         TEXT CHECK (extractor IS NULL OR extractor IN ('ai', 'pattern')),
        text              TEXT,
        extraction        TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX idx_documents_course ON documents(student_course_id);

      -- Full-text index over the student's own uploaded text, for retrieval. Private by user_id.
      CREATE VIRTUAL TABLE document_chunks USING fts5(
        content, document_id UNINDEXED, user_id UNINDEXED, tokenize = 'porter unicode61'
      );
      CREATE TRIGGER documents_delete_chunks AFTER DELETE ON documents BEGIN
        DELETE FROM document_chunks WHERE document_id = old.id;
      END;

      -- Recall topics can point at a course-knowledge topic (by key) and be pinned as a priority.
      ALTER TABLE topics ADD COLUMN knowledge_key TEXT;
      ALTER TABLE topics ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));
      CREATE INDEX idx_topics_knowledge ON topics(course_id, knowledge_key);

      ALTER TABLE questions ADD COLUMN difficulty TEXT
        CHECK (difficulty IS NULL OR difficulty IN ('foundational', 'intermediate', 'challenging'));
      ALTER TABLE questions ADD COLUMN grounding_source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL;
    `,
  },
];
