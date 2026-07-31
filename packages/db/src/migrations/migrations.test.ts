import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { foldSearchText } from "@nexus/core";
import { MIGRATIONS, NexusDatabase, openDatabase, runMigrations } from "../index.js";

/**
 * Derived, not spelled out sixteen times over: every migration's own suite
 * asserts that a fresh database is stamped with the *latest* version, which is
 * a statement about `MIGRATIONS`, not about any particular number. The number
 * itself is pinned once, just below, so adding a migration is a one-line edit
 * here instead of a sweep through every describe block.
 */
const LATEST_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);

describe("the migration list", () => {
  it("is at version 40 (the profile picture), ascending and gap-free from 1", () => {
    expect(LATEST_VERSION).toBe(40);
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(
      Array.from({ length: LATEST_VERSION }, (_, index) => index + 1),
    );
  });
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-migrate-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tableNames(db: NexusDatabase): string[] {
  return (
    db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function insertProfile(db: NexusDatabase, id: string): void {
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
}

describe("migration 002 — tasks", () => {
  it("creates the tasks table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("tasks");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("is a no-op when reopening an already-migrated database", () => {
    const path = join(dir, "again.db");
    const first = openDatabase({ path });
    insertProfile(first, "p1");
    first.close();

    const second = openDatabase({ path });
    expect(second.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    expect(tableNames(second)).toContain("tasks");
    expect(
      (second.raw.prepare("SELECT count(*) AS n FROM profiles").get() as { n: number }).n,
    ).toBe(1);
    second.close();
  });

  it("enforces the status/completed_at completion invariant with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check.db") });
    insertProfile(db, "p1");
    const now = new Date().toISOString();
    const insert = db.raw.prepare(
      `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    // status 'done' but no completion timestamp -> violates the invariant.
    expect(() => insert.run("t1", "p1", "x", "done", now, now, null)).toThrow();
    // a completion timestamp on a non-done task is equally rejected.
    expect(() => insert.run("t2", "p1", "x", "todo", now, now, now)).toThrow();
    // the consistent combinations are accepted.
    expect(() => insert.run("t3", "p1", "x", "todo", now, now, null)).not.toThrow();
    expect(() => insert.run("t4", "p1", "x", "done", now, now, now)).not.toThrow();
    db.close();
  });

  it("cascades task deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    const now = new Date().toISOString();
    db.raw
      .prepare(
        `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("t1", "p1", "x", "todo", now, now);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM tasks").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 003 — events", () => {
  it("creates the events table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("events");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("enforces the all_day flag with a 0/1 CHECK", () => {
    const db = openDatabase({ path: join(dir, "check.db") });
    insertProfile(db, "p1");
    const now = new Date().toISOString();
    const insert = db.raw.prepare(
      `INSERT INTO events (id, profile_id, title, start_at, all_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    // all_day outside {0, 1} -> rejected by the CHECK.
    expect(() => insert.run("e1", "p1", "x", now, 2, now, now)).toThrow();
    // the two boolean encodings are accepted.
    expect(() => insert.run("e2", "p1", "x", now, 0, now, now)).not.toThrow();
    expect(() => insert.run("e3", "p1", "x", now, 1, now, now)).not.toThrow();
    db.close();
  });

  it("creates the events_profile_active partial index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("events_profile_active");
    db.close();
  });

  it("cascades event deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    const now = new Date().toISOString();
    db.raw
      .prepare(
        `INSERT INTO events (id, profile_id, title, start_at, all_day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("e1", "p1", "x", now, 0, now, now);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 004 — documents", () => {
  const insertDocument = (db: NexusDatabase, id: string, profileId: string, docType: string) =>
    db.raw
      .prepare(
        `INSERT INTO tracked_documents
           (id, profile_id, doc_type, label, expiry_date, reminder_offsets, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, docType, "x", "2027-01-01", "[90]", now(), now());

  const now = () => new Date().toISOString();

  it("creates both document tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("tracked_documents");
    expect(names).toContain("document_renewals");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("rejects a doc_type outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check.db") });
    insertProfile(db, "p1");
    // an unlisted type -> rejected by the CHECK.
    expect(() => insertDocument(db, "d1", "p1", "bogus")).toThrow();
    // an enumerated type is accepted.
    expect(() => insertDocument(db, "d2", "p1", "pasos")).not.toThrow();
    db.close();
  });

  it("creates the documents partial index and the renewals index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("documents_profile_active");
    expect(indexes).toContain("document_renewals_document");
    db.close();
  });

  it("cascades document deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    insertDocument(db, "d1", "p1", "pasos");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM tracked_documents").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades renewal deletion when the owning document is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-renewals.db") });
    insertProfile(db, "p1");
    insertDocument(db, "d1", "p1", "pasos");
    db.raw
      .prepare(
        `INSERT INTO document_renewals (id, document_id, previous_expiry, renewed_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run("r1", "d1", "2025-01-01", now());

    db.raw.prepare("DELETE FROM tracked_documents WHERE id = ?").run("d1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM document_renewals").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 005 — study", () => {
  const now = () => new Date().toISOString();

  const insertSubject = (db: NexusDatabase, id: string, profileId: string, color: string) =>
    db.raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "x", color, now(), now());

  const insertExam = (db: NexusDatabase, id: string, profileId: string, subjectId: string, examType: string) =>
    db.raw
      .prepare(
        `INSERT INTO exams (id, profile_id, subject_id, exam_type, exam_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, subjectId, examType, "2026-09-01", now(), now());

  it("creates both study tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("subjects");
    expect(names).toContain("exams");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("rejects a subject colour outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-color.db") });
    insertProfile(db, "p1");
    // an unlisted colour -> rejected by the CHECK.
    expect(() => insertSubject(db, "s1", "p1", "teal")).toThrow();
    // an enumerated colour is accepted.
    expect(() => insertSubject(db, "s2", "p1", "burgundy")).not.toThrow();
    db.close();
  });

  it("rejects an exam_type outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-type.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1", "jade");
    // an unlisted type -> rejected by the CHECK.
    expect(() => insertExam(db, "e1", "p1", "s1", "esej")).toThrow();
    // an enumerated type is accepted.
    expect(() => insertExam(db, "e2", "p1", "s1", "pismeni")).not.toThrow();
    db.close();
  });

  it("creates the subjects and exams partial indexes", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("subjects_profile_active");
    expect(indexes).toContain("exams_profile_active");
    db.close();
  });

  it("cascades subject and exam deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1", "jade");
    insertExam(db, "e1", "p1", "s1", "pismeni");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM subjects").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM exams").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades exam deletion when the owning subject is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-subject.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1", "jade");
    insertExam(db, "e1", "p1", "s1", "pismeni");

    db.raw.prepare("DELETE FROM subjects WHERE id = ?").run("s1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM exams").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 006 — flashcards", () => {
  const now = () => new Date().toISOString();

  const insertSubject = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "x", "jade", now(), now());

  const insertDeck = (db: NexusDatabase, id: string, profileId: string, subjectId: string) =>
    db.raw
      .prepare(
        `INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, subjectId, "x", now(), now());

  const insertCard = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    deckId: string,
    state: number,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO cards
           (id, profile_id, deck_id, front, back, due, stability, difficulty,
            elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, deckId, "front", "back", now(), 0, 0, 0, 0, 0, 0, 0, state, now(), now());

  const insertReviewLog = (db: NexusDatabase, id: string, profileId: string, cardId: string, rating: number) =>
    db.raw
      .prepare(
        `INSERT INTO review_log
           (id, profile_id, card_id, rating, state, due, stability, difficulty,
            elapsed_days, last_elapsed_days, scheduled_days, learning_steps,
            review, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, cardId, rating, 2, now(), 1, 1, 0, 0, 1, 0, now(), now());

  it("creates all three flashcard tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("decks");
    expect(names).toContain("cards");
    expect(names).toContain("review_log");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("rejects a card state outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-card-state.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
    // an unlisted state -> rejected by the CHECK.
    expect(() => insertCard(db, "c1", "p1", "d1", 4)).toThrow();
    // an enumerated state (0=New..3=Relearning) is accepted.
    expect(() => insertCard(db, "c2", "p1", "d1", 0)).not.toThrow();
    db.close();
  });

  it("rejects a review_log rating outside the closed Grade set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-log-rating.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
    insertCard(db, "c1", "p1", "d1", 0);
    // Manual (0) and anything outside 1-4 -> rejected by the CHECK.
    expect(() => insertReviewLog(db, "l1", "p1", "c1", 0)).toThrow();
    expect(() => insertReviewLog(db, "l2", "p1", "c1", 5)).toThrow();
    // an enumerated Grade (1=Again..4=Easy) is accepted.
    expect(() => insertReviewLog(db, "l3", "p1", "c1", 3)).not.toThrow();
    db.close();
  });

  it("creates the decks/cards partial indexes and the review_log index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("decks_profile_active");
    expect(indexes).toContain("cards_profile_due_active");
    expect(indexes).toContain("cards_profile_deck_active");
    expect(indexes).toContain("review_log_card_review");
    db.close();
  });

  it("cascades deck/card/review_log deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
    insertCard(db, "c1", "p1", "d1", 0);
    insertReviewLog(db, "l1", "p1", "c1", 3);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect((db.raw.prepare("SELECT count(*) AS n FROM decks").get() as { n: number }).n).toBe(0);
    expect((db.raw.prepare("SELECT count(*) AS n FROM cards").get() as { n: number }).n).toBe(0);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM review_log").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades deck deletion when the owning subject is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-subject.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");

    db.raw.prepare("DELETE FROM subjects WHERE id = ?").run("s1");
    expect((db.raw.prepare("SELECT count(*) AS n FROM decks").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it("cascades card deletion when the owning deck is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-deck.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
    insertCard(db, "c1", "p1", "d1", 0);

    db.raw.prepare("DELETE FROM decks WHERE id = ?").run("d1");
    expect((db.raw.prepare("SELECT count(*) AS n FROM cards").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it("cascades review_log deletion when the owning card is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-card.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
    insertCard(db, "c1", "p1", "d1", 0);
    insertReviewLog(db, "l1", "p1", "c1", 3);

    db.raw.prepare("DELETE FROM cards WHERE id = ?").run("c1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM review_log").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 007 — study plans", () => {
  const now = () => new Date().toISOString();

  const insertSubject = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "x", "jade", now(), now());

  const insertExam = (db: NexusDatabase, id: string, profileId: string, subjectId: string) =>
    db.raw
      .prepare(
        `INSERT INTO exams (id, profile_id, subject_id, exam_type, exam_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, subjectId, "pismeni", "2026-09-01", now(), now());

  const insertPlan = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    examId: string,
    dailyMinutes = 30,
    deletedAt: string | null = null,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO study_plans
           (id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, examId, dailyMinutes, "2026-08-01", 1, now(), now(), deletedAt);

  const insertBlock = (
    db: NexusDatabase,
    id: string,
    planId: string,
    profileId: string,
    blockDate: string,
    minutes = 30,
    status = "planned",
  ) =>
    db.raw
      .prepare(
        `INSERT INTO study_blocks
           (id, plan_id, profile_id, block_date, minutes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, planId, profileId, blockDate, minutes, status, now(), now());

  it("creates both study-plan tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("study_plans");
    expect(names).toContain("study_blocks");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("rejects a daily_minutes outside 15..480 with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-minutes.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertExam(db, "e1", "p1", "s1");
    expect(() => insertPlan(db, "pl1", "p1", "e1", 14)).toThrow();
    expect(() => insertPlan(db, "pl2", "p1", "e1", 481)).toThrow();
    expect(() => insertPlan(db, "pl3", "p1", "e1", 15)).not.toThrow();
    db.close();
  });

  it("rejects an exam_week_boost outside {0, 1} with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-boost.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertExam(db, "e1", "p1", "s1");
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO study_plans
             (id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("pl1", "p1", "e1", 30, "2026-08-01", 2, now(), now()),
    ).toThrow();
    db.close();
  });

  it("enforces the one-active-plan-per-exam unique partial index", () => {
    const db = openDatabase({ path: join(dir, "unique-active-exam.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertExam(db, "e1", "p1", "s1");
    insertPlan(db, "pl1", "p1", "e1");
    // a second active plan for the same exam violates the partial unique index.
    expect(() => insertPlan(db, "pl2", "p1", "e1")).toThrow();
    // once the first is soft-deleted, a new active plan for the same exam is fine.
    db.raw.prepare("UPDATE study_plans SET deleted_at = ? WHERE id = ?").run(now(), "pl1");
    expect(() => insertPlan(db, "pl3", "p1", "e1")).not.toThrow();
    db.close();
  });

  it("rejects study_blocks minutes <= 0 with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-block-minutes.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertExam(db, "e1", "p1", "s1");
    insertPlan(db, "pl1", "p1", "e1");
    expect(() => insertBlock(db, "b1", "pl1", "p1", "2026-08-01", 0)).toThrow();
    expect(() => insertBlock(db, "b2", "pl1", "p1", "2026-08-01", 30)).not.toThrow();
    db.close();
  });

  it("rejects a study_blocks status outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-block-status.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertExam(db, "e1", "p1", "s1");
    insertPlan(db, "pl1", "p1", "e1");
    expect(() => insertBlock(db, "b1", "pl1", "p1", "2026-08-01", 30, "bogus")).toThrow();
    expect(() => insertBlock(db, "b2", "pl1", "p1", "2026-08-01", 30, "missed")).not.toThrow();
    db.close();
  });

  it("enforces UNIQUE(plan_id, block_date) on study_blocks", () => {
    const db = openDatabase({ path: join(dir, "unique-block-date.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertExam(db, "e1", "p1", "s1");
    insertPlan(db, "pl1", "p1", "e1");
    insertBlock(db, "b1", "pl1", "p1", "2026-08-01");
    expect(() => insertBlock(db, "b2", "pl1", "p1", "2026-08-01")).toThrow();
    db.close();
  });

  it("creates the study_plans and study_blocks indexes", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("study_plans_active_exam");
    expect(indexes).toContain("study_plans_profile_active");
    expect(indexes).toContain("study_blocks_profile_date");
    db.close();
  });

  it("cascades study_plan and study_block deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertExam(db, "e1", "p1", "s1");
    insertPlan(db, "pl1", "p1", "e1");
    insertBlock(db, "b1", "pl1", "p1", "2026-08-01");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM study_plans").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM study_blocks").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades study_plan deletion when the owning exam is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-exam.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertExam(db, "e1", "p1", "s1");
    insertPlan(db, "pl1", "p1", "e1");

    db.raw.prepare("DELETE FROM exams WHERE id = ?").run("e1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM study_plans").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades study_block deletion when the owning plan is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-plan.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertExam(db, "e1", "p1", "s1");
    insertPlan(db, "pl1", "p1", "e1");
    insertBlock(db, "b1", "pl1", "p1", "2026-08-01");

    db.raw.prepare("DELETE FROM study_plans WHERE id = ?").run("pl1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM study_blocks").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 008 — focus sessions", () => {
  const now = () => new Date().toISOString();

  const insertSubject = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "x", "jade", now(), now());

  const insertSession = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    subjectId: string,
    startedAt: string,
    endedAt: string,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO focus_sessions
           (id, profile_id, subject_id, started_at, ended_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, profileId, subjectId, startedAt, endedAt, now(), now());

  it("creates the focus_sessions table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("focus_sessions");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("rejects ended_at <= started_at with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-order.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    // equal timestamps -> rejected by the CHECK.
    expect(() =>
      insertSession(db, "f1", "p1", "s1", "2026-07-08T12:00:00.000Z", "2026-07-08T12:00:00.000Z"),
    ).toThrow();
    // ended_at before started_at -> rejected.
    expect(() =>
      insertSession(db, "f2", "p1", "s1", "2026-07-08T12:00:00.000Z", "2026-07-08T11:00:00.000Z"),
    ).toThrow();
    // ended_at strictly after started_at -> accepted.
    expect(() =>
      insertSession(db, "f3", "p1", "s1", "2026-07-08T12:00:00.000Z", "2026-07-08T12:30:00.000Z"),
    ).not.toThrow();
    db.close();
  });

  it("creates the focus_sessions_profile_started partial index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("focus_sessions_profile_started");
    db.close();
  });

  it("cascades focus_session deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertSession(db, "f1", "p1", "s1", "2026-07-08T12:00:00.000Z", "2026-07-08T12:30:00.000Z");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM focus_sessions").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades focus_session deletion when the owning subject is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-subject.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertSession(db, "f1", "p1", "s1", "2026-07-08T12:00:00.000Z", "2026-07-08T12:30:00.000Z");

    db.raw.prepare("DELETE FROM subjects WHERE id = ?").run("s1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM focus_sessions").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 009 — notifications", () => {
  const now = () => new Date().toISOString();

  const insertNotification = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    source: string,
    status = "delivered",
  ) =>
    db.raw
      .prepare(
        `INSERT INTO notifications
           (id, profile_id, source, entity_id, occurrence_key, title, body, status,
            snoozed_until, delivered_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(id, profileId, source, "e1", "d-1", "Title", "Body", status, now(), now(), now());

  const insertNtfSettings = (db: NexusDatabase, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO ntf_settings (profile_id, quiet_from, quiet_to, morning_hour, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(profileId, "22:00", "07:00", "08:00", now(), now());

  const insertNtfSourceSetting = (
    db: NexusDatabase,
    profileId: string,
    source: string,
    enabled: number,
  ) =>
    db.raw
      .prepare(`INSERT INTO ntf_source_settings (profile_id, source, enabled) VALUES (?, ?, ?)`)
      .run(profileId, source, enabled);

  it("creates all three notification tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("notifications");
    expect(names).toContain("ntf_settings");
    expect(names).toContain("ntf_source_settings");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("rejects a notifications source outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-source.db") });
    insertProfile(db, "p1");
    // an unlisted source -> rejected by the CHECK.
    expect(() => insertNotification(db, "n1", "p1", "bogus")).toThrow();
    // an enumerated source is accepted.
    expect(() => insertNotification(db, "n2", "p1", "exam")).not.toThrow();
    db.close();
  });

  it("rejects a notifications status outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-status.db") });
    insertProfile(db, "p1");
    // an unlisted status -> rejected by the CHECK.
    expect(() => insertNotification(db, "n1", "p1", "exam", "bogus")).toThrow();
    // each enumerated status is accepted.
    expect(() => insertNotification(db, "n2", "p1", "exam", "delivered")).not.toThrow();
    expect(() => insertNotification(db, "n3", "p1", "document", "snoozed")).not.toThrow();
    expect(() => insertNotification(db, "n4", "p1", "study-day", "dismissed")).not.toThrow();
    db.close();
  });

  it("enforces UNIQUE(profile_id, source, entity_id, occurrence_key) on notifications", () => {
    const db = openDatabase({ path: join(dir, "unique-occurrence.db") });
    insertProfile(db, "p1");
    insertNotification(db, "n1", "p1", "exam");
    // the same (profile, source, entity, occurrence) combination collides.
    expect(() => insertNotification(db, "n2", "p1", "exam")).toThrow();
    db.close();
  });

  it("creates the notifications_profile_status_updated index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("notifications_profile_status_updated");
    db.close();
  });

  it("cascades notification deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-notifications.db") });
    insertProfile(db, "p1");
    insertNotification(db, "n1", "p1", "exam");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM notifications").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("rejects an ntf_source_settings source outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-source-settings.db") });
    insertProfile(db, "p1");
    // an unlisted source -> rejected by the CHECK.
    expect(() => insertNtfSourceSetting(db, "p1", "bogus", 1)).toThrow();
    // an enumerated source is accepted.
    expect(() => insertNtfSourceSetting(db, "p1", "study-day", 1)).not.toThrow();
    db.close();
  });

  it("rejects an ntf_source_settings enabled value outside {0, 1} with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-enabled.db") });
    insertProfile(db, "p1");
    expect(() => insertNtfSourceSetting(db, "p1", "exam", 2)).toThrow();
    expect(() => insertNtfSourceSetting(db, "p1", "exam", 0)).not.toThrow();
    db.close();
  });

  it("cascades ntf_settings and ntf_source_settings deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-settings.db") });
    insertProfile(db, "p1");
    insertNtfSettings(db, "p1");
    insertNtfSourceSetting(db, "p1", "exam", 0);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM ntf_settings").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM ntf_source_settings").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 010 — notes", () => {
  const now = () => new Date().toISOString();

  const insertNote = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO notes (id, profile_id, title, created_at, updated_at, deleted_at)
         VALUES (?, ?, '', ?, ?, NULL)`,
      )
      .run(id, profileId, now(), now());

  const insertUpdate = (db: NexusDatabase, noteId: string, seq: number) =>
    db.raw
      .prepare(
        `INSERT INTO note_updates (note_id, seq, update_blob, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(noteId, seq, Buffer.from([1, 2, 3]), now());

  const insertSnapshot = (db: NexusDatabase, noteId: string) =>
    db.raw
      .prepare(
        `INSERT INTO note_snapshots (note_id, snapshot, plaintext, covered_seq, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(noteId, Buffer.from([4, 5, 6]), "text", 1, now());

  it("creates all three note tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("notes");
    expect(names).toContain("note_updates");
    expect(names).toContain("note_snapshots");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the notes_profile_active partial index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("notes_profile_active");
    db.close();
  });

  it("enforces PRIMARY KEY (note_id, seq) on note_updates", () => {
    const db = openDatabase({ path: join(dir, "unique-seq.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertUpdate(db, "n1", 1);
    // the same (note, seq) pair collides.
    expect(() => insertUpdate(db, "n1", 1)).toThrow();
    // a different seq for the same note is fine.
    expect(() => insertUpdate(db, "n1", 2)).not.toThrow();
    db.close();
  });

  it("allows at most one snapshot row per note", () => {
    const db = openDatabase({ path: join(dir, "unique-snapshot.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertSnapshot(db, "n1");
    expect(() => insertSnapshot(db, "n1")).toThrow();
    db.close();
  });

  it("cascades note deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM notes").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades update and snapshot deletion when the owning note is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-note.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertUpdate(db, "n1", 1);
    insertSnapshot(db, "n1");

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run("n1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_updates").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_snapshots").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 011 — notes organization", () => {
  const now = () => new Date().toISOString();

  const insertNote = (db: NexusDatabase, id: string, profileId: string, folderId: string | null = null) =>
    db.raw
      .prepare(
        `INSERT INTO notes (id, profile_id, title, folder_id, created_at, updated_at, deleted_at)
         VALUES (?, ?, '', ?, ?, ?, NULL)`,
      )
      .run(id, profileId, folderId, now(), now());

  const insertFolder = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    parentId: string | null = null,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO note_folders (id, profile_id, parent_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, profileId, parentId, "x", now(), now());

  const insertTag = (db: NexusDatabase, id: string, profileId: string, name: string) =>
    db.raw
      .prepare(`INSERT INTO note_tags (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, profileId, name, now());

  const insertLink = (db: NexusDatabase, noteId: string, tagId: string) =>
    db.raw
      .prepare(`INSERT INTO note_tag_links (note_id, tag_id) VALUES (?, ?)`)
      .run(noteId, tagId);

  const columnNames = (db: NexusDatabase, table: string): string[] =>
    (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (row) => row.name,
    );

  it("creates all three organization tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("note_folders");
    expect(names).toContain("note_tags");
    expect(names).toContain("note_tag_links");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("adds folder_id and pinned columns to notes, pinned defaulting to 0", () => {
    const db = openDatabase({ path: join(dir, "notes-columns.db") });
    const columns = columnNames(db, "notes");
    expect(columns).toContain("folder_id");
    expect(columns).toContain("pinned");

    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    const row = db.raw
      .prepare("SELECT folder_id, pinned FROM notes WHERE id = ?")
      .get("n1") as { folder_id: string | null; pinned: number };
    expect(row.folder_id).toBeNull();
    expect(row.pinned).toBe(0);
    db.close();
  });

  it("rejects a pinned value outside {0, 1} with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-pinned.db") });
    insertProfile(db, "p1");
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO notes (id, profile_id, title, pinned, created_at, updated_at, deleted_at)
           VALUES (?, ?, '', ?, ?, ?, NULL)`,
        )
        .run("n1", "p1", 2, now(), now()),
    ).toThrow();
    db.close();
  });

  it("creates the note organization indexes", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("note_folders_profile_parent");
    expect(indexes).toContain("note_tags_profile_name");
    expect(indexes).toContain("note_tag_links_tag");
    db.close();
  });

  it("enforces UNIQUE(profile_id, name) on note_tags", () => {
    const db = openDatabase({ path: join(dir, "unique-tag.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertTag(db, "t1", "p1", "važno");
    // the same name in the same profile collides.
    expect(() => insertTag(db, "t2", "p1", "važno")).toThrow();
    // the same name in a different profile is fine.
    expect(() => insertTag(db, "t3", "p2", "važno")).not.toThrow();
    db.close();
  });

  it("enforces PRIMARY KEY (note_id, tag_id) on note_tag_links", () => {
    const db = openDatabase({ path: join(dir, "unique-link.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertTag(db, "t1", "p1", "a");
    insertLink(db, "n1", "t1");
    // the same (note, tag) pair collides.
    expect(() => insertLink(db, "n1", "t1")).toThrow();
    db.close();
  });

  it("cascades folders, tags and links when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertFolder(db, "f1", "p1");
    insertNote(db, "n1", "p1");
    insertTag(db, "t1", "p1", "a");
    insertLink(db, "n1", "t1");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_folders").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_tags").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_tag_links").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades tag links when the owning note is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-note-links.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertTag(db, "t1", "p1", "a");
    insertLink(db, "n1", "t1");

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run("n1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_tag_links").get() as { n: number }).n,
    ).toBe(0);
    // the tag itself survives — only the link is pruned.
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_tags").get() as { n: number }).n,
    ).toBe(1);
    db.close();
  });

  it("cascades tag links when the owning tag is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-tag-links.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertTag(db, "t1", "p1", "a");
    insertLink(db, "n1", "t1");

    db.raw.prepare("DELETE FROM note_tags WHERE id = ?").run("t1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_tag_links").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("SET-NULLs notes.folder_id when the folder row is deleted directly", () => {
    const db = openDatabase({ path: join(dir, "folder-set-null.db") });
    insertProfile(db, "p1");
    insertFolder(db, "f1", "p1");
    insertNote(db, "n1", "p1", "f1");

    db.raw.prepare("DELETE FROM note_folders WHERE id = ?").run("f1");
    const row = db.raw
      .prepare("SELECT folder_id FROM notes WHERE id = ?")
      .get("n1") as { folder_id: string | null };
    expect(row.folder_id).toBeNull();
    // the note itself is untouched.
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM notes").get() as { n: number }).n,
    ).toBe(1);
    db.close();
  });

  it("cascade-deletes child folders when a parent folder row is deleted directly", () => {
    const db = openDatabase({ path: join(dir, "folder-cascade-child.db") });
    insertProfile(db, "p1");
    insertFolder(db, "f1", "p1");
    insertFolder(db, "f2", "p1", "f1");
    insertFolder(db, "f3", "p1", "f2");

    db.raw.prepare("DELETE FROM note_folders WHERE id = ?").run("f1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_folders").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 012 — note links", () => {
  const now = () => new Date().toISOString();

  const insertNote = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO notes (id, profile_id, title, created_at, updated_at, deleted_at)
         VALUES (?, ?, '', ?, ?, NULL)`,
      )
      .run(id, profileId, now(), now());

  const insertLink = (db: NexusDatabase, sourceId: string, targetId: string) =>
    db.raw
      .prepare(`INSERT INTO note_links (source_note_id, target_note_id) VALUES (?, ?)`)
      .run(sourceId, targetId);

  it("creates the note_links table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("note_links");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the note_links_target index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("note_links_target");
    db.close();
  });

  it("enforces PRIMARY KEY (source_note_id, target_note_id) on note_links", () => {
    const db = openDatabase({ path: join(dir, "unique-link.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertNote(db, "n2", "p1");
    insertLink(db, "n1", "n2");
    // the same (source, target) pair collides.
    expect(() => insertLink(db, "n1", "n2")).toThrow();
    db.close();
  });

  it("cascades link deletion when the source note is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-source.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertNote(db, "n2", "p1");
    insertLink(db, "n1", "n2");

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run("n1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_links").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades link deletion when the target note is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-target.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertNote(db, "n2", "p1");
    insertLink(db, "n1", "n2");

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run("n2");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_links").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades both link rows when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertNote(db, "n2", "p1");
    insertLink(db, "n1", "n2");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_links").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 013 — note attachments", () => {
  const now = () => new Date().toISOString();

  const insertNote = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO notes (id, profile_id, title, created_at, updated_at, deleted_at)
         VALUES (?, ?, '', ?, ?, NULL)`,
      )
      .run(id, profileId, now(), now());

  const insertAttachment = (
    db: NexusDatabase,
    id: string,
    noteId: string,
    sizeBytes = 100,
    sha256 = "a".repeat(64),
  ) =>
    db.raw
      .prepare(
        `INSERT INTO note_attachments (id, note_id, file_name, mime, size_bytes, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, noteId, "file.png", "image/png", sizeBytes, sha256, now());

  it("creates the note_attachments table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("note_attachments");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the note_attachments_note and note_attachments_sha indexes", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("note_attachments_note");
    expect(indexes).toContain("note_attachments_sha");
    db.close();
  });

  it("rejects a size_bytes of 0 with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-size.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    // zero -> rejected by the CHECK.
    expect(() => insertAttachment(db, "a1", "n1", 0)).toThrow();
    // a positive size is accepted.
    expect(() => insertAttachment(db, "a2", "n1", 1)).not.toThrow();
    db.close();
  });

  it("cascades attachment deletion when the owning note is hard-deleted", () => {
    const db = openDatabase({ path: join(dir, "cascade-note.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertAttachment(db, "a1", "n1");

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run("n1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_attachments").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades attachment deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertAttachment(db, "a1", "n1");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_attachments").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 014 — note versions", () => {
  const now = () => new Date().toISOString();

  const insertNote = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO notes (id, profile_id, title, created_at, updated_at, deleted_at)
         VALUES (?, ?, '', ?, ?, NULL)`,
      )
      .run(id, profileId, now(), now());

  const insertVersion = (db: NexusDatabase, noteId: string, coveredSeq: number, title = "Naslov") =>
    db.raw
      .prepare(
        `INSERT INTO note_versions (note_id, covered_seq, snapshot, title, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(noteId, coveredSeq, Buffer.from([1, 2, 3]), title, now());

  it("creates the note_versions table with the ADR-015 columns and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("note_versions");
    const columns = (
      db.raw.prepare("PRAGMA table_info(note_versions)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toEqual(
      expect.arrayContaining(["note_id", "covered_seq", "snapshot", "title", "created_at"]),
    );
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("enforces PRIMARY KEY (note_id, covered_seq) on note_versions", () => {
    const db = openDatabase({ path: join(dir, "unique-version.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertVersion(db, "n1", 5);
    // the same (note, covered_seq) pair collides.
    expect(() => insertVersion(db, "n1", 5)).toThrow();
    // a different covered_seq for the same note is fine.
    expect(() => insertVersion(db, "n1", 6)).not.toThrow();
    db.close();
  });

  it("cascades version deletion when the owning note is hard-deleted", () => {
    const db = openDatabase({ path: join(dir, "cascade-note.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertVersion(db, "n1", 1);
    insertVersion(db, "n1", 2);

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run("n1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_versions").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades version deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertVersion(db, "n1", 1);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_versions").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 015 — note templates", () => {
  const now = () => new Date().toISOString();

  const insertTemplate = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    name: string,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO note_templates (id, profile_id, name, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, name, '{"type":"doc"}', now(), now());

  it("creates the note_templates table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("note_templates");
    const columns = (
      db.raw.prepare("PRAGMA table_info(note_templates)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toEqual(
      expect.arrayContaining(["id", "profile_id", "name", "content", "created_at", "updated_at"]),
    );
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("enforces UNIQUE(profile_id, name) on note_templates", () => {
    const db = openDatabase({ path: join(dir, "unique-name.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertTemplate(db, "t1", "p1", "Sastanak");
    // the same name in the same profile collides.
    expect(() => insertTemplate(db, "t2", "p1", "Sastanak")).toThrow();
    // the same name in a different profile is fine.
    expect(() => insertTemplate(db, "t3", "p2", "Sastanak")).not.toThrow();
    db.close();
  });

  it("cascades template deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertTemplate(db, "t1", "p1", "Sastanak");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_templates").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 016 — inline flashcards", () => {
  const now = () => new Date().toISOString();

  const insertSubject = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "x", "jade", now(), now());

  const insertDeck = (db: NexusDatabase, id: string, profileId: string, subjectId: string) =>
    db.raw
      .prepare(
        `INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, subjectId, "x", now(), now());

  const insertNote = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO notes (id, profile_id, title, created_at, updated_at, deleted_at)
         VALUES (?, ?, '', ?, ?, NULL)`,
      )
      .run(id, profileId, now(), now());

  const insertCard = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    deckId: string,
    sourceNoteId: string | null = null,
    sourceBlockKey: string | null = null,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO cards
           (id, profile_id, deck_id, front, back, due, stability, difficulty,
            elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
            created_at, updated_at, source_note_id, source_block_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        profileId,
        deckId,
        "front",
        "back",
        now(),
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        now(),
        now(),
        sourceNoteId,
        sourceBlockKey,
      );

  it("adds source_note_id/source_block_key to cards and card_deck_id to notes, all defaulting to NULL, and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const cardColumns = (
      db.raw.prepare("PRAGMA table_info(cards)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(cardColumns).toEqual(expect.arrayContaining(["source_note_id", "source_block_key"]));
    const noteColumns = (
      db.raw.prepare("PRAGMA table_info(notes)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(noteColumns).toContain("card_deck_id");

    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
    insertCard(db, "c1", "p1", "d1");
    insertNote(db, "n1", "p1");

    const cardRow = db.raw
      .prepare("SELECT source_note_id, source_block_key FROM cards WHERE id = ?")
      .get("c1") as { source_note_id: string | null; source_block_key: string | null };
    expect(cardRow.source_note_id).toBeNull();
    expect(cardRow.source_block_key).toBeNull();

    const noteRow = db.raw.prepare("SELECT card_deck_id FROM notes WHERE id = ?").get("n1") as {
      card_deck_id: string | null;
    };
    expect(noteRow.card_deck_id).toBeNull();

    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("enforces the partial UNIQUE(profile_id, source_note_id, source_block_key), allowing many hand-made cards with source_note_id NULL", () => {
    const db = openDatabase({ path: join(dir, "unique-source-block.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
    insertNote(db, "n1", "p1");

    insertCard(db, "c1", "p1", "d1", "n1", "block-1");
    // the same (profile, note, block key) triple collides.
    expect(() => insertCard(db, "c2", "p1", "d1", "n1", "block-1")).toThrow();
    // a different block key for the same note is fine.
    expect(() => insertCard(db, "c3", "p1", "d1", "n1", "block-2")).not.toThrow();

    // Hand-made cards (source_note_id NULL) never collide with each other —
    // the index is partial precisely so (profile, NULL, NULL) is not a slot.
    expect(() => insertCard(db, "c4", "p1", "d1")).not.toThrow();
    expect(() => insertCard(db, "c5", "p1", "d1")).not.toThrow();
    db.close();
  });

  it("SET NULLs cards.source_note_id when the source note is hard-deleted, keeping the card and its history", () => {
    const db = openDatabase({ path: join(dir, "card-source-set-null.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
    insertNote(db, "n1", "p1");
    insertCard(db, "c1", "p1", "d1", "n1", "block-1");

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run("n1");
    const row = db.raw.prepare("SELECT source_note_id FROM cards WHERE id = ?").get("c1") as {
      source_note_id: string | null;
    };
    expect(row.source_note_id).toBeNull();
    // the card row itself survives — only the source link is cleared.
    expect((db.raw.prepare("SELECT count(*) AS n FROM cards").get() as { n: number }).n).toBe(1);
    db.close();
  });

  it("SET NULLs notes.card_deck_id when the mapped deck is hard-deleted", () => {
    const db = openDatabase({ path: join(dir, "note-deck-set-null.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
    insertNote(db, "n1", "p1");
    db.raw.prepare("UPDATE notes SET card_deck_id = ? WHERE id = ?").run("d1", "n1");

    db.raw.prepare("DELETE FROM decks WHERE id = ?").run("d1");
    const row = db.raw.prepare("SELECT card_deck_id FROM notes WHERE id = ?").get("n1") as {
      card_deck_id: string | null;
    };
    expect(row.card_deck_id).toBeNull();
    db.close();
  });
});

describe("migration 018 — recurrence", () => {
  const now = () => new Date().toISOString();

  const columnNames = (db: NexusDatabase, table: string): string[] =>
    (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (row) => row.name,
    );

  const insertTask = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "x", "todo", now(), now());

  const insertEvent = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO events (id, profile_id, title, start_at, all_day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "x", "2026-07-08", 0, now(), now());

  it("adds recurrence to tasks and events plus recurrence_exdates to events, and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(columnNames(db, "tasks")).toContain("recurrence");
    expect(columnNames(db, "events")).toEqual(
      expect.arrayContaining(["recurrence", "recurrence_exdates"]),
    );
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("defaults a task's and an event's recurrence to NULL and an event's exdates to the empty JSON array", () => {
    const db = openDatabase({ path: join(dir, "defaults.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertEvent(db, "e1", "p1");

    const task = db.raw.prepare("SELECT recurrence FROM tasks WHERE id = ?").get("t1") as {
      recurrence: string | null;
    };
    expect(task.recurrence).toBeNull();

    const event = db.raw
      .prepare("SELECT recurrence, recurrence_exdates FROM events WHERE id = ?")
      .get("e1") as { recurrence: string | null; recurrence_exdates: string };
    expect(event.recurrence).toBeNull();
    expect(event.recurrence_exdates).toBe("[]");
    db.close();
  });

  it("rejects a NULL recurrence_exdates — the column is NOT NULL, so a row always carries at least an empty list", () => {
    const db = openDatabase({ path: join(dir, "exdates-not-null.db") });
    insertProfile(db, "p1");
    insertEvent(db, "e1", "p1");
    expect(() =>
      db.raw.prepare("UPDATE events SET recurrence_exdates = NULL WHERE id = ?").run("e1"),
    ).toThrow();
    db.close();
  });

  it("stores rule JSON verbatim — no SQL CHECK can validate it, which is why the stores are the gate", () => {
    const db = openDatabase({ path: join(dir, "no-json-check.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    // Deliberately nonsense: the schema accepts it, and `TaskStore` is what
    // refuses to read it back (see taskStore.test.ts).
    expect(() =>
      db.raw.prepare("UPDATE tasks SET recurrence = ? WHERE id = ?").run("{not-json", "t1"),
    ).not.toThrow();
    db.close();
  });
});

describe("migration 019 — event reminders", () => {
  type Handle = Database.Database;

  const now = () => new Date().toISOString();

  const columnNames = (raw: Handle, table: string): string[] =>
    (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name);

  const objectNames = (raw: Handle, type: "table" | "index"): string[] =>
    (raw.prepare("SELECT name FROM sqlite_master WHERE type = ?").all(type) as { name: string }[]).map(
      (row) => row.name,
    );

  const seedProfile = (raw: Handle, id: string) =>
    raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, "personal", "P", now());

  const seedEvent = (raw: Handle, id: string, profileId: string) =>
    raw
      .prepare(
        `INSERT INTO events (id, profile_id, title, start_at, all_day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "Sastanak", "2026-07-08T10:00:00.000Z", 0, now(), now());

  const seedNotification = (
    raw: Handle,
    id: string,
    profileId: string,
    source: string,
    occurrenceKey = "d-1",
  ) =>
    raw
      .prepare(
        `INSERT INTO notifications
           (id, profile_id, source, entity_id, occurrence_key, title, body, status,
            snoozed_until, delivered_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'delivered', NULL, ?, ?, ?)`,
      )
      .run(id, profileId, source, "entity-1", occurrenceKey, "Naslov", "Telo", now(), now(), now());

  const seedSourceSetting = (raw: Handle, profileId: string, source: string, enabled: number) =>
    raw
      .prepare("INSERT INTO ntf_source_settings (profile_id, source, enabled) VALUES (?, ?, ?)")
      .run(profileId, source, enabled);

  /**
   * A connection held at exactly `version`, set up the way `openDatabase` sets
   * one up (WAL, foreign keys ON, and `nx_fold` registered — migration 017's
   * backfill calls it). `openDatabase` always migrates to the newest version,
   * so this is the only way to hold a file at an older schema, which is what an
   * upgrade test needs.
   */
  function openAtVersion(path: string, version: number): Handle {
    const raw = new Database(path);
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      raw,
      MIGRATIONS.filter((migration) => migration.version <= version),
    );
    return raw;
  }

  it("adds reminder_offsets to events, defaulting to the empty JSON array, and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(columnNames(db.raw, "events")).toContain("reminder_offsets");

    insertProfile(db, "p1");
    seedEvent(db.raw, "e1", "p1");
    expect(
      db.raw.prepare("SELECT reminder_offsets FROM events WHERE id = ?").get("e1"),
    ).toEqual({ reminder_offsets: "[]" });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("rejects a NULL reminder_offsets — the column is NOT NULL, so a row always carries at least an empty list", () => {
    const db = openDatabase({ path: join(dir, "offsets-not-null.db") });
    insertProfile(db, "p1");
    seedEvent(db.raw, "e1", "p1");
    expect(() =>
      db.raw.prepare("UPDATE events SET reminder_offsets = NULL WHERE id = ?").run("e1"),
    ).toThrow();
    db.close();
  });

  it("widens the notifications source CHECK to accept 'event', still rejecting anything outside the set", () => {
    const db = openDatabase({ path: join(dir, "check-source.db") });
    insertProfile(db, "p1");
    expect(() => seedNotification(db.raw, "n1", "p1", "event")).not.toThrow();
    // the three original sources still pass, and an unlisted one still does not.
    expect(() => seedNotification(db.raw, "n2", "p1", "document", "7")).not.toThrow();
    expect(() => seedNotification(db.raw, "n3", "p1", "exam", "d-0")).not.toThrow();
    expect(() => seedNotification(db.raw, "n4", "p1", "study-day", "day")).not.toThrow();
    expect(() => seedNotification(db.raw, "n5", "p1", "bogus", "x")).toThrow();
    db.close();
  });

  it("widens the ntf_source_settings source CHECK to accept 'event', still rejecting anything outside the set", () => {
    const db = openDatabase({ path: join(dir, "check-source-settings.db") });
    insertProfile(db, "p1");
    expect(() => seedSourceSetting(db.raw, "p1", "event", 0)).not.toThrow();
    expect(() => seedSourceSetting(db.raw, "p1", "bogus", 1)).toThrow();
    // the 0/1 CHECK on `enabled` came back with the rebuilt table too.
    expect(() => seedSourceSetting(db.raw, "p1", "exam", 2)).toThrow();
    db.close();
  });

  it("leaves no rebuild scaffolding behind and keeps the notifications UNIQUE tuple and its index", () => {
    const db = openDatabase({ path: join(dir, "rebuilt.db") });
    const tables = objectNames(db.raw, "table");
    expect(tables).not.toContain("notifications_new");
    expect(tables).not.toContain("ntf_source_settings_new");
    expect(objectNames(db.raw, "index")).toContain("notifications_profile_status_updated");

    insertProfile(db, "p1");
    seedNotification(db.raw, "n1", "p1", "event");
    // the same (profile, source, entity, occurrence) tuple still collides.
    expect(() => seedNotification(db.raw, "n2", "p1", "event")).toThrow();
    db.close();
  });

  it("carries a seeded 018 database's ledger, source settings and events through the rebuild untouched", () => {
    const path = join(dir, "upgrade.db");
    const before = openAtVersion(path, 18);
    seedProfile(before, "p1");
    seedNotification(before, "n1", "p1", "exam");
    seedNotification(before, "n2", "p1", "study-day", "day");
    seedSourceSetting(before, "p1", "document", 0);
    seedEvent(before, "e1", "p1");
    expect(before.pragma("user_version", { simple: true })).toBe(18);
    before.close();

    const db = openDatabase({ path });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    expect(
      db.raw
        .prepare("SELECT id, source, occurrence_key, title, status FROM notifications ORDER BY id")
        .all(),
    ).toEqual([
      { id: "n1", source: "exam", occurrence_key: "d-1", title: "Naslov", status: "delivered" },
      { id: "n2", source: "study-day", occurrence_key: "day", title: "Naslov", status: "delivered" },
    ]);
    expect(db.raw.prepare("SELECT profile_id, source, enabled FROM ntf_source_settings").all()).toEqual([
      { profile_id: "p1", source: "document", enabled: 0 },
    ]);
    // The row that predates the column gains it at its default.
    expect(
      db.raw.prepare("SELECT reminder_offsets FROM events WHERE id = ?").get("e1"),
    ).toEqual({ reminder_offsets: "[]" });

    // The rebuilt table's own constraints and index came back with it...
    expect(objectNames(db.raw, "index")).toContain("notifications_profile_status_updated");
    expect(() => seedNotification(db.raw, "n3", "p1", "exam")).toThrow(); // same UNIQUE tuple as n1
    // ...including the foreign key to `profiles`, cascade and all.
    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM notifications").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM ntf_source_settings").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 020 — people", () => {
  const now = () => new Date().toISOString();

  const insertPerson = (
    db: NexusDatabase,
    overrides: Partial<{
      id: string;
      name: string;
      kind: string;
      month: number;
      day: number;
      year: number | null;
      note: string | null;
    }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO people (id, profile_id, name, kind, month, day, year, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        overrides.id ?? "pe1",
        "p1",
        overrides.name ?? "Marko",
        overrides.kind ?? "birthday",
        overrides.month ?? 3,
        overrides.day ?? 14,
        overrides.year === undefined ? 1990 : overrides.year,
        overrides.note === undefined ? null : overrides.note,
        now(),
        now(),
      );

  it("creates the people table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("people");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("accepts both kinds and rejects anything outside the closed set", () => {
    const db = openDatabase({ path: join(dir, "check-kind.db") });
    insertProfile(db, "p1");
    expect(() => insertPerson(db, { id: "pe1", kind: "birthday" })).not.toThrow();
    expect(() => insertPerson(db, { id: "pe2", kind: "anniversary" })).not.toThrow();
    expect(() => insertPerson(db, { id: "pe3", kind: "imendan" })).toThrow();
    db.close();
  });

  it("bounds month to 1-12 and day to 1-31 with CHECKs", () => {
    const db = openDatabase({ path: join(dir, "check-month-day.db") });
    insertProfile(db, "p1");
    expect(() => insertPerson(db, { id: "pe1", month: 1, day: 1 })).not.toThrow();
    expect(() => insertPerson(db, { id: "pe2", month: 12, day: 31 })).not.toThrow();
    expect(() => insertPerson(db, { id: "pe3", month: 0 })).toThrow();
    expect(() => insertPerson(db, { id: "pe4", month: 13 })).toThrow();
    expect(() => insertPerson(db, { id: "pe5", day: 0 })).toThrow();
    expect(() => insertPerson(db, { id: "pe6", day: 32 })).toThrow();
    db.close();
  });

  it("accepts a (month, day) pair that is no real calendar day — the store is the gate for that", () => {
    const db = openDatabase({ path: join(dir, "pair-uncheckable.db") });
    insertProfile(db, "p1");
    // 31 April breaks no per-column range, so no CHECK can refuse it; see the
    // migration's doc comment and `peopleStore.test.ts`.
    expect(() => insertPerson(db, { month: 4, day: 31 })).not.toThrow();
    db.close();
  });

  it("leaves year and note nullable — an unknown birth year is a normal person", () => {
    const db = openDatabase({ path: join(dir, "nullable.db") });
    insertProfile(db, "p1");
    insertPerson(db, { year: null, note: null });
    expect(db.raw.prepare("SELECT year, note FROM people WHERE id = ?").get("pe1")).toEqual({
      year: null,
      note: null,
    });
    db.close();
  });

  it("cascades a person's deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    insertPerson(db);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect((db.raw.prepare("SELECT count(*) AS n FROM people").get() as { n: number }).n).toBe(0);
    db.close();
  });
});

describe("migration 021 — task reminders", () => {
  type Handle = Database.Database;

  const now = () => new Date().toISOString();

  const columnNames = (raw: Handle, table: string): string[] =>
    (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name);

  const objectNames = (raw: Handle, type: "table" | "index"): string[] =>
    (raw.prepare("SELECT name FROM sqlite_master WHERE type = ?").all(type) as { name: string }[]).map(
      (row) => row.name,
    );

  const seedProfile = (raw: Handle, id: string) =>
    raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, "personal", "P", now());

  const seedTask = (raw: Handle, id: string, profileId: string) =>
    raw
      .prepare(
        `INSERT INTO tasks (id, profile_id, title, status, due_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "Zadatak", "todo", "2026-08-10", now(), now());

  const seedNotification = (
    raw: Handle,
    id: string,
    profileId: string,
    source: string,
    occurrenceKey = "d-1",
  ) =>
    raw
      .prepare(
        `INSERT INTO notifications
           (id, profile_id, source, entity_id, occurrence_key, title, body, status,
            snoozed_until, delivered_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'delivered', NULL, ?, ?, ?)`,
      )
      .run(id, profileId, source, "entity-1", occurrenceKey, "Naslov", "Telo", now(), now(), now());

  const seedSourceSetting = (raw: Handle, profileId: string, source: string, enabled: number) =>
    raw
      .prepare("INSERT INTO ntf_source_settings (profile_id, source, enabled) VALUES (?, ?, ?)")
      .run(profileId, source, enabled);

  /** As migration 019's own helper: a connection held at exactly `version`, set up the way `openDatabase` sets one up. */
  function openAtVersion(path: string, version: number): Handle {
    const raw = new Database(path);
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      raw,
      MIGRATIONS.filter((migration) => migration.version <= version),
    );
    return raw;
  }

  it("adds reminder_offsets to tasks, defaulting to the empty JSON array, and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(columnNames(db.raw, "tasks")).toContain("reminder_offsets");

    insertProfile(db, "p1");
    seedTask(db.raw, "t1", "p1");
    expect(db.raw.prepare("SELECT reminder_offsets FROM tasks WHERE id = ?").get("t1")).toEqual({
      reminder_offsets: "[]",
    });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("rejects a NULL reminder_offsets — the column is NOT NULL, so a row always carries at least an empty list", () => {
    const db = openDatabase({ path: join(dir, "task-offsets-not-null.db") });
    insertProfile(db, "p1");
    seedTask(db.raw, "t1", "p1");
    expect(() =>
      db.raw.prepare("UPDATE tasks SET reminder_offsets = NULL WHERE id = ?").run("t1"),
    ).toThrow();
    db.close();
  });

  it("stores the ladder JSON verbatim — no SQL CHECK can validate it, which is why TaskStore is the gate", () => {
    const db = openDatabase({ path: join(dir, "task-offsets-no-check.db") });
    insertProfile(db, "p1");
    seedTask(db.raw, "t1", "p1");
    // Deliberately nonsense: the schema accepts it, and `TaskStore` is what
    // refuses to read it back (see taskStore.test.ts).
    expect(() =>
      db.raw.prepare("UPDATE tasks SET reminder_offsets = ? WHERE id = ?").run("[-5]", "t1"),
    ).not.toThrow();
    db.close();
  });

  it("widens the notifications source CHECK to accept 'task', still rejecting anything outside the set", () => {
    const db = openDatabase({ path: join(dir, "check-source-task.db") });
    insertProfile(db, "p1");
    expect(() => seedNotification(db.raw, "n1", "p1", "task", "2026-08-10 3")).not.toThrow();
    // the four earlier sources still pass, and an unlisted one still does not.
    expect(() => seedNotification(db.raw, "n2", "p1", "document", "7")).not.toThrow();
    expect(() => seedNotification(db.raw, "n3", "p1", "exam", "d-0")).not.toThrow();
    expect(() => seedNotification(db.raw, "n4", "p1", "study-day", "day")).not.toThrow();
    expect(() => seedNotification(db.raw, "n5", "p1", "event", "2026-08-01 15")).not.toThrow();
    expect(() => seedNotification(db.raw, "n6", "p1", "bogus", "x")).toThrow();
    db.close();
  });

  it("widens the ntf_source_settings source CHECK to accept 'task', still rejecting anything outside the set", () => {
    const db = openDatabase({ path: join(dir, "check-source-settings-task.db") });
    insertProfile(db, "p1");
    expect(() => seedSourceSetting(db.raw, "p1", "task", 0)).not.toThrow();
    expect(() => seedSourceSetting(db.raw, "p1", "bogus", 1)).toThrow();
    // the 0/1 CHECK on `enabled` came back with the rebuilt table too.
    expect(() => seedSourceSetting(db.raw, "p1", "event", 2)).toThrow();
    db.close();
  });

  it("leaves no rebuild scaffolding behind and keeps the notifications UNIQUE tuple and its index", () => {
    const db = openDatabase({ path: join(dir, "rebuilt-021.db") });
    const tables = objectNames(db.raw, "table");
    expect(tables).not.toContain("notifications_new");
    expect(tables).not.toContain("ntf_source_settings_new");
    expect(objectNames(db.raw, "index")).toContain("notifications_profile_status_updated");

    insertProfile(db, "p1");
    seedNotification(db.raw, "n1", "p1", "task", "2026-08-10 3");
    // the same (profile, source, entity, occurrence) tuple still collides.
    expect(() => seedNotification(db.raw, "n2", "p1", "task", "2026-08-10 3")).toThrow();
    db.close();
  });

  it("carries a seeded 020 database's ledger, source settings and tasks through the rebuild untouched", () => {
    const path = join(dir, "upgrade-021.db");
    const before = openAtVersion(path, 20);
    seedProfile(before, "p1");
    seedNotification(before, "n1", "p1", "exam");
    seedNotification(before, "n2", "p1", "event", "2026-08-01 15");
    seedSourceSetting(before, "p1", "study-day", 0);
    seedTask(before, "t1", "p1");
    expect(before.pragma("user_version", { simple: true })).toBe(20);
    before.close();

    const db = openDatabase({ path });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    expect(
      db.raw
        .prepare("SELECT id, source, occurrence_key, title, status FROM notifications ORDER BY id")
        .all(),
    ).toEqual([
      { id: "n1", source: "exam", occurrence_key: "d-1", title: "Naslov", status: "delivered" },
      { id: "n2", source: "event", occurrence_key: "2026-08-01 15", title: "Naslov", status: "delivered" },
    ]);
    expect(db.raw.prepare("SELECT profile_id, source, enabled FROM ntf_source_settings").all()).toEqual([
      { profile_id: "p1", source: "study-day", enabled: 0 },
    ]);
    // The row that predates the column gains it at its default.
    expect(db.raw.prepare("SELECT reminder_offsets FROM tasks WHERE id = ?").get("t1")).toEqual({
      reminder_offsets: "[]",
    });

    // The rebuilt table's own constraints and index came back with it...
    expect(objectNames(db.raw, "index")).toContain("notifications_profile_status_updated");
    expect(() => seedNotification(db.raw, "n3", "p1", "exam")).toThrow(); // same UNIQUE tuple as n1
    // ...including the foreign key to `profiles`, cascade and all.
    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM notifications").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM ntf_source_settings").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 022 — task lists", () => {
  type Handle = Database.Database;

  const now = () => new Date().toISOString();

  const columnNames = (raw: Handle, table: string): string[] =>
    (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name);

  const seedProfile = (raw: Handle, id: string) =>
    raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, "personal", "P", now());

  /** A task seeded straight into the table, `created_at` supplied so the backfill's ordering is observable. */
  const seedTask = (raw: Handle, id: string, profileId: string, createdAt: string) =>
    raw
      .prepare(
        `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'todo', ?, ?)`,
      )
      .run(id, profileId, `Zadatak ${id}`, createdAt, createdAt);

  const insertList = (
    db: NexusDatabase,
    overrides: Partial<{
      id: string;
      parentId: string | null;
      name: string;
      isInbox: number;
      defaultView: string;
      position: number;
    }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO task_lists
           (id, profile_id, parent_id, name, is_inbox, default_view, position, created_at, updated_at)
         VALUES (?, 'p1', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        overrides.id ?? "tl1",
        overrides.parentId === undefined ? null : overrides.parentId,
        overrides.name ?? "Lista",
        overrides.isInbox ?? 0,
        overrides.defaultView ?? "list",
        overrides.position ?? 1024,
        now(),
        now(),
      );

  /** As migration 021's own helper: a connection held at exactly `version`, set up the way `openDatabase` sets one up. */
  function openAtVersion(path: string, version: number): Handle {
    const raw = new Database(path);
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      raw,
      MIGRATIONS.filter((migration) => migration.version <= version),
    );
    return raw;
  }

  it("creates both tables, adds the three task columns, and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("task_lists");
    expect(tableNames(db)).toContain("task_sections");
    expect(columnNames(db.raw, "tasks")).toEqual(
      expect.arrayContaining(["list_id", "section_id", "position"]),
    );
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("defaults position to 0 and leaves list_id/section_id null for a raw insert — TaskStore is the gate", () => {
    const db = openDatabase({ path: join(dir, "task-defaults.db") });
    insertProfile(db, "p1");
    seedTask(db.raw, "t1", "p1", now());
    expect(
      db.raw.prepare("SELECT list_id, section_id, position FROM tasks WHERE id = ?").get("t1"),
    ).toEqual({ list_id: null, section_id: null, position: 0 });
    db.close();
  });

  it("bounds is_inbox to 0/1 and default_view to the closed list/kanban set with CHECKs", () => {
    const db = openDatabase({ path: join(dir, "check-list.db") });
    insertProfile(db, "p1");
    expect(() => insertList(db, { id: "tl1", isInbox: 1, defaultView: "kanban" })).not.toThrow();
    expect(() => insertList(db, { id: "tl2", isInbox: 0, defaultView: "list" })).not.toThrow();
    expect(() => insertList(db, { id: "tl3", isInbox: 2 })).toThrow();
    expect(() => insertList(db, { id: "tl4", defaultView: "gantt" })).toThrow();
    db.close();
  });

  it("accepts a negative position — a sort key is not a count, and prepending walks below zero", () => {
    const db = openDatabase({ path: join(dir, "negative-position.db") });
    insertProfile(db, "p1");
    expect(() => insertList(db, { id: "tl1", position: -2048 })).not.toThrow();
    db.close();
  });

  it("refuses a parent_id, list_id or section_id that references nothing", () => {
    const db = openDatabase({ path: join(dir, "fk-list.db") });
    insertProfile(db, "p1");
    expect(() => insertList(db, { id: "tlx", parentId: "ghost" })).toThrow();

    insertList(db, { id: "tl1" });
    seedTask(db.raw, "t1", "p1", now());
    expect(() =>
      db.raw.prepare("UPDATE tasks SET list_id = ? WHERE id = ?").run("ghost", "t1"),
    ).toThrow();
    expect(() =>
      db.raw.prepare("UPDATE tasks SET section_id = ? WHERE id = ?").run("ghost", "t1"),
    ).toThrow();
    db.close();
  });

  it("cascades lists (and, through them, sections) when the owning profile is removed, task and all", () => {
    const db = openDatabase({ path: join(dir, "cascade-lists.db") });
    insertProfile(db, "p1");
    insertList(db, { id: "tl1" });
    db.raw
      .prepare(
        `INSERT INTO task_sections (id, list_id, name, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("ts1", "tl1", "Danas", 1024, now(), now());
    // A task placed INSIDE that section: the profile's delete reaches `tasks`
    // and `task_lists` directly and `task_sections` only through the latter, so
    // this is the shape that would trip on the order the cascades run in.
    seedTask(db.raw, "t1", "p1", now());
    db.raw
      .prepare("UPDATE tasks SET list_id = 'tl1', section_id = 'ts1' WHERE id = ?")
      .run("t1");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    for (const table of ["tasks", "task_lists", "task_sections"]) {
      const { n } = db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      expect({ table, n }).toEqual({ table, n: 0 });
    }
    db.close();
  });

  it("backfills one Inbox per existing profile and files every task into it, gap-spaced in created_at order", () => {
    const path = join(dir, "upgrade-022.db");
    const before = openAtVersion(path, 21);
    seedProfile(before, "p1");
    seedProfile(before, "p2");
    // Deliberately inserted out of order, so the backfill's `created_at, id`
    // sort is what the positions below prove — not the insertion order.
    seedTask(before, "t2", "p1", "2026-01-02T00:00:00.000Z");
    seedTask(before, "t1", "p1", "2026-01-01T00:00:00.000Z");
    seedTask(before, "t3", "p1", "2026-01-03T00:00:00.000Z");
    seedTask(before, "t4", "p2", "2026-01-01T00:00:00.000Z");
    // A soft-deleted task is backfilled too: restoring it later must not
    // resurrect a row with no list to sit in.
    seedTask(before, "t5", "p1", "2026-01-04T00:00:00.000Z");
    before.prepare("UPDATE tasks SET deleted_at = ? WHERE id = ?").run(now(), "t5");
    expect(before.pragma("user_version", { simple: true })).toBe(21);
    before.close();

    const db = openDatabase({ path });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);

    const inboxes = db.raw
      .prepare(
        `SELECT id, profile_id, name, is_inbox, default_view, position, created_at, updated_at, deleted_at
         FROM task_lists ORDER BY profile_id`,
      )
      .all() as {
      id: string;
      profile_id: string;
      name: string;
      is_inbox: number;
      default_view: string;
      position: number;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
    }[];
    expect(inboxes.map((row) => row.profile_id)).toEqual(["p1", "p2"]);
    for (const inbox of inboxes) {
      expect({
        name: inbox.name,
        is_inbox: inbox.is_inbox,
        default_view: inbox.default_view,
        position: inbox.position,
        deleted_at: inbox.deleted_at,
      }).toEqual({ name: "Inbox", is_inbox: 1, default_view: "list", position: 0, deleted_at: null });
    }
    // One JS clock read for the whole migration.
    expect(new Set(inboxes.map((row) => `${row.created_at}|${row.updated_at}`)).size).toBe(1);

    const p1Inbox = inboxes[0]?.id ?? "";
    const p2Inbox = inboxes[1]?.id ?? "";
    expect(p1Inbox).not.toBe(p2Inbox);

    expect(
      db.raw
        .prepare("SELECT id, list_id, section_id, position FROM tasks ORDER BY profile_id, position")
        .all(),
    ).toEqual([
      { id: "t1", list_id: p1Inbox, section_id: null, position: 1024 },
      { id: "t2", list_id: p1Inbox, section_id: null, position: 2048 },
      { id: "t3", list_id: p1Inbox, section_id: null, position: 3072 },
      { id: "t5", list_id: p1Inbox, section_id: null, position: 4096 },
      { id: "t4", list_id: p2Inbox, section_id: null, position: 1024 },
    ]);
    db.close();
  });

  it("creates no Inbox at all for a database with no profiles yet", () => {
    const db = openDatabase({ path: join(dir, "no-profiles.db") });
    expect((db.raw.prepare("SELECT count(*) AS n FROM task_lists").get() as { n: number }).n).toBe(0);
    db.close();
  });
});

describe("migration 023 — task tags", () => {
  const now = () => new Date().toISOString();

  /** A task seeded straight into the table — this migration adds nothing to `tasks`, so the Inbox `TaskStore` needs is beside the point here. */
  const insertTask = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'todo', ?, ?)`,
      )
      .run(id, profileId, `Zadatak ${id}`, now(), now());

  const insertTag = (db: NexusDatabase, id: string, profileId: string, name: string) =>
    db.raw
      .prepare(`INSERT INTO task_tags (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, profileId, name, now());

  const insertLink = (db: NexusDatabase, taskId: string, tagId: string) =>
    db.raw
      .prepare(`INSERT INTO task_tag_links (task_id, tag_id) VALUES (?, ?)`)
      .run(taskId, tagId);

  const countOf = (db: NexusDatabase, table: string): number =>
    (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

  it("creates both tag tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("task_tags");
    expect(names).toContain("task_tag_links");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the task tag indexes", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("task_tags_profile_name");
    expect(indexes).toContain("task_tag_links_tag");
    db.close();
  });

  it("enforces UNIQUE(profile_id, name) on task_tags — migration 011's choice for note_tags", () => {
    const db = openDatabase({ path: join(dir, "unique-tag.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertTag(db, "tt1", "p1", "važno");
    // the same name in the same profile collides.
    expect(() => insertTag(db, "tt2", "p1", "važno")).toThrow();
    // the same name in a different profile is fine.
    expect(() => insertTag(db, "tt3", "p2", "važno")).not.toThrow();
    db.close();
  });

  it("enforces PRIMARY KEY (task_id, tag_id) on task_tag_links", () => {
    const db = openDatabase({ path: join(dir, "unique-link.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertTag(db, "tt1", "p1", "a");
    insertLink(db, "t1", "tt1");
    // the same (task, tag) pair collides.
    expect(() => insertLink(db, "t1", "tt1")).toThrow();
    db.close();
  });

  it("refuses a link pointing at no task or no tag", () => {
    const db = openDatabase({ path: join(dir, "fk-link.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertTag(db, "tt1", "p1", "a");
    expect(() => insertLink(db, "ghost", "tt1")).toThrow();
    expect(() => insertLink(db, "t1", "ghost")).toThrow();
    db.close();
  });

  it("cascades tags and links when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertTag(db, "tt1", "p1", "a");
    insertLink(db, "t1", "tt1");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(countOf(db, "task_tags")).toBe(0);
    expect(countOf(db, "task_tag_links")).toBe(0);
    db.close();
  });

  it("cascades tag links when the owning task is removed, leaving the tag itself", () => {
    const db = openDatabase({ path: join(dir, "cascade-task-links.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertTag(db, "tt1", "p1", "a");
    insertLink(db, "t1", "tt1");

    db.raw.prepare("DELETE FROM tasks WHERE id = ?").run("t1");
    expect(countOf(db, "task_tag_links")).toBe(0);
    // the tag itself survives — only the link is pruned.
    expect(countOf(db, "task_tags")).toBe(1);
    db.close();
  });

  it("cascades tag links when the owning tag is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-tag-links.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertTag(db, "tt1", "p1", "a");
    insertLink(db, "t1", "tt1");

    db.raw.prepare("DELETE FROM task_tags WHERE id = ?").run("tt1");
    expect(countOf(db, "task_tag_links")).toBe(0);
    db.close();
  });

  it("leaves a soft-deleted task's links standing — only a HARD delete prunes them", () => {
    const db = openDatabase({ path: join(dir, "soft-delete-links.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertTag(db, "tt1", "p1", "a");
    insertLink(db, "t1", "tt1");

    db.raw.prepare("UPDATE tasks SET deleted_at = ? WHERE id = ?").run(now(), "t1");
    expect(countOf(db, "task_tag_links")).toBe(1);
    db.close();
  });

  it("adds no column to tasks — tagging is entirely the join's business", () => {
    const db = openDatabase({ path: join(dir, "tasks-untouched.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).not.toContain("tag_id");
    db.close();
  });
});

describe("migration 024 — task attachments", () => {
  const now = () => new Date().toISOString();

  /** A task seeded straight into the table — this migration adds nothing to `tasks`, so the Inbox `TaskStore` needs is beside the point here (migration 023's own suite makes the same call). */
  const insertTask = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'todo', ?, ?)`,
      )
      .run(id, profileId, `Zadatak ${id}`, now(), now());

  const insertAttachment = (
    db: NexusDatabase,
    id: string,
    taskId: string,
    sizeBytes = 100,
    sha256 = "a".repeat(64),
  ) =>
    db.raw
      .prepare(
        `INSERT INTO task_attachments (id, task_id, file_name, mime, size_bytes, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, taskId, "file.png", "image/png", sizeBytes, sha256, now());

  const countOf = (db: NexusDatabase, table: string): number =>
    (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

  it("creates the task_attachments table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("task_attachments");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the task_attachments_task and task_attachments_sha indexes", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("task_attachments_task");
    expect(indexes).toContain("task_attachments_sha");
    db.close();
  });

  it("rejects a size_bytes of 0 with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-size.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    expect(() => insertAttachment(db, "a1", "t1", 0)).toThrow();
    expect(() => insertAttachment(db, "a2", "t1", 1)).not.toThrow();
    db.close();
  });

  it("refuses an attachment pointing at no task", () => {
    const db = openDatabase({ path: join(dir, "fk-task.db") });
    insertProfile(db, "p1");
    expect(() => insertAttachment(db, "a1", "ghost")).toThrow();
    db.close();
  });

  it("cascades attachment deletion when the owning task is hard-deleted", () => {
    const db = openDatabase({ path: join(dir, "cascade-task.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertAttachment(db, "a1", "t1");

    db.raw.prepare("DELETE FROM tasks WHERE id = ?").run("t1");
    expect(countOf(db, "task_attachments")).toBe(0);
    db.close();
  });

  it("cascades attachment deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertAttachment(db, "a1", "t1");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(countOf(db, "task_attachments")).toBe(0);
    db.close();
  });

  it("leaves a soft-deleted task's attachments standing — only a HARD delete prunes them", () => {
    const db = openDatabase({ path: join(dir, "soft-delete.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertAttachment(db, "a1", "t1");

    db.raw.prepare("UPDATE tasks SET deleted_at = ? WHERE id = ?").run(now(), "t1");
    expect(countOf(db, "task_attachments")).toBe(1);
    db.close();
  });
});

describe("migration 025 — task attachment names inside the task's search entry", () => {
  /** Every view/trigger migration 017 defined, by name — what "leaves every OTHER view and trigger untouched" is measured against. */
  const SEARCH_VIEWS = [
    "search_source_task",
    "search_source_event",
    "search_source_note",
    "search_source_document",
    "search_source_subject",
    "search_source_exam",
    "search_source_deck",
    "search_source_card",
    "search_source_attachment",
  ];

  const objectSql = (db: NexusDatabase, type: string, name: string): string | undefined =>
    (
      db.raw
        .prepare("SELECT sql FROM sqlite_master WHERE type = ? AND name = ?")
        .get(type, name) as { sql: string } | undefined
    )?.sql;

  const namesOfType = (db: NexusDatabase, type: string): string[] =>
    (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all(type) as {
        name: string;
      }[]
    ).map((row) => row.name);

  it("swaps search_source_task for one that reads task_attachments, leaving exactly one view of that name", () => {
    const db = openDatabase({ path: join(dir, "view-swap.db") });
    const views = namesOfType(db, "view");
    expect(views.filter((name) => name === "search_source_task")).toHaveLength(1);

    const sql = objectSql(db, "view", "search_source_task");
    expect(sql).toContain("task_attachments");
    expect(sql).toContain("group_concat");
    // The rest of the projection is untouched: still the task's own columns,
    // still capped, still folded.
    expect(sql).toContain("nx_fold");
    expect(sql).toContain("8000");
    expect(sql).toContain("due_date");
    db.close();
  });

  it("creates the three task_attachments search triggers, the update one scoped to file_name", () => {
    const db = openDatabase({ path: join(dir, "triggers.db") });
    const triggers = namesOfType(db, "trigger");
    expect(triggers).toContain("task_attachments_search_ai");
    expect(triggers).toContain("task_attachments_search_au");
    expect(triggers).toContain("task_attachments_search_ad");

    // The AI/AU refresh keys off new.task_id, the AD off old.task_id — reading
    // `new` in an AFTER DELETE trigger is not an error SQLite reports, it is a
    // trigger that silently refreshes nothing.
    expect(objectSql(db, "trigger", "task_attachments_search_au")).toContain(
      "UPDATE OF file_name",
    );
    expect(objectSql(db, "trigger", "task_attachments_search_ad")).toContain("old.task_id");
    expect(objectSql(db, "trigger", "task_attachments_search_ai")).toContain("new.task_id");
    db.close();
  });

  it("leaves every other search view and trigger of migration 017 exactly as it was", () => {
    const db = openDatabase({ path: join(dir, "untouched.db") });
    const views = namesOfType(db, "view");
    for (const name of SEARCH_VIEWS) expect(views).toContain(name);
    // Only search_source_task learned about task attachments.
    for (const name of SEARCH_VIEWS.filter((view) => view !== "search_source_task")) {
      expect(objectSql(db, "view", name)).not.toContain("task_attachments");
    }

    const triggers = namesOfType(db, "trigger");
    for (const name of [
      "tasks_search_ai",
      "tasks_search_au",
      "tasks_search_ad",
      "note_attachments_search_ai",
      "note_attachments_search_au",
      "note_attachments_search_ad",
      "notes_search_au",
      "search_entries_ai",
      "search_entries_au",
      "search_entries_ad",
    ]) {
      expect(triggers).toContain(name);
    }
    db.close();
  });
});

describe("migration 026 — notification appetite", () => {
  const now = () => new Date().toISOString();

  const insertNtfSettings = (
    db: NexusDatabase,
    profileId: string,
    appetiteAsked: number | null = null,
  ) =>
    appetiteAsked === null
      ? db.raw
          .prepare(
            `INSERT INTO ntf_settings
               (profile_id, quiet_from, quiet_to, morning_hour, created_at, updated_at)
             VALUES (?, NULL, NULL, '08:00', ?, ?)`,
          )
          .run(profileId, now(), now())
      : db.raw
          .prepare(
            `INSERT INTO ntf_settings
               (profile_id, quiet_from, quiet_to, morning_hour, appetite_asked, created_at, updated_at)
             VALUES (?, NULL, NULL, '08:00', ?, ?, ?)`,
          )
          .run(profileId, appetiteAsked, now(), now());

  it("adds appetite_asked to ntf_settings and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(ntf_settings)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toContain("appetite_asked");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("defaults to 0 — a row written without it means the question was never put", () => {
    const db = openDatabase({ path: join(dir, "default.db") });
    insertProfile(db, "p1");
    insertNtfSettings(db, "p1");
    const row = db.raw
      .prepare("SELECT appetite_asked FROM ntf_settings WHERE profile_id = ?")
      .get("p1") as { appetite_asked: number };
    expect(row.appetite_asked).toBe(0);
    db.close();
  });

  it("rejects an appetite_asked value outside {0, 1} with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-appetite.db") });
    insertProfile(db, "p1");
    expect(() => insertNtfSettings(db, "p1", 2)).toThrow();
    expect(() => insertNtfSettings(db, "p1", 1)).not.toThrow();
    db.close();
  });
});

describe("migration 027 — task templates", () => {
  const now = () => new Date().toISOString();

  const insertTemplate = (db: NexusDatabase, id: string, profileId: string, name: string) =>
    db.raw
      .prepare(
        `INSERT INTO task_templates (id, profile_id, name, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, name, '{"title":"x"}', now(), now());

  it("creates the task_templates table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("task_templates");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the task_templates_profile_name unique index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("task_templates_profile_name");
    db.close();
  });

  it("enforces UNIQUE(profile_id, name) — the name IS the template's identity", () => {
    const db = openDatabase({ path: join(dir, "unique-name.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertTemplate(db, "tpl1", "p1", "Nedeljni pregled");
    // the same name in the same profile collides — which is what makes
    // `saveByName` an upsert rather than a second row.
    expect(() => insertTemplate(db, "tpl2", "p1", "Nedeljni pregled")).toThrow();
    // the same name in a different profile is fine.
    expect(() => insertTemplate(db, "tpl3", "p2", "Nedeljni pregled")).not.toThrow();
    db.close();
  });

  it("cascades templates when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertTemplate(db, "tpl1", "p1", "Nedeljni pregled");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM task_templates").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("has no deleted_at column — deleting a template is final, as for note_templates", () => {
    const db = openDatabase({ path: join(dir, "no-soft-delete.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(task_templates)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toEqual(["id", "profile_id", "name", "payload", "created_at", "updated_at"]);
    db.close();
  });
});

describe("migration 028 — note folder preferences", () => {
  const now = () => new Date().toISOString();

  const insertFolder = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    fields: { defaultTemplateId?: string | null; isCaptureDefault?: number } = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO note_folders
           (id, profile_id, parent_id, name, color, default_template_id, is_capture_default,
            created_at, updated_at)
         VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        id,
        profileId,
        `F${id}`,
        fields.defaultTemplateId ?? null,
        fields.isCaptureDefault ?? 0,
        now(),
        now(),
      );

  it("adds both columns to note_folders, defaulting to NULL and 0", () => {
    const db = openDatabase({ path: join(dir, "prefs-columns.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(note_folders)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toContain("default_template_id");
    expect(columns).toContain("is_capture_default");

    insertProfile(db, "p1");
    // Written through the PRE-028 column list, exactly as an older row was —
    // the values read back are what a migrated database gives such a row.
    db.raw
      .prepare(
        `INSERT INTO note_folders (id, profile_id, parent_id, name, color, created_at, updated_at)
         VALUES (?, ?, NULL, 'F', NULL, ?, ?)`,
      )
      .run("f1", "p1", now(), now());
    const row = db.raw
      .prepare("SELECT default_template_id, is_capture_default FROM note_folders WHERE id = ?")
      .get("f1") as { default_template_id: string | null; is_capture_default: number };
    expect(row.default_template_id).toBeNull();
    expect(row.is_capture_default).toBe(0);
    db.close();
  });

  it("rejects an is_capture_default outside {0, 1} with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-capture.db") });
    insertProfile(db, "p1");
    expect(() => insertFolder(db, "f1", "p1", { isCaptureDefault: 2 })).toThrow();
    expect(() => insertFolder(db, "f2", "p1", { isCaptureDefault: 1 })).not.toThrow();
    db.close();
  });

  it("accepts a default_template_id naming no row at all — deliberately not a foreign key", () => {
    const db = openDatabase({ path: join(dir, "no-fk.db") });
    insertProfile(db, "p1");
    // A built-in template id is a code constant with no `note_templates` row to
    // reference — a foreign key here would make exactly this case unstorable.
    expect(() =>
      insertFolder(db, "f1", "p1", { defaultTemplateId: "builtin:sastanak" }),
    ).not.toThrow();
    expect(() =>
      insertFolder(db, "f2", "p1", { defaultTemplateId: "no-such-template" }),
    ).not.toThrow();
    db.close();
  });

  it("allows at most one capture-default folder per profile, and any number of unmarked ones", () => {
    const db = openDatabase({ path: join(dir, "capture-unique.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertFolder(db, "f1", "p1", { isCaptureDefault: 1 });
    // a second claimant in the SAME profile violates the partial unique index.
    expect(() => insertFolder(db, "f2", "p1", { isCaptureDefault: 1 })).toThrow();
    // unmarked folders are unconstrained — the index is partial, not a plain
    // UNIQUE(profile_id), which would allow one folder per profile full stop.
    expect(() => insertFolder(db, "f3", "p1")).not.toThrow();
    expect(() => insertFolder(db, "f4", "p1")).not.toThrow();
    // another profile's mark is its own.
    expect(() => insertFolder(db, "f5", "p2", { isCaptureDefault: 1 })).not.toThrow();
    db.close();
  });

  it("creates the note_folders_capture_default partial index", () => {
    const db = openDatabase({ path: join(dir, "capture-index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("note_folders_capture_default");
    db.close();
  });
});

describe("migration 029 — task dependencies", () => {
  const now = () => new Date().toISOString();

  /** A task seeded straight into the table — this migration adds nothing to `tasks`, so the Inbox `TaskStore` needs is beside the point here (migration 023's own helper). */
  const insertTask = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'todo', ?, ?)`,
      )
      .run(id, profileId, `Zadatak ${id}`, now(), now());

  const insertEdge = (db: NexusDatabase, blockerId: string, blockedId: string) =>
    db.raw
      .prepare(`INSERT INTO task_dependencies (blocker_id, blocked_id) VALUES (?, ?)`)
      .run(blockerId, blockedId);

  const countOf = (db: NexusDatabase, table: string): number =>
    (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

  it("creates the dependency table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("task_dependencies");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the blocked_id index — the direction the edit form reads in", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("task_dependencies_blocked");
    db.close();
  });

  it("enforces PRIMARY KEY (blocker_id, blocked_id)", () => {
    const db = openDatabase({ path: join(dir, "unique-edge.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertTask(db, "t2", "p1");
    insertEdge(db, "t1", "t2");
    // the same (blocker, blocked) pair collides.
    expect(() => insertEdge(db, "t1", "t2")).toThrow();
    // the REVERSE pair is a different edge as far as the schema is concerned —
    // the cycle rule that refuses it lives in the store, not in SQL.
    expect(() => insertEdge(db, "t2", "t1")).not.toThrow();
    db.close();
  });

  it("refuses an edge pointing at no task on either end", () => {
    const db = openDatabase({ path: join(dir, "fk-edge.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    expect(() => insertEdge(db, "ghost", "t1")).toThrow();
    expect(() => insertEdge(db, "t1", "ghost")).toThrow();
    db.close();
  });

  it("cascades edges when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertTask(db, "t2", "p1");
    insertEdge(db, "t1", "t2");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(countOf(db, "task_dependencies")).toBe(0);
    db.close();
  });

  it("cascades edges from either end when a task is hard-deleted", () => {
    const db = openDatabase({ path: join(dir, "cascade-task.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertTask(db, "t2", "p1");
    insertTask(db, "t3", "p1");
    insertEdge(db, "t1", "t2");
    insertEdge(db, "t2", "t3");

    // Deleting the middle task takes both the edge it blocks and the edge it is
    // blocked by; the outer two tasks stay.
    db.raw.prepare("DELETE FROM tasks WHERE id = ?").run("t2");
    expect(countOf(db, "task_dependencies")).toBe(0);
    expect(countOf(db, "tasks")).toBe(2);
    db.close();
  });

  it("leaves a soft-deleted task's edges standing — only a HARD delete prunes them", () => {
    const db = openDatabase({ path: join(dir, "soft-delete-edges.db") });
    insertProfile(db, "p1");
    insertTask(db, "t1", "p1");
    insertTask(db, "t2", "p1");
    insertEdge(db, "t1", "t2");

    db.raw.prepare("UPDATE tasks SET deleted_at = ? WHERE id = ?").run(now(), "t1");
    expect(countOf(db, "task_dependencies")).toBe(1);
    db.close();
  });

  it("adds no column to tasks — being blocked is derived, never stored", () => {
    const db = openDatabase({ path: join(dir, "tasks-untouched-deps.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).not.toContain("blocked");
    expect(columns).not.toContain("blocked_by");
    db.close();
  });

  it("carries no profile column — scoping rides the tasks, as task_tag_links does", () => {
    const db = openDatabase({ path: join(dir, "no-profile-column.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(task_dependencies)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toEqual(["blocker_id", "blocked_id"]);
    db.close();
  });
});

describe("migration 030 — dashboard settings", () => {
  const now = () => new Date().toISOString();

  const insertSettings = (
    db: NexusDatabase,
    profileId: string,
    hash: string | null,
    mime: string | null,
    sizeBytes: number | null,
    dim: number,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO dashboard_settings
           (profile_id, background_hash, background_mime, background_size_bytes,
            background_dim, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(profileId, hash, mime, sizeBytes, dim, now(), now());

  const HASH = "a".repeat(64);

  it("creates the dashboard_settings table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("dashboard_settings");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the dashboard_settings_background index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("dashboard_settings_background");
    db.close();
  });

  it("allows at most one row per profile", () => {
    const db = openDatabase({ path: join(dir, "one-row.db") });
    insertProfile(db, "p1");
    insertSettings(db, "p1", null, null, null, 40);
    expect(() => insertSettings(db, "p1", null, null, null, 20)).toThrow();
    db.close();
  });

  it("defaults background_dim to 40 when the column is omitted", () => {
    const db = openDatabase({ path: join(dir, "default-dim.db") });
    insertProfile(db, "p1");
    db.raw
      .prepare(
        `INSERT INTO dashboard_settings (profile_id, created_at, updated_at) VALUES (?, ?, ?)`,
      )
      .run("p1", now(), now());
    const row = db.raw
      .prepare("SELECT background_dim FROM dashboard_settings WHERE profile_id = ?")
      .get("p1") as { background_dim: number };
    expect(row.background_dim).toBe(40);
    db.close();
  });

  it("rejects a half-set background triple with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-pair.db") });
    insertProfile(db, "p1");
    // A hash with no mime — nothing could decide how to serve it.
    expect(() => insertSettings(db, "p1", HASH, null, 10, 40)).toThrow();
    // A mime with no hash — a decision about bytes that are not named.
    expect(() => insertSettings(db, "p1", null, "image/png", null, 40)).toThrow();
    // A hash and mime with no size — the archive's blob inventory needs both.
    expect(() => insertSettings(db, "p1", HASH, "image/png", null, 40)).toThrow();
    // All three set is accepted, and so is all three null.
    expect(() => insertSettings(db, "p1", HASH, "image/png", 10, 40)).not.toThrow();
    insertProfile(db, "p2");
    expect(() => insertSettings(db, "p2", null, null, null, 40)).not.toThrow();
    db.close();
  });

  it("rejects a non-positive background_size_bytes with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-size.db") });
    insertProfile(db, "p1");
    expect(() => insertSettings(db, "p1", HASH, "image/png", 0, 40)).toThrow();
    expect(() => insertSettings(db, "p1", HASH, "image/png", 1, 40)).not.toThrow();
    db.close();
  });

  it("rejects a background_dim outside 0..90 with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-dim.db") });
    insertProfile(db, "p1");
    expect(() => insertSettings(db, "p1", null, null, null, -1)).toThrow();
    expect(() => insertSettings(db, "p1", null, null, null, 91)).toThrow();
    expect(() => insertSettings(db, "p1", null, null, null, 0)).not.toThrow();
    insertProfile(db, "p2");
    expect(() => insertSettings(db, "p2", null, null, null, 90)).not.toThrow();
    db.close();
  });

  it("cascades the settings row when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertSettings(db, "p1", HASH, "image/png", 10, 40);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM dashboard_settings").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 031 — first-class cloze cards", () => {
  const now = () => new Date().toISOString();

  const insertSubject = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "x", "jade", now(), now());

  const insertDeck = (db: NexusDatabase, id: string, profileId: string, subjectId: string) =>
    db.raw
      .prepare(
        `INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, subjectId, "x", now(), now());

  /** A card with the three ADR-042 columns spelled out; the FSRS fields are constants here. */
  const insertCard = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    deckId: string,
    kind: string,
    clozeText: string | null,
    clozeOrdinal: number | null,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO cards
           (id, profile_id, deck_id, front, back, kind, cloze_text, cloze_ordinal,
            due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
            reps, lapses, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, profileId, deckId, "front", "back", kind, clozeText, clozeOrdinal,
        now(), 0, 0, 0, 0, 0, 0, 0, 0, now(), now(),
      );

  /** A deck plus its profile and subject, ready for cards. */
  const seedDeck = (db: NexusDatabase) => {
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
  };

  it("adds the three cloze columns and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(cards)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toContain("kind");
    expect(columns).toContain("cloze_text");
    expect(columns).toContain("cloze_ordinal");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("defaults kind to 'basic' with both cloze columns NULL — every pre-existing card, unchanged", () => {
    const db = openDatabase({ path: join(dir, "default-kind.db") });
    seedDeck(db);
    // Deliberately omits all three columns, exactly as every write predating
    // this migration did.
    db.raw
      .prepare(
        `INSERT INTO cards
           (id, profile_id, deck_id, front, back, due, stability, difficulty,
            elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("c1", "p1", "d1", "f", "b", now(), 0, 0, 0, 0, 0, 0, 0, 0, now(), now());

    const row = db.raw
      .prepare("SELECT kind, cloze_text, cloze_ordinal FROM cards WHERE id = ?")
      .get("c1") as { kind: string; cloze_text: string | null; cloze_ordinal: number | null };
    expect(row.kind).toBe("basic");
    expect(row.cloze_text).toBeNull();
    expect(row.cloze_ordinal).toBeNull();
    db.close();
  });

  it("rejects a kind outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-kind.db") });
    seedDeck(db);
    expect(() => insertCard(db, "c1", "p1", "d1", "bogus", null, null)).toThrow();
    expect(() => insertCard(db, "c2", "p1", "d1", "basic", null, null)).not.toThrow();
    expect(() => insertCard(db, "c3", "p1", "d1", "cloze", "{{a}}", 0)).not.toThrow();
    db.close();
  });

  it("rejects a basic card carrying either cloze column", () => {
    const db = openDatabase({ path: join(dir, "check-basic-pair.db") });
    seedDeck(db);
    expect(() => insertCard(db, "c1", "p1", "d1", "basic", "{{a}}", null)).toThrow();
    expect(() => insertCard(db, "c2", "p1", "d1", "basic", null, 0)).toThrow();
    db.close();
  });

  it("rejects a cloze card missing either cloze column", () => {
    const db = openDatabase({ path: join(dir, "check-cloze-pair.db") });
    seedDeck(db);
    expect(() => insertCard(db, "c1", "p1", "d1", "cloze", "{{a}}", null)).toThrow();
    expect(() => insertCard(db, "c2", "p1", "d1", "cloze", null, 0)).toThrow();
    expect(() => insertCard(db, "c3", "p1", "d1", "cloze", null, null)).toThrow();
    db.close();
  });

  it("rejects a negative cloze_ordinal and accepts 0 (the first deletion)", () => {
    const db = openDatabase({ path: join(dir, "check-ordinal.db") });
    seedDeck(db);
    expect(() => insertCard(db, "c1", "p1", "d1", "cloze", "{{a}}", -1)).toThrow();
    expect(() => insertCard(db, "c2", "p1", "d1", "cloze", "{{a}}", 0)).not.toThrow();
    db.close();
  });

  it("keeps every review_log row — this migration adds columns, it never rebuilds cards", () => {
    // The reason the migration uses ALTER TABLE ADD COLUMN rather than the
    // create/copy/drop/rename rebuild migration 021 used: DROP TABLE cards
    // would cascade a user's whole FSRS history away.
    const db = openDatabase({ path: join(dir, "review-log-survives.db") });
    seedDeck(db);
    insertCard(db, "c1", "p1", "d1", "basic", null, null);
    db.raw
      .prepare(
        `INSERT INTO review_log
           (id, profile_id, card_id, rating, state, due, stability, difficulty,
            elapsed_days, last_elapsed_days, scheduled_days, learning_steps,
            review, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("l1", "p1", "c1", 3, 2, now(), 1, 1, 0, 0, 1, 0, now(), now());

    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM review_log").get() as { n: number }).n,
    ).toBe(1);
    db.close();
  });

  it("keeps migration 017's card search triggers — a rebuild would have dropped them", () => {
    const db = openDatabase({ path: join(dir, "triggers-survive.db") });
    const triggers = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(triggers).toContain("cards_search_ai");
    expect(triggers).toContain("cards_search_au");
    expect(triggers).toContain("cards_search_ad");
    db.close();
  });
});

describe("migration 032 — dashboard widgets", () => {
  const now = () => new Date().toISOString();

  const insertWidget = (
    db: NexusDatabase,
    instanceId: string,
    profileId: string,
    widgetId: string,
    size: string,
    position: number,
    config: string | null = null,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO dashboard_widgets
           (profile_id, instance_id, widget_id, size, position, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(profileId, instanceId, widgetId, size, position, config, now(), now());

  it("creates the dashboard_widgets table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("dashboard_widgets");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the dashboard_widgets_profile_position index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("dashboard_widgets_profile_position");
    db.close();
  });

  it("rejects a size outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-size.db") });
    insertProfile(db, "p1");
    // an unlisted preset -> rejected by the CHECK.
    expect(() => insertWidget(db, "w1", "p1", "calendar:danas", "XL", 1024)).toThrow();
    // each enumerated preset is accepted.
    expect(() => insertWidget(db, "w2", "p1", "calendar:danas", "S", 1024)).not.toThrow();
    expect(() => insertWidget(db, "w3", "p1", "calendar:danas", "M", 2048)).not.toThrow();
    expect(() => insertWidget(db, "w4", "p1", "calendar:danas", "L", 3072)).not.toThrow();
    db.close();
  });

  it("enforces instance_id as the primary key while allowing the same widget twice", () => {
    const db = openDatabase({ path: join(dir, "unique-instance.db") });
    insertProfile(db, "p1");
    insertWidget(db, "w1", "p1", "calendar:danas", "M", 1024);
    // The same PLACEMENT id collides...
    expect(() => insertWidget(db, "w1", "p1", "study:ispiti", "M", 2048)).toThrow();
    // ...while the same widget placed a second time is a layout, not a mistake.
    expect(() => insertWidget(db, "w2", "p1", "calendar:danas", "L", 2048)).not.toThrow();
    db.close();
  });

  it("accepts a widget_id no module publishes — it is a code constant, not a foreign key", () => {
    const db = openDatabase({ path: join(dir, "no-fk.db") });
    insertProfile(db, "p1");
    // A layout is the user's: a widget whose module this build does not carry
    // keeps its row rather than vanishing from the table (migration 028's
    // argument for `default_template_id`).
    expect(() => insertWidget(db, "w1", "p1", "finance:budzet", "M", 1024)).not.toThrow();
    db.close();
  });

  it("accepts a negative position — a sort key is relative, never a count", () => {
    const db = openDatabase({ path: join(dir, "negative-position.db") });
    insertProfile(db, "p1");
    expect(() => insertWidget(db, "w1", "p1", "calendar:danas", "M", -1024)).not.toThrow();
    db.close();
  });

  it("cascades widget deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertWidget(db, "w1", "p1", "calendar:danas", "M", 1024);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM dashboard_widgets").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 033 — problem cards", () => {
  const now = () => new Date().toISOString();

  const insertSubject = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, "x", "jade", now(), now());

  const insertDeck = (db: NexusDatabase, id: string, profileId: string, subjectId: string) =>
    db.raw
      .prepare(
        `INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, subjectId, "x", now(), now());

  /** A card with `kind` and the ADR-046 column spelled out; the FSRS fields are constants here. */
  const insertCard = (
    db: NexusDatabase,
    id: string,
    kind: string,
    clozeText: string | null,
    clozeOrdinal: number | null,
    problemSteps: string | null,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO cards
           (id, profile_id, deck_id, front, back, kind, cloze_text, cloze_ordinal, problem_steps,
            due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
            reps, lapses, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, "p1", "d1", "front", "back", kind, clozeText, clozeOrdinal, problemSteps,
        now(), 0, 0, 0, 0, 0, 0, 0, 0, now(), now(),
      );

  /** A deck plus its profile and subject, ready for cards. */
  const seedDeck = (db: NexusDatabase) => {
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertDeck(db, "d1", "p1", "s1");
  };

  it("adds problem_steps and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh-033.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(cards)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toContain("problem_steps");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("leaves problem_steps NULL for a card written without it — no default, no backfill", () => {
    const db = openDatabase({ path: join(dir, "default-steps.db") });
    seedDeck(db);
    // Deliberately omits the column, exactly as every write predating this
    // migration did: NULL already means "no worked solution".
    db.raw
      .prepare(
        `INSERT INTO cards
           (id, profile_id, deck_id, front, back, due, stability, difficulty,
            elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("c1", "p1", "d1", "f", "b", now(), 0, 0, 0, 0, 0, 0, 0, 0, now(), now());

    const row = db.raw
      .prepare("SELECT kind, problem_steps FROM cards WHERE id = ?")
      .get("c1") as { kind: string; problem_steps: string | null };
    expect(row.kind).toBe("basic");
    expect(row.problem_steps).toBeNull();
    db.close();
  });

  it("accepts steps on a basic card — the only kind that may carry them", () => {
    const db = openDatabase({ path: join(dir, "check-basic-steps.db") });
    seedDeck(db);
    expect(() => insertCard(db, "c1", "basic", null, null, "prvi\n--\ndrugi")).not.toThrow();
    expect(() => insertCard(db, "c2", "basic", null, null, null)).not.toThrow();
    db.close();
  });

  it("rejects steps on a cloze card — its back already has a source, and one is all it may have", () => {
    const db = openDatabase({ path: join(dir, "check-cloze-steps.db") });
    seedDeck(db);
    expect(() => insertCard(db, "c1", "cloze", "{{a}}", 0, "korak")).toThrow();
    expect(() => insertCard(db, "c2", "cloze", "{{a}}", 0, null)).not.toThrow();
    db.close();
  });

  it("rejects the empty string — NULL is the one way to say 'no worked solution'", () => {
    const db = openDatabase({ path: join(dir, "check-empty-steps.db") });
    seedDeck(db);
    expect(() => insertCard(db, "c1", "basic", null, null, "")).toThrow();
    db.close();
  });

  it("keeps every review_log row and migration 017's card triggers — cards is never rebuilt", () => {
    const db = openDatabase({ path: join(dir, "cards-intact-033.db") });
    seedDeck(db);
    insertCard(db, "c1", "basic", null, null, "korak");
    db.raw
      .prepare(
        `INSERT INTO review_log
           (id, profile_id, card_id, rating, state, due, stability, difficulty,
            elapsed_days, last_elapsed_days, scheduled_days, learning_steps,
            review, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("l1", "p1", "c1", 3, 2, now(), 1, 1, 0, 0, 1, 0, now(), now());

    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM review_log").get() as { n: number }).n,
    ).toBe(1);
    const triggers = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(triggers).toContain("cards_search_ai");
    expect(triggers).toContain("cards_search_au");
    expect(triggers).toContain("cards_search_ad");
    db.close();
  });
});

describe("migration 034 — study settings", () => {
  const now = () => new Date().toISOString();

  const insertSettings = (
    db: NexusDatabase,
    profileId: string,
    targetRetention: number,
    newPerDay: number,
    maxReviewsPerDay: number | null,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO study_settings
           (profile_id, target_retention, new_per_day, max_reviews_per_day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(profileId, targetRetention, newPerDay, maxReviewsPerDay, now(), now());

  it("creates the study_settings table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh-034.db") });
    expect(tableNames(db)).toContain("study_settings");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the review_log_profile_review index the daily cap counts through", () => {
    const db = openDatabase({ path: join(dir, "index-034.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("review_log_profile_review");
    db.close();
  });

  it("allows at most one row per profile", () => {
    const db = openDatabase({ path: join(dir, "one-row-034.db") });
    insertProfile(db, "p1");
    insertSettings(db, "p1", 0.9, 20, null);
    expect(() => insertSettings(db, "p1", 0.85, 10, null)).toThrow();
    db.close();
  });

  it("defaults retention to 0.9, new cards to 20 and the review cap to NULL when the columns are omitted", () => {
    const db = openDatabase({ path: join(dir, "defaults-034.db") });
    insertProfile(db, "p1");
    db.raw
      .prepare(`INSERT INTO study_settings (profile_id, created_at, updated_at) VALUES (?, ?, ?)`)
      .run("p1", now(), now());
    const row = db.raw
      .prepare(
        "SELECT target_retention, new_per_day, max_reviews_per_day FROM study_settings WHERE profile_id = ?",
      )
      .get("p1") as {
      target_retention: number;
      new_per_day: number;
      max_reviews_per_day: number | null;
    };
    expect(row.target_retention).toBeCloseTo(0.9, 10);
    expect(row.new_per_day).toBe(20);
    expect(row.max_reviews_per_day).toBeNull();
    db.close();
  });

  it("rejects a target_retention outside 0.70..0.97 with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-retention.db") });
    insertProfile(db, "p1");
    expect(() => insertSettings(db, "p1", 0.69, 20, null)).toThrow();
    expect(() => insertSettings(db, "p1", 0.98, 20, null)).toThrow();
    expect(() => insertSettings(db, "p1", 0.7, 20, null)).not.toThrow();
    insertProfile(db, "p2");
    expect(() => insertSettings(db, "p2", 0.97, 20, null)).not.toThrow();
    db.close();
  });

  it("rejects a new_per_day outside 0..100 with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-new.db") });
    insertProfile(db, "p1");
    expect(() => insertSettings(db, "p1", 0.9, -1, null)).toThrow();
    expect(() => insertSettings(db, "p1", 0.9, 101, null)).toThrow();
    // Zero is a real answer here — "no new cards today", not "unset".
    expect(() => insertSettings(db, "p1", 0.9, 0, null)).not.toThrow();
    insertProfile(db, "p2");
    expect(() => insertSettings(db, "p2", 0.9, 100, null)).not.toThrow();
    db.close();
  });

  it("rejects a max_reviews_per_day outside 1..1000, while NULL means uncapped", () => {
    const db = openDatabase({ path: join(dir, "check-reviews.db") });
    insertProfile(db, "p1");
    // Zero is NOT "uncapped" — NULL is, and a cap of nothing is not a cap.
    expect(() => insertSettings(db, "p1", 0.9, 20, 0)).toThrow();
    expect(() => insertSettings(db, "p1", 0.9, 20, 1001)).toThrow();
    expect(() => insertSettings(db, "p1", 0.9, 20, 1)).not.toThrow();
    insertProfile(db, "p2");
    expect(() => insertSettings(db, "p2", 0.9, 20, 1000)).not.toThrow();
    insertProfile(db, "p3");
    expect(() => insertSettings(db, "p3", 0.9, 20, null)).not.toThrow();
    db.close();
  });

  it("cascades the settings row when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-034.db") });
    insertProfile(db, "p1");
    insertSettings(db, "p1", 0.9, 20, 50);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM study_settings").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 035 — subject materials and linked notes", () => {
  const now = () => new Date().toISOString();

  const insertSubject = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, `Predmet ${id}`, "jade", now(), now());

  const insertNote = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO notes (id, profile_id, title, created_at, updated_at, deleted_at)
         VALUES (?, ?, '', ?, ?, NULL)`,
      )
      .run(id, profileId, now(), now());

  const insertMaterial = (
    db: NexusDatabase,
    id: string,
    subjectId: string,
    sizeBytes = 100,
    sha256 = "b".repeat(64),
  ) =>
    db.raw
      .prepare(
        `INSERT INTO subject_attachments (id, subject_id, file_name, mime, size_bytes, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, subjectId, "skripta.pdf", "application/pdf", sizeBytes, sha256, now());

  const insertLink = (db: NexusDatabase, subjectId: string, noteId: string) =>
    db.raw
      .prepare(`INSERT INTO subject_note_links (subject_id, note_id, created_at) VALUES (?, ?, ?)`)
      .run(subjectId, noteId, now());

  const countOf = (db: NexusDatabase, table: string): number =>
    (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

  it("creates both tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh-035.db") });
    const names = tableNames(db);
    expect(names).toContain("subject_attachments");
    expect(names).toContain("subject_note_links");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the subject_attachments_subject and subject_attachments_sha indexes", () => {
    const db = openDatabase({ path: join(dir, "index-035.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("subject_attachments_subject");
    expect(indexes).toContain("subject_attachments_sha");
    db.close();
  });

  it("creates the subject_note_links_note reverse-lookup index", () => {
    const db = openDatabase({ path: join(dir, "index-links-035.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("subject_note_links_note");
    db.close();
  });

  it("rejects a size_bytes of 0 with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-size-035.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    expect(() => insertMaterial(db, "m1", "s1", 0)).toThrow();
    expect(() => insertMaterial(db, "m2", "s1", 1)).not.toThrow();
    db.close();
  });

  it("refuses a material pointing at no subject", () => {
    const db = openDatabase({ path: join(dir, "fk-subject-035.db") });
    insertProfile(db, "p1");
    expect(() => insertMaterial(db, "m1", "ghost")).toThrow();
    db.close();
  });

  it("cascades materials when the owning subject is hard-deleted", () => {
    const db = openDatabase({ path: join(dir, "cascade-subject-035.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertMaterial(db, "m1", "s1");

    db.raw.prepare("DELETE FROM subjects WHERE id = ?").run("s1");
    expect(countOf(db, "subject_attachments")).toBe(0);
    db.close();
  });

  it("cascades materials when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile-035.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertMaterial(db, "m1", "s1");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(countOf(db, "subject_attachments")).toBe(0);
    db.close();
  });

  it("leaves a soft-deleted subject's materials standing — only a HARD delete prunes them", () => {
    const db = openDatabase({ path: join(dir, "soft-delete-035.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertMaterial(db, "m1", "s1");

    db.raw.prepare("UPDATE subjects SET deleted_at = ? WHERE id = ?").run(now(), "s1");
    expect(countOf(db, "subject_attachments")).toBe(1);
    db.close();
  });

  it("carries no profile column on subject_attachments — scoping rides the subject", () => {
    const db = openDatabase({ path: join(dir, "no-profile-035.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(subject_attachments)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toEqual([
      "id",
      "subject_id",
      "file_name",
      "mime",
      "size_bytes",
      "sha256",
      "created_at",
    ]);
    db.close();
  });

  it("enforces PRIMARY KEY (subject_id, note_id) on subject_note_links", () => {
    const db = openDatabase({ path: join(dir, "unique-link-035.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertNote(db, "n1", "p1");
    insertLink(db, "s1", "n1");
    expect(() => insertLink(db, "s1", "n1")).toThrow();
    db.close();
  });

  it("refuses a link pointing at no subject or no note", () => {
    const db = openDatabase({ path: join(dir, "fk-link-035.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertNote(db, "n1", "p1");
    expect(() => insertLink(db, "ghost", "n1")).toThrow();
    expect(() => insertLink(db, "s1", "ghost")).toThrow();
    db.close();
  });

  it("cascades links from either end when a subject or a note is hard-deleted", () => {
    const db = openDatabase({ path: join(dir, "cascade-link-035.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertSubject(db, "s2", "p1");
    insertNote(db, "n1", "p1");
    insertNote(db, "n2", "p1");
    insertLink(db, "s1", "n1");
    insertLink(db, "s2", "n2");

    db.raw.prepare("DELETE FROM subjects WHERE id = ?").run("s1");
    expect(countOf(db, "subject_note_links")).toBe(1);
    db.raw.prepare("DELETE FROM notes WHERE id = ?").run("n2");
    expect(countOf(db, "subject_note_links")).toBe(0);
    db.close();
  });

  it("leaves a link standing when EITHER end is soft-deleted — ADR-037's edge philosophy", () => {
    const db = openDatabase({ path: join(dir, "soft-delete-link-035.db") });
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertNote(db, "n1", "p1");
    insertLink(db, "s1", "n1");

    db.raw.prepare("UPDATE subjects SET deleted_at = ? WHERE id = ?").run(now(), "s1");
    expect(countOf(db, "subject_note_links")).toBe(1);
    db.raw.prepare("UPDATE notes SET deleted_at = ? WHERE id = ?").run(now(), "n1");
    expect(countOf(db, "subject_note_links")).toBe(1);
    db.close();
  });

  it("carries no profile column on subject_note_links — scoping rides both ends", () => {
    const db = openDatabase({ path: join(dir, "no-profile-link-035.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(subject_note_links)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toEqual(["subject_id", "note_id", "created_at"]);
    db.close();
  });

  it("adds nothing to the search index — a material's name is not searchable in this slice", () => {
    const db = openDatabase({ path: join(dir, "search-untouched-035.db") });
    const triggers = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(triggers.filter((name) => name.includes("subject_attachment"))).toEqual([]);
    expect(triggers.filter((name) => name.includes("subject_note_link"))).toEqual([]);
    db.close();
  });
});

describe("migration 036 — event templates", () => {
  const now = () => new Date().toISOString();

  const insertTemplate = (db: NexusDatabase, id: string, profileId: string, name: string) =>
    db.raw
      .prepare(
        `INSERT INTO event_templates (id, profile_id, name, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, name, '{"title":"x"}', now(), now());

  it("creates the event_templates table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh-036.db") });
    expect(tableNames(db)).toContain("event_templates");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the event_templates_profile_name unique index", () => {
    const db = openDatabase({ path: join(dir, "index-036.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("event_templates_profile_name");
    db.close();
  });

  it("enforces UNIQUE(profile_id, name) — the name IS the template's identity", () => {
    const db = openDatabase({ path: join(dir, "unique-name-036.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertTemplate(db, "etpl1", "p1", "Trening");
    // The same name in the same profile collides — which is what makes
    // `saveByName` an upsert rather than a second row.
    expect(() => insertTemplate(db, "etpl2", "p1", "Trening")).toThrow();
    // The same name in a different profile is fine.
    expect(() => insertTemplate(db, "etpl3", "p2", "Trening")).not.toThrow();
    db.close();
  });

  it("cascades templates when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-036.db") });
    insertProfile(db, "p1");
    insertTemplate(db, "etpl1", "p1", "Trening");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM event_templates").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("has no deleted_at column — deleting a template is final, as for task_templates", () => {
    const db = openDatabase({ path: join(dir, "no-soft-delete-036.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(event_templates)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toEqual(["id", "profile_id", "name", "payload", "created_at", "updated_at"]);
    db.close();
  });
});

describe("migration 037 — security notifications", () => {
  type Handle = Database.Database;

  const now = () => new Date().toISOString();

  const objectNames = (raw: Handle, type: "table" | "index"): string[] =>
    (raw.prepare("SELECT name FROM sqlite_master WHERE type = ?").all(type) as { name: string }[]).map(
      (row) => row.name,
    );

  const seedProfile = (raw: Handle, id: string) =>
    raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, "personal", "P", now());

  const seedNotification = (
    raw: Handle,
    id: string,
    profileId: string,
    source: string,
    occurrenceKey = "d-1",
  ) =>
    raw
      .prepare(
        `INSERT INTO notifications
           (id, profile_id, source, entity_id, occurrence_key, title, body, status,
            snoozed_until, delivered_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'delivered', NULL, ?, ?, ?)`,
      )
      .run(id, profileId, source, "entity-1", occurrenceKey, "Naslov", "Telo", now(), now(), now());

  const seedSourceSetting = (raw: Handle, profileId: string, source: string, enabled: number) =>
    raw
      .prepare("INSERT INTO ntf_source_settings (profile_id, source, enabled) VALUES (?, ?, ?)")
      .run(profileId, source, enabled);

  /** As every rebuild migration's own helper: a connection held at exactly `version`, set up the way `openDatabase` sets one up. */
  function openAtVersion(path: string, version: number): Handle {
    const raw = new Database(path);
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      raw,
      MIGRATIONS.filter((migration) => migration.version <= version),
    );
    return raw;
  }

  it("widens the notifications source CHECK to accept 'security', still rejecting anything outside the set", () => {
    const db = openDatabase({ path: join(dir, "check-source-security.db") });
    insertProfile(db, "p1");
    expect(() =>
      seedNotification(db.raw, "n1", "p1", "security", "2026-07-31T10:00:00.000Z"),
    ).not.toThrow();
    // the five earlier sources still pass, and an unlisted one still does not.
    expect(() => seedNotification(db.raw, "n2", "p1", "document", "7")).not.toThrow();
    expect(() => seedNotification(db.raw, "n3", "p1", "exam", "d-0")).not.toThrow();
    expect(() => seedNotification(db.raw, "n4", "p1", "study-day", "day")).not.toThrow();
    expect(() => seedNotification(db.raw, "n5", "p1", "event", "2026-08-01 15")).not.toThrow();
    expect(() => seedNotification(db.raw, "n6", "p1", "task", "2026-08-10 3")).not.toThrow();
    expect(() => seedNotification(db.raw, "n7", "p1", "bogus", "x")).toThrow();
    db.close();
  });

  it("leaves ntf_source_settings' narrower CHECK alone — 'security' is not a preference", () => {
    const db = openDatabase({ path: join(dir, "settings-check-037.db") });
    insertProfile(db, "p1");
    // The schema itself is what makes "security: off" unwritable, by anyone.
    expect(() => seedSourceSetting(db.raw, "p1", "security", 0)).toThrow();
    expect(() => seedSourceSetting(db.raw, "p1", "task", 0)).not.toThrow();
    db.close();
  });

  it("leaves no rebuild scaffolding behind and keeps the notifications UNIQUE tuple and its index", () => {
    const db = openDatabase({ path: join(dir, "rebuilt-037.db") });
    expect(objectNames(db.raw, "table")).not.toContain("notifications_new");
    expect(objectNames(db.raw, "index")).toContain("notifications_profile_status_updated");

    insertProfile(db, "p1");
    seedNotification(db.raw, "n1", "p1", "security", "2026-07-31T10:00:00.000Z");
    // the same (profile, source, entity, occurrence) tuple still collides.
    expect(() =>
      seedNotification(db.raw, "n2", "p1", "security", "2026-07-31T10:00:00.000Z"),
    ).toThrow();
    db.close();
  });

  it("carries a seeded 036 database's ledger and source settings through the rebuild untouched", () => {
    const path = join(dir, "upgrade-037.db");
    const before = openAtVersion(path, 36);
    seedProfile(before, "p1");
    seedNotification(before, "n1", "p1", "exam");
    seedNotification(before, "n2", "p1", "task", "2026-08-10 3");
    seedSourceSetting(before, "p1", "study-day", 0);
    expect(before.pragma("user_version", { simple: true })).toBe(36);
    before.close();

    const db = openDatabase({ path });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    expect(
      db.raw
        .prepare("SELECT id, source, occurrence_key, title, status FROM notifications ORDER BY id")
        .all(),
    ).toEqual([
      { id: "n1", source: "exam", occurrence_key: "d-1", title: "Naslov", status: "delivered" },
      { id: "n2", source: "task", occurrence_key: "2026-08-10 3", title: "Naslov", status: "delivered" },
    ]);
    expect(db.raw.prepare("SELECT profile_id, source, enabled FROM ntf_source_settings").all()).toEqual([
      { profile_id: "p1", source: "study-day", enabled: 0 },
    ]);
    // The rebuilt table cascades exactly as the one it replaced did.
    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM notifications").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 038 — the four task views", () => {
  type Handle = Database.Database;

  const now = () => new Date().toISOString();

  const columnNames = (raw: Handle, table: string): string[] =>
    (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name);

  const tableNamesOf = (raw: Handle): string[] =>
    (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]).map((row) => row.name);

  const seedProfile = (raw: Handle, id: string) =>
    raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, "personal", "P", now());

  const seedList = (
    raw: Handle,
    id: string,
    profileId: string,
    parentId: string | null,
    defaultView = "list",
    position = 1024,
  ) =>
    raw
      .prepare(
        `INSERT INTO task_lists
           (id, profile_id, parent_id, name, is_inbox, default_view, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(id, profileId, parentId, `Lista ${id}`, defaultView, position, now(), now());

  const seedSection = (raw: Handle, id: string, listId: string, position = 1024) =>
    raw
      .prepare(
        `INSERT INTO task_sections (id, list_id, name, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, listId, `Sekcija ${id}`, position, now(), now());

  const seedTask = (
    raw: Handle,
    id: string,
    profileId: string,
    listId: string,
    sectionId: string | null,
  ) => {
    raw
      .prepare(
        `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'todo', ?, ?)`,
      )
      .run(id, profileId, `Zadatak ${id}`, now(), now());
    raw
      .prepare("UPDATE tasks SET list_id = ?, section_id = ? WHERE id = ?")
      .run(listId, sectionId, id);
  };

  /** As every rebuild migration's own helper: a connection held at exactly `version`, set up the way `openDatabase` sets one up. */
  function openAtVersion(path: string, version: number): Handle {
    const raw = new Database(path);
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      raw,
      MIGRATIONS.filter((migration) => migration.version <= version),
    );
    return raw;
  }

  /** A 037 database holding the whole shape the rebuild has to carry: nested lists, headings, and tasks filed into both. */
  function seedTaskWorld(raw: Handle): void {
    seedProfile(raw, "p1");
    seedList(raw, "tl1", "p1", null, "kanban", 1024);
    seedList(raw, "tl2", "p1", "tl1", "list", 2048);
    seedSection(raw, "ts1", "tl1", 1024);
    seedSection(raw, "ts2", "tl1", 2048);
    seedSection(raw, "ts3", "tl2", 1024);
    seedTask(raw, "t1", "p1", "tl1", "ts1");
    seedTask(raw, "t2", "p1", "tl1", null);
    seedTask(raw, "t3", "p1", "tl2", "ts3");
  }

  it("widens default_view to the four-shape set and adds a nullable view_config", () => {
    const db = openDatabase({ path: join(dir, "views-038.db") });
    expect(columnNames(db.raw, "task_lists")).toEqual(
      expect.arrayContaining(["default_view", "view_config"]),
    );
    insertProfile(db, "p1");
    for (const view of ["list", "kanban", "cards", "calendar"]) {
      expect(() => seedList(db.raw, `tl-${view}`, "p1", null, view)).not.toThrow();
    }
    expect(() => seedList(db.raw, "tl-gantt", "p1", null, "gantt")).toThrow();
    expect(
      db.raw.prepare("SELECT view_config FROM task_lists WHERE id = ?").get("tl-list"),
    ).toEqual({ view_config: null });
    db.close();
  });

  it("leaves view_config free of any CHECK — the store is the gate for a JSON column", () => {
    const db = openDatabase({ path: join(dir, "view-config-038.db") });
    insertProfile(db, "p1");
    seedList(db.raw, "tl1", "p1", null);
    expect(() =>
      db.raw
        .prepare("UPDATE task_lists SET view_config = ? WHERE id = ?")
        .run('{"kanban":{"groupBy":"section"}}', "tl1"),
    ).not.toThrow();
    db.close();
  });

  it("leaves no rebuild scaffolding behind", () => {
    const db = openDatabase({ path: join(dir, "scaffolding-038.db") });
    const tables = tableNamesOf(db.raw);
    for (const name of ["task_lists_new", "task_lists_hold", "task_sections_hold"]) {
      expect({ name, present: tables.includes(name) }).toEqual({ name, present: false });
    }
    db.close();
  });

  it("carries every list, heading and placement of a seeded 037 database through the parent rebuild", () => {
    const path = join(dir, "upgrade-038.db");
    const before = openAtVersion(path, 37);
    seedTaskWorld(before);
    expect(before.pragma("user_version", { simple: true })).toBe(37);
    before.close();

    const db = openDatabase({ path });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);

    expect(
      db.raw
        .prepare(
          "SELECT id, parent_id, default_view, view_config, position FROM task_lists ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: "tl1", parent_id: null, default_view: "kanban", view_config: null, position: 1024 },
      { id: "tl2", parent_id: "tl1", default_view: "list", view_config: null, position: 2048 },
    ]);
    // The cascade the drop fires would have emptied this table outright.
    expect(db.raw.prepare("SELECT id, list_id FROM task_sections ORDER BY id").all()).toEqual([
      { id: "ts1", list_id: "tl1" },
      { id: "ts2", list_id: "tl1" },
      { id: "ts3", list_id: "tl2" },
    ]);
    expect(
      db.raw.prepare("SELECT id, list_id, section_id FROM tasks ORDER BY id").all(),
    ).toEqual([
      { id: "t1", list_id: "tl1", section_id: "ts1" },
      { id: "t2", list_id: "tl1", section_id: null },
      { id: "t3", list_id: "tl2", section_id: "ts3" },
    ]);
    expect(db.raw.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });

  it("leaves every child foreign key pointing at the REBUILT table", () => {
    const path = join(dir, "fk-038.db");
    const before = openAtVersion(path, 37);
    seedTaskWorld(before);
    before.close();

    const db = openDatabase({ path });
    // A reference to a list/section that does not exist is still refused, which
    // it could not be if the clauses still named the dropped table.
    expect(() =>
      db.raw.prepare("UPDATE tasks SET list_id = ? WHERE id = ?").run("ghost", "t1"),
    ).toThrow();
    expect(() =>
      db.raw.prepare("UPDATE tasks SET section_id = ? WHERE id = ?").run("ghost", "t1"),
    ).toThrow();
    expect(() =>
      db.raw.prepare("UPDATE task_sections SET list_id = ? WHERE id = ?").run("ghost", "ts1"),
    ).toThrow();
    // The self-reference survived its own rename too.
    expect(() => seedList(db.raw, "tlx", "p1", "ghost")).toThrow();
    db.close();
  });

  it("still cascades a list's headings away with it, and the whole tree away with its profile", () => {
    const path = join(dir, "cascade-038.db");
    const before = openAtVersion(path, 37);
    seedTaskWorld(before);
    before.close();

    const db = openDatabase({ path });
    // Deleting one list takes its headings — the ON DELETE CASCADE the rebuild
    // had to survive. Its tasks go first: `tasks.list_id` is NO ACTION, exactly
    // as it was before.
    db.raw.prepare("DELETE FROM tasks WHERE list_id = 'tl2'").run();
    db.raw.prepare("DELETE FROM task_lists WHERE id = 'tl2'").run();
    expect(db.raw.prepare("SELECT id FROM task_sections ORDER BY id").all()).toEqual([
      { id: "ts1" },
      { id: "ts2" },
    ]);

    db.raw.prepare("DELETE FROM tasks WHERE profile_id = 'p1'").run();
    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    for (const table of ["task_lists", "task_sections"]) {
      const { n } = db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      expect({ table, n }).toEqual({ table, n: 0 });
    }
    db.close();
  });
});

describe("migration 039 — a note folder's default view", () => {
  type Handle = Database.Database;

  const now = () => new Date().toISOString();

  const insertFolder = (db: NexusDatabase, id: string, profileId: string, defaultView = "list") =>
    db.raw
      .prepare(
        `INSERT INTO note_folders
           (id, profile_id, parent_id, name, color, default_template_id, is_capture_default,
            default_view, created_at, updated_at)
         VALUES (?, ?, NULL, ?, NULL, NULL, 0, ?, ?, ?)`,
      )
      .run(id, profileId, `F${id}`, defaultView, now(), now());

  /** As every upgrade test's helper: a connection held at exactly `version`, set up the way `openDatabase` sets one up. */
  function openAtVersion(path: string, version: number): Handle {
    const raw = new Database(path);
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      raw,
      MIGRATIONS.filter((migration) => migration.version <= version),
    );
    return raw;
  }

  it("adds default_view to note_folders and stamps the latest user_version", () => {
    const db = openDatabase({ path: join(dir, "folder-view-039.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(note_folders)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toContain("default_view");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("accepts both shapes and refuses anything else with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-view-039.db") });
    insertProfile(db, "p1");
    for (const view of ["list", "cards"]) {
      expect(() => insertFolder(db, `f-${view}`, "p1", view)).not.toThrow();
    }
    // The three shapes a TASK list has but a note folder does not (migration
    // 038's set is wider on purpose), plus the empty string.
    for (const view of ["kanban", "calendar", "grid", "", "List"]) {
      expect(() => insertFolder(db, `bad-${view}`, "p1", view), view).toThrow();
    }
    db.close();
  });

  it("defaults a folder written through the PRE-039 column list to 'list'", () => {
    const db = openDatabase({ path: join(dir, "default-view-039.db") });
    insertProfile(db, "p1");
    db.raw
      .prepare(
        `INSERT INTO note_folders (id, profile_id, parent_id, name, color, created_at, updated_at)
         VALUES (?, ?, NULL, 'F', NULL, ?, ?)`,
      )
      .run("f1", "p1", now(), now());
    expect(
      db.raw.prepare("SELECT default_view FROM note_folders WHERE id = ?").get("f1"),
    ).toEqual({ default_view: "list" });
    db.close();
  });

  it("gives every folder of a seeded 038 database the 'list' it already opened as", () => {
    const path = join(dir, "upgrade-039.db");
    const before = openAtVersion(path, 38);
    before
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run("p1", "personal", "P", now());
    for (const [id, parentId] of [
      ["nf1", null],
      ["nf2", "nf1"],
    ] as [string, string | null][]) {
      before
        .prepare(
          `INSERT INTO note_folders (id, profile_id, parent_id, name, color, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'zlato', ?, ?)`,
        )
        .run(id, "p1", parentId, `F${id}`, now(), now());
    }
    expect(before.pragma("user_version", { simple: true })).toBe(38);
    before.close();

    const db = openDatabase({ path });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    // An ADD COLUMN, so the tree is untouched — no rebuild, nothing to lose.
    expect(
      db.raw
        .prepare("SELECT id, parent_id, color, default_view FROM note_folders ORDER BY id")
        .all(),
    ).toEqual([
      { id: "nf1", parent_id: null, color: "zlato", default_view: "list" },
      { id: "nf2", parent_id: "nf1", color: "zlato", default_view: "list" },
    ]);
    expect(db.raw.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });

  it("leaves migration 028's capture-default index standing — nothing was rebuilt", () => {
    const db = openDatabase({ path: join(dir, "index-039.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("note_folders_capture_default");

    insertProfile(db, "p1");
    db.raw
      .prepare(
        `INSERT INTO note_folders
           (id, profile_id, parent_id, name, color, default_template_id, is_capture_default,
            default_view, created_at, updated_at)
         VALUES (?, ?, NULL, 'F', NULL, NULL, 1, 'cards', ?, ?)`,
      )
      .run("f1", "p1", now(), now());
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO note_folders
             (id, profile_id, parent_id, name, color, default_template_id, is_capture_default,
              default_view, created_at, updated_at)
           VALUES (?, ?, NULL, 'G', NULL, NULL, 1, 'list', ?, ?)`,
        )
        .run("f2", "p1", now(), now()),
    ).toThrow();
    db.close();
  });
});

describe("migration 040 — profile picture", () => {
  const columnNames = (db: NexusDatabase, table: string): string[] =>
    (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (row) => row.name,
    );

  const HASH = "b".repeat(64);

  /**
   * Writes the picture trio straight onto a profile row, bypassing the store
   * entirely — which is exactly the path the CHECKs exist for: a restore writes
   * raw `UPDATE`s, and a constraint is what holds when no store is involved.
   */
  const setPicture = (
    db: NexusDatabase,
    profileId: string,
    hash: string | null,
    mime: string | null,
    sizeBytes: number | null,
  ) =>
    db.raw
      .prepare(
        `UPDATE profiles
            SET picture_hash = ?, picture_mime = ?, picture_size_bytes = ?
          WHERE id = ?`,
      )
      .run(hash, mime, sizeBytes, profileId);

  it("adds the three picture columns and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(columnNames(db, "profiles")).toEqual(
      expect.arrayContaining(["picture_hash", "picture_mime", "picture_size_bytes"]),
    );
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the profiles_picture index the blob refcount and mime lookup both read", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("profiles_picture");
    db.close();
  });

  it("leaves a profile created without one with no picture", () => {
    const db = openDatabase({ path: join(dir, "no-picture.db") });
    insertProfile(db, "p1");
    expect(
      db.raw
        .prepare("SELECT picture_hash, picture_mime, picture_size_bytes FROM profiles WHERE id = ?")
        .get("p1"),
    ).toEqual({ picture_hash: null, picture_mime: null, picture_size_bytes: null });
    db.close();
  });

  it("accepts the trio all set and all null, and refuses every half-set combination", () => {
    const db = openDatabase({ path: join(dir, "trio.db") });
    insertProfile(db, "p1");

    expect(() => setPicture(db, "p1", HASH, "image/png", 512)).not.toThrow();
    expect(() => setPicture(db, "p1", null, null, null)).not.toThrow();

    expect(() => setPicture(db, "p1", HASH, null, 512)).toThrow();
    expect(() => setPicture(db, "p1", HASH, "image/png", null)).toThrow();
    expect(() => setPicture(db, "p1", null, "image/png", 512)).toThrow();
    expect(() => setPicture(db, "p1", null, null, 512)).toThrow();
    db.close();
  });

  it("refuses a non-positive size", () => {
    const db = openDatabase({ path: join(dir, "size.db") });
    insertProfile(db, "p1");
    expect(() => setPicture(db, "p1", HASH, "image/png", 0)).toThrow();
    expect(() => setPicture(db, "p1", HASH, "image/png", -1)).toThrow();
    db.close();
  });

  it("upgrades a database written before it, keeping the profile it already held", () => {
    const path = join(dir, "upgrade-040.db");
    const before = new Database(path);
    before.pragma("journal_mode = WAL");
    before.pragma("foreign_keys = ON");
    before.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      before,
      MIGRATIONS.filter((migration) => migration.version < 40),
    );
    before
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run("p1", "personal", "Stari profil", new Date().toISOString());
    before.close();

    const db = openDatabase({ path });
    expect(
      db.raw
        .prepare(
          "SELECT name, picture_hash, picture_mime, picture_size_bytes FROM profiles WHERE id = ?",
        )
        .get("p1"),
    ).toEqual({
      name: "Stari profil",
      picture_hash: null,
      picture_mime: null,
      picture_size_bytes: null,
    });
    db.close();
  });
});
