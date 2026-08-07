import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import {
  CLOZE_MASK,
  clozeNumbers,
  findClozeRuns,
  foldSearchText,
  renderClozeCard,
} from "@nexus/core";
import { CardStore, MIGRATIONS, NexusDatabase, openDatabase, runMigrations } from "../index.js";

/**
 * Derived, not spelled out sixteen times over: every migration's own suite
 * asserts that a fresh database is stamped with the *latest* version, which is
 * a statement about `MIGRATIONS`, not about any particular number. The number
 * itself is pinned once, just below, so adding a migration is a one-line edit
 * here instead of a sweep through every describe block.
 */
const LATEST_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);

describe("the migration list", () => {
  it("is at version 60 (the canvas boards, then FIT training and body), ascending and gap-free from 1", () => {
    expect(LATEST_VERSION).toBe(60);
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

describe("migration 041 — the default snooze preset", () => {
  const columnNames = (db: NexusDatabase, table: string): string[] =>
    (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (row) => row.name,
    );
  const now = () => new Date().toISOString();

  /**
   * Writes `ntf_settings` raw, either naming the new column or leaving it to
   * its default — the two shapes that matter, because a restore writes this row
   * by naming its columns while every row a pre-041 database holds never named
   * this one at all.
   */
  const insertNtfSettings = (db: NexusDatabase, profileId: string, snoozeDefault?: string) =>
    snoozeDefault === undefined
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
               (profile_id, quiet_from, quiet_to, morning_hour, snooze_default, created_at, updated_at)
             VALUES (?, NULL, NULL, '08:00', ?, ?, ?)`,
          )
          .run(profileId, snoozeDefault, now(), now());

  it("adds snooze_default to ntf_settings and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(columnNames(db, "ntf_settings")).toContain("snooze_default");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("defaults to 10m — the shortest preset, and what every snooze button did before it existed", () => {
    const db = openDatabase({ path: join(dir, "default.db") });
    insertProfile(db, "p1");
    insertNtfSettings(db, "p1");
    expect(
      db.raw.prepare("SELECT snooze_default FROM ntf_settings WHERE profile_id = ?").get("p1"),
    ).toEqual({ snooze_default: "10m" });
    db.close();
  });

  it("accepts each of the four presets and refuses anything else with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-snooze.db") });
    for (const [index, preset] of ["10m", "1h", "tonight", "tomorrow-morning"].entries()) {
      const profileId = `p${index}`;
      insertProfile(db, profileId);
      expect(() => insertNtfSettings(db, profileId, preset)).not.toThrow();
    }
    insertProfile(db, "bad");
    expect(() => insertNtfSettings(db, "bad", "30m")).toThrow();
    expect(() => insertNtfSettings(db, "bad", "")).toThrow();
    db.close();
  });

  it("upgrades a database written before it, leaving the settings it already held on the default", () => {
    const path = join(dir, "upgrade-041.db");
    const before = new Database(path);
    before.pragma("journal_mode = WAL");
    before.pragma("foreign_keys = ON");
    before.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      before,
      MIGRATIONS.filter((migration) => migration.version < 41),
    );
    before
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run("p1", "personal", "Stari profil", now());
    before
      .prepare(
        `INSERT INTO ntf_settings
           (profile_id, quiet_from, quiet_to, morning_hour, created_at, updated_at)
         VALUES (?, '22:00', '07:00', '09:00', ?, ?)`,
      )
      .run("p1", now(), now());
    before.close();

    const db = openDatabase({ path });
    expect(
      db.raw
        .prepare(
          "SELECT quiet_from, morning_hour, snooze_default FROM ntf_settings WHERE profile_id = ?",
        )
        .get("p1"),
    ).toEqual({ quiet_from: "22:00", morning_hour: "09:00", snooze_default: "10m" });
    db.close();
  });
});

describe("migration 042 — calendar settings", () => {
  /**
   * Writes `calendar_settings` raw, one column list either way — the CHECKs
   * are per-column GLOBs plus one pair rule, so half-set rows are legal at the
   * TABLE (a single upsert statement stages them) and refused by the store.
   */
  const insertCalendarSettings = (
    db: NexusDatabase,
    profileId: string,
    semesterStart: string | null,
    semesterEnd: string | null,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO calendar_settings (profile_id, semester_start, semester_end)
         VALUES (?, ?, ?)`,
      )
      .run(profileId, semesterStart, semesterEnd);

  it("creates the calendar_settings table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("calendar_settings");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("accepts the pair both set, both null — and each half alone (the store's rule, not the table's)", () => {
    const db = openDatabase({ path: join(dir, "pair.db") });
    for (const id of ["p1", "p2", "p3", "p4"]) insertProfile(db, id);
    expect(() => insertCalendarSettings(db, "p1", "2026-10-01", "2027-01-31")).not.toThrow();
    expect(() => insertCalendarSettings(db, "p2", null, null)).not.toThrow();
    // Half-set is legal HERE so one upsert statement can stage either column;
    // both-or-neither is `CalendarSettingsStore`'s own gate.
    expect(() => insertCalendarSettings(db, "p3", "2026-10-01", null)).not.toThrow();
    expect(() => insertCalendarSettings(db, "p4", null, "2027-01-31")).not.toThrow();
    db.close();
  });

  it("rejects a date outside the YYYY-MM-DD shape with the GLOB CHECK", () => {
    const db = openDatabase({ path: join(dir, "glob.db") });
    insertProfile(db, "p1");
    expect(() => insertCalendarSettings(db, "p1", "oktobar", "2027-01-31")).toThrow();
    expect(() => insertCalendarSettings(db, "p1", "2026-10-1", "2027-01-31")).toThrow();
    expect(() => insertCalendarSettings(db, "p1", "2026-10-01", "31.01.2027")).toThrow();
    db.close();
  });

  it("rejects a start after its end with the pair CHECK", () => {
    const db = openDatabase({ path: join(dir, "order.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    expect(() => insertCalendarSettings(db, "p1", "2027-02-01", "2026-10-01")).toThrow();
    // One-day terms are legal: equality is inside the closed range.
    expect(() => insertCalendarSettings(db, "p2", "2026-10-01", "2026-10-01")).not.toThrow();
    db.close();
  });

  it("allows at most one row per profile", () => {
    const db = openDatabase({ path: join(dir, "singleton.db") });
    insertProfile(db, "p1");
    insertCalendarSettings(db, "p1", "2026-10-01", "2027-01-31");
    expect(() => insertCalendarSettings(db, "p1", null, null)).toThrow();
    db.close();
  });

  it("cascades calendar_settings deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    insertCalendarSettings(db, "p1", "2026-10-01", "2027-01-31");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM calendar_settings").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("upgrades a database written before it, leaving the profile with no row", () => {
    const path = join(dir, "upgrade-042.db");
    const before = new Database(path);
    before.pragma("journal_mode = WAL");
    before.pragma("foreign_keys = ON");
    before.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      before,
      MIGRATIONS.filter((migration) => migration.version < 42),
    );
    before
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run("p1", "personal", "Stari profil", new Date().toISOString());
    before.close();

    const db = openDatabase({ path });
    expect(tableNames(db)).toContain("calendar_settings");
    // No row IS "unset": the store's get-or-default answers both-null for it.
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM calendar_settings").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});


describe("migration 043 — named dashboards (DASH-008 / ADR-055)", () => {
  const now = () => new Date().toISOString();

  const columnNames = (db: NexusDatabase, table: string): string[] =>
    (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (row) => row.name,
    );

  const insertSet = (db: NexusDatabase, id: string, profileId: string, name = "Fakultet") =>
    db.raw
      .prepare(
        `INSERT INTO dashboard_sets (id, profile_id, name, position, created_at, updated_at)
         VALUES (?, ?, ?, 1024, ?, ?)`,
      )
      .run(id, profileId, name, now(), now());

  const insertWidget = (db: NexusDatabase, id: string, profileId: string, setId: string | null) =>
    db.raw
      .prepare(
        `INSERT INTO dashboard_widgets
           (profile_id, instance_id, widget_id, size, position, set_id, config, created_at, updated_at)
         VALUES (?, ?, 'calendar:danas', 'M', 1024, ?, NULL, ?, ?)`,
      )
      .run(profileId, id, setId, now(), now());

  it("creates the dashboard_sets table, its index, and stamps the latest user_version", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("dashboard_sets");
    expect(columnNames(db, "dashboard_sets")).toEqual([
      "id", "profile_id", "name", "position", "created_at", "updated_at",
    ]);
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'dashboard_sets'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("dashboard_sets_profile_position");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("adds set_id to dashboard_widgets and active_set_id to dashboard_settings, both NULL", () => {
    const db = openDatabase({ path: join(dir, "columns.db") });
    expect(columnNames(db, "dashboard_widgets")).toContain("set_id");
    expect(columnNames(db, "dashboard_settings")).toContain("active_set_id");
    insertProfile(db, "p1");
    insertWidget(db, "w-null", "p1", null); // NULL set_id IS the default dashboard
    expect(
      db.raw.prepare("SELECT set_id FROM dashboard_widgets WHERE instance_id = ?").get("w-null"),
    ).toEqual({ set_id: null });
    db.close();
  });

  it("enforces the set_id foreign key on dashboard_widgets", () => {
    const db = openDatabase({ path: join(dir, "fk.db") });
    insertProfile(db, "p1");
    expect(() => insertWidget(db, "w-bad", "p1", "no-such-set")).toThrow();
    insertSet(db, "set1", "p1");
    expect(() => insertWidget(db, "w-ok", "p1", "set1")).not.toThrow();
    db.close();
  });

  it("cascades set deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    insertSet(db, "set1", "p1");
    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM dashboard_sets").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("upgrades a database written before it, leaving existing widget rows on the default set", () => {
    const path = join(dir, "upgrade-043.db");
    const before = new Database(path);
    before.pragma("journal_mode = WAL");
    before.pragma("foreign_keys = ON");
    before.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      before,
      MIGRATIONS.filter((migration) => migration.version < 43),
    );
    before
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run("p1", "personal", "Stari profil", now());
    before
      .prepare(
        `INSERT INTO dashboard_widgets
           (profile_id, instance_id, widget_id, size, position, config, created_at, updated_at)
         VALUES (?, ?, 'calendar:danas', 'L', 1024, NULL, ?, ?)`,
      )
      .run("p1", "w1", now(), now());
    before.close();

    const db = openDatabase({ path });
    expect(
      db.raw
        .prepare("SELECT size, set_id FROM dashboard_widgets WHERE instance_id = ?")
        .get("w1"),
    ).toEqual({ size: "L", set_id: null });
    db.close();
  });
});


describe("migration 044 — backup settings", () => {
  const now = () => new Date().toISOString();

  /** Writes a `backup_settings` row raw, defaulting to a fully-configured, disabled one; `overrides` names what a test bends. */
  const insertSettings = (
    db: NexusDatabase,
    profileId: string,
    overrides: Partial<{
      enabled: number;
      cadence: string;
      folderPath: string | null;
      passphraseWrapped: string | null;
      keepLast: number;
      lastStatus: string | null;
      lastError: string | null;
    }> = {},
  ) => {
    const row = {
      enabled: 0,
      cadence: "daily",
      folderPath: "C:\\Backups" as string | null,
      passphraseWrapped: '{"v":1}' as string | null,
      keepLast: 5,
      lastStatus: null as string | null,
      lastError: null as string | null,
      ...overrides,
    };
    db.raw
      .prepare(
        `INSERT INTO backup_settings
           (profile_id, enabled, cadence, folder_path, passphrase_wrapped, keep_last,
            last_run_at, last_status, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        profileId,
        row.enabled,
        row.cadence,
        row.folderPath,
        row.passphraseWrapped,
        row.keepLast,
        row.lastStatus,
        row.lastError,
        now(),
        now(),
      );
  };

  it("creates the backup_settings table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("backup_settings");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("accepts both cadences and refuses anything else with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-cadence.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertProfile(db, "bad");
    expect(() => insertSettings(db, "p1", { cadence: "daily" })).not.toThrow();
    expect(() => insertSettings(db, "p2", { cadence: "weekly" })).not.toThrow();
    expect(() => insertSettings(db, "bad", { cadence: "hourly" })).toThrow();
    db.close();
  });

  it("holds keep_last inside 2..50 with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-keep.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertProfile(db, "bad");
    expect(() => insertSettings(db, "p1", { keepLast: 2 })).not.toThrow();
    expect(() => insertSettings(db, "p2", { keepLast: 50 })).not.toThrow();
    expect(() => insertSettings(db, "bad", { keepLast: 1 })).toThrow();
    expect(() => insertSettings(db, "bad", { keepLast: 51 })).toThrow();
    db.close();
  });

  it("refuses an enabled schedule without a folder or without a wrapped passphrase", () => {
    const db = openDatabase({ path: join(dir, "check-enabled.db") });
    insertProfile(db, "p1");
    insertProfile(db, "bad");
    expect(() => insertSettings(db, "p1", { enabled: 1 })).not.toThrow();
    expect(() => insertSettings(db, "bad", { enabled: 1, folderPath: null })).toThrow();
    expect(() => insertSettings(db, "bad", { enabled: 1, passphraseWrapped: null })).toThrow();
    db.close();
  });

  it("allows last_error only beside a failed status", () => {
    const db = openDatabase({ path: join(dir, "check-error.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertProfile(db, "bad");
    expect(() =>
      insertSettings(db, "p1", { lastStatus: "failed", lastError: "folder-unreachable" }),
    ).not.toThrow();
    expect(() => insertSettings(db, "p2", { lastStatus: "ok" })).not.toThrow();
    expect(() => insertSettings(db, "bad", { lastStatus: "ok", lastError: "x" })).toThrow();
    expect(() => insertSettings(db, "bad", { lastStatus: "done" })).toThrow();
    db.close();
  });

  it("cascades settings deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    insertSettings(db, "p1");
    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(db.raw.prepare("SELECT count(*) AS n FROM backup_settings").get()).toEqual({ n: 0 });
    db.close();
  });
});

describe("migration 045 — private notes", () => {
  const now = () => new Date().toISOString();

  const insertNote = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO private_notes (id, profile_id, sealed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, Buffer.from([1, 2, 3]), now(), now());

  const insertVersion = (db: NexusDatabase, noteId: string, seq: number) =>
    db.raw
      .prepare(
        `INSERT INTO private_note_versions (note_id, seq, sealed, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(noteId, seq, Buffer.from([4, 5, 6]), now());

  /** Writes a `private_settings` row raw, defaulting to a valid credential-only one; `overrides` names what a test bends. */
  const insertSettings = (
    db: NexusDatabase,
    profileId: string,
    overrides: Partial<{
      kitSalt: string | null;
      kitWrap: string | null;
      usesAccountPasscode: number;
      autoLockMinutes: number;
      lockOnMinimize: number;
    }> = {},
  ) => {
    const row = {
      kitSalt: null as string | null,
      kitWrap: null as string | null,
      usesAccountPasscode: 0,
      autoLockMinutes: 5,
      lockOnMinimize: 1,
      ...overrides,
    };
    db.raw
      .prepare(
        `INSERT INTO private_settings
           (profile_id, kdf, pass_salt, pass_wrap, kit_salt, kit_wrap,
            uses_account_passcode, auto_lock_minutes, lock_on_minimize, created_at, updated_at)
         VALUES (?, '{"algorithm":"argon2id"}', 'c2FsdA==', '{"v":1}', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profileId,
        row.kitSalt,
        row.kitWrap,
        row.usesAccountPasscode,
        row.autoLockMinutes,
        row.lockOnMinimize,
        now(),
        now(),
      );
  };

  it("creates all three private tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("private_notes");
    expect(names).toContain("private_note_versions");
    expect(names).toContain("private_settings");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("keeps the cleartext surface to ids and timestamps only — no title, no plaintext column", () => {
    const db = openDatabase({ path: join(dir, "columns.db") });
    const columns = (
      db.raw.prepare(`PRAGMA table_info(private_notes)`).all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns.sort()).toEqual(["created_at", "id", "profile_id", "sealed", "updated_at"]);
    db.close();
  });

  it("creates the private_notes_profile_updated index for list ordering", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("private_notes_profile_updated");
    db.close();
  });

  it("enforces PRIMARY KEY (note_id, seq) on private_note_versions", () => {
    const db = openDatabase({ path: join(dir, "unique-seq.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertVersion(db, "n1", 1);
    expect(() => insertVersion(db, "n1", 1)).toThrow();
    expect(() => insertVersion(db, "n1", 2)).not.toThrow();
    db.close();
  });

  it("cascades notes, versions and settings when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertVersion(db, "n1", 1);
    insertSettings(db, "p1");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    for (const table of ["private_notes", "private_note_versions", "private_settings"]) {
      const { n } = db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      expect({ table, n }).toEqual({ table, n: 0 });
    }
    db.close();
  });

  it("cascades version deletion when the owning note is removed — a hard delete takes the history with it", () => {
    const db = openDatabase({ path: join(dir, "cascade-note.db") });
    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    insertVersion(db, "n1", 1);
    insertVersion(db, "n1", 2);

    db.raw.prepare("DELETE FROM private_notes WHERE id = ?").run("n1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM private_note_versions").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("holds auto_lock_minutes inside 1..60 with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-autolock.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertProfile(db, "bad");
    expect(() => insertSettings(db, "p1", { autoLockMinutes: 1 })).not.toThrow();
    expect(() => insertSettings(db, "p2", { autoLockMinutes: 60 })).not.toThrow();
    expect(() => insertSettings(db, "bad", { autoLockMinutes: 0 })).toThrow();
    expect(() => insertSettings(db, "bad", { autoLockMinutes: 61 })).toThrow();
    db.close();
  });

  it("holds the two flags to {0, 1} with CHECKs", () => {
    const db = openDatabase({ path: join(dir, "check-flags.db") });
    insertProfile(db, "p1");
    insertProfile(db, "bad");
    expect(() => insertSettings(db, "p1", { usesAccountPasscode: 1 })).not.toThrow();
    expect(() => insertSettings(db, "bad", { usesAccountPasscode: 2 })).toThrow();
    expect(() => insertSettings(db, "bad", { lockOnMinimize: 2 })).toThrow();
    db.close();
  });

  it("refuses a kit salt without a kit wrap and the reverse — both or neither", () => {
    const db = openDatabase({ path: join(dir, "check-kit.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertProfile(db, "bad");
    expect(() => insertSettings(db, "p1")).not.toThrow();
    expect(() => insertSettings(db, "p2", { kitSalt: "a2l0", kitWrap: '{"v":1}' })).not.toThrow();
    expect(() => insertSettings(db, "bad", { kitSalt: "a2l0" })).toThrow();
    expect(() => insertSettings(db, "bad", { kitWrap: '{"v":1}' })).toThrow();
    db.close();
  });
});

describe("migration 046 — exam topics (ADR-063)", () => {
  const now = () => new Date().toISOString();

  const insertSubject = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, 'x', 'jade', ?, ?)`,
      )
      .run(id, profileId, now(), now());

  const insertExam = (db: NexusDatabase, id: string, profileId: string, subjectId: string) =>
    db.raw
      .prepare(
        `INSERT INTO exams (id, profile_id, subject_id, exam_type, exam_date, created_at, updated_at)
         VALUES (?, ?, ?, 'pismeni', '2026-09-01', ?, ?)`,
      )
      .run(id, profileId, subjectId, now(), now());

  const insertDeck = (db: NexusDatabase, id: string, profileId: string, subjectId: string) =>
    db.raw
      .prepare(
        `INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at)
         VALUES (?, ?, ?, 'x', ?, ?)`,
      )
      .run(id, profileId, subjectId, now(), now());

  const insertPlan = (db: NexusDatabase, id: string, profileId: string, examId: string) =>
    db.raw
      .prepare(
        `INSERT INTO study_plans
           (id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost, created_at, updated_at)
         VALUES (?, ?, ?, 30, '2026-08-01', 1, ?, ?)`,
      )
      .run(id, profileId, examId, now(), now());

  const insertTopic = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    examId: string,
    overrides: Partial<{
      name: string;
      sortOrder: number;
      confidence: number | null;
      deckId: string | null;
      cut: number;
    }> = {},
  ) => {
    const row = {
      name: "Grafovi",
      sortOrder: 0,
      confidence: null as number | null,
      deckId: null as string | null,
      cut: 0,
      ...overrides,
    };
    return db.raw
      .prepare(
        `INSERT INTO exam_topics
           (id, profile_id, exam_id, name, sort_order, confidence, deck_id, cut, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, examId, row.name, row.sortOrder, row.confidence, row.deckId, row.cut, now(), now());
  };

  const insertBlock = (
    db: NexusDatabase,
    id: string,
    planId: string,
    profileId: string,
    blockDate: string,
    overrides: Partial<{ topicId: string | null; kind: string; pinned: number }> = {},
  ) => {
    const row = { topicId: null as string | null, kind: "coverage", pinned: 0, ...overrides };
    return db.raw
      .prepare(
        `INSERT INTO study_blocks
           (id, plan_id, profile_id, block_date, minutes, status, topic_id, kind, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, 30, 'planned', ?, ?, ?, ?, ?)`,
      )
      .run(id, planId, profileId, blockDate, row.topicId, row.kind, row.pinned, now(), now());
  };

  /** A profile with one subject, exam, deck and plan — everything a topic or block can point at. */
  function studyFixture(db: NexusDatabase): void {
    insertProfile(db, "p1");
    insertSubject(db, "s1", "p1");
    insertExam(db, "e1", "p1", "s1");
    insertDeck(db, "dk1", "p1", "s1");
    insertPlan(db, "pl1", "p1", "e1");
  }

  it("creates exam_topics, its index, and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("exam_topics");
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("exam_topics_profile_exam_active");
    expect(indexes).toContain("study_blocks_plan_date_topic_kind");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("rejects an empty topic name with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-name.db") });
    studyFixture(db);
    expect(() => insertTopic(db, "t1", "p1", "e1", { name: "" })).toThrow();
    expect(() => insertTopic(db, "t2", "p1", "e1", { name: "Stabla" })).not.toThrow();
    db.close();
  });

  it("holds confidence inside 0..100 (or NULL) with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-confidence.db") });
    studyFixture(db);
    expect(() => insertTopic(db, "t1", "p1", "e1", { confidence: -1 })).toThrow();
    expect(() => insertTopic(db, "t2", "p1", "e1", { confidence: 101 })).toThrow();
    expect(() => insertTopic(db, "t3", "p1", "e1", { confidence: 0 })).not.toThrow();
    expect(() => insertTopic(db, "t4", "p1", "e1", { confidence: 100, sortOrder: 1 })).not.toThrow();
    expect(() => insertTopic(db, "t5", "p1", "e1", { confidence: null, sortOrder: 2 })).not.toThrow();
    db.close();
  });

  it("holds cut to {0, 1} with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check-cut.db") });
    studyFixture(db);
    expect(() => insertTopic(db, "t1", "p1", "e1", { cut: 2 })).toThrow();
    expect(() => insertTopic(db, "t2", "p1", "e1", { cut: 1 })).not.toThrow();
    db.close();
  });

  it("cascades topic deletion from the exam and SET-NULLs a topic's deck link when the deck row goes", () => {
    const db = openDatabase({ path: join(dir, "topic-fks.db") });
    studyFixture(db);
    insertTopic(db, "t1", "p1", "e1", { deckId: "dk1" });

    db.raw.prepare("DELETE FROM decks WHERE id = ?").run("dk1");
    const row = db.raw
      .prepare("SELECT deck_id FROM exam_topics WHERE id = ?")
      .get("t1") as { deck_id: string | null };
    expect(row.deck_id).toBeNull();

    db.raw.prepare("DELETE FROM exams WHERE id = ?").run("e1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM exam_topics").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("gives study_blocks the three new columns with their defaults, and SET-NULLs topic_id when the topic row goes", () => {
    const db = openDatabase({ path: join(dir, "block-columns.db") });
    studyFixture(db);
    insertTopic(db, "t1", "p1", "e1");
    db.raw
      .prepare(
        `INSERT INTO study_blocks (id, plan_id, profile_id, block_date, minutes, status, created_at, updated_at)
         VALUES ('b1', 'pl1', 'p1', '2026-08-01', 30, 'planned', ?, ?)`,
      )
      .run(now(), now());
    const defaults = db.raw
      .prepare("SELECT topic_id, kind, pinned FROM study_blocks WHERE id = 'b1'")
      .get() as { topic_id: string | null; kind: string; pinned: number };
    expect(defaults).toEqual({ topic_id: null, kind: "coverage", pinned: 0 });

    insertBlock(db, "b2", "pl1", "p1", "2026-08-02", { topicId: "t1", kind: "revision", pinned: 1 });
    db.raw.prepare("DELETE FROM exam_topics WHERE id = 't1'").run();
    const orphan = db.raw
      .prepare("SELECT topic_id FROM study_blocks WHERE id = 'b2'")
      .get() as { topic_id: string | null };
    expect(orphan.topic_id).toBeNull();
    db.close();
  });

  it("rejects a block kind outside the closed set and a pinned outside {0, 1} with CHECKs", () => {
    const db = openDatabase({ path: join(dir, "check-block.db") });
    studyFixture(db);
    expect(() => insertBlock(db, "b1", "pl1", "p1", "2026-08-01", { kind: "cram" })).toThrow();
    expect(() => insertBlock(db, "b2", "pl1", "p1", "2026-08-01", { pinned: 2 })).toThrow();
    expect(() => insertBlock(db, "b3", "pl1", "p1", "2026-08-01", { kind: "recall" })).not.toThrow();
    db.close();
  });

  it("replaces UNIQUE(plan_id, block_date) with (plan_id, block_date, topic_id, kind) — NULL topics included", () => {
    const db = openDatabase({ path: join(dir, "unique-block.db") });
    studyFixture(db);
    insertTopic(db, "t1", "p1", "e1");
    insertBlock(db, "b1", "pl1", "p1", "2026-08-01");
    // The same (plan, date, NULL topic, kind) still collides — SQLite treats
    // UNIQUE NULLs as distinct, which is why the index goes through COALESCE.
    expect(() => insertBlock(db, "b2", "pl1", "p1", "2026-08-01")).toThrow();
    // A different kind, or a topic, on the same date is a different row now.
    expect(() => insertBlock(db, "b3", "pl1", "p1", "2026-08-01", { kind: "recall" })).not.toThrow();
    expect(() => insertBlock(db, "b4", "pl1", "p1", "2026-08-01", { topicId: "t1" })).not.toThrow();
    expect(() =>
      insertBlock(db, "b5", "pl1", "p1", "2026-08-01", { topicId: "t1", kind: "revision" }),
    ).not.toThrow();
    // But the exact same (plan, date, topic, kind) collides.
    expect(() => insertBlock(db, "b6", "pl1", "p1", "2026-08-01", { topicId: "t1" })).toThrow();
    db.close();
  });

  it("adds the nullable weekday_minutes column to study_plans", () => {
    const db = openDatabase({ path: join(dir, "plan-column.db") });
    studyFixture(db);
    const row = db.raw
      .prepare("SELECT weekday_minutes FROM study_plans WHERE id = 'pl1'")
      .get() as { weekday_minutes: string | null };
    expect(row.weekday_minutes).toBeNull();
    db.raw
      .prepare("UPDATE study_plans SET weekday_minutes = ? WHERE id = 'pl1'")
      .run("[30,30,30,30,30,0,60]");
    db.close();
  });

  it("carries every pre-046 block through the rebuild byte for byte, with the new columns defaulted", () => {
    const path = join(dir, "rebuild.db");
    const raw = new Database(path);
    try {
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      // Migration 017's backfill calls `nx_fold`; `openDatabase` registers it
      // before migrating, and this two-stage open has to do the same.
      raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
        typeof value === "string" ? foldSearchText(value) : null,
      );
      runMigrations(raw, MIGRATIONS.slice(0, 45));
      const t = "2026-01-01T00:00:00.000Z";
      raw
        .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)")
        .run(t);
      raw
        .prepare(
          `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
           VALUES ('s1', 'p1', 'x', 'jade', ?, ?)`,
        )
        .run(t, t);
      raw
        .prepare(
          `INSERT INTO exams (id, profile_id, subject_id, exam_type, exam_date, created_at, updated_at)
           VALUES ('e1', 'p1', 's1', 'pismeni', '2026-09-01', ?, ?)`,
        )
        .run(t, t);
      raw
        .prepare(
          `INSERT INTO study_plans
             (id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost, created_at, updated_at)
           VALUES ('pl1', 'p1', 'e1', 30, '2026-08-01', 1, ?, ?)`,
        )
        .run(t, t);
      raw
        .prepare(
          `INSERT INTO study_blocks
             (id, plan_id, profile_id, block_date, minutes, status, created_at, updated_at)
           VALUES ('b1', 'pl1', 'p1', '2026-08-05', 45, 'done', ?, ?)`,
        )
        .run(t, t);

      runMigrations(raw, MIGRATIONS);

      const row = raw.prepare("SELECT * FROM study_blocks WHERE id = 'b1'").get() as Record<
        string,
        unknown
      >;
      expect(row).toEqual({
        id: "b1",
        plan_id: "pl1",
        profile_id: "p1",
        block_date: "2026-08-05",
        minutes: 45,
        status: "done",
        topic_id: null,
        kind: "coverage",
        pinned: 0,
        created_at: t,
        updated_at: t,
      });
    } finally {
      raw.close();
    }
  });
});

describe("migration 047 — cloze deletion numbers (ADR-068)", () => {
  const T = "2026-01-01T00:00:00.000Z";
  type Handle = Database.Database;

  /**
   * A database migrated to 46 and seeded with the world a cloze card needs,
   * opened the two-stage way every data-migration test here opens one (see
   * migration 046's rebuild test for why `nx_fold` has to be registered first).
   */
  function seeded(name: string): Handle {
    const raw = new Database(join(dir, name));
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(raw, MIGRATIONS.slice(0, 46));
    raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)")
      .run(T);
    raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES ('s1', 'p1', 'x', 'jade', ?, ?)`,
      )
      .run(T, T);
    raw
      .prepare(
        `INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at)
         VALUES ('dk1', 'p1', 's1', 'Glava 1', ?, ?)`,
      )
      .run(T, T);
    raw
      .prepare(
        `INSERT INTO notes (id, profile_id, title, created_at, updated_at)
         VALUES ('n1', 'p1', 'Beleška', ?, ?)`,
      )
      .run(T, T);
    return raw;
  }

  /** One `cards` row as a 46-era build wrote it: `cloze_ordinal` is a 0-based POSITION. */
  function insertCard(
    raw: Handle,
    id: string,
    overrides: Partial<{
      front: string;
      back: string;
      kind: string;
      clozeText: string | null;
      clozeOrdinal: number | null;
      sourceNoteId: string | null;
      sourceBlockKey: string | null;
    }> = {},
  ): void {
    const row = {
      front: "Q",
      back: "A",
      kind: "basic",
      clozeText: null as string | null,
      clozeOrdinal: null as number | null,
      sourceNoteId: null as string | null,
      sourceBlockKey: null as string | null,
      ...overrides,
    };
    raw
      .prepare(
        `INSERT INTO cards
           (id, profile_id, deck_id, front, back, source_note_id, source_block_key,
            kind, cloze_text, cloze_ordinal, problem_steps,
            due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
            reps, lapses, state, last_review, created_at, updated_at, deleted_at)
         VALUES (?, 'p1', 'dk1', ?, ?, ?, ?, ?, ?, ?, NULL,
                 ?, 3, 5, 1, 2, 0, 4, 1, 2, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        row.front,
        row.back,
        row.sourceNoteId,
        row.sourceBlockKey,
        row.kind,
        row.clozeText,
        row.clozeOrdinal,
        T,
        T,
        T,
        T,
      );
  }

  /** One FSRS review of `cardId` — the history the rebase must not cost anybody. */
  function insertReview(raw: Handle, id: string, cardId: string): void {
    raw
      .prepare(
        `INSERT INTO review_log
           (id, profile_id, card_id, rating, state, due, stability, difficulty,
            elapsed_days, last_elapsed_days, scheduled_days, learning_steps, review, created_at)
         VALUES (?, 'p1', ?, 3, 2, ?, 3, 5, 1, 1, 2, 0, ?, ?)`,
      )
      .run(id, cardId, T, T, T);
  }

  const cardRow = (raw: Handle, id: string) =>
    raw.prepare("SELECT kind, cloze_ordinal, source_block_key FROM cards WHERE id = ?").get(id) as {
      kind: string;
      cloze_ordinal: number | null;
      source_block_key: string | null;
    };

  it("stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh-047.db") });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("rebases every cloze row's position onto its 1-based number, leaving basic rows alone", () => {
    const raw = seeded("rebase.db");
    try {
      insertCard(raw, "c-basic");
      insertCard(raw, "c0", { kind: "cloze", clozeText: "{{A}} i {{B}}", clozeOrdinal: 0 });
      insertCard(raw, "c1", { kind: "cloze", clozeText: "{{A}} i {{B}}", clozeOrdinal: 1 });

      runMigrations(raw, MIGRATIONS);

      expect(cardRow(raw, "c0").cloze_ordinal).toBe(1);
      expect(cardRow(raw, "c1").cloze_ordinal).toBe(2);
      expect(cardRow(raw, "c-basic").cloze_ordinal).toBeNull();
    } finally {
      raw.close();
    }
  });

  it("keeps every FSRS review row — the ADR-042 hazard a table rebuild would fire", () => {
    // `review_log` cascades from `cards`, and `PRAGMA foreign_keys` is a no-op
    // inside the transaction each migration runs in, so a create-copy-drop of
    // this table would delete a user's whole study history mid-migration. This
    // test is the pin: it fails the moment 047 stops being an UPDATE.
    const raw = seeded("history.db");
    try {
      insertCard(raw, "c0", { kind: "cloze", clozeText: "{{A}} i {{B}}", clozeOrdinal: 0 });
      insertCard(raw, "c1", { kind: "cloze", clozeText: "{{A}} i {{B}}", clozeOrdinal: 1 });
      insertReview(raw, "r1", "c0");
      insertReview(raw, "r2", "c0");
      insertReview(raw, "r3", "c1");

      runMigrations(raw, MIGRATIONS);

      expect(raw.prepare("SELECT id, card_id FROM review_log ORDER BY id").all()).toEqual([
        { id: "r1", card_id: "c0" },
        { id: "r2", card_id: "c0" },
        { id: "r3", card_id: "c1" },
      ]);
      // And the cards themselves are the same rows, not recreated ones.
      expect((raw.prepare("SELECT count(*) AS n FROM cards").get() as { n: number }).n).toBe(2);
    } finally {
      raw.close();
    }
  });

  it("rebases a note-derived card's `#N` key suffix in lockstep, past the UNIQUE slot it moves onto", () => {
    const raw = seeded("keys.db");
    try {
      insertCard(raw, "c0", {
        kind: "cloze",
        clozeText: "{{A}} i {{B}}",
        clozeOrdinal: 0,
        sourceNoteId: "n1",
        sourceBlockKey: "blok-1#0",
      });
      insertCard(raw, "c1", {
        kind: "cloze",
        clozeText: "{{A}} i {{B}}",
        clozeOrdinal: 1,
        sourceNoteId: "n1",
        sourceBlockKey: "blok-1#1",
      });
      // A Q/A card of the same note: no numeric suffix, so nothing to rebase.
      insertCard(raw, "c-qna", { sourceNoteId: "n1", sourceBlockKey: "blok-2" });
      // A pre-031 note-derived cloze row: still `basic` with a NULL ordinal
      // (ADR-042's lazy upgrade), and its key must move all the same.
      insertCard(raw, "c-stale", { sourceNoteId: "n1", sourceBlockKey: "blok-3#0" });

      runMigrations(raw, MIGRATIONS);

      expect(cardRow(raw, "c0").source_block_key).toBe("blok-1#1");
      expect(cardRow(raw, "c1").source_block_key).toBe("blok-1#2");
      expect(cardRow(raw, "c-qna").source_block_key).toBe("blok-2");
      expect(cardRow(raw, "c-stale")).toMatchObject({
        source_block_key: "blok-3#1",
        cloze_ordinal: null,
      });
    } finally {
      raw.close();
    }
  });

  it("rebases a two-digit suffix as a number, not as text", () => {
    const raw = seeded("two-digit.db");
    try {
      insertCard(raw, "c9", {
        kind: "cloze",
        clozeText: "{{A}}",
        clozeOrdinal: 9,
        sourceNoteId: "n1",
        sourceBlockKey: "blok-1#9",
      });
      runMigrations(raw, MIGRATIONS);
      expect(cardRow(raw, "c9")).toMatchObject({
        cloze_ordinal: 10,
        source_block_key: "blok-1#10",
      });
    } finally {
      raw.close();
    }
  });

  it("leaves a hand-made cloze card's NULL key and a non-numeric suffix alone", () => {
    const raw = seeded("untouched.db");
    try {
      insertCard(raw, "c-hand", { kind: "cloze", clozeText: "{{A}}", clozeOrdinal: 0 });
      insertCard(raw, "c-odd", { sourceNoteId: "n1", sourceBlockKey: "blok-4#x" });
      runMigrations(raw, MIGRATIONS);
      expect(cardRow(raw, "c-hand")).toMatchObject({ source_block_key: null, cloze_ordinal: 1 });
      expect(cardRow(raw, "c-odd").source_block_key).toBe("blok-4#x");
    } finally {
      raw.close();
    }
  });

  it("lets the note's NEXT sync find the same rows: no duplicate, no lost history", () => {
    // The whole reason the key suffix rebases with the ordinal. After 047 the
    // generator writes `#1`/`#2` for this block, and the reconcile has to match
    // the rows that are already there — otherwise every cloze card is
    // soft-deleted and recreated, FSRS history and all.
    const raw = seeded("resync.db");
    try {
      const template = "{{A}} i {{B}}";
      // The sides a 46-era build stored: rendered off the POSITIONS this
      // database still holds, which is what makes the sync below a true no-op
      // rather than a rewrite.
      insertCard(raw, "c0", {
        front: `${CLOZE_MASK} i B`,
        back: "A i B",
        kind: "cloze",
        clozeText: template,
        clozeOrdinal: 0,
        sourceNoteId: "n1",
        sourceBlockKey: "blok-1#0",
      });
      insertCard(raw, "c1", {
        front: `A i ${CLOZE_MASK}`,
        back: "A i B",
        kind: "cloze",
        clozeText: template,
        clozeOrdinal: 1,
        sourceNoteId: "n1",
        sourceBlockKey: "blok-1#1",
      });
      insertReview(raw, "r1", "c0");
      runMigrations(raw, MIGRATIONS);

      // Exactly what `collectNoteCards` now sends for this block.
      const store = new CardStore(raw, "p1");
      const specs = clozeNumbers(findClozeRuns(template)).map((number) => {
        const sides = renderClozeCard(template, number);
        return {
          key: `blok-1#${number}`,
          front: sides?.front ?? "",
          back: sides?.back ?? "",
          kind: "cloze" as const,
          clozeText: template,
          clozeOrdinal: number,
        };
      });
      const result = store.syncFromNote("n1", "dk1", specs, T);

      // Not one row created, not one removed, and not one even rewritten: the
      // migrated rows ARE the rows the new generator names.
      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(store.listByDeck("dk1").map((card) => card.id)).toEqual(["c0", "c1"]);
      expect(
        (
          raw.prepare("SELECT count(*) AS n FROM review_log WHERE card_id = 'c0'").get() as {
            n: number;
          }
        ).n,
      ).toBe(1);
    } finally {
      raw.close();
    }
  });
});

describe("migration 048 — attachment text search (SRCH-008)", () => {
  const T = "2026-01-01T00:00:00.000Z";
  type Handle = Database.Database;

  const columnNames = (raw: Handle, table: string): string[] =>
    (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name);

  const indexNames = (raw: Handle, table: string): string[] =>
    (raw.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]).map((row) => row.name);

  const sqlOf = (raw: Handle, name: string): string =>
    (raw.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql: string }).sql;

  /**
   * A database migrated to `through` and seeded with a task and a note that
   * each carry one attachment — the two tables this migration widens. Opened
   * the two-stage way every data-migration test here opens one: `nx_fold` has
   * to exist on the connection before migration 017's views are created.
   */
  function seeded(name: string, through: number): Handle {
    const raw = new Database(join(dir, name));
    raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(raw, MIGRATIONS.slice(0, through));
    raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)")
      .run(T);
    raw
      .prepare(
        `INSERT INTO task_lists (id, profile_id, parent_id, name, is_inbox, position, created_at, updated_at)
         VALUES ('l1', 'p1', NULL, 'Inbox', 1, 'a', ?, ?)`,
      )
      .run(T, T);
    raw
      .prepare(
        `INSERT INTO tasks (id, profile_id, list_id, title, description, status, priority, position, created_at, updated_at)
         VALUES ('t1', 'p1', 'l1', 'Prijava', 'Opis', 'todo', 'none', 'a', ?, ?)`,
      )
      .run(T, T);
    raw
      .prepare(
        `INSERT INTO task_attachments (id, task_id, file_name, mime, size_bytes, sha256, created_at)
         VALUES ('ta1', 't1', 'beleske.txt', 'text/plain', 40, ?, ?)`,
      )
      .run("a".repeat(64), T);
    raw
      .prepare(
        `INSERT INTO notes (id, profile_id, title, created_at, updated_at)
         VALUES ('n1', 'p1', 'Beleška', ?, ?)`,
      )
      .run(T, T);
    raw
      .prepare(
        `INSERT INTO note_attachments (id, note_id, file_name, mime, size_bytes, sha256, created_at)
         VALUES ('na1', 'n1', 'zapisnik.md', 'text/plain', 40, ?, ?)`,
      )
      .run("b".repeat(64), T);
    return raw;
  }

  /**
   * The projected columns, never `search_entries.id`: every refresh is a
   * delete-then-reinsert (migration 017 — a contentless FTS5 row cannot be
   * updated in place), so the surrogate rowid moves whenever a trigger fires
   * even when nothing about the projection changed. What must not move is the
   * projection.
   */
  const entries = (raw: Handle): unknown[] =>
    raw
      .prepare(
        `SELECT kind, entity_id, profile_id, parent_id, title, body,
                title_folded, body_folded, context_date, updated_at
         FROM search_entries ORDER BY kind, entity_id`,
      )
      .all();

  it("adds a nullable extracted_text to both projected attachment tables, and to no other", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(columnNames(db.raw, "note_attachments")).toContain("extracted_text");
    expect(columnNames(db.raw, "task_attachments")).toContain("extracted_text");
    // Subject materials are deliberately NOT projected into the index at all
    // (migration 035), so their contents are not indexed either.
    expect(columnNames(db.raw, "subject_attachments")).not.toContain("extracted_text");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates the pending-queue partial index on each widened table", () => {
    const db = openDatabase({ path: join(dir, "indexes.db") });
    expect(indexNames(db.raw, "note_attachments")).toContain("note_attachments_text_pending");
    expect(indexNames(db.raw, "task_attachments")).toContain("task_attachments_text_pending");
    expect(sqlOf(db.raw, "task_attachments_text_pending")).toContain("WHERE extracted_text IS NULL");
    db.close();
  });

  it("names extracted_text in the task attachment trigger's UPDATE OF narrowing", () => {
    // Migration 025 narrowed the trigger so a `mime`/`size_bytes` correction
    // does not re-project the task. A column that DOES change the projection
    // has to be named there, or the first extraction never reaches the index.
    const db = openDatabase({ path: join(dir, "trigger.db") });
    expect(sqlOf(db.raw, "task_attachments_search_au")).toContain(
      "AFTER UPDATE OF file_name, extracted_text",
    );
    db.close();
  });

  it("leaves every already-written search entry byte-for-byte alone (no re-projection needed)", () => {
    // The claim the migration makes instead of shipping a backfill statement:
    // with every extracted_text still NULL, both widened views produce exactly
    // what the old ones produced, so rewriting the entries would change nothing.
    const raw = seeded("upgrade.db", 47);
    try {
      const before = entries(raw);
      expect(before).toHaveLength(3); // the task, the note, and the note's attachment
      runMigrations(raw, MIGRATIONS);
      expect(entries(raw)).toEqual(before);
    } finally {
      raw.close();
    }
  });

  it("indexes a task's attachment text without putting it in the displayed body", () => {
    const raw = seeded("task-text.db", 48);
    try {
      raw
        .prepare("UPDATE task_attachments SET extracted_text = ? WHERE id = 'ta1'")
        .run("kvartalni izveštaj o prodaji");
      const row = raw.prepare("SELECT * FROM search_entries WHERE kind = 'task'").get() as {
        body: string;
        body_folded: string;
      };
      expect(row.body).toBe("Opis beleske.txt");
      expect(row.body_folded).toBe(foldSearchText("Opis beleske.txt kvartalni izveštaj o prodaji"));
    } finally {
      raw.close();
    }
  });

  it("indexes a note attachment's text as its own entry's matchable body, display body still empty", () => {
    const raw = seeded("note-text.db", 48);
    try {
      raw
        .prepare("UPDATE note_attachments SET extracted_text = ? WHERE id = 'na1'")
        .run("Đorđe je vodio zapisnik");
      const row = raw.prepare("SELECT * FROM search_entries WHERE kind = 'attachment'").get() as {
        title: string;
        body: string;
        body_folded: string;
      };
      expect(row.title).toBe("zapisnik.md");
      expect(row.body).toBe("");
      expect(row.body_folded).toBe(foldSearchText("Đorđe je vodio zapisnik"));
    } finally {
      raw.close();
    }
  });

  it("treats an empty extracted_text exactly as a NULL one: nothing added to either body", () => {
    // The sentinel that marks a row as ATTEMPTED must not leak a separator or a
    // stray space into the index — an unreadable file has to index as though it
    // had never been looked at.
    const raw = seeded("attempted.db", 48);
    try {
      const before = entries(raw);
      raw.prepare("UPDATE task_attachments SET extracted_text = '' WHERE id = 'ta1'").run();
      raw.prepare("UPDATE note_attachments SET extracted_text = '' WHERE id = 'na1'").run();
      expect(entries(raw)).toEqual(before);
    } finally {
      raw.close();
    }
  });
});

describe("migration 049 — note categories (NOTE-002)", () => {
  const T = "2026-01-01T00:00:00.000Z";

  const columnNames = (db: NexusDatabase, table: string): string[] =>
    (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (row) => row.name,
    );

  const insertNote = (db: NexusDatabase, id: string, profileId: string, categoryId?: string) =>
    db.raw
      .prepare(
        `INSERT INTO notes (id, profile_id, title, category_id, created_at, updated_at, deleted_at)
         VALUES (?, ?, '', ?, ?, ?, NULL)`,
      )
      .run(id, profileId, categoryId ?? null, T, T);

  const insertCategory = (db: NexusDatabase, id: string, profileId: string, name: string) =>
    db.raw
      .prepare(
        `INSERT INTO note_categories (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, profileId, name, T, T);

  it("creates the note_categories table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("note_categories");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("has no parent_id — a category tree would be a folder tree, and this table is flat by design", () => {
    const db = openDatabase({ path: join(dir, "flat.db") });
    expect(columnNames(db, "note_categories")).toEqual([
      "id",
      "profile_id",
      "name",
      "color",
      "created_at",
      "updated_at",
    ]);
    db.close();
  });

  it("adds notes.category_id, defaulting to NULL", () => {
    const db = openDatabase({ path: join(dir, "notes-column.db") });
    expect(columnNames(db, "notes")).toContain("category_id");

    insertProfile(db, "p1");
    insertNote(db, "n1", "p1");
    const row = db.raw.prepare("SELECT category_id FROM notes WHERE id = 'n1'").get() as {
      category_id: string | null;
    };
    expect(row.category_id).toBeNull();
    db.close();
  });

  it("enforces UNIQUE(profile_id, name) — the note_tags rule, per profile", () => {
    const db = openDatabase({ path: join(dir, "unique.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertCategory(db, "c1", "p1", "sastanak");
    expect(() => insertCategory(db, "c2", "p1", "sastanak")).toThrow();
    // Another profile's own „sastanak" is a different row.
    expect(() => insertCategory(db, "c3", "p2", "sastanak")).not.toThrow();
    db.close();
  });

  it("creates the note_categories_profile_name index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("note_categories_profile_name");
    db.close();
  });

  it("SET-NULLs notes.category_id when the category row is deleted — the note survives, uncategorized", () => {
    const db = openDatabase({ path: join(dir, "set-null.db") });
    insertProfile(db, "p1");
    insertCategory(db, "c1", "p1", "recept");
    insertNote(db, "n1", "p1", "c1");

    db.raw.prepare("DELETE FROM note_categories WHERE id = 'c1'").run();
    const row = db.raw.prepare("SELECT category_id FROM notes WHERE id = 'n1'").get() as {
      category_id: string | null;
    };
    expect(row.category_id).toBeNull();
    expect((db.raw.prepare("SELECT count(*) AS n FROM notes").get() as { n: number }).n).toBe(1);
    db.close();
  });

  it("cascades categories when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-profile.db") });
    insertProfile(db, "p1");
    insertCategory(db, "c1", "p1", "dnevnik");

    db.raw.prepare("DELETE FROM profiles WHERE id = 'p1'").run();
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_categories").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("refuses a category_id that names no category row", () => {
    const db = openDatabase({ path: join(dir, "fk.db") });
    insertProfile(db, "p1");
    expect(() => insertNote(db, "n1", "p1", "nema-takve")).toThrow();
    db.close();
  });

  it("leaves every pre-existing note uncategorized when an older database is migrated", () => {
    const raw = new Database(join(dir, "upgrade.db"));
    try {
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
        typeof value === "string" ? foldSearchText(value) : null,
      );
      runMigrations(raw, MIGRATIONS.slice(0, 48));
      raw
        .prepare(
          "INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)",
        )
        .run(T);
      raw
        .prepare(
          `INSERT INTO notes (id, profile_id, title, created_at, updated_at)
           VALUES ('n1', 'p1', 'Beleška', ?, ?)`,
        )
        .run(T, T);

      runMigrations(raw, MIGRATIONS);

      expect(raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
      const row = raw.prepare("SELECT category_id FROM notes WHERE id = 'n1'").get() as {
        category_id: string | null;
      };
      expect(row.category_id).toBeNull();
    } finally {
      raw.close();
    }
  });
});

describe("migration 050 — search history (SRCH-009)", () => {
  const T = "2026-01-01T00:00:00.000Z";

  const insertQuery = (db: NexusDatabase, profileId: string, query: string, usedAt = T) =>
    db.raw
      .prepare("INSERT INTO search_history (profile_id, query, used_at) VALUES (?, ?, ?)")
      .run(profileId, query, usedAt);

  it("creates the search_history table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("search_history");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("carries three columns and nothing else — a query, when it was used, and whose it is", () => {
    const db = openDatabase({ path: join(dir, "columns.db") });
    expect(
      (db.raw.prepare("PRAGMA table_info(search_history)").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    ).toEqual(["profile_id", "query", "used_at"]);
    db.close();
  });

  it("makes a duplicate query unrepresentable per profile, while two profiles keep their own", () => {
    const db = openDatabase({ path: join(dir, "dedupe.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertQuery(db, "p1", "#posao rok:danas");
    expect(() => insertQuery(db, "p1", "#posao rok:danas")).toThrow();
    // Another profile's identical search is a different row — one person's
    // history must never surface in another profile on the same install.
    expect(() => insertQuery(db, "p2", "#posao rok:danas")).not.toThrow();
    db.close();
  });

  it("compares queries as SQLite compares TEXT: „Ispit“ and „ispit“ are two entries", () => {
    const db = openDatabase({ path: join(dir, "case.db") });
    insertProfile(db, "p1");
    insertQuery(db, "p1", "Ispit");
    expect(() => insertQuery(db, "p1", "ispit")).not.toThrow();
    db.close();
  });

  it("refuses an empty or whitespace-only query — an unused search box is not a search", () => {
    const db = openDatabase({ path: join(dir, "empty.db") });
    insertProfile(db, "p1");
    expect(() => insertQuery(db, "p1", "")).toThrow();
    expect(() => insertQuery(db, "p1", "   ")).toThrow();
    db.close();
  });

  it("refuses a query longer than the palette's own input cap", () => {
    const db = openDatabase({ path: join(dir, "long.db") });
    insertProfile(db, "p1");
    expect(() => insertQuery(db, "p1", "b".repeat(500))).not.toThrow();
    expect(() => insertQuery(db, "p1", "c".repeat(501))).toThrow();
    db.close();
  });

  it("creates the search_history_profile_used index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(indexes).toContain("search_history_profile_used");
    db.close();
  });

  it("cascades a profile's history when the profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    insertQuery(db, "p1", "beleške");

    db.raw.prepare("DELETE FROM profiles WHERE id = 'p1'").run();
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM search_history").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("leaves an older database with an empty history — nothing to backfill from", () => {
    const raw = new Database(join(dir, "upgrade.db"));
    try {
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
        typeof value === "string" ? foldSearchText(value) : null,
      );
      runMigrations(raw, MIGRATIONS.slice(0, 49));
      raw
        .prepare(
          "INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)",
        )
        .run(T);

      runMigrations(raw, MIGRATIONS);

      expect(raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
      expect(
        (raw.prepare("SELECT count(*) AS n FROM search_history").get() as { n: number }).n,
      ).toBe(0);
    } finally {
      raw.close();
    }
  });
});


describe("migration 051 — the finance module's ledger (FIN slice a)", () => {
  const T = "2026-01-01T00:00:00.000Z";

  const columnNames = (db: NexusDatabase, table: string): string[] =>
    (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (row) => row.name,
    );

  const insertAccount = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    overrides: Partial<{ name: string; kind: string; currency: string; opening: number }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fin_accounts
           (id, profile_id, name, kind, currency, opening_balance, archived,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
      )
      .run(
        id,
        profileId,
        overrides.name ?? "Tekući",
        overrides.kind ?? "current",
        overrides.currency ?? "RSD",
        overrides.opening ?? 0,
        T,
        T,
      );

  const insertCategory = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    name: string,
    kind = "expense",
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fin_categories (id, profile_id, name, kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, name, kind, T, T);

  const insertTransaction = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    accountId: string,
    amount: number,
    overrides: Partial<{
      counterAccountId: string | null;
      categoryId: string | null;
      date: string;
    }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fin_transactions
           (id, profile_id, account_id, counter_account_id, category_id, tx_date, amount,
            payee, note, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        profileId,
        accountId,
        overrides.counterAccountId ?? null,
        overrides.categoryId ?? null,
        overrides.date ?? "2026-01-15",
        amount,
        T,
        T,
      );

  const insertBudget = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    categoryId: string,
    currency: string,
    amount: number,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fin_budgets
           (id, profile_id, category_id, currency, amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, categoryId, currency, amount, T, T);

  it("creates the four finance tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fin-fresh.db") });
    for (const table of ["fin_accounts", "fin_categories", "fin_transactions", "fin_budgets"]) {
      expect(tableNames(db)).toContain(table);
    }
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("gives an account a closed kind vocabulary and an archived flag beside its soft delete", () => {
    const db = openDatabase({ path: join(dir, "fin-account-shape.db") });
    expect(columnNames(db, "fin_accounts")).toEqual([
      "id",
      "profile_id",
      "name",
      "kind",
      "currency",
      "opening_balance",
      "archived",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);

    insertProfile(db, "p1");
    for (const kind of ["cash", "current", "card", "savings"]) {
      expect(() => insertAccount(db, `a-${kind}`, "p1", { kind })).not.toThrow();
    }
    expect(() => insertAccount(db, "a-bad", "p1", { kind: "kripto" })).toThrow();
    db.close();
  });

  it("refuses a currency that is not a three-letter upper-case ISO-4217 code", () => {
    const db = openDatabase({ path: join(dir, "fin-currency.db") });
    insertProfile(db, "p1");
    expect(() => insertAccount(db, "a1", "p1", { currency: "RSD" })).not.toThrow();
    expect(() => insertAccount(db, "a2", "p1", { currency: "rsd" })).toThrow();
    expect(() => insertAccount(db, "a3", "p1", { currency: "EURO" })).toThrow();
    expect(() => insertAccount(db, "a4", "p1", { currency: "E" })).toThrow();
    db.close();
  });

  it("refuses a non-integer amount in every money column — minor units, never a float", () => {
    const db = openDatabase({ path: join(dir, "fin-integer.db") });
    insertProfile(db, "p1");
    expect(() => insertAccount(db, "a1", "p1", { opening: 12.5 })).toThrow();
    insertAccount(db, "a2", "p1");
    expect(() => insertTransaction(db, "t1", "p1", "a2", 12.5)).toThrow();
    insertCategory(db, "c1", "p1", "Hrana");
    expect(() => insertBudget(db, "b1", "p1", "c1", "RSD", 99.5)).toThrow();
    db.close();
  });

  it("keeps categories flat with an income/expense kind, unique per (profile, kind, name)", () => {
    const db = openDatabase({ path: join(dir, "fin-categories.db") });
    expect(columnNames(db, "fin_categories")).toEqual([
      "id",
      "profile_id",
      "name",
      "kind",
      "created_at",
      "updated_at",
    ]);

    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertCategory(db, "c1", "p1", "Pokloni", "expense");
    // The same name under the OTHER kind is a different category: gifts given
    // and gifts received are two rows in every honest ledger.
    expect(() => insertCategory(db, "c2", "p1", "Pokloni", "income")).not.toThrow();
    expect(() => insertCategory(db, "c3", "p1", "Pokloni", "expense")).toThrow();
    // Another profile's own „Pokloni" is a different row.
    expect(() => insertCategory(db, "c4", "p2", "Pokloni", "expense")).not.toThrow();
    expect(() => insertCategory(db, "c5", "p1", "Ostalo", "stednja")).toThrow();
    db.close();
  });

  it("models a transfer as ONE row naming both sides, never as a pair", () => {
    const db = openDatabase({ path: join(dir, "fin-transfer.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    insertAccount(db, "a2", "p1", { name: "Štednja", kind: "savings" });

    expect(() =>
      insertTransaction(db, "t1", "p1", "a1", -5000, { counterAccountId: "a2" }),
    ).not.toThrow();
    // A transfer to itself is not a transfer.
    expect(() =>
      insertTransaction(db, "t2", "p1", "a1", -5000, { counterAccountId: "a1" }),
    ).toThrow();
    db.close();
  });

  it("refuses a category on a transfer — a transfer is neither income nor expense", () => {
    const db = openDatabase({ path: join(dir, "fin-transfer-category.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    insertAccount(db, "a2", "p1", { name: "Štednja", kind: "savings" });
    insertCategory(db, "c1", "p1", "Hrana");

    expect(() =>
      insertTransaction(db, "t1", "p1", "a1", -5000, {
        counterAccountId: "a2",
        categoryId: "c1",
      }),
    ).toThrow();
    db.close();
  });

  it("refuses a zero-amount transaction", () => {
    const db = openDatabase({ path: join(dir, "fin-zero.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    expect(() => insertTransaction(db, "t1", "p1", "a1", 0)).toThrow();
    db.close();
  });

  it("exposes fin_flows — the transfer-free view every income/expense aggregate reads", () => {
    const db = openDatabase({ path: join(dir, "fin-flows.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    insertAccount(db, "a2", "p1", { name: "Štednja", kind: "savings" });
    insertCategory(db, "c1", "p1", "Hrana");

    insertTransaction(db, "t1", "p1", "a1", -1200, { categoryId: "c1" });
    insertTransaction(db, "t2", "p1", "a1", -5000, { counterAccountId: "a2" });
    db.raw.prepare("UPDATE fin_transactions SET deleted_at = ? WHERE id = 't1'").run(T);
    insertTransaction(db, "t3", "p1", "a1", -800, { categoryId: "c1" });

    const rows = (
      db.raw.prepare("SELECT id FROM fin_flows ORDER BY id").all() as { id: string }[]
    ).map((row) => row.id);
    // The transfer and the trashed row are both invisible here, by construction.
    expect(rows).toEqual(["t3"]);
    // And the view carries no `counter_account_id` at all, so nothing reading it
    // can even ask about a transfer.
    expect(columnNames(db, "fin_flows")).not.toContain("counter_account_id");
    db.close();
  });

  it("SET-NULLs a transaction's category when the category row is deleted", () => {
    const db = openDatabase({ path: join(dir, "fin-category-set-null.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    insertCategory(db, "c1", "p1", "Hrana");
    insertTransaction(db, "t1", "p1", "a1", -1200, { categoryId: "c1" });

    db.raw.prepare("DELETE FROM fin_categories WHERE id = 'c1'").run();
    const row = db.raw.prepare("SELECT category_id FROM fin_transactions WHERE id = 't1'").get() as {
      category_id: string | null;
    };
    expect(row.category_id).toBeNull();
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM fin_transactions").get() as { n: number }).n,
    ).toBe(1);
    db.close();
  });

  it("cascades a budget when its category goes, and every finance row when the profile goes", () => {
    const db = openDatabase({ path: join(dir, "fin-cascade.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    insertCategory(db, "c1", "p1", "Hrana");
    insertTransaction(db, "t1", "p1", "a1", -1200, { categoryId: "c1" });
    insertBudget(db, "b1", "p1", "c1", "RSD", 30000);

    db.raw.prepare("DELETE FROM fin_categories WHERE id = 'c1'").run();
    expect((db.raw.prepare("SELECT count(*) AS n FROM fin_budgets").get() as { n: number }).n).toBe(
      0,
    );

    db.raw.prepare("DELETE FROM profiles WHERE id = 'p1'").run();
    for (const table of ["fin_accounts", "fin_categories", "fin_transactions", "fin_budgets"]) {
      const { n } = db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      expect({ table, n }).toEqual({ table, n: 0 });
    }
    db.close();
  });

  it("takes a transfer's row with either side, so no half-transfer can survive", () => {
    const db = openDatabase({ path: join(dir, "fin-transfer-cascade.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    insertAccount(db, "a2", "p1", { name: "Štednja", kind: "savings" });
    insertTransaction(db, "t1", "p1", "a1", -5000, { counterAccountId: "a2" });

    db.raw.prepare("DELETE FROM fin_accounts WHERE id = 'a2'").run();
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM fin_transactions").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("holds at most one budget per (profile, category, currency)", () => {
    const db = openDatabase({ path: join(dir, "fin-budget-unique.db") });
    insertProfile(db, "p1");
    insertCategory(db, "c1", "p1", "Hrana");

    expect(() => insertBudget(db, "b1", "p1", "c1", "RSD", 30000)).not.toThrow();
    // A second currency is a second allowance, never a second row for the same one.
    expect(() => insertBudget(db, "b2", "p1", "c1", "EUR", 200_00)).not.toThrow();
    expect(() => insertBudget(db, "b3", "p1", "c1", "RSD", 40000)).toThrow();
    db.close();
  });

  it("creates the finance read indexes", () => {
    const db = openDatabase({ path: join(dir, "fin-indexes.db") });
    const indexes = (
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    for (const index of [
      "fin_accounts_profile_active",
      "fin_categories_profile_kind_name",
      "fin_transactions_profile_date",
      "fin_transactions_account_active",
      "fin_transactions_counter_active",
      "fin_budgets_profile_category_currency",
    ]) {
      expect(indexes).toContain(index);
    }
    db.close();
  });

  it("leaves an older database untouched apart from gaining the four empty tables", () => {
    const raw = new Database(join(dir, "fin-upgrade.db"));
    try {
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
        typeof value === "string" ? foldSearchText(value) : null,
      );
      runMigrations(
        raw,
        MIGRATIONS.filter((migration) => migration.version < 51),
      );
      raw
        .prepare(
          "INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)",
        )
        .run(T);

      runMigrations(raw, MIGRATIONS);

      expect(raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
      expect((raw.prepare("SELECT count(*) AS n FROM fin_accounts").get() as { n: number }).n).toBe(
        0,
      );
      expect((raw.prepare("SELECT count(*) AS n FROM profiles").get() as { n: number }).n).toBe(1);
    } finally {
      raw.close();
    }
  });
});

describe("migration 052 — the finance import fingerprint (FIN slice e)", () => {
  const T = "2026-01-01T00:00:00.000Z";

  const seedAccounts = (db: NexusDatabase) => {
    insertProfile(db, "p1");
    const insert = db.raw.prepare(
      `INSERT INTO fin_accounts
         (id, profile_id, name, kind, currency, opening_balance, archived,
          created_at, updated_at, deleted_at)
       VALUES (?, 'p1', ?, ?, 'RSD', 0, 0, ?, ?, NULL)`,
    );
    insert.run("a1", "Tekući", "current", T, T);
    insert.run("a2", "Štednja", "savings", T, T);
  };

  const insertKeyed = (
    db: NexusDatabase,
    id: string,
    accountId: string,
    importKey: string | null,
    deletedAt: string | null = null,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fin_transactions
           (id, profile_id, account_id, counter_account_id, category_id, tx_date, amount,
            payee, note, created_at, updated_at, deleted_at, import_key)
         VALUES (?, 'p1', ?, NULL, NULL, '2026-01-15', -35000, NULL, NULL, ?, ?, ?, ?)`,
      )
      .run(id, accountId, T, T, deletedAt, importKey);

  /** One fingerprint as `finImportKey` composes it: day, signed minor units, payee, note, occurrence. */
  const KEY = '["2026-01-15",-35000,"","KAFA",1]';

  it("adds the nullable import_key column and its partial unique index", () => {
    const db = openDatabase({ path: join(dir, "fin-key-fresh.db") });
    const column = (
      db.raw.prepare("PRAGMA table_info(fin_transactions)").all() as {
        name: string;
        notnull: number;
      }[]
    ).find((row) => row.name === "import_key");
    expect(column).toMatchObject({ notnull: 0 });

    const indexes = (
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(indexes).toContain("fin_transactions_import_key");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("refuses a second row carrying the same key on the same account", () => {
    const db = openDatabase({ path: join(dir, "fin-key-unique.db") });
    seedAccounts(db);
    expect(() => insertKeyed(db, "t1", "a1", KEY)).not.toThrow();
    expect(() => insertKeyed(db, "t2", "a1", KEY)).toThrow();
    db.close();
  });

  it("lets two identical rows in — ordinals 1 and 2 are two coffees, not one duplicated", () => {
    const db = openDatabase({ path: join(dir, "fin-key-ordinal.db") });
    seedAccounts(db);
    expect(() => insertKeyed(db, "t1", "a1", KEY)).not.toThrow();
    expect(() =>
      insertKeyed(db, "t2", "a1", '["2026-01-15",-35000,"","KAFA",2]'),
    ).not.toThrow();
    db.close();
  });

  it("scopes uniqueness to the ACCOUNT, so one statement can land in two of them", () => {
    const db = openDatabase({ path: join(dir, "fin-key-account.db") });
    seedAccounts(db);
    expect(() => insertKeyed(db, "t1", "a1", KEY)).not.toThrow();
    expect(() => insertKeyed(db, "t2", "a2", KEY)).not.toThrow();
    db.close();
  });

  it("keeps a SOFT-DELETED row's key indexed, so no re-import can resurrect it", () => {
    const db = openDatabase({ path: join(dir, "fin-key-deleted.db") });
    seedAccounts(db);
    insertKeyed(db, "t1", "a1", KEY, T);
    expect(() => insertKeyed(db, "t2", "a1", KEY)).toThrow();
    db.close();
  });

  it("leaves hand-typed rows alone: a NULL key never collides with another", () => {
    const db = openDatabase({ path: join(dir, "fin-key-null.db") });
    seedAccounts(db);
    expect(() => insertKeyed(db, "t1", "a1", null)).not.toThrow();
    expect(() => insertKeyed(db, "t2", "a1", null)).not.toThrow();
    db.close();
  });

  it("upgrades a 051 database in place, every existing transaction reading back keyless", () => {
    const raw = new Database(join(dir, "fin-key-upgrade.db"));
    try {
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
        typeof value === "string" ? foldSearchText(value) : null,
      );
      runMigrations(
        raw,
        MIGRATIONS.filter((migration) => migration.version < 52),
      );
      raw
        .prepare(
          "INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)",
        )
        .run(T);
      raw
        .prepare(
          `INSERT INTO fin_accounts
             (id, profile_id, name, kind, currency, opening_balance, archived,
              created_at, updated_at, deleted_at)
           VALUES ('a1', 'p1', 'Tekući', 'current', 'RSD', 0, 0, ?, ?, NULL)`,
        )
        .run(T, T);
      raw
        .prepare(
          `INSERT INTO fin_transactions
             (id, profile_id, account_id, counter_account_id, category_id, tx_date, amount,
              payee, note, created_at, updated_at, deleted_at)
           VALUES ('t1', 'p1', 'a1', NULL, NULL, '2026-01-15', -1200, NULL, NULL, ?, ?, NULL)`,
        )
        .run(T, T);

      runMigrations(raw, MIGRATIONS);

      expect(raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
      const row = raw.prepare("SELECT import_key FROM fin_transactions WHERE id = 't1'").get() as {
        import_key: string | null;
      };
      expect(row.import_key).toBeNull();
    } finally {
      raw.close();
    }
  });
});


describe("migration 053 — FIN subscriptions (recurring charges, FIN slice d)", () => {
  const T = "2026-01-01T00:00:00.000Z";
  /** A canonical ADR-024 rule, exactly as `serializeRecurrenceRule` writes one. */
  const MONTHLY = JSON.stringify({
    freq: { kind: "monthly-date", interval: 1, day: 5 },
    end: { kind: "never" },
  });

  const columnNames = (db: NexusDatabase, table: string): string[] =>
    (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (row) => row.name,
    );

  const insertAccount = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO fin_accounts
           (id, profile_id, name, kind, currency, opening_balance, archived,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, 'Tekući', 'current', 'RSD', 0, 0, ?, ?, NULL)`,
      )
      .run(id, profileId, T, T);

  const insertRecurring = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    accountId: string,
    overrides: Partial<{
      categoryId: string | null;
      amount: number;
      reminderDays: number | null;
      name: string;
    }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fin_recurring
           (id, profile_id, account_id, category_id, name, amount, payee, note,
            recurrence, anchor_date, next_run, reminder_days, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, '2026-01-05', '2026-01-05', ?, ?, ?, NULL)`,
      )
      .run(
        id,
        profileId,
        accountId,
        overrides.categoryId ?? null,
        overrides.name ?? "Netflix",
        overrides.amount ?? -1_190,
        MONTHLY,
        overrides.reminderDays === undefined ? 2 : overrides.reminderDays,
        T,
        T,
      );

  const insertCharge = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    accountId: string,
    recurringId: string | null,
    date: string,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fin_transactions
           (id, profile_id, account_id, counter_account_id, category_id, tx_date, amount,
            payee, note, created_at, updated_at, deleted_at, recurring_id)
         VALUES (?, ?, ?, NULL, NULL, ?, -1190, NULL, NULL, ?, ?, NULL, ?)`,
      )
      .run(id, profileId, accountId, date, T, T, recurringId);

  it("creates fin_recurring, adds recurring_id, and stamps the latest user_version", () => {
    const db = openDatabase({ path: join(dir, "rec-fresh.db") });
    expect(tableNames(db)).toContain("fin_recurring");
    expect(columnNames(db, "fin_recurring")).toEqual([
      "id",
      "profile_id",
      "account_id",
      "category_id",
      "name",
      "amount",
      "payee",
      "note",
      "recurrence",
      "anchor_date",
      "next_run",
      "reminder_days",
      "created_at",
      "updated_at",
      "deleted_at",
      // Appended by migration 054's ADD COLUMN, which is where SQLite puts one.
      "paused_at",
    ]);
    expect(columnNames(db, "fin_transactions")).toContain("recurring_id");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("keeps `fin_flows` free of the new column — a transfer-free aggregate reads no provenance", () => {
    const db = openDatabase({ path: join(dir, "rec-flows.db") });
    expect(columnNames(db, "fin_flows")).toEqual([
      "id",
      "profile_id",
      "account_id",
      "category_id",
      "tx_date",
      "amount",
      "payee",
      "note",
    ]);
    db.close();
  });

  it("refuses a non-integer or zero amount, and a reminder lead outside 0..365", () => {
    const db = openDatabase({ path: join(dir, "rec-checks.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    expect(() => insertRecurring(db, "r-float", "p1", "a1", { amount: 11.9 })).toThrow();
    expect(() => insertRecurring(db, "r-zero", "p1", "a1", { amount: 0 })).toThrow();
    expect(() => insertRecurring(db, "r-neg", "p1", "a1", { reminderDays: -1 })).toThrow();
    expect(() => insertRecurring(db, "r-far", "p1", "a1", { reminderDays: 400 })).toThrow();
    expect(() => insertRecurring(db, "r-none", "p1", "a1", { reminderDays: null })).not.toThrow();
    expect(() => insertRecurring(db, "r-ok", "p1", "a1", { name: "Spotify" })).not.toThrow();
    db.close();
  });

  it("holds at most ONE charge per (subscription, day) — the idempotence the schema owns", () => {
    const db = openDatabase({ path: join(dir, "rec-unique.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    insertRecurring(db, "r1", "p1", "a1");

    expect(() => insertCharge(db, "t1", "p1", "a1", "r1", "2026-01-05")).not.toThrow();
    // The very row a second generation pass would try to write.
    expect(() => insertCharge(db, "t2", "p1", "a1", "r1", "2026-01-05")).toThrow();
    // The next occurrence is a different slot, and a hand-typed row (no
    // subscription) is outside the index entirely — the partial WHERE is what
    // keeps two ordinary coffees on one day two rows.
    expect(() => insertCharge(db, "t3", "p1", "a1", "r1", "2026-02-05")).not.toThrow();
    expect(() => insertCharge(db, "t4", "p1", "a1", null, "2026-01-05")).not.toThrow();
    expect(() => insertCharge(db, "t5", "p1", "a1", null, "2026-01-05")).not.toThrow();
    db.close();
  });

  it("keeps a DELETED generated charge's slot, so it cannot come back on the next pass", () => {
    const db = openDatabase({ path: join(dir, "rec-deleted-slot.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    insertRecurring(db, "r1", "p1", "a1");
    insertCharge(db, "t1", "p1", "a1", "r1", "2026-01-05");
    db.raw.prepare("UPDATE fin_transactions SET deleted_at = ? WHERE id = 't1'").run(T);

    // The index carries no `deleted_at IS NULL`: the thrown-away charge still
    // occupies its day, which is exactly why generation cannot resurrect it.
    expect(() => insertCharge(db, "t2", "p1", "a1", "r1", "2026-01-05")).toThrow();
    db.close();
  });

  it("detaches a charge from a hard-deleted subscription and cascades the rest", () => {
    const db = openDatabase({ path: join(dir, "rec-cascade.db") });
    insertProfile(db, "p1");
    insertAccount(db, "a1", "p1");
    db.raw
      .prepare(
        `INSERT INTO fin_categories (id, profile_id, name, kind, created_at, updated_at)
         VALUES ('c1', 'p1', 'Zabava', 'expense', ?, ?)`,
      )
      .run(T, T);
    insertRecurring(db, "r1", "p1", "a1", { categoryId: "c1" });
    insertCharge(db, "t1", "p1", "a1", "r1", "2026-01-05");

    // Losing the label must never lose the schedule.
    db.raw.prepare("DELETE FROM fin_categories WHERE id = 'c1'").run();
    expect(
      (
        db.raw.prepare("SELECT category_id FROM fin_recurring WHERE id = 'r1'").get() as {
          category_id: string | null;
        }
      ).category_id,
    ).toBeNull();

    // Losing the subscription must never lose the money that already moved.
    db.raw.prepare("DELETE FROM fin_recurring WHERE id = 'r1'").run();
    expect(
      (
        db.raw.prepare("SELECT recurring_id FROM fin_transactions WHERE id = 't1'").get() as {
          recurring_id: string | null;
        }
      ).recurring_id,
    ).toBeNull();

    // …but losing the ACCOUNT takes both, exactly as migration 051 decided.
    insertRecurring(db, "r2", "p1", "a1");
    db.raw.prepare("DELETE FROM fin_accounts WHERE id = 'a1'").run();
    for (const table of ["fin_recurring", "fin_transactions"]) {
      const { n } = db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      expect({ table, n }).toEqual({ table, n: 0 });
    }
    db.close();
  });

  it("widens both notification CHECKs to 'subscription', security still unsilenceable", () => {
    const db = openDatabase({ path: join(dir, "rec-sources.db") });
    insertProfile(db, "p1");
    const ledger = (source: string) =>
      db.raw
        .prepare(
          `INSERT INTO notifications
             (id, profile_id, source, entity_id, occurrence_key, title, body, status,
              snoozed_until, delivered_at, created_at, updated_at)
           VALUES (?, 'p1', ?, 'e1', 'k1', 't', 'b', 'delivered', NULL, ?, ?, ?)`,
        )
        .run(`n-${source}`, source, T, T, T);
    const toggle = (source: string) =>
      db.raw
        .prepare(`INSERT INTO ntf_source_settings (profile_id, source, enabled) VALUES ('p1', ?, 0)`)
        .run(source);

    expect(() => ledger("subscription")).not.toThrow();
    expect(() => ledger("izmisljeno")).toThrow();
    expect(() => toggle("subscription")).not.toThrow();
    // Migration 037's decision stands: a security notice has no off switch.
    expect(() => toggle("security")).toThrow();
    db.close();
  });

  it("loses NO row to the two table rebuilds — the ADR-042 hazard, re-checked here", () => {
    const raw = new Database(join(dir, "rec-rebuild.db"));
    try {
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
        typeof value === "string" ? foldSearchText(value) : null,
      );
      runMigrations(
        raw,
        MIGRATIONS.filter((migration) => migration.version < 53),
      );
      raw
        .prepare(
          "INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)",
        )
        .run(T);
      for (const [id, source] of [
        ["n1", "document"],
        ["n2", "exam"],
        ["n3", "event"],
        ["n4", "task"],
        ["n5", "security"],
      ] as const) {
        raw
          .prepare(
            `INSERT INTO notifications
               (id, profile_id, source, entity_id, occurrence_key, title, body, status,
                snoozed_until, delivered_at, created_at, updated_at)
             VALUES (?, 'p1', ?, 'e1', 'k1', 'Naslov', 'Telo', 'delivered', NULL, ?, ?, ?)`,
          )
          .run(id, source, T, T, T);
      }
      for (const source of ["document", "exam", "study-day", "event", "task"]) {
        raw
          .prepare(
            `INSERT INTO ntf_source_settings (profile_id, source, enabled) VALUES ('p1', ?, 0)`,
          )
          .run(source);
      }
      raw
        .prepare(
          `INSERT INTO ntf_settings (profile_id, morning_hour, created_at, updated_at)
           VALUES ('p1', '08:00', ?, ?)`,
        )
        .run(T, T);
      raw
        .prepare(
          `INSERT INTO fin_accounts
             (id, profile_id, name, kind, currency, opening_balance, archived,
              created_at, updated_at, deleted_at)
           VALUES ('a1', 'p1', 'Tekući', 'current', 'RSD', 100000, 0, ?, ?, NULL)`,
        )
        .run(T, T);
      raw
        .prepare(
          `INSERT INTO fin_transactions
             (id, profile_id, account_id, counter_account_id, category_id, tx_date, amount,
              payee, note, created_at, updated_at, deleted_at)
           VALUES ('t1', 'p1', 'a1', NULL, NULL, '2026-01-15', -1190, NULL, NULL, ?, ?, NULL)`,
        )
        .run(T, T);

      runMigrations(raw, MIGRATIONS);

      expect(raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
      expect(raw.prepare("SELECT id, source FROM notifications ORDER BY id").all()).toEqual([
        { id: "n1", source: "document" },
        { id: "n2", source: "exam" },
        { id: "n3", source: "event" },
        { id: "n4", source: "task" },
        { id: "n5", source: "security" },
      ]);
      expect(
        (raw.prepare("SELECT count(*) AS n FROM ntf_source_settings").get() as { n: number }).n,
      ).toBe(5);
      expect((raw.prepare("SELECT count(*) AS n FROM ntf_settings").get() as { n: number }).n).toBe(
        1,
      );
      // The existing ledger row survives the ADD COLUMN with a NULL provenance.
      expect(raw.prepare("SELECT id, recurring_id FROM fin_transactions").all()).toEqual([
        { id: "t1", recurring_id: null },
      ]);
      // And the rebuilt table's own index came back with it.
      const indexes = (
        raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
          name: string;
        }[]
      ).map((row) => row.name);
      expect(indexes).toContain("notifications_profile_status_updated");
      expect(indexes).toContain("fin_recurring_profile_active");
      expect(indexes).toContain("fin_transactions_recurring_occurrence");
    } finally {
      raw.close();
    }
  });
});

describe("migration 054 — pausing a subscription (ADR-074)", () => {
  const T = "2026-01-01T00:00:00.000Z";
  const MONTHLY = JSON.stringify({
    freq: { kind: "monthly-date", interval: 1, day: 5 },
    end: { kind: "never" },
  });

  it("adds paused_at as a nullable column and stamps the latest user_version", () => {
    const db = openDatabase({ path: join(dir, "pause-fresh.db") });
    const column = (
      db.raw.prepare("PRAGMA table_info(fin_recurring)").all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[]
    ).find((row) => row.name === "paused_at");
    expect(column).toMatchObject({ notnull: 0, dflt_value: null });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  /**
   * The ADR-042 hazard, checked where it would actually bite: `fin_recurring` is
   * a referenced PARENT (`fin_transactions.recurring_id`), so a rebuild of it
   * would fire that reference's `ON DELETE SET NULL` inside the migration's own
   * transaction — where `PRAGMA foreign_keys` cannot be switched off — and every
   * generated charge would come out of migration 054 no longer knowing what made
   * it. An `ALTER TABLE … ADD COLUMN` touches no row, and this is what says so.
   */
  it("keeps every generated charge attached to its subscription — no rebuild of a referenced parent", () => {
    const raw = new Database(join(dir, "pause-upgrade.db"));
    try {
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
        typeof value === "string" ? foldSearchText(value) : null,
      );
      runMigrations(
        raw,
        MIGRATIONS.filter((migration) => migration.version < 54),
      );
      raw
        .prepare(
          "INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)",
        )
        .run(T);
      raw
        .prepare(
          `INSERT INTO fin_accounts
             (id, profile_id, name, kind, currency, opening_balance, archived,
              created_at, updated_at, deleted_at)
           VALUES ('a1', 'p1', 'Tekući', 'current', 'RSD', 100000, 0, ?, ?, NULL)`,
        )
        .run(T, T);
      raw
        .prepare(
          `INSERT INTO fin_recurring
             (id, profile_id, account_id, category_id, name, amount, payee, note,
              recurrence, anchor_date, next_run, reminder_days, created_at, updated_at, deleted_at)
           VALUES ('r1', 'p1', 'a1', NULL, 'Netflix', -1190, NULL, NULL, ?,
                   '2026-01-05', '2026-04-05', 2, ?, ?, NULL)`,
        )
        .run(MONTHLY, T, T);
      const charge = raw.prepare(
        `INSERT INTO fin_transactions
           (id, profile_id, account_id, counter_account_id, category_id, tx_date, amount,
            payee, note, created_at, updated_at, deleted_at, recurring_id)
         VALUES (?, 'p1', 'a1', NULL, NULL, ?, -1190, 'Netflix', NULL, ?, ?, NULL, 'r1')`,
      );
      for (const [id, date] of [
        ["t1", "2026-01-05"],
        ["t2", "2026-02-05"],
        ["t3", "2026-03-05"],
      ] as const) {
        charge.run(id, date, T, T);
      }

      runMigrations(raw, MIGRATIONS);

      expect(raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
      expect(
        raw.prepare("SELECT id, recurring_id FROM fin_transactions ORDER BY id").all(),
      ).toEqual([
        { id: "t1", recurring_id: "r1" },
        { id: "t2", recurring_id: "r1" },
        { id: "t3", recurring_id: "r1" },
      ]);
      // The subscription itself is untouched, and reads back as what it was: a
      // subscription nobody has ever paused.
      expect(raw.prepare("SELECT next_run, paused_at FROM fin_recurring WHERE id = 'r1'").get()).toEqual(
        { next_run: "2026-04-05", paused_at: null },
      );
    } finally {
      raw.close();
    }
  });
});

describe("migration 055 — habits (HABIT slice a)", () => {
  const T = "2026-01-01T00:00:00.000Z";
  /** Canonical `serializeHabitSchedule` output — the only thing this column ever holds. */
  const MON_WED_FRI = JSON.stringify({ kind: "days", weekdays: [1, 3, 5] });

  const insertHabit = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    overrides: Partial<{
      name: string;
      color: string | null;
      target: number | null;
      unit: string | null;
    }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO habits
           (id, profile_id, name, color, schedule, target, unit, reminder_time,
            archived_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        profileId,
        overrides.name ?? "Teretana",
        overrides.color === undefined ? "maslina" : overrides.color,
        MON_WED_FRI,
        overrides.target ?? null,
        overrides.unit ?? null,
        T,
        T,
      );

  const insertEntry = (db: NexusDatabase, id: string, habitId: string, day: string, value: number) =>
    db.raw
      .prepare(
        `INSERT INTO habit_entries (id, habit_id, entry_date, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, habitId, day, value, T, T);

  it("creates both habit tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "habits-fresh.db") });
    expect(tableNames(db)).toEqual(expect.arrayContaining(["habits", "habit_entries"]));
    expect(
      (db.raw.prepare("PRAGMA table_info(habits)").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    ).toEqual([
      "id",
      "profile_id",
      "name",
      "color",
      "schedule",
      "target",
      "unit",
      "reminder_time",
      "archived_at",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("makes a second tick of the same day unrepresentable", () => {
    const db = openDatabase({ path: join(dir, "habits-unique.db") });
    insertProfile(db, "p1");
    insertHabit(db, "h1", "p1");
    insertEntry(db, "e1", "h1", "2026-01-05", 1);
    expect(() => insertEntry(db, "e2", "h1", "2026-01-05", 1)).toThrow(/UNIQUE/i);
    // The same DAY on a different habit is a different row, which is the whole
    // point of the pair.
    insertHabit(db, "h2", "p1", { name: "Čitanje" });
    expect(() => insertEntry(db, "e3", "h2", "2026-01-05", 1)).not.toThrow();
    db.close();
  });

  it.each([
    ["fractional", 12.5],
    ["zero", 0],
    ["negative", -1],
  ])("refuses a %s value — a tick is a whole count, never a float", (label, value) => {
    const db = openDatabase({ path: join(dir, `habits-value-${label}.db`) });
    insertProfile(db, "p1");
    insertHabit(db, "h1", "p1");
    expect(() => insertEntry(db, "e1", "h1", "2026-01-05", value)).toThrow(/CHECK/i);
    db.close();
  });

  it.each([
    ["fractional-target", { target: 8.5 }],
    ["zero-target", { target: 0 }],
    ["empty-name", { name: "" }],
    ["unit-without-target", { unit: "čaša" }],
  ])("refuses %s", (label, overrides) => {
    const db = openDatabase({ path: join(dir, `habits-check-${label}.db`) });
    insertProfile(db, "p1");
    expect(() => insertHabit(db, "h1", "p1", overrides)).toThrow(/CHECK/i);
    db.close();
  });

  it("accepts a targeted habit with its unit — one nullable column, one model", () => {
    const db = openDatabase({ path: join(dir, "habits-target.db") });
    insertProfile(db, "p1");
    insertHabit(db, "h1", "p1", { name: "Voda", target: 8, unit: "čaša" });
    expect(db.raw.prepare("SELECT target, unit FROM habits WHERE id = 'h1'").get()).toEqual({
      target: 8,
      unit: "čaša",
    });
    db.close();
  });

  it("keeps archived_at and deleted_at independent — a finished habit is not a deleted one", () => {
    const db = openDatabase({ path: join(dir, "habits-archive.db") });
    insertProfile(db, "p1");
    insertHabit(db, "h1", "p1");
    db.raw.prepare("UPDATE habits SET archived_at = ?, deleted_at = ? WHERE id = 'h1'").run(T, T);
    expect(
      db.raw.prepare("SELECT archived_at, deleted_at FROM habits WHERE id = 'h1'").get(),
    ).toEqual({ archived_at: T, deleted_at: T });
    db.close();
  });

  it("takes a habit's entries with it on a HARD delete, and scopes them through it alone", () => {
    const db = openDatabase({ path: join(dir, "habits-cascade.db") });
    insertProfile(db, "p1");
    insertHabit(db, "h1", "p1");
    insertEntry(db, "e1", "h1", "2026-01-05", 1);
    db.raw.prepare("DELETE FROM habits WHERE id = 'h1'").run();
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM habit_entries").get()).toEqual({ n: 0 });
    db.close();
  });
});

describe("migration 056 — the habit reminder as a notification source (HABIT slice c)", () => {
  const T = "2026-01-01T00:00:00.000Z";
  /** Every source the CHECK allowed BEFORE this migration — the fixture's whole point. */
  const SOURCES_AT_55 = [
    "document",
    "exam",
    "study-day",
    "event",
    "task",
    "security",
    "subscription",
  ] as const;
  /** The narrower settings domain at 55: the same list minus the one that cannot be silenced. */
  const TOGGLEABLE_AT_55 = SOURCES_AT_55.filter((source) => source !== "security");

  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nexus-migrations-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const insertProfile = (db: NexusDatabase, id: string) =>
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, 'personal', ?, ?)")
      .run(id, id, T);

  it("widens both notification CHECKs to 'habit', security still unsilenceable", () => {
    const db = openDatabase({ path: join(dir, "habit-sources.db") });
    insertProfile(db, "p1");
    const ledger = (source: string) =>
      db.raw
        .prepare(
          `INSERT INTO notifications
             (id, profile_id, source, entity_id, occurrence_key, title, body, status,
              snoozed_until, delivered_at, created_at, updated_at)
           VALUES (?, 'p1', ?, 'e1', 'k1', 't', 'b', 'delivered', NULL, ?, ?, ?)`,
        )
        .run(`n-${source}`, source, T, T, T);
    const toggle = (source: string) =>
      db.raw
        .prepare(`INSERT INTO ntf_source_settings (profile_id, source, enabled) VALUES ('p1', ?, 0)`)
        .run(source);

    expect(() => ledger("habit")).not.toThrow();
    expect(() => ledger("izmisljeno")).toThrow();
    // A habit nudge IS silenceable — „podseti me u 20:00" is a preference
    // somebody set and may unset, unlike migration 037's `'security'`.
    expect(() => toggle("habit")).not.toThrow();
    expect(() => toggle("security")).toThrow();
    db.close();
  });

  it("keeps one nudge per habit per day unrepresentable — the ledger's UNIQUE comes back with the table", () => {
    const db = openDatabase({ path: join(dir, "habit-unique.db") });
    insertProfile(db, "p1");
    const record = (id: string, entityId: string, occurrenceKey: string) =>
      db.raw
        .prepare(
          `INSERT INTO notifications
             (id, profile_id, source, entity_id, occurrence_key, title, body, status,
              snoozed_until, delivered_at, created_at, updated_at)
           VALUES (?, 'p1', 'habit', ?, ?, 't', 'b', 'delivered', NULL, ?, ?, ?)`,
        )
        .run(id, entityId, occurrenceKey, T, T, T);

    expect(() => record("n1", "h1", "2026-01-05")).not.toThrow();
    // The same habit, the same day — the schema refuses it rather than a guard.
    expect(() => record("n2", "h1", "2026-01-05")).toThrow();
    // Another day, and another habit on the same day, are different occurrences.
    expect(() => record("n3", "h1", "2026-01-06")).not.toThrow();
    expect(() => record("n4", "h2", "2026-01-05")).not.toThrow();
    db.close();
  });

  it("loses NO row to the two table rebuilds — the ADR-042 hazard, re-checked at version 55", () => {
    const raw = new Database(join(dir, "habit-rebuild.db"));
    try {
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      raw.function("nx_fold", { deterministic: true }, (value: unknown) =>
        typeof value === "string" ? foldSearchText(value) : null,
      );
      runMigrations(
        raw,
        MIGRATIONS.filter((migration) => migration.version < 56),
      );
      raw
        .prepare(
          "INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)",
        )
        .run(T);
      // EVERY source the old CHECK allowed, so a rebuild that dropped one would
      // be caught by name rather than by a count that happened to match.
      for (const source of SOURCES_AT_55) {
        raw
          .prepare(
            `INSERT INTO notifications
               (id, profile_id, source, entity_id, occurrence_key, title, body, status,
                snoozed_until, delivered_at, created_at, updated_at)
             VALUES (?, 'p1', ?, 'e1', 'k1', 'Naslov', 'Telo', 'delivered', NULL, ?, ?, ?)`,
          )
          .run(`n-${source}`, source, T, T, T);
      }
      for (const source of TOGGLEABLE_AT_55) {
        raw
          .prepare(
            `INSERT INTO ntf_source_settings (profile_id, source, enabled) VALUES ('p1', ?, 0)`,
          )
          .run(source);
      }
      raw
        .prepare(
          `INSERT INTO ntf_settings (profile_id, morning_hour, created_at, updated_at)
           VALUES ('p1', '08:00', ?, ?)`,
        )
        .run(T, T);

      runMigrations(raw, MIGRATIONS);

      expect(raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
      expect(
        (
          raw.prepare("SELECT source FROM notifications ORDER BY source").all() as {
            source: string;
          }[]
        ).map((row) => row.source),
      ).toEqual([...SOURCES_AT_55].sort());
      expect(
        (
          raw
            .prepare("SELECT source, enabled FROM ntf_source_settings ORDER BY source")
            .all() as { source: string; enabled: number }[]
        ).map((row) => row.source),
      ).toEqual([...TOGGLEABLE_AT_55].sort());
      // The appetite the profile actually chose, not a default the rebuild reset.
      expect(
        (
          raw.prepare("SELECT count(*) AS n FROM ntf_source_settings WHERE enabled = 0").get() as {
            n: number;
          }
        ).n,
      ).toBe(TOGGLEABLE_AT_55.length);
      expect((raw.prepare("SELECT count(*) AS n FROM ntf_settings").get() as { n: number }).n).toBe(
        1,
      );
      // Dropped with the old table and re-created by hand; the UNIQUE came back
      // with the declaration, which the case above proves behaviourally.
      const indexes = (
        raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
          name: string;
        }[]
      ).map((row) => row.name);
      expect(indexes).toContain("notifications_profile_status_updated");
    } finally {
      raw.close();
    }
  });
});

describe("migration 057 — the one focus timer", () => {
  type Handle = Database.Database;

  const now = () => new Date().toISOString();

  const columnNames = (raw: Handle, table: string): string[] =>
    (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name);

  const tableNamesOf = (raw: Handle): string[] =>
    (
      raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);

  const seedProfile = (raw: Handle, id: string) =>
    raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, "personal", "P", now());

  const seedSubject = (raw: Handle, id: string, profileId: string) =>
    raw
      .prepare(
        `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, `Predmet ${id}`, "jade", now(), now());

  /** A pre-057 session, exactly the shape migration 008 accepted — including its soft delete. */
  const seedOldSession = (
    raw: Handle,
    id: string,
    profileId: string,
    subjectId: string,
    startedAt: string,
    endedAt: string,
    deletedAt: string | null = null,
  ) =>
    raw
      .prepare(
        `INSERT INTO focus_sessions
           (id, profile_id, subject_id, started_at, ended_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, profileId, subjectId, startedAt, endedAt,
        "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", deletedAt,
      );

  /** As every rebuild migration's own helper: a connection held at exactly `version`. */
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

  /** A 056 database whose focus log holds two live sessions and a soft-deleted one. */
  function seedFocusWorld(raw: Handle): void {
    seedProfile(raw, "p1");
    seedSubject(raw, "s1", "p1");
    seedSubject(raw, "s2", "p1");
    seedOldSession(raw, "f1", "p1", "s1", "2026-07-08T12:00:00.000Z", "2026-07-08T12:30:00.000Z");
    seedOldSession(raw, "f2", "p1", "s2", "2026-07-09T08:00:00.000Z", "2026-07-09T09:15:00.000Z");
    seedOldSession(
      raw, "f3", "p1", "s1",
      "2026-07-10T20:00:00.000Z", "2026-07-10T20:45:00.000Z", "2026-07-11T06:00:00.000Z",
    );
  }

  it("adds the phase columns and keeps every column migration 008 declared", () => {
    const db = openDatabase({ path: join(dir, "columns-057.db") });
    expect(columnNames(db.raw, "focus_sessions")).toEqual([
      "id",
      "profile_id",
      "subject_id",
      "started_at",
      "ended_at",
      "kind",
      "planned_minutes",
      "paused_seconds",
      "outcome",
      "cycle_index",
      "task_id",
      "label",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);
    db.close();
  });

  it("leaves no rebuild scaffolding behind", () => {
    const db = openDatabase({ path: join(dir, "scaffolding-057.db") });
    expect(tableNamesOf(db.raw)).not.toContain("focus_sessions_new");
    db.close();
  });

  it("re-creates the partial index the drop took with the table", () => {
    const db = openDatabase({ path: join(dir, "index-057.db") });
    const indexes = (
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(indexes).toContain("focus_sessions_profile_started");
    db.close();
  });

  it("carries every seeded 056 session through the rebuild with its values intact", () => {
    const path = join(dir, "upgrade-057.db");
    const before = openAtVersion(path, 56);
    seedFocusWorld(before);
    expect(before.pragma("user_version", { simple: true })).toBe(56);
    before.close();

    const db = openDatabase({ path });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);

    // Every row, every value — the COPY is what has to be proven, not the shape.
    expect(
      db.raw
        .prepare(
          `SELECT id, profile_id, subject_id, started_at, ended_at, created_at, updated_at,
                  deleted_at, kind, planned_minutes, paused_seconds, outcome, cycle_index,
                  task_id, label
             FROM focus_sessions ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: "f1", profile_id: "p1", subject_id: "s1",
        started_at: "2026-07-08T12:00:00.000Z", ended_at: "2026-07-08T12:30:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z",
        deleted_at: null,
        kind: "work", planned_minutes: null, paused_seconds: 0, outcome: null,
        cycle_index: 0, task_id: null, label: null,
      },
      {
        id: "f2", profile_id: "p1", subject_id: "s2",
        started_at: "2026-07-09T08:00:00.000Z", ended_at: "2026-07-09T09:15:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z",
        deleted_at: null,
        kind: "work", planned_minutes: null, paused_seconds: 0, outcome: null,
        cycle_index: 0, task_id: null, label: null,
      },
      // The soft delete survives: a session the user deleted and can still undo
      // must not come back resurrected by a schema change.
      {
        id: "f3", profile_id: "p1", subject_id: "s1",
        started_at: "2026-07-10T20:00:00.000Z", ended_at: "2026-07-10T20:45:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z",
        deleted_at: "2026-07-11T06:00:00.000Z",
        kind: "work", planned_minutes: null, paused_seconds: 0, outcome: null,
        cycle_index: 0, task_id: null, label: null,
      },
    ]);
    expect(db.raw.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });

  it("keeps both cascades pointing at the REBUILT table", () => {
    const path = join(dir, "cascade-057.db");
    const before = openAtVersion(path, 56);
    seedFocusWorld(before);
    before.close();

    const db = openDatabase({ path });
    // Subject -> sessions, migration 008's chain, still live after the rename.
    db.raw.prepare("DELETE FROM subjects WHERE id = ?").run("s2");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM focus_sessions").get() as { n: number }).n,
    ).toBe(2);
    // Profile -> everything.
    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM focus_sessions").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("still refuses a subject this database does not have", () => {
    const db = openDatabase({ path: join(dir, "fk-057.db") });
    seedProfile(db.raw, "p1");
    expect(() =>
      seedOldSession(
        db.raw, "f1", "p1", "ghost",
        "2026-07-08T12:00:00.000Z", "2026-07-08T12:30:00.000Z",
      ),
    ).toThrow();
    db.close();
  });

  it("accepts a session with no subject at all — a Pomodoro phase belongs to none", () => {
    const db = openDatabase({ path: join(dir, "nullable-subject-057.db") });
    seedProfile(db.raw, "p1");
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO focus_sessions
             (id, profile_id, subject_id, started_at, ended_at, kind, planned_minutes,
              created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, 'short_break', 5, ?, ?)`,
        )
        .run("f1", "p1", "2026-07-08T12:00:00.000Z", "2026-07-08T12:05:00.000Z", now(), now()),
    ).not.toThrow();
    db.close();
  });

  it("keeps migration 008's ended_at > started_at CHECK", () => {
    const db = openDatabase({ path: join(dir, "order-057.db") });
    seedProfile(db.raw, "p1");
    seedSubject(db.raw, "s1", "p1");
    expect(() =>
      seedOldSession(
        db.raw, "f1", "p1", "s1",
        "2026-07-08T12:00:00.000Z", "2026-07-08T12:00:00.000Z",
      ),
    ).toThrow();
    expect(() =>
      seedOldSession(
        db.raw, "f2", "p1", "s1",
        "2026-07-08T12:00:00.000Z", "2026-07-08T11:00:00.000Z",
      ),
    ).toThrow();
    db.close();
  });

  it("closes the phase vocabulary and the outcome vocabulary with CHECKs", () => {
    const db = openDatabase({ path: join(dir, "enums-057.db") });
    seedProfile(db.raw, "p1");

    const insert = (id: string, kind: string, outcome: string | null) =>
      db.raw
        .prepare(
          `INSERT INTO focus_sessions
             (id, profile_id, started_at, ended_at, kind, outcome, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id, "p1", "2026-07-08T12:00:00.000Z", "2026-07-08T12:30:00.000Z",
          kind, outcome, now(), now(),
        );

    for (const kind of ["work", "short_break", "long_break"]) {
      expect(() => insert(`ok-${kind}`, kind, "completed")).not.toThrow();
    }
    expect(() => insert("bad-kind", "pause", null)).toThrow();
    for (const outcome of ["completed", "stopped"]) {
      expect(() => insert(`ok-${outcome}`, "work", outcome)).not.toThrow();
    }
    expect(() => insert("ok-null-outcome", "work", null)).not.toThrow();
    // No 'abandoned': a running phase is never a row, so no stored phase has an
    // end nobody witnessed.
    expect(() => insert("bad-outcome", "work", "abandoned")).toThrow();
    db.close();
  });

  it("refuses a fractional or non-positive number in every integer column", () => {
    const db = openDatabase({ path: join(dir, "integers-057.db") });
    seedProfile(db.raw, "p1");

    const insert = (id: string, column: string, value: number) =>
      db.raw
        .prepare(
          `INSERT INTO focus_sessions
             (id, profile_id, started_at, ended_at, ${column}, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, "p1", "2026-07-08T12:00:00.000Z", "2026-07-08T12:30:00.000Z", value, now(), now());

    // INTEGER affinity alone would have accepted 12.5 (migration 051's lesson).
    expect(() => insert("pm-frac", "planned_minutes", 12.5)).toThrow();
    expect(() => insert("pm-zero", "planned_minutes", 0)).toThrow();
    expect(() => insert("pm-ok", "planned_minutes", 25)).not.toThrow();
    expect(() => insert("ps-frac", "paused_seconds", 0.5)).toThrow();
    expect(() => insert("ps-neg", "paused_seconds", -1)).toThrow();
    expect(() => insert("ps-zero", "paused_seconds", 0)).not.toThrow();
    expect(() => insert("ci-frac", "cycle_index", 1.5)).toThrow();
    expect(() => insert("ci-neg", "cycle_index", -1)).toThrow();
    expect(() => insert("ci-ok", "cycle_index", 3)).not.toThrow();
    db.close();
  });

  it("lets a task_id outlive the task it names — no foreign key, deliberately", () => {
    const db = openDatabase({ path: join(dir, "task-057.db") });
    seedProfile(db.raw, "p1");
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO focus_sessions
             (id, profile_id, started_at, ended_at, task_id, label, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "f1", "p1", "2026-07-08T12:00:00.000Z", "2026-07-08T12:30:00.000Z",
          "a-task-that-was-deleted", "Pisanje izveštaja", now(), now(),
        ),
    ).not.toThrow();
    expect(db.raw.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });
});

describe("migration 058 — FIT nutrition (FIT slice a)", () => {
  const T = "2026-01-01T00:00:00.000Z";
  /** „Mamin ajvar" — a plausible per-100 g row; the values matter only where a CHECK is under test. */
  const MACROS = [120, 1.5, 9, 8.5, 2.5, 5, 480] as const;

  const insertFood = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    macros: readonly number[] = MACROS,
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fit_foods
           (id, profile_id, name, category, kcal, protein, carbs, fat, fiber, sugar, sodium_mg,
            servings_json, notes, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, profileId, "Mamin ajvar", "povrce", ...macros, "[]", "", T, T);

  const insertItem = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    overrides: Partial<{ slot: string; foodRef: string; label: string; grams: number }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fit_meal_items
           (id, profile_id, meal_date, slot, food_ref, label, grams,
            kcal, protein, carbs, fat, fiber, sugar, sodium_mg,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        profileId,
        "2026-06-01",
        overrides.slot ?? "rucak",
        overrides.foodRef ?? "catalogue:jaje-celo-sirovo",
        overrides.label ?? "Jaje",
        overrides.grams ?? 50,
        ...MACROS,
        T,
        T,
      );

  const insertTargetSql = `INSERT INTO fit_targets (profile_id, kcal, protein_g, carbs_g, fat_g, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`;

  it("creates all three tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fit-fresh.db") });
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["fit_foods", "fit_meal_items", "fit_targets"]),
    );
    expect(
      (db.raw.prepare("PRAGMA table_info(fit_meal_items)").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    ).toEqual([
      "id",
      "profile_id",
      "meal_date",
      "slot",
      "food_ref",
      "label",
      "grams",
      "kcal",
      "protein",
      "carbs",
      "fat",
      "fiber",
      "sugar",
      "sodium_mg",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("creates NO table for the app's food catalogue, and none for meals either", () => {
    const db = openDatabase({ path: join(dir, "fit-absent-tables.db") });
    const names = tableNames(db);
    // The catalogue ships as JSON inside `@nexus/core`: seeding it would put app
    // data where user data lives, and into every export archive besides.
    expect(names).not.toContain("fit_catalogue");
    // A meal is a (day, slot) grouping of items, so a container row could only
    // ever be an empty meal nothing can show and nobody can clean up.
    expect(names).not.toContain("fit_meals");
    db.close();
  });

  it("refuses a negative nutrient on a food", () => {
    const db = openDatabase({ path: join(dir, "fit-food-negative.db") });
    insertProfile(db, "p1");
    expect(() => insertFood(db, "f1", "p1", [120, -1, 9, 8.5, 2.5, 5, 480])).toThrow(/CHECK/i);
    expect(() => insertFood(db, "f2", "p1", [120, 1.5, 9, 8.5, 2.5, 5, -0.5])).toThrow(/CHECK/i);
    db.close();
  });

  it("keeps FRACTIONAL nutrients — a food diary is not HABIT's integer counts", () => {
    const db = openDatabase({ path: join(dir, "fit-food-real.db") });
    insertProfile(db, "p1");
    insertFood(db, "f1", "p1", [143, 12.6, 0.72, 9.51, 0, 0.37, 142]);
    expect(
      (db.raw.prepare("SELECT carbs FROM fit_foods WHERE id = 'f1'").get() as { carbs: number })
        .carbs,
    ).toBe(0.72);
    db.close();
  });

  it("closes the slot vocabulary at five", () => {
    const db = openDatabase({ path: join(dir, "fit-slot.db") });
    insertProfile(db, "p1");
    for (const slot of ["dorucak", "uzina1", "rucak", "uzina2", "vecera"]) {
      expect(() => insertItem(db, `i-${slot}`, "p1", { slot })).not.toThrow();
    }
    expect(() => insertItem(db, "i-brunch", "p1", { slot: "brunch" })).toThrow(/CHECK/i);
    db.close();
  });

  it("refuses a zero or negative gram weight, and a blank label", () => {
    const db = openDatabase({ path: join(dir, "fit-item-guards.db") });
    insertProfile(db, "p1");
    expect(() => insertItem(db, "i1", "p1", { grams: 0 })).toThrow(/CHECK/i);
    expect(() => insertItem(db, "i2", "p1", { grams: -5 })).toThrow(/CHECK/i);
    expect(() => insertItem(db, "i3", "p1", { label: "" })).toThrow(/CHECK/i);
    db.close();
  });

  it("lets food_ref name anything — it is text with NO foreign key", () => {
    const db = openDatabase({ path: join(dir, "fit-item-ref.db") });
    insertProfile(db, "p1");
    // The catalogue is not a table, so this reference can never resolve to a row
    // and must still be legal.
    expect(() =>
      insertItem(db, "i1", "p1", { foodRef: "catalogue:jaje-celo-sirovo" }),
    ).not.toThrow();
    // A user food hard-deleted long ago: the item stays, because its own label
    // and snapshot are what make it readable.
    expect(() => insertItem(db, "i2", "p1", { foodRef: "user:gone" })).not.toThrow();
    db.close();
  });

  it("survives a food being deleted under a meal item that names it", () => {
    const db = openDatabase({ path: join(dir, "fit-food-gone.db") });
    insertProfile(db, "p1");
    insertFood(db, "f1", "p1");
    insertItem(db, "i1", "p1", { foodRef: "user:f1" });
    db.raw.prepare("DELETE FROM fit_foods WHERE id = 'f1'").run();
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM fit_meal_items").get() as { n: number }).n,
    ).toBe(1);
    db.close();
  });

  it("holds ONE goals row per profile, every goal independently nullable and zero storable", () => {
    const db = openDatabase({ path: join(dir, "fit-targets.db") });
    insertProfile(db, "p1");
    const insertTarget = db.raw.prepare(insertTargetSql);
    // A calorie-only goal: three nulls beside it, which is the ordinary case.
    expect(() => insertTarget.run("p1", 2200, null, null, null, T)).not.toThrow();
    expect(() => insertTarget.run("p1", 1800, null, null, null, T)).toThrow(/UNIQUE|PRIMARY/i);
    // Zero is a goal, and a different claim from NULL; both are storable.
    db.raw.prepare("UPDATE fit_targets SET kcal = 0 WHERE profile_id = 'p1'").run();
    expect(
      (
        db.raw.prepare("SELECT kcal FROM fit_targets WHERE profile_id = 'p1'").get() as {
          kcal: number | null;
        }
      ).kcal,
    ).toBe(0);
    db.close();
  });

  it("refuses a negative goal", () => {
    const db = openDatabase({ path: join(dir, "fit-target-negative.db") });
    insertProfile(db, "p1");
    expect(() => db.raw.prepare(insertTargetSql).run("p1", -1, null, null, null, T)).toThrow(
      /CHECK/i,
    );
    db.close();
  });

  it("takes all three tables with the profile", () => {
    const db = openDatabase({ path: join(dir, "fit-cascade.db") });
    insertProfile(db, "p1");
    insertFood(db, "f1", "p1");
    insertItem(db, "i1", "p1");
    db.raw.prepare(insertTargetSql).run("p1", 2200, null, null, null, T);
    db.raw.prepare("DELETE FROM profiles WHERE id = 'p1'").run();
    for (const table of ["fit_foods", "fit_meal_items", "fit_targets"]) {
      expect((db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(
        0,
      );
    }
    db.close();
  });
});

describe("migration 059 — canvas boards (CANV slice a)", () => {
  const T = "2026-01-01T00:00:00.000Z";
  /** Canonical `serializeCanvasScene` output — the only thing this column ever holds. */
  const EMPTY_SCENE = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "nexus",
    elements: [],
    appState: {},
    files: {},
  });

  const insertBoard = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    overrides: Partial<{ name: string; scene: string }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO canvas_boards (id, profile_id, name, scene, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, profileId, overrides.name ?? "Tabla", overrides.scene ?? EMPTY_SCENE, T, T);

  it("creates the board table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "canvas-fresh.db") });
    expect(tableNames(db)).toContain("canvas_boards");
    expect(
      (db.raw.prepare("PRAGMA table_info(canvas_boards)").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    ).toEqual(["id", "profile_id", "name", "scene", "created_at", "updated_at", "deleted_at"]);
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  /**
   * ADR-042's precondition, CHECKED rather than assumed (see `059-canvas.ts`):
   * at version 58 there is no `canvas_boards` table and nothing references one,
   * so migration 059 is a plain `CREATE TABLE` with no rebuild to endanger a
   * referenced parent — and an upgrade of a populated database keeps every row
   * it had.
   */
  it("adds the table to a database written at 58, whose rows it leaves untouched", () => {
    const path = join(dir, "canvas-upgrade-058.db");
    const before = new Database(path);
    before.pragma("journal_mode = WAL");
    before.pragma("foreign_keys = ON");
    before.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      before,
      MIGRATIONS.filter((migration) => migration.version <= 58),
    );
    expect(
      before
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'canvas_boards'")
        .all(),
    ).toEqual([]);
    before
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run("p1", "personal", "Stari profil", T);
    before.close();

    const db = openDatabase({ path });
    expect(tableNames(db)).toContain("canvas_boards");
    // No rows: a profile that predates the module drew nothing, which is what
    // an empty table says.
    expect((db.raw.prepare("SELECT count(*) AS n FROM canvas_boards").get() as { n: number }).n).toBe(
      0,
    );
    expect((db.raw.prepare("SELECT count(*) AS n FROM profiles").get() as { n: number }).n).toBe(1);
    db.close();
  });

  it.each([
    ["empty-name", { name: "" }],
    ["over-long-name", { name: "T".repeat(61) }],
    ["empty-scene", { scene: "" }],
  ])("refuses %s", (label, overrides) => {
    const db = openDatabase({ path: join(dir, `canvas-check-${label}.db`) });
    insertProfile(db, "p1");
    expect(() => insertBoard(db, "b1", "p1", overrides)).toThrow(/CHECK/i);
    db.close();
  });

  it("lets two boards of one profile share a name — a board is identified by its id", () => {
    const db = openDatabase({ path: join(dir, "canvas-dupe-name.db") });
    insertProfile(db, "p1");
    insertBoard(db, "b1", "p1", { name: "Baza" });
    expect(() => insertBoard(db, "b2", "p1", { name: "Baza" })).not.toThrow();
    db.close();
  });

  it("keeps the scene verbatim, byte for byte", () => {
    const db = openDatabase({ path: join(dir, "canvas-verbatim.db") });
    insertProfile(db, "p1");
    const scene = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "nexus",
      elements: [{ id: "a", type: "rectangle", strokeWidth: 2 }],
      appState: { gridSize: 20 },
      files: {},
    });
    insertBoard(db, "b1", "p1", { scene });
    expect(
      (db.raw.prepare("SELECT scene FROM canvas_boards WHERE id = 'b1'").get() as { scene: string })
        .scene,
    ).toBe(scene);
    db.close();
  });

  it("takes a profile's boards with it — the table is a CHILD of profiles and never a parent", () => {
    const db = openDatabase({ path: join(dir, "canvas-cascade.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertBoard(db, "b1", "p1");
    insertBoard(db, "b2", "p2");
    db.raw.prepare("DELETE FROM profiles WHERE id = 'p1'").run();
    expect(db.raw.prepare("SELECT id FROM canvas_boards ORDER BY id").all()).toEqual([{ id: "b2" }]);
    db.close();
  });

  it("indexes the live boards by profile and name, and keeps the drawing out of that index", () => {
    const db = openDatabase({ path: join(dir, "canvas-index.db") });
    const [index] = db.raw
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'canvas_boards_profile_active'",
      )
      .all() as { sql: string }[];
    expect(index?.sql).toContain("(profile_id, name, id)");
    expect(index?.sql).toContain("WHERE deleted_at IS NULL");
    expect(index?.sql).not.toContain("scene");
    db.close();
  });
});

/**
 * Migration 060 — FIT training and body (ADR-081 slice b). Seven tables, and
 * the suite is organised around what the SCHEMA is asked to make impossible
 * rather than around the tables: an unreadable set, a backwards rep range, a
 * muscle unit with no reading, two readings for one day, and a cascade that
 * reaches further than a profile.
 */
describe("migration 060 — FIT training and body", () => {
  const T = "2026-08-07T09:00:00.000Z";
  const DAY = "2026-08-07";

  const insertExercise = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    overrides: Partial<{ name: string; metric: string; unilateral: number }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fit_exercises (id, profile_id, name, name_en, primary_muscles_json,
           secondary_muscles_json, equipment, pattern, unilateral, metric, notes,
           created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, '', '["grudi"]', '[]', 'sipka', 'potisak', ?, ?, '', ?, ?, NULL)`,
      )
      .run(
        id,
        profileId,
        overrides.name ?? "Potisak sa klupe",
        overrides.unilateral ?? 0,
        overrides.metric ?? "weight_reps",
        T,
        T,
      );

  const insertRoutine = (db: NexusDatabase, id: string, profileId: string) =>
    db.raw
      .prepare(
        `INSERT INTO fit_routines (id, profile_id, name, notes, created_at, updated_at, deleted_at)
         VALUES (?, ?, 'Gornji dan', '', ?, ?, NULL)`,
      )
      .run(id, profileId, T, T);

  const insertRoutineItem = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    routineId: string,
    overrides: Partial<{
      position: number;
      targetSets: number | null;
      repsMin: number | null;
      repsMax: number | null;
    }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fit_routine_items (id, profile_id, routine_id, position, exercise_ref, label,
           target_sets, target_reps_min, target_reps_max, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'catalogue:bench-press', 'Potisak sa klupe', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        profileId,
        routineId,
        overrides.position ?? 0,
        overrides.targetSets === undefined ? 3 : overrides.targetSets,
        overrides.repsMin === undefined ? 6 : overrides.repsMin,
        overrides.repsMax === undefined ? 10 : overrides.repsMax,
        T,
        T,
      );

  const insertWorkout = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    overrides: Partial<{ day: string; endedAt: string | null }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fit_workouts (id, profile_id, workout_date, started_at, ended_at,
           routine_ref, routine_label, notes, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL, '', '', ?, ?, NULL)`,
      )
      .run(
        id,
        profileId,
        overrides.day ?? DAY,
        T,
        overrides.endedAt === undefined ? T : overrides.endedAt,
        T,
        T,
      );

  const insertSet = (
    db: NexusDatabase,
    id: string,
    profileId: string,
    workoutId: string,
    overrides: Partial<{
      kind: string;
      metric: string;
      rir: number | null;
      reps: number | null;
      weight: number | null;
      position: number;
    }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fit_workout_sets (id, profile_id, workout_id, position, exercise_ref, label,
           metric, primary_muscles_json, kind, weight_kg, reps, seconds, distance_m, rir,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, 'catalogue:bench-press', 'Potisak sa klupe', ?, '["grudi"]', ?,
                 ?, ?, NULL, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        profileId,
        workoutId,
        overrides.position ?? 0,
        overrides.metric ?? "weight_reps",
        overrides.kind ?? "working",
        overrides.weight === undefined ? 80 : overrides.weight,
        overrides.reps === undefined ? 8 : overrides.reps,
        overrides.rir === undefined ? 2 : overrides.rir,
        T,
        T,
      );

  const insertMeasurement = (
    db: NexusDatabase,
    profileId: string,
    overrides: Partial<{
      day: string;
      weight: number;
      fat: number | null;
      muscleUnit: string | null;
      muscleValue: number | null;
      water: number | null;
      neck: number | null;
    }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fit_measurements (profile_id, day, weight_kg, body_fat_percent,
           muscle_unit, muscle_value, water_percent, neck_cm, chest_cm, upper_arm_cm,
           waist_cm, hip_cm, thigh_cm, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        profileId,
        overrides.day ?? DAY,
        overrides.weight ?? 82.4,
        overrides.fat === undefined ? 17.5 : overrides.fat,
        overrides.muscleUnit === undefined ? "kg" : overrides.muscleUnit,
        overrides.muscleValue === undefined ? 38.2 : overrides.muscleValue,
        overrides.water === undefined ? 55 : overrides.water,
        overrides.neck === undefined ? 39 : overrides.neck,
        T,
        T,
      );

  const insertBodyProfile = (
    db: NexusDatabase,
    profileId: string,
    overrides: Partial<{ sex: string | null; height: number; activity: string }> = {},
  ) =>
    db.raw
      .prepare(
        `INSERT INTO fit_body_profile (profile_id, sex, birth_date, height_cm, activity,
           created_at, updated_at)
         VALUES (?, ?, '1995-04-12', ?, ?, ?, ?)`,
      )
      .run(
        profileId,
        overrides.sex === undefined ? "male" : overrides.sex,
        overrides.height ?? 183,
        overrides.activity ?? "moderate",
        T,
        T,
      );

  it("creates all seven tables and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fit-training-fresh.db") });
    for (const table of [
      "fit_exercises",
      "fit_routines",
      "fit_routine_items",
      "fit_workouts",
      "fit_workout_sets",
      "fit_measurements",
      "fit_body_profile",
    ]) {
      expect(tableNames(db)).toContain(table);
    }
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    db.close();
  });

  it("gives a logged set the snapshot columns that decide how it is READ", () => {
    const db = openDatabase({ path: join(dir, "fit-set-columns.db") });
    const columns = (
      db.raw.prepare("PRAGMA table_info(fit_workout_sets)").all() as { name: string }[]
    ).map((row) => row.name);
    // `metric` says which of the four numbers mean anything; the muscles decide
    // which weekly total the set lands in. Both belong to the SET, not to an
    // exercise row that may be edited tonight.
    expect(columns).toContain("metric");
    expect(columns).toContain("primary_muscles_json");
    expect(columns).toContain("label");
    db.close();
  });

  it("refuses a set whose kind no volume read knows what to do with", () => {
    const db = openDatabase({ path: join(dir, "fit-set-kind.db") });
    insertProfile(db, "p1");
    insertWorkout(db, "w1", "p1");
    expect(() => insertSet(db, "s1", "p1", "w1", { kind: "cooldown" })).toThrow(/CHECK/i);
    for (const kind of ["warmup", "working", "drop", "failure"]) {
      expect(() => insertSet(db, `s-${kind}`, "p1", "w1", { kind })).not.toThrow();
    }
    db.close();
  });

  it("refuses a set whose metric would make its own numbers unreadable", () => {
    const db = openDatabase({ path: join(dir, "fit-set-metric.db") });
    insertProfile(db, "p1");
    insertWorkout(db, "w1", "p1");
    expect(() => insertSet(db, "s1", "p1", "w1", { metric: "calories" })).toThrow(/CHECK/i);
    db.close();
  });

  it("keeps RIR inside 0–5 and lets it be absent", () => {
    const db = openDatabase({ path: join(dir, "fit-set-rir.db") });
    insertProfile(db, "p1");
    insertWorkout(db, "w1", "p1");
    expect(() => insertSet(db, "s1", "p1", "w1", { rir: 6 })).toThrow(/CHECK/i);
    expect(() => insertSet(db, "s2", "p1", "w1", { rir: -1 })).toThrow(/CHECK/i);
    expect(() => insertSet(db, "s3", "p1", "w1", { rir: null })).not.toThrow();
    expect(() => insertSet(db, "s4", "p1", "w1", { rir: 0 })).not.toThrow();
    db.close();
  });

  it("lets a set carry no weight and no reps — a plank has neither", () => {
    const db = openDatabase({ path: join(dir, "fit-set-nulls.db") });
    insertProfile(db, "p1");
    insertWorkout(db, "w1", "p1");
    expect(() =>
      insertSet(db, "s1", "p1", "w1", { metric: "time", weight: null, reps: null }),
    ).not.toThrow();
    db.close();
  });

  it("refuses a rep range that runs backwards, and admits a single target", () => {
    const db = openDatabase({ path: join(dir, "fit-routine-range.db") });
    insertProfile(db, "p1");
    insertRoutine(db, "r1", "p1");
    expect(() =>
      insertRoutineItem(db, "i1", "p1", "r1", { repsMin: 12, repsMax: 8 }),
    ).toThrow(/CHECK/i);
    expect(() =>
      insertRoutineItem(db, "i2", "p1", "r1", { repsMin: 5, repsMax: 5 }),
    ).not.toThrow();
    // „As many sets as it takes" is a real routine, so all three targets are
    // allowed to be absent — NULL is „no target", never a target of zero.
    expect(() =>
      insertRoutineItem(db, "i3", "p1", "r1", {
        position: 1,
        targetSets: null,
        repsMin: null,
        repsMax: null,
      }),
    ).not.toThrow();
    expect(() => insertRoutineItem(db, "i4", "p1", "r1", { targetSets: 0 })).toThrow(/CHECK/i);
    db.close();
  });

  it("takes a routine's items with it, and a workout's sets with it", () => {
    const db = openDatabase({ path: join(dir, "fit-cascade-children.db") });
    insertProfile(db, "p1");
    insertRoutine(db, "r1", "p1");
    insertRoutine(db, "r2", "p1");
    insertRoutineItem(db, "i1", "p1", "r1");
    insertRoutineItem(db, "i2", "p1", "r2");
    insertWorkout(db, "w1", "p1");
    insertWorkout(db, "w2", "p1");
    insertSet(db, "s1", "p1", "w1");
    insertSet(db, "s2", "p1", "w2");

    db.raw.prepare("DELETE FROM fit_routines WHERE id = 'r1'").run();
    db.raw.prepare("DELETE FROM fit_workouts WHERE id = 'w1'").run();

    expect(db.raw.prepare("SELECT id FROM fit_routine_items ORDER BY id").all()).toEqual([
      { id: "i2" },
    ]);
    expect(db.raw.prepare("SELECT id FROM fit_workout_sets ORDER BY id").all()).toEqual([
      { id: "s2" },
    ]);
    db.close();
  });

  it("takes every FIT training row of a profile with the profile", () => {
    const db = openDatabase({ path: join(dir, "fit-cascade-profile.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertExercise(db, "e1", "p1");
    insertExercise(db, "e2", "p2");
    insertRoutine(db, "r1", "p1");
    insertRoutineItem(db, "i1", "p1", "r1");
    insertWorkout(db, "w1", "p1");
    insertSet(db, "s1", "p1", "w1");
    insertMeasurement(db, "p1");
    insertBodyProfile(db, "p1");

    db.raw.prepare("DELETE FROM profiles WHERE id = 'p1'").run();

    for (const table of [
      "fit_routines",
      "fit_routine_items",
      "fit_workouts",
      "fit_workout_sets",
      "fit_measurements",
      "fit_body_profile",
    ]) {
      expect(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect(db.raw.prepare("SELECT id FROM fit_exercises ORDER BY id").all()).toEqual([{ id: "e2" }]);
    db.close();
  });

  it("holds one reading per day and says so with its primary key", () => {
    const db = openDatabase({ path: join(dir, "fit-measurement-key.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertMeasurement(db, "p1");
    expect(() => insertMeasurement(db, "p1")).toThrow(/UNIQUE|PRIMARY/i);
    // Same day, different profile, and different days of one profile are both fine.
    expect(() => insertMeasurement(db, "p2")).not.toThrow();
    expect(() => insertMeasurement(db, "p1", { day: "2026-08-08" })).not.toThrow();
    db.close();
  });

  it("refuses a muscle unit with no reading, and a reading with no unit", () => {
    const db = openDatabase({ path: join(dir, "fit-measurement-muscle.db") });
    insertProfile(db, "p1");
    expect(() => insertMeasurement(db, "p1", { muscleUnit: "kg", muscleValue: null })).toThrow(
      /CHECK/i,
    );
    expect(() =>
      insertMeasurement(db, "p1", { day: "2026-08-08", muscleUnit: null, muscleValue: 38 }),
    ).toThrow(/CHECK/i);
    expect(() =>
      insertMeasurement(db, "p1", { day: "2026-08-09", muscleUnit: null, muscleValue: null }),
    ).not.toThrow();
    expect(() =>
      insertMeasurement(db, "p1", { day: "2026-08-10", muscleUnit: "percent", muscleValue: 42 }),
    ).not.toThrow();
    db.close();
  });

  it("refuses percentages a body cannot have, and weights a person cannot be", () => {
    const db = openDatabase({ path: join(dir, "fit-measurement-bounds.db") });
    insertProfile(db, "p1");
    expect(() => insertMeasurement(db, "p1", { fat: 0 })).toThrow(/CHECK/i);
    expect(() => insertMeasurement(db, "p1", { fat: 100 })).toThrow(/CHECK/i);
    expect(() => insertMeasurement(db, "p1", { water: 0 })).toThrow(/CHECK/i);
    expect(() => insertMeasurement(db, "p1", { weight: 0 })).toThrow(/CHECK/i);
    expect(() => insertMeasurement(db, "p1", { weight: 501 })).toThrow(/CHECK/i);
    // „Not measured" is the ordinary case for everything except the weight.
    expect(() =>
      insertMeasurement(db, "p1", { fat: null, water: null, neck: null }),
    ).not.toThrow();
    db.close();
  });

  it("stores a birth date rather than an age, and lets the sex be absent", () => {
    const db = openDatabase({ path: join(dir, "fit-body-profile.db") });
    insertProfile(db, "p1");
    const columns = (
      db.raw.prepare("PRAGMA table_info(fit_body_profile)").all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toContain("birth_date");
    expect(columns).not.toContain("age");
    expect(() => insertBodyProfile(db, "p1", { sex: null })).not.toThrow();
    db.close();
  });

  it("refuses an implausible height and an activity level nothing has a factor for", () => {
    const db = openDatabase({ path: join(dir, "fit-body-bounds.db") });
    insertProfile(db, "p1");
    expect(() => insertBodyProfile(db, "p1", { height: 49 })).toThrow(/CHECK/i);
    expect(() => insertBodyProfile(db, "p1", { height: 261 })).toThrow(/CHECK/i);
    expect(() => insertBodyProfile(db, "p1", { activity: "athlete" })).toThrow(/CHECK/i);
    expect(() => insertBodyProfile(db, "p1", { sex: "other" })).toThrow(/CHECK/i);
    db.close();
  });

  it("refuses a second open session, and lets a finished one be followed by a new one", () => {
    const db = openDatabase({ path: join(dir, "fit-one-open.db") });
    insertProfile(db, "p1");
    insertProfile(db, "p2");
    insertWorkout(db, "w1", "p1", { endedAt: null });
    // Two open at once would make „the current workout" ambiguous.
    expect(() => insertWorkout(db, "w2", "p1", { endedAt: null })).toThrow(/UNIQUE/i);
    // Another profile is another person.
    expect(() => insertWorkout(db, "w3", "p2", { endedAt: null })).not.toThrow();
    // Finished sessions do not occupy the slot, however many there are.
    expect(() => insertWorkout(db, "w4", "p1")).not.toThrow();
    expect(() => insertWorkout(db, "w5", "p1")).not.toThrow();
    db.raw.prepare("UPDATE fit_workouts SET ended_at = ? WHERE id = 'w1'").run(T);
    expect(() => insertWorkout(db, "w6", "p1", { endedAt: null })).not.toThrow();
    db.close();
  });

  it("indexes the read the module exists for — this exercise, last time", () => {
    const db = openDatabase({ path: join(dir, "fit-index.db") });
    const indexes = Object.fromEntries(
      (
        db.raw
          .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'fit_%'")
          .all() as { name: string; sql: string | null }[]
      ).map((row) => [row.name, row.sql ?? ""]),
    );
    expect(indexes["fit_workout_sets_profile_exercise"]).toContain("(profile_id, exercise_ref");
    expect(indexes["fit_workout_sets_workout"]).toContain("(workout_id, position, id)");
    expect(indexes["fit_workouts_profile_day"]).toContain("WHERE deleted_at IS NULL");
    expect(indexes["fit_exercises_profile_active"]).toContain("WHERE deleted_at IS NULL");
    expect(indexes["fit_routines_profile_active"]).toContain("WHERE deleted_at IS NULL");
    // The date lives on the workout and is JOINed for, never copied onto every
    // set: a copied date drifts the first time a session is re-dated.
    expect(
      (db.raw.prepare("PRAGMA table_info(fit_workout_sets)").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    ).not.toContain("workout_date");
    db.close();
  });

  it("adds the seven tables to a database written at 59, whose rows it leaves untouched", () => {
    const path = join(dir, "fit-upgrade-059.db");
    const before = new Database(path);
    before.pragma("journal_mode = WAL");
    before.pragma("foreign_keys = ON");
    before.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );
    runMigrations(
      before,
      MIGRATIONS.filter((migration) => migration.version <= 59),
    );
    before
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run("p1", "personal", "P", T);
    before
      .prepare(
        `INSERT INTO fit_targets (profile_id, kcal, protein_g, carbs_g, fat_g, updated_at)
         VALUES ('p1', 2600, 180, NULL, NULL, ?)`,
      )
      .run(T);
    expect(before.pragma("user_version", { simple: true })).toBe(59);
    before.close();

    const db = openDatabase({ path });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
    expect(tableNames(db)).toContain("fit_workout_sets");
    expect(db.raw.prepare("SELECT kcal, protein_g FROM fit_targets WHERE profile_id = 'p1'").get())
      .toEqual({ kcal: 2600, protein_g: 180 });
    db.close();
  });
});
