import type { Migration } from "./migrations.js";

/**
 * Migration 7 — the STUDY module's exam-planner data layer (PRD: backward
 * planning from the exam date into scheduled study blocks; STUDY piece 3a).
 *
 * Two tables, continuing the house style of 005/006: UUIDv7 text ids, ISO-8601
 * text dates, and `ON DELETE CASCADE` down the chain profiles -> exams ->
 * study_plans -> study_blocks.
 *
 * `study_plans` is a soft-deleted, one-per-exam plan: the partial unique index
 * `study_plans_active_exam` enforces "at most one active plan per exam" —
 * creating a second plan for an exam that already has one, or restoring a plan
 * under an exam that has since gained another, both violate the constraint and
 * are surfaced by `PlanStore` as a `PlanValidationError`, never a raw SQLite
 * error. `study_blocks` are the generated daily study sessions themselves:
 * `block_date` is a bare "YYYY-MM-DD" (matching `exam_date`/`start_date`),
 * `minutes` the length of that day's block, and `status` tracks whether it was
 * completed, missed (set only by `PlanStore.sync`, never by hand), or is still
 * planned. Blocks have **no `deleted_at`** — `PlanStore` regenerates them
 * wholesale as the plan changes or as time passes, and they disappear from
 * active queries once their plan is soft-deleted (every block query joins
 * through active plans).
 *
 * `study_plans_active_exam` is the hot invariant; `study_plans_profile_active`
 * and `study_blocks_profile_date` cover the two read paths: "this profile's
 * active plans" and "this profile's blocks in a date range" (the calendar
 * merge, STUDY-003).
 */
export const migration007: Migration = {
  version: 7,
  up(db) {
    db.exec(`
      CREATE TABLE study_plans (
        id                TEXT PRIMARY KEY,
        profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        exam_id           TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        daily_minutes     INTEGER NOT NULL CHECK (daily_minutes BETWEEN 15 AND 480),
        start_date        TEXT NOT NULL,
        exam_week_boost   INTEGER NOT NULL DEFAULT 1 CHECK (exam_week_boost IN (0, 1)),
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        deleted_at        TEXT
      );

      -- The core invariant: at most one active plan per exam.
      CREATE UNIQUE INDEX study_plans_active_exam
        ON study_plans (exam_id)
        WHERE deleted_at IS NULL;

      -- The hot path is "active plans for one profile". This partial index
      -- covers that query and keeps soft-deleted rows out of it.
      CREATE INDEX study_plans_profile_active
        ON study_plans (profile_id, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE study_blocks (
        id          TEXT PRIMARY KEY,
        plan_id     TEXT NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
        profile_id  TEXT NOT NULL,
        block_date  TEXT NOT NULL,
        minutes     INTEGER NOT NULL CHECK (minutes > 0),
        status      TEXT NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned', 'done', 'missed')),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE (plan_id, block_date)
      );

      -- The hot path is "this profile's blocks in a date range" (the calendar
      -- merge). Blocks have no deleted_at (see file doc comment) — active-plan
      -- scoping happens at the query layer instead.
      CREATE INDEX study_blocks_profile_date
        ON study_blocks (profile_id, block_date);
    `);
  },
};
