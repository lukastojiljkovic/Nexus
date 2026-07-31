import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeckStore,
  ExamNotFoundError,
  ExamStore,
  ExamTopicNotFoundError,
  ExamTopicValidationError,
  NexusDatabase,
  openDatabase,
  SubjectStore,
  TopicStore,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const T0 = "2026-07-08T10:00:00.000Z";
const TODAY = "2026-07-08";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-topics-"));
  db = openDatabase({ path: join(dir, "topics.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
  return id;
}

/** A profile with one subject, one exam a month out, and one deck — plus the stores scoped to it. */
function fixture(): {
  topics: TopicStore;
  exams: ExamStore;
  decks: DeckStore;
  profileId: string;
  examId: string;
  deckId: string;
  subjectId: string;
} {
  const profileId = createProfile();
  const subjects = new SubjectStore(db.raw, profileId);
  const subjectId = subjects.create({ name: "Analiza 1" }).id;
  const exams = new ExamStore(db.raw, profileId);
  const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-08-10" }).id;
  const decks = new DeckStore(db.raw, profileId);
  const deckId = decks.create({ subjectId, name: "Glava 1" }).id;
  return { topics: new TopicStore(db.raw, profileId), exams, decks, profileId, examId, deckId, subjectId };
}

/** Inserts one raw card of `deckId` with the given scheduled interval — the maturity evidence. */
function insertCard(profileId: string, deckId: string, scheduledDays: number, deleted = false): string {
  const id = uuidv7();
  db.raw
    .prepare(
      `INSERT INTO cards
         (id, profile_id, deck_id, front, back, due, stability, difficulty,
          elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'Q', 'A', ?, 1, 1, 0, ?, 0, 1, 0, 2, ?, ?, ?)`,
    )
    .run(id, profileId, deckId, T0, scheduledDays, T0, T0, deleted ? T0 : null);
  return id;
}

/** Inserts one raw review of `cardId` at `review` with the given rating (1 = Again). */
function insertReview(profileId: string, cardId: string, rating: number, review: string): void {
  db.raw
    .prepare(
      `INSERT INTO review_log
         (id, profile_id, card_id, rating, state, due, stability, difficulty,
          elapsed_days, last_elapsed_days, scheduled_days, learning_steps, review, created_at)
       VALUES (?, ?, ?, ?, 2, ?, 1, 1, 0, 0, 1, 0, ?, ?)`,
    )
    .run(uuidv7(), profileId, cardId, rating, review, review, review);
}

describe("TopicStore", () => {
  describe("create / listByExam", () => {
    it("appends each topic at the bottom rank, trimmed, and lists in rank order", () => {
      const { topics, examId } = fixture();
      const first = topics.create({ examId, name: "  Grafovi  " }, T0);
      const second = topics.create({ examId, name: "Stabla" }, T0);

      expect(first.name).toBe("Grafovi");
      expect(first.rank).toBe(0);
      expect(first.confidence).toBeNull();
      expect(first.deckId).toBeNull();
      expect(first.cut).toBe(false);
      expect(second.rank).toBe(1);

      expect(topics.listByExam(examId).map((t) => [t.name, t.rank])).toEqual([
        ["Grafovi", 0],
        ["Stabla", 1],
      ]);
    });

    it("stores an initial confidence and deck link when given", () => {
      const { topics, examId, deckId } = fixture();
      const created = topics.create({ examId, name: "Grafovi", confidence: 40, deckId }, T0);
      expect(created.confidence).toBe(40);
      expect(created.deckId).toBe(deckId);
    });

    it("rejects an examId that does not resolve to an active exam in this profile", () => {
      const { topics, exams, examId } = fixture();
      expect(() => topics.create({ examId: "missing", name: "X" }, T0)).toThrow(ExamNotFoundError);

      const other = fixture();
      expect(() => topics.create({ examId: other.examId, name: "X" }, T0)).toThrow(
        ExamNotFoundError,
      );

      exams.softDelete(examId);
      expect(() => topics.create({ examId, name: "X" }, T0)).toThrow(ExamNotFoundError);
    });

    it("rejects an empty or over-long name, a bad confidence, and a malformed now", () => {
      const { topics, examId } = fixture();
      expect(() => topics.create({ examId, name: "   " }, T0)).toThrow(ExamTopicValidationError);
      expect(() => topics.create({ examId, name: "x".repeat(201) }, T0)).toThrow(
        ExamTopicValidationError,
      );
      expect(() => topics.create({ examId, name: "X", confidence: -1 }, T0)).toThrow(
        ExamTopicValidationError,
      );
      expect(() => topics.create({ examId, name: "X", confidence: 101 }, T0)).toThrow(
        ExamTopicValidationError,
      );
      expect(() => topics.create({ examId, name: "X", confidence: 50.5 }, T0)).toThrow(
        ExamTopicValidationError,
      );
      expect(() => topics.create({ examId, name: "X" }, "not-a-date")).toThrow(
        ExamTopicValidationError,
      );
    });

    it("rejects a deckId that does not resolve to an active deck in this profile", () => {
      const { topics, examId } = fixture();
      const other = fixture();
      expect(() => topics.create({ examId, name: "X", deckId: "missing" }, T0)).toThrow(
        ExamTopicValidationError,
      );
      expect(() => topics.create({ examId, name: "X", deckId: other.deckId }, T0)).toThrow(
        ExamTopicValidationError,
      );
    });

    it("throws ExamNotFoundError when listing an exam that is not active in this profile", () => {
      const { topics } = fixture();
      expect(() => topics.listByExam("missing")).toThrow(ExamNotFoundError);
    });
  });

  describe("listAll", () => {
    it("lists every active topic of this profile, grouped by exam in rank order", () => {
      const { topics, exams, examId, subjectId } = fixture();
      const examB = exams.create({ subjectId, examType: "usmeni", examDate: "2026-09-01" }).id;
      topics.create({ examId, name: "A0" }, T0);
      topics.create({ examId, name: "A1" }, T0);
      topics.create({ examId: examB, name: "B0" }, T0);

      const names = topics.listAll().map((t) => t.name);
      expect(names).toHaveLength(3);
      expect(names).toContain("B0");
      // Within one exam, rank order holds.
      expect(names.indexOf("A0")).toBeLessThan(names.indexOf("A1"));
    });

    it("keeps one profile's topics invisible to another's store", () => {
      const a = fixture();
      const b = fixture();
      a.topics.create({ examId: a.examId, name: "Samo A" }, T0);
      expect(b.topics.listAll()).toHaveLength(0);
    });
  });

  describe("rename / setConfidence / setDeck", () => {
    it("renames a topic, trimmed and validated", () => {
      const { topics, examId } = fixture();
      const created = topics.create({ examId, name: "Grafovi" }, T0);
      const renamed = topics.rename(created.id, "  Stabla ", "2026-07-09T10:00:00.000Z");
      expect(renamed.name).toBe("Stabla");
      expect(renamed.updatedAt).toBe("2026-07-09T10:00:00.000Z");
      expect(() => topics.rename(created.id, "  ", T0)).toThrow(ExamTopicValidationError);
      expect(() => topics.rename("missing", "X", T0)).toThrow(ExamTopicNotFoundError);
    });

    it("sets and clears the manual confidence", () => {
      const { topics, examId } = fixture();
      const created = topics.create({ examId, name: "Grafovi" }, T0);
      expect(topics.setConfidence(created.id, 70, T0).confidence).toBe(70);
      expect(topics.setConfidence(created.id, null, T0).confidence).toBeNull();
      expect(() => topics.setConfidence(created.id, 101, T0)).toThrow(ExamTopicValidationError);
      expect(() => topics.setConfidence("missing", 10, T0)).toThrow(ExamTopicNotFoundError);
    });

    it("sets and clears the deck link, validating the deck's profile", () => {
      const { topics, examId, deckId } = fixture();
      const other = fixture();
      const created = topics.create({ examId, name: "Grafovi" }, T0);
      expect(topics.setDeck(created.id, deckId, T0).deckId).toBe(deckId);
      expect(topics.setDeck(created.id, null, T0).deckId).toBeNull();
      expect(() => topics.setDeck(created.id, other.deckId, T0)).toThrow(
        ExamTopicValidationError,
      );
      expect(() => other.topics.setDeck(created.id, other.deckId, T0)).toThrow(
        ExamTopicNotFoundError,
      );
    });
  });

  describe("moveTopic", () => {
    it("moves a topic to the given rank and renumbers the exam contiguously", () => {
      const { topics, examId } = fixture();
      topics.create({ examId, name: "A" }, T0);
      const b = topics.create({ examId, name: "B" }, T0);
      topics.create({ examId, name: "C" }, T0);

      const after = topics.moveTopic(b.id, 0, "2026-07-09T10:00:00.000Z");
      expect(after.map((t) => [t.name, t.rank])).toEqual([
        ["B", 0],
        ["A", 1],
        ["C", 2],
      ]);
    });

    it("moves toward the bottom as well", () => {
      const { topics, examId } = fixture();
      const a = topics.create({ examId, name: "A" }, T0);
      topics.create({ examId, name: "B" }, T0);
      topics.create({ examId, name: "C" }, T0);

      const after = topics.moveTopic(a.id, 2, T0);
      expect(after.map((t) => t.name)).toEqual(["B", "C", "A"]);
      expect(after.map((t) => t.rank)).toEqual([0, 1, 2]);
    });

    it("rejects a rank outside 0..n-1 or a non-integer, and an unknown topic", () => {
      const { topics, examId } = fixture();
      const a = topics.create({ examId, name: "A" }, T0);
      topics.create({ examId, name: "B" }, T0);
      expect(() => topics.moveTopic(a.id, -1, T0)).toThrow(ExamTopicValidationError);
      expect(() => topics.moveTopic(a.id, 2, T0)).toThrow(ExamTopicValidationError);
      expect(() => topics.moveTopic(a.id, 0.5, T0)).toThrow(ExamTopicValidationError);
      expect(() => topics.moveTopic("missing", 0, T0)).toThrow(ExamTopicNotFoundError);
    });
  });

  describe("softDelete", () => {
    it("removes the topic from lists, renumbers the survivors, and promotes its blocks' topic_id to NULL", () => {
      const { topics, examId, profileId } = fixture();
      const a = topics.create({ examId, name: "A" }, T0);
      const b = topics.create({ examId, name: "B" }, T0);
      const c = topics.create({ examId, name: "C" }, T0);

      // A plan and one block assigned to B, written raw (PlanStore's own
      // topic-aware generation is exercised in its own suite).
      db.raw
        .prepare(
          `INSERT INTO study_plans
             (id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost, created_at, updated_at)
           VALUES ('pl1', ?, ?, 30, '2026-08-01', 0, ?, ?)`,
        )
        .run(profileId, examId, T0, T0);
      db.raw
        .prepare(
          `INSERT INTO study_blocks
             (id, plan_id, profile_id, block_date, minutes, status, topic_id, kind, pinned, created_at, updated_at)
           VALUES ('bl1', 'pl1', ?, '2026-08-05', 30, 'planned', ?, 'coverage', 0, ?, ?)`,
        )
        .run(profileId, b.id, T0, T0);

      topics.softDelete(b.id, "2026-07-09T10:00:00.000Z");

      expect(topics.listByExam(examId).map((t) => [t.id, t.rank])).toEqual([
        [a.id, 0],
        [c.id, 1],
      ]);
      const block = db.raw
        .prepare("SELECT topic_id FROM study_blocks WHERE id = 'bl1'")
        .get() as { topic_id: string | null };
      expect(block.topic_id).toBeNull();
    });

    it("throws ExamTopicNotFoundError for an unknown, already-deleted, or cross-profile topic", () => {
      const { topics, examId } = fixture();
      const a = topics.create({ examId, name: "A" }, T0);
      expect(() => topics.softDelete("missing", T0)).toThrow(ExamTopicNotFoundError);
      topics.softDelete(a.id, T0);
      expect(() => topics.softDelete(a.id, T0)).toThrow(ExamTopicNotFoundError);

      const other = fixture();
      const owned = other.topics.create({ examId: other.examId, name: "X" }, T0);
      expect(() => topics.softDelete(owned.id, T0)).toThrow(ExamTopicNotFoundError);
    });
  });

  describe("deck-derived confidence (the ADR-063 blend, pinned)", () => {
    it("answers null for a deck with no active cards", () => {
      const { topics, deckId } = fixture();
      expect(topics.deriveDeckConfidence(deckId, TODAY)).toBeNull();
    });

    it("blends mature-card fraction alone when there are no recent reviews", () => {
      const { topics, deckId, profileId } = fixture();
      insertCard(profileId, deckId, 30); // mature (>= 21)
      insertCard(profileId, deckId, 5); // young
      // againRate 0, matureFraction 0.5 -> round(100 * (0.6 + 0.2)) = 80.
      expect(topics.deriveDeckConfidence(deckId, TODAY)).toBe(80);
    });

    it("folds the recent Again-rate in beside maturity", () => {
      const { topics, deckId, profileId } = fixture();
      const mature = insertCard(profileId, deckId, 30);
      insertCard(profileId, deckId, 5);
      // Four reviews inside the 30-day window, one of them Again.
      insertReview(profileId, mature, 3, "2026-07-01T10:00:00.000Z");
      insertReview(profileId, mature, 3, "2026-07-02T10:00:00.000Z");
      insertReview(profileId, mature, 3, "2026-07-03T10:00:00.000Z");
      insertReview(profileId, mature, 1, "2026-07-04T10:00:00.000Z");
      // againRate 0.25, matureFraction 0.5 -> round(100 * (0.45 + 0.2)) = 65.
      expect(topics.deriveDeckConfidence(deckId, TODAY)).toBe(65);
    });

    it("ignores reviews older than the 30-day window", () => {
      const { topics, deckId, profileId } = fixture();
      const mature = insertCard(profileId, deckId, 30);
      insertCard(profileId, deckId, 5);
      insertReview(profileId, mature, 1, "2026-06-01T10:00:00.000Z"); // outside the window
      expect(topics.deriveDeckConfidence(deckId, TODAY)).toBe(80);
    });

    it("counts a deleted card's reviews (a review that happened, happened) but not its maturity", () => {
      const { topics, deckId, profileId } = fixture();
      insertCard(profileId, deckId, 30); // the live census: 1 of 1 mature
      const deleted = insertCard(profileId, deckId, 5, true);
      insertReview(profileId, deleted, 1, "2026-07-01T10:00:00.000Z");
      // againRate 1, matureFraction 1 -> round(100 * (0 + 0.4)) = 40.
      expect(topics.deriveDeckConfidence(deckId, TODAY)).toBe(40);
    });

    it("rejects a malformed today", () => {
      const { topics, deckId } = fixture();
      expect(() => topics.deriveDeckConfidence(deckId, "not-a-date")).toThrow(
        ExamTopicValidationError,
      );
    });
  });

  describe("listEffectiveByExam", () => {
    it("prefers the manual confidence, falls back to the deck, and answers null with neither", () => {
      const { topics, examId, deckId, profileId } = fixture();
      insertCard(profileId, deckId, 30);
      insertCard(profileId, deckId, 5); // derived confidence: 80

      const manual = topics.create({ examId, name: "Ručno", confidence: 30, deckId }, T0);
      const derived = topics.create({ examId, name: "Iz špila", deckId }, T0);
      const unknown = topics.create({ examId, name: "Nepoznato" }, T0);

      const effective = topics.listEffectiveByExam(examId, TODAY);
      const byId = new Map(effective.map((t) => [t.id, t.effectiveConfidence]));
      expect(byId.get(manual.id)).toBe(30);
      expect(byId.get(derived.id)).toBe(80);
      expect(byId.get(unknown.id)).toBeNull();
    });

    it("rejects a malformed today and an exam outside this profile", () => {
      const { topics, examId } = fixture();
      expect(() => topics.listEffectiveByExam(examId, "nope")).toThrow(ExamTopicValidationError);
      expect(() => topics.listEffectiveByExam("missing", TODAY)).toThrow(ExamNotFoundError);
    });
  });

  describe("deck liveness (the stale-link flag behind Nedostupan spil)", () => {
    it("marks a link whose deck was deleted afterwards, leaves the derivation alone, and clears with the link", () => {
      const { topics, decks, examId, deckId, profileId } = fixture();
      insertCard(profileId, deckId, 30);
      insertCard(profileId, deckId, 5); // derived confidence: 80

      const topic = topics.create({ examId, name: "Iz špila", deckId }, T0);
      const linked = topics.listEffectiveByExam(examId, TODAY)[0]!;
      expect(linked.deckMissing).toBe(false);
      expect(linked.effectiveConfidence).toBe(80);

      decks.softDelete(deckId);

      const stale = topics.listEffectiveByExam(examId, TODAY)[0]!;
      expect(stale.deckId).toBe(deckId); // the stored link is untouched
      expect(stale.deckMissing).toBe(true);
      // The derivation is unchanged in behaviour — only the telling is new.
      expect(stale.effectiveConfidence).toBe(80);

      topics.setDeck(topic.id, null, T0);
      const cleared = topics.listEffectiveByExam(examId, TODAY)[0]!;
      expect(cleared.deckMissing).toBe(false);
      expect(cleared.effectiveConfidence).toBeNull();
    });

    it("never marks a topic with no link at all", () => {
      const { topics, examId } = fixture();
      topics.create({ examId, name: "Bez špila" }, T0);
      expect(topics.listEffectiveByExam(examId, TODAY)[0]?.deckMissing).toBe(false);
    });

    it("resolves the whole listed set at once: two topics on the dead deck, one on a live one", () => {
      const { topics, decks, examId, deckId, subjectId } = fixture();
      const liveDeckId = decks.create({ subjectId, name: "Glava 2" }).id;
      topics.create({ examId, name: "A", deckId }, T0);
      topics.create({ examId, name: "B", deckId }, T0);
      topics.create({ examId, name: "C", deckId: liveDeckId }, T0);

      decks.softDelete(deckId);

      expect(topics.listEffectiveByExam(examId, TODAY).map((t) => [t.name, t.deckMissing])).toEqual([
        ["A", true],
        ["B", true],
        ["C", false],
      ]);
    });

    it("marks a link the deck's own profile no longer backs, and unmarks it when the deck comes back", () => {
      const { topics, decks, examId, deckId } = fixture();
      topics.create({ examId, name: "Iz špila", deckId }, T0);

      decks.softDelete(deckId);
      expect(topics.listEffectiveByExam(examId, TODAY)[0]?.deckMissing).toBe(true);

      decks.restore(deckId);
      expect(topics.listEffectiveByExam(examId, TODAY)[0]?.deckMissing).toBe(false);
    });
  });
});
