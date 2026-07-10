import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NexusDatabase, openDatabase } from "../index.js";

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
    expect(db.raw.pragma("user_version", { simple: true })).toBe(8);
    db.close();
  });

  it("is a no-op when reopening an already-migrated database", () => {
    const path = join(dir, "again.db");
    const first = openDatabase({ path });
    insertProfile(first, "p1");
    first.close();

    const second = openDatabase({ path });
    expect(second.raw.pragma("user_version", { simple: true })).toBe(8);
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
    expect(db.raw.pragma("user_version", { simple: true })).toBe(8);
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
    expect(db.raw.pragma("user_version", { simple: true })).toBe(8);
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
    expect(db.raw.pragma("user_version", { simple: true })).toBe(8);
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
    expect(db.raw.pragma("user_version", { simple: true })).toBe(8);
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
    expect(db.raw.pragma("user_version", { simple: true })).toBe(8);
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
    expect(db.raw.pragma("user_version", { simple: true })).toBe(8);
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
