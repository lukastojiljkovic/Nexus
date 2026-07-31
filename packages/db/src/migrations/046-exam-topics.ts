import type { Migration } from "./migrations.js";

/**
 * Migration 46 — exam topics and the honest planner's block anatomy (ADR-063,
 * STUDY-003/004/005).
 *
 * `exam_topics` is the exam's ranked curriculum, house style of 005/007:
 * UUIDv7 text ids, ISO-8601 text dates, `deleted_at` soft delete, CASCADE from
 * profiles and exams. `sort_order` is the user's RANK — curriculum order AND
 * scope-cut priority, 0 = the list's top = most important; `TopicStore` keeps
 * it contiguous per exam. `confidence` is the user's own 0-100 self-assessment,
 * NULL for unknown (the planner then derives one from the linked deck's FSRS
 * history, or treats the topic as between-low-and-middle). `deck_id` is the
 * topic ↔ flashcard-deck link, `ON DELETE SET NULL` because the link is
 * decoration on the topic — a deck's row going away must not take the
 * curriculum entry with it. `cut` is set ONLY through an explicit user
 * acceptance (`PlanStore.acceptScopeCut`) — never by the machine — and a cut
 * topic is excluded from generation entirely. There is deliberately no
 * `estimated_minutes` in v1 (recorded refusal): a topic's weight derives from
 * its confidence.
 *
 * `study_blocks` is REBUILT (create-copy-drop-rename), not ALTERed. The
 * ALTER-only rule that migration 021 documents for `tasks` exists because that
 * table has children and triggers a rebuild would have to re-wire; it does NOT
 * transfer here, and a rebuild is safe for THIS table specifically because
 * nothing references `study_blocks` (no child table, no trigger, no view) and
 * it has no `deleted_at` — every row is a live generated block whose columns
 * are copied verbatim, and the new columns land on their defaults, which is
 * exactly what every pre-topic block is (an undifferentiated `coverage` block,
 * unpinned, of no topic). The rebuild is what lets the UNIQUE change shape:
 * `UNIQUE(plan_id, block_date)` is REPLACED by uniqueness over
 * `(plan_id, block_date, topic_id, kind)` — one day may now hold one block per
 * (topic, kind). That uniqueness is enforced by the expression index
 * `study_blocks_plan_date_topic_kind` (through `COALESCE(topic_id, '')`)
 * rather than a table constraint, because SQLite treats UNIQUE NULLs as
 * distinct: a plain four-column UNIQUE would quietly stop deduplicating the
 * topicless rows every zero-topic plan writes. `topic_id` is
 * `ON DELETE SET NULL` for the hard-delete paths (restore wipe, profile
 * cascade); a topic's soft delete promotes its blocks' `topic_id` to NULL in
 * `TopicStore` itself.
 *
 * `study_plans.weekday_minutes` is a nullable TEXT column holding a validated
 * JSON 7-vector Mon..Sun (each 0-480, at least one positive) — the per-weekday
 * capacity the engine schedules under. NULL means "every day =
 * daily_minutes", which is every existing plan's exact semantics, so there is
 * no data migration; `daily_minutes` stays as the base the vector defaults
 * from.
 */
export const migration046: Migration = {
  version: 46,
  up(db) {
    db.exec(`
      CREATE TABLE exam_topics (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        exam_id     TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        name        TEXT NOT NULL CHECK (length(name) > 0),
        sort_order  INTEGER NOT NULL,
        confidence  INTEGER CHECK (confidence BETWEEN 0 AND 100),
        deck_id     TEXT REFERENCES decks(id) ON DELETE SET NULL,
        cut         INTEGER NOT NULL DEFAULT 0 CHECK (cut IN (0, 1)),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      );

      -- The hot path is "this exam's live topics, in rank order" (every list
      -- read AND every regeneration); the profile_id prefix keeps the same
      -- index serving the profile-wide gather.
      CREATE INDEX exam_topics_profile_exam_active
        ON exam_topics (profile_id, exam_id, sort_order, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE study_blocks_new (
        id          TEXT PRIMARY KEY,
        plan_id     TEXT NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
        profile_id  TEXT NOT NULL,
        block_date  TEXT NOT NULL,
        minutes     INTEGER NOT NULL CHECK (minutes > 0),
        status      TEXT NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned', 'done', 'missed')),
        topic_id    TEXT REFERENCES exam_topics(id) ON DELETE SET NULL,
        kind        TEXT NOT NULL DEFAULT 'coverage'
                      CHECK (kind IN ('coverage', 'revision', 'recall')),
        pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      INSERT INTO study_blocks_new
        (id, plan_id, profile_id, block_date, minutes, status, created_at, updated_at)
        SELECT id, plan_id, profile_id, block_date, minutes, status, created_at, updated_at
          FROM study_blocks;

      DROP TABLE study_blocks;
      ALTER TABLE study_blocks_new RENAME TO study_blocks;

      -- The replacement uniqueness (see the file doc comment for why COALESCE).
      CREATE UNIQUE INDEX study_blocks_plan_date_topic_kind
        ON study_blocks (plan_id, block_date, COALESCE(topic_id, ''), kind);

      -- Recreated from 007: the calendar-merge read path, unchanged.
      CREATE INDEX study_blocks_profile_date
        ON study_blocks (profile_id, block_date);

      ALTER TABLE study_plans ADD COLUMN weekday_minutes TEXT;
    `);
  },
};
