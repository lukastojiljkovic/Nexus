import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLOZE_MASK, renderClozeCard } from "@nexus/core";
import {
  CardNotFoundError,
  CardStore,
  CardValidationError,
  DeckStore,
  NexusDatabase,
  openDatabase,
  SubjectStore,
  uuidv7,
} from "../index.js";
import type { NoteCardSpecInput } from "./cardStore.js";

let dir: string;
let db: NexusDatabase;

const T0 = "2026-07-08T10:00:00.000Z";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-cards-"));
  db = openDatabase({ path: join(dir, "cards.db") });
});

afterEach(() => {
  vi.useRealTimers();
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

function countReviewLogs(cardId: string): number {
  return (
    db.raw
      .prepare("SELECT count(*) AS n FROM review_log WHERE card_id = ?")
      .get(cardId) as { n: number }
  ).n;
}

/** A profile with one subject and one deck, plus the stores scoped to it. */
function fixture(): {
  cards: CardStore;
  decks: DeckStore;
  subjects: SubjectStore;
  deckId: string;
  subjectId: string;
  profileId: string;
} {
  const profileId = createProfile();
  const subjects = new SubjectStore(db.raw, profileId);
  const subjectId = subjects.create({ name: "Analiza 1" }).id;
  const decks = new DeckStore(db.raw, profileId);
  const deckId = decks.create({ subjectId, name: "Glava 1" }).id;
  return { cards: new CardStore(db.raw, profileId), decks, subjects, deckId, subjectId, profileId };
}

/**
 * A Q/A spec as `collectNoteCards` sends it. The three ADR-042 fields are
 * constant for a Q/A card, so they are spelled once here rather than on every
 * one of the reconcile tests below.
 */
function spec(key: string, front: string, back: string): NoteCardSpecInput {
  return { key, front, back, kind: "basic", clozeText: null, clozeOrdinal: null };
}

/** One cloze deletion as `collectNoteCards` sends it: the template plus the ordinal it asks. */
function clozeSpec(key: string, clozeText: string, clozeOrdinal: number): NoteCardSpecInput {
  const sides = renderClozeCard(clozeText, clozeOrdinal);
  if (sides === null) throw new Error(`Test fixture: ${clozeText} has no deletion ${clozeOrdinal}.`);
  return { key, front: sides.front, back: sides.back, kind: "cloze", clozeText, clozeOrdinal };
}

/** Inserts a note for `profileId` directly (CardStore does not own notes). */
function insertNote(profileId: string, deletedAt: string | null = null): string {
  const id = uuidv7();
  db.raw
    .prepare(
      `INSERT INTO notes (id, profile_id, title, created_at, updated_at, deleted_at)
       VALUES (?, ?, '', ?, ?, ?)`,
    )
    .run(id, profileId, T0, T0, deletedAt);
  return id;
}

describe("CardStore", () => {
  describe("create", () => {
    it("seeds a fresh FSRS state (New, due = now, zero counters)", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);

      expect(created.deckId).toBe(deckId);
      expect(created.front).toBe("Q");
      expect(created.back).toBe("A");
      expect(created.due).toBe(T0);
      expect(created.state).toBe(0); // New
      expect(created.reps).toBe(0);
      expect(created.lapses).toBe(0);
      expect(created.stability).toBe(0);
      expect(created.difficulty).toBe(0);
      expect(created.lastReview).toBeNull();
    });

    it("inserts NULL for sourceNoteId/sourceBlockKey on a hand-made card", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);
      expect(created.sourceNoteId).toBeNull();
      expect(created.sourceBlockKey).toBeNull();
    });

    it("trims front/back and stores $...$ KaTeX math verbatim (no sanitizing)", () => {
      const { cards, deckId } = fixture();
      const created = cards.create(
        { deckId, front: "  What is $x^2$?  ", back: "  $x \\cdot x$  " },
        T0,
      );
      expect(created.front).toBe("What is $x^2$?");
      expect(created.back).toBe("$x \\cdot x$");
    });

    it("rejects an empty or whitespace-only front/back", () => {
      const { cards, deckId } = fixture();
      expect(() => cards.create({ deckId, front: "", back: "A" }, T0)).toThrow(
        CardValidationError,
      );
      expect(() => cards.create({ deckId, front: "Q", back: "   " }, T0)).toThrow(
        CardValidationError,
      );
    });

    it("rejects front/back longer than 10000 characters", () => {
      const { cards, deckId } = fixture();
      expect(() =>
        cards.create({ deckId, front: "x".repeat(10001), back: "A" }, T0),
      ).toThrow(CardValidationError);
      expect(() =>
        cards.create({ deckId, front: "x".repeat(10000), back: "A" }, T0),
      ).not.toThrow();
    });

    it("rejects a card referencing a deck from another profile", () => {
      const { cards } = fixture();
      const foreignProfile = createProfile();
      const foreignSubjects = new SubjectStore(db.raw, foreignProfile);
      const foreignSubjectId = foreignSubjects.create({ name: "Elsewhere" }).id;
      const foreignDecks = new DeckStore(db.raw, foreignProfile);
      const foreignDeckId = foreignDecks.create({ subjectId: foreignSubjectId, name: "x" }).id;

      expect(() =>
        cards.create({ deckId: foreignDeckId, front: "Q", back: "A" }, T0),
      ).toThrow(CardValidationError);
    });

    it("rejects a card referencing a soft-deleted deck", () => {
      const { cards, decks, deckId } = fixture();
      decks.softDelete(deckId);
      expect(() => cards.create({ deckId, front: "Q", back: "A" }, T0)).toThrow(
        CardValidationError,
      );
    });

    it("rejects a malformed now", () => {
      const { cards, deckId } = fixture();
      expect(() =>
        cards.create({ deckId, front: "Q", back: "A" }, "2026-07-08"),
      ).toThrow(CardValidationError);
      expect(() =>
        cards.create({ deckId, front: "Q", back: "A" }, "not-a-date"),
      ).toThrow(CardValidationError);
    });
  });

  describe("update", () => {
    it("updates content/placement fields without touching scheduling state", () => {
      const { cards, decks, subjectId, deckId } = fixture();
      const otherDeckId = decks.create({ subjectId, name: "Glava 2" }).id;
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);

      const updated = cards.update(created.id, { front: "Q2", back: "A2", deckId: otherDeckId });

      expect(updated.front).toBe("Q2");
      expect(updated.back).toBe("A2");
      expect(updated.deckId).toBe(otherDeckId);
      expect(updated.due).toBe(created.due);
      expect(updated.state).toBe(created.state);
      expect(updated.stability).toBe(created.stability);
      expect(updated.reps).toBe(created.reps);
    });

    it("rejects an update that moves a card to a deck in another profile", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);
      const foreignProfile = createProfile();
      const foreignSubjects = new SubjectStore(db.raw, foreignProfile);
      const foreignSubjectId = foreignSubjects.create({ name: "Elsewhere" }).id;
      const foreignDecks = new DeckStore(db.raw, foreignProfile);
      const foreignDeckId = foreignDecks.create({ subjectId: foreignSubjectId, name: "x" }).id;

      expect(() => cards.update(created.id, { deckId: foreignDeckId })).toThrow(
        CardValidationError,
      );
    });
  });

  describe("listByDeck / soft delete / restore", () => {
    it("lists active cards of a deck ordered by creation", () => {
      vi.useFakeTimers();
      const { cards, deckId } = fixture();
      vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
      const first = cards.create({ deckId, front: "1", back: "1" }, T0);
      vi.setSystemTime(new Date("2026-07-06T10:00:01.000Z"));
      const second = cards.create({ deckId, front: "2", back: "2" }, T0);

      expect(cards.listByDeck(deckId).map((c) => c.id)).toEqual([first.id, second.id]);
    });

    it("rejects listByDeck for a deck in another profile", () => {
      const { cards } = fixture();
      const foreignProfile = createProfile();
      const foreignSubjects = new SubjectStore(db.raw, foreignProfile);
      const foreignSubjectId = foreignSubjects.create({ name: "Elsewhere" }).id;
      const foreignDecks = new DeckStore(db.raw, foreignProfile);
      const foreignDeckId = foreignDecks.create({ subjectId: foreignSubjectId, name: "x" }).id;

      expect(() => cards.listByDeck(foreignDeckId)).toThrow(CardValidationError);
    });

    it("excludes soft-deleted cards from listByDeck and restores them", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);

      cards.softDelete(created.id);
      expect(cards.listByDeck(deckId)).toHaveLength(0);

      cards.restore(created.id);
      const listed = cards.listByDeck(deckId);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(created.id);
    });

    it("throws CardNotFoundError for operations on an unknown or wrong-state card", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);

      expect(() => cards.update("missing", { front: "x" })).toThrow(CardNotFoundError);
      expect(() => cards.softDelete("missing")).toThrow(CardNotFoundError);
      expect(() => cards.restore(created.id)).toThrow(CardNotFoundError);
      cards.softDelete(created.id);
      expect(() => cards.softDelete(created.id)).toThrow(CardNotFoundError);
    });

    it("isolates cards between profiles", () => {
      const a = fixture();
      const b = fixture();
      const owned = a.cards.create({ deckId: a.deckId, front: "Q", back: "A" }, T0);

      expect(b.cards.listByDeck(b.deckId)).toHaveLength(0);
      expect(() => b.cards.update(owned.id, { front: "x" })).toThrow(CardNotFoundError);
      expect(() => b.cards.softDelete(owned.id)).toThrow(CardNotFoundError);
      expect(a.cards.listByDeck(a.deckId)).toHaveLength(1);
    });
  });

  describe("review", () => {
    it("review(Good) advances state and pushes due into the future, writing exactly one log row", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);

      const reviewed = cards.review(created.id, 3, T0); // Good

      expect(reviewed.state).not.toBe(0); // no longer New
      expect(reviewed.due > created.due).toBe(true);
      expect(reviewed.reps).toBe(1);
      expect(reviewed.lapses).toBe(0);
      expect(reviewed.lastReview).toBe(T0);
      expect(countReviewLogs(created.id)).toBe(1);
    });

    it("review(Again) on a Review-state card increments lapses", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);
      const toReview = cards.review(created.id, 4, T0); // Easy: New -> Review directly
      expect(toReview.state).toBe(2);
      expect(toReview.lapses).toBe(0);

      const lapsed = cards.review(created.id, 1, "2026-07-20T10:00:00.000Z"); // Again
      expect(lapsed.lapses).toBe(1);
      expect(countReviewLogs(created.id)).toBe(2);
    });

    it("rejects an unknown or Manual(0) rating", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);
      expect(() => cards.review(created.id, 0 as never, T0)).toThrow(CardValidationError);
      expect(() => cards.review(created.id, 5 as never, T0)).toThrow(CardValidationError);
    });

    it("rejects a malformed now", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);
      expect(() => cards.review(created.id, 3, "not-a-date")).toThrow(CardValidationError);
    });

    it("throws CardNotFoundError reviewing an unknown or deleted card", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);
      cards.softDelete(created.id);
      expect(() => cards.review(created.id, 3, T0)).toThrow(CardNotFoundError);
      expect(() => cards.review("missing", 3, T0)).toThrow(CardNotFoundError);
    });
  });

  describe("undoLastReview", () => {
    it("restores the exact pre-review card and removes the log row", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);
      cards.review(created.id, 3, T0); // Good
      expect(countReviewLogs(created.id)).toBe(1);

      const undone = cards.undoLastReview(created.id, "2026-07-08T10:15:00.000Z");

      expect(undone.due).toBe(created.due);
      expect(undone.stability).toBe(created.stability);
      expect(undone.difficulty).toBe(created.difficulty);
      expect(undone.elapsedDays).toBe(created.elapsedDays);
      expect(undone.scheduledDays).toBe(created.scheduledDays);
      expect(undone.learningSteps).toBe(created.learningSteps);
      expect(undone.reps).toBe(created.reps);
      expect(undone.lapses).toBe(created.lapses);
      expect(undone.state).toBe(created.state);
      expect(undone.lastReview).toBe(created.lastReview);
      expect(countReviewLogs(created.id)).toBe(0);
    });

    it("throws CardValidationError when there is no review to undo", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);
      expect(() => cards.undoLastReview(created.id, T0)).toThrow(CardValidationError);
    });

    it("throws CardNotFoundError undoing an unknown or deleted card", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);
      cards.softDelete(created.id);
      expect(() => cards.undoLastReview(created.id, T0)).toThrow(CardNotFoundError);
      expect(() => cards.undoLastReview("missing", T0)).toThrow(CardNotFoundError);
    });
  });

  describe("previewIntervals", () => {
    it("returns four strictly-ordered-or-equal dates and persists nothing", () => {
      const { cards, deckId } = fixture();
      const created = cards.create({ deckId, front: "Q", back: "A" }, T0);

      const preview = cards.previewIntervals(created.id, T0);

      expect(preview.again <= preview.hard).toBe(true);
      expect(preview.hard <= preview.good).toBe(true);
      expect(preview.good <= preview.easy).toBe(true);

      // Persists nothing: the stored card and log table are untouched.
      const stillActive = cards.listByDeck(deckId)[0];
      expect(stillActive?.due).toBe(created.due);
      expect(stillActive?.state).toBe(created.state);
      expect(stillActive?.reps).toBe(created.reps);
      expect(countReviewLogs(created.id)).toBe(0);
    });

    it("throws CardNotFoundError previewing an unknown card", () => {
      const { cards } = fixture();
      expect(() => cards.previewIntervals("missing", T0)).toThrow(CardNotFoundError);
    });
  });

  describe("dueQueue", () => {
    it("orders due cards by due,id then appends New cards capped by newLimit", () => {
      // System-clock ticks are advanced between creates: `now` (the FSRS scheduling
      // instant) is always passed explicitly below, but `created_at`/id ordering for
      // the New section depends on real ticks between creation calls.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
      const { cards, deckId } = fixture();

      // Two cards pushed into the future but already due by queryNow, at different due dates.
      const a = cards.create({ deckId, front: "a", back: "a" }, T0);
      const dueA = cards.review(a.id, 3, T0); // due = T0 + 10m
      const b = cards.create({ deckId, front: "b", back: "b" }, "2026-07-08T10:05:00.000Z");
      const dueB = cards.review(b.id, 3, "2026-07-08T10:05:00.000Z"); // due = 10:15
      expect(dueA.due < dueB.due).toBe(true);

      // Three New cards (never reviewed), each a tick apart for a deterministic id order.
      vi.setSystemTime(new Date("2026-07-06T10:00:01.000Z"));
      const n1 = cards.create({ deckId, front: "n1", back: "n1" }, T0);
      vi.setSystemTime(new Date("2026-07-06T10:00:02.000Z"));
      const n2 = cards.create({ deckId, front: "n2", back: "n2" }, T0);
      vi.setSystemTime(new Date("2026-07-06T10:00:03.000Z"));
      cards.create({ deckId, front: "n3", back: "n3" }, T0);

      const queryNow = "2026-07-09T00:00:00.000Z"; // well after both dueA/dueB
      const queue = cards.dueQueue({ newLimit: 2 }, queryNow);

      expect(queue.map((c) => c.id)).toEqual([dueA.id, dueB.id, n1.id, n2.id]);
    });

    it("filters by deck", () => {
      const { cards, decks, subjectId, deckId } = fixture();
      const otherDeckId = decks.create({ subjectId, name: "Glava 2" }).id;
      const inDeck = cards.create({ deckId, front: "a", back: "a" }, T0);
      cards.create({ deckId: otherDeckId, front: "b", back: "b" }, T0);

      const queue = cards.dueQueue({ deckId, newLimit: 10 }, T0);
      expect(queue.map((c) => c.id)).toEqual([inDeck.id]);
    });

    it("filters by subject (across that subject's decks)", () => {
      const { cards, decks, subjects, subjectId, deckId } = fixture();
      const otherSubjectId = subjects.create({ name: "Analiza 2" }).id;
      const otherDeckId = decks.create({ subjectId: otherSubjectId, name: "x" }).id;
      const inSubject = cards.create({ deckId, front: "a", back: "a" }, T0);
      cards.create({ deckId: otherDeckId, front: "b", back: "b" }, T0);

      const queue = cards.dueQueue({ subjectId, newLimit: 10 }, T0);
      expect(queue.map((c) => c.id)).toEqual([inSubject.id]);
    });

    it("rejects an out-of-range or non-integer newLimit", () => {
      const { cards } = fixture();
      expect(() => cards.dueQueue({ newLimit: -1 }, T0)).toThrow(CardValidationError);
      expect(() => cards.dueQueue({ newLimit: 101 }, T0)).toThrow(CardValidationError);
      expect(() => cards.dueQueue({ newLimit: 1.5 }, T0)).toThrow(CardValidationError);
    });

    it("rejects a deckId/subjectId that does not resolve in this profile", () => {
      const { cards } = fixture();
      expect(() => cards.dueQueue({ deckId: "missing" }, T0)).toThrow(CardValidationError);
      expect(() => cards.dueQueue({ subjectId: "missing" }, T0)).toThrow(CardValidationError);
    });
  });

  describe("countsByDeck", () => {
    it("reports new and due counts per active deck of this profile", () => {
      const { cards, decks, subjectId, deckId } = fixture();
      const otherDeckId = decks.create({ subjectId, name: "Glava 2" }).id;

      // deckId: one New card, one due card.
      cards.create({ deckId, front: "n", back: "n" }, T0);
      const toReview = cards.create({ deckId, front: "d", back: "d" }, T0);
      cards.review(toReview.id, 3, T0); // due = T0 + 10m

      // otherDeckId: no cards at all.

      const queryNow = "2026-07-09T00:00:00.000Z";
      const counts = cards.countsByDeck(queryNow);

      const forDeck = counts.find((c) => c.deckId === deckId);
      const forOtherDeck = counts.find((c) => c.deckId === otherDeckId);

      expect(forDeck).toEqual({ deckId, newCount: 1, dueCount: 1 });
      expect(forOtherDeck).toEqual({ deckId: otherDeckId, newCount: 0, dueCount: 0 });
    });
  });

  describe("listReviewLog", () => {
    it("returns every review_log row of this profile, ordered by review then id", () => {
      const { cards, deckId } = fixture();
      const cardA = cards.create({ deckId, front: "a", back: "a" }, T0);
      const cardB = cards.create({ deckId, front: "b", back: "b" }, T0);

      cards.review(cardB.id, 3, "2026-07-09T10:00:00.000Z");
      cards.review(cardA.id, 4, "2026-07-08T10:00:00.000Z");

      const log = cards.listReviewLog();

      expect(log).toHaveLength(2);
      expect(log.map((entry) => entry.cardId)).toEqual([cardA.id, cardB.id]); // earlier review first
      const first = log[0]!;
      expect(first.profileId).toBe(cardA.profileId);
      expect(first.rating).toBe(4);
      expect(first.state).toBe(0); // ts-fsrs logs the PRE-review state (New)
      expect(typeof first.due).toBe("string");
      expect(typeof first.stability).toBe("number");
      expect(typeof first.difficulty).toBe("number");
      expect(typeof first.elapsedDays).toBe("number");
      expect(typeof first.lastElapsedDays).toBe("number");
      expect(typeof first.scheduledDays).toBe("number");
      expect(typeof first.learningSteps).toBe("number");
      expect(first.review).toBe("2026-07-08T10:00:00.000Z");
      expect(typeof first.createdAt).toBe("string");
    });

    it("returns an empty array when there are no reviews", () => {
      const { cards } = fixture();
      expect(cards.listReviewLog()).toEqual([]);
    });

    it("never returns another profile's review log rows", () => {
      const { cards, deckId } = fixture();
      const card = cards.create({ deckId, front: "q", back: "a" }, T0);
      cards.review(card.id, 3, T0);

      const otherProfileId = createProfile();
      const otherCards = new CardStore(db.raw, otherProfileId);
      expect(otherCards.listReviewLog()).toEqual([]);
    });
  });

  describe("syncFromNote", () => {
    it("creates a fresh card per new key, seeded with a fresh FSRS state", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);

      const result = cards.syncFromNote(
        noteId,
        deckId,
        [
          spec("b1", "Q1", "A1"),
          spec("b2", "Q2", "A2"),
        ],
        T0,
      );

      expect(result).toEqual({ created: 2, updated: 0, removed: 0 });
      const listed = cards.listByDeck(deckId);
      expect(listed).toHaveLength(2);
      expect(listed.map((c) => c.front).sort()).toEqual(["Q1", "Q2"]);
      expect(listed.every((c) => c.sourceNoteId === noteId)).toBe(true);
      expect(listed.map((c) => c.sourceBlockKey).sort()).toEqual(["b1", "b2"]);
      expect(listed.every((c) => c.state === 0)).toBe(true);
    });

    it("is a no-op on an identical second sync: updated stays 0, updated_at is untouched", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      const specs = [spec("b1", "Q", "A")];
      cards.syncFromNote(noteId, deckId, specs, T0);
      const before = cards.listByDeck(deckId)[0]!;

      const result = cards.syncFromNote(noteId, deckId, specs, "2026-07-08T11:00:00.000Z");

      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(cards.listByDeck(deckId)[0]?.updatedAt).toBe(before.updatedAt);
    });

    it("a changed front updates the row but leaves FSRS scheduling state untouched", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);
      const created = cards.listByDeck(deckId)[0]!;
      const reviewed = cards.review(created.id, 3, T0); // Good â€” moves state off New

      const result = cards.syncFromNote(
        noteId,
        deckId,
        [spec("b1", "Q2", "A")],
        "2026-07-08T11:00:00.000Z",
      );

      expect(result).toEqual({ created: 0, updated: 1, removed: 0 });
      const after = cards.listByDeck(deckId)[0]!;
      expect(after.front).toBe("Q2");
      expect(after.due).toBe(reviewed.due);
      expect(after.stability).toBe(reviewed.stability);
      expect(after.reps).toBe(reviewed.reps);
      expect(after.state).toBe(reviewed.state);
    });

    it("a vanished key soft-deletes its card, keeping the review_log", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);
      const created = cards.listByDeck(deckId)[0]!;
      cards.review(created.id, 3, T0);
      expect(countReviewLogs(created.id)).toBe(1);

      const result = cards.syncFromNote(noteId, deckId, [], "2026-07-08T11:00:00.000Z");

      expect(result).toEqual({ created: 0, updated: 0, removed: 1 });
      expect(cards.listByDeck(deckId)).toHaveLength(0);
      expect(countReviewLogs(created.id)).toBe(1);
    });

    it("the key's return restores the same row id with its FSRS state intact", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);
      const created = cards.listByDeck(deckId)[0]!;
      const reviewed = cards.review(created.id, 3, T0);
      cards.syncFromNote(noteId, deckId, [], "2026-07-08T11:00:00.000Z"); // removed

      const result = cards.syncFromNote(
        noteId,
        deckId,
        [spec("b1", "Q2", "A2")],
        "2026-07-08T12:00:00.000Z",
      );

      expect(result).toEqual({ created: 0, updated: 1, removed: 0 });
      const restored = cards.listByDeck(deckId)[0]!;
      expect(restored.id).toBe(created.id);
      expect(restored.front).toBe("Q2");
      expect(restored.back).toBe("A2");
      expect(restored.due).toBe(reviewed.due);
      expect(restored.stability).toBe(reviewed.stability);
      expect(restored.reps).toBe(reviewed.reps);
      expect(restored.state).toBe(reviewed.state);
    });

    it("changing deckId moves a note's generated cards to the new deck", () => {
      const { cards, decks, subjectId, deckId, profileId } = fixture();
      const otherDeckId = decks.create({ subjectId, name: "Glava 2" }).id;
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);

      const result = cards.syncFromNote(
        noteId,
        otherDeckId,
        [spec("b1", "Q", "A")],
        "2026-07-08T11:00:00.000Z",
      );

      expect(result).toEqual({ created: 0, updated: 1, removed: 0 });
      expect(cards.listByDeck(deckId)).toHaveLength(0);
      expect(cards.listByDeck(otherDeckId)).toHaveLength(1);
    });

    it("never touches hand-made cards in the same deck", () => {
      const { cards, deckId, profileId } = fixture();
      const handMade = cards.create({ deckId, front: "Manual Q", back: "Manual A" }, T0);
      const noteId = insertNote(profileId);

      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);
      cards.syncFromNote(noteId, deckId, [], "2026-07-08T11:00:00.000Z"); // removes the generated one

      const listed = cards.listByDeck(deckId);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(handMade.id);
      expect(listed[0]?.sourceNoteId).toBeNull();
    });

    it("rejects a noteId or deckId from another profile", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      const foreignProfile = createProfile();
      const foreignNoteId = insertNote(foreignProfile);
      const foreignSubjects = new SubjectStore(db.raw, foreignProfile);
      const foreignSubjectId = foreignSubjects.create({ name: "Elsewhere" }).id;
      const foreignDecks = new DeckStore(db.raw, foreignProfile);
      const foreignDeckId = foreignDecks.create({ subjectId: foreignSubjectId, name: "x" }).id;

      expect(() => cards.syncFromNote(foreignNoteId, deckId, [], T0)).toThrow(CardValidationError);
      expect(() => cards.syncFromNote(noteId, foreignDeckId, [], T0)).toThrow(CardValidationError);
    });

    it("rejects duplicate keys within one call", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      expect(() =>
        cards.syncFromNote(
          noteId,
          deckId,
          [
            spec("b1", "Q1", "A1"),
            spec("b1", "Q2", "A2"),
          ],
          T0,
        ),
      ).toThrow(CardValidationError);
    });

    it("rejects more than 500 specs, accepting exactly 500", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      const tooMany = Array.from({ length: 501 }, (_, i) => spec(`k${i}`, "Q", "A"));
      const exactly500 = Array.from({ length: 500 }, (_, i) => spec(`k${i}`, "Q", "A"));

      expect(() => cards.syncFromNote(noteId, deckId, tooMany, T0)).toThrow(CardValidationError);
      expect(() => cards.syncFromNote(noteId, deckId, exactly500, T0)).not.toThrow();
    });

    it("rejects an empty or over-cap front/back", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      expect(() =>
        cards.syncFromNote(noteId, deckId, [spec("b1", "", "A")], T0),
      ).toThrow(CardValidationError);
      expect(() =>
        cards.syncFromNote(
          noteId,
          deckId,
          [spec("b1", "x".repeat(10001), "A")],
          T0,
        ),
      ).toThrow(CardValidationError);
    });

    it("rejects a malformed now", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      expect(() => cards.syncFromNote(noteId, deckId, [], "not-a-date")).toThrow(
        CardValidationError,
      );
    });

    it("listByDeck and dueQueue include generated cards alongside hand-made ones", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);
      const handMade = cards.create({ deckId, front: "Manual", back: "Manual" }, T0);

      const listed = cards.listByDeck(deckId);
      expect(listed.map((c) => c.front).sort()).toEqual(["Manual", "Q"]);

      const generated = listed.find((c) => c.front === "Q")!;
      const queue = cards.dueQueue({ deckId, newLimit: 10 }, T0);
      expect(queue.map((c) => c.id).sort()).toEqual([handMade.id, generated.id].sort());
    });

    it("lists a note's generated cards back in the document order they were sent in", () => {
      // `listByDeck` orders by `(created_at, id)` and `uuidv7`'s
      // sub-millisecond bits are random, so inserts are stamped a millisecond
      // apart — without that a note's cards would land in the deck list
      // shuffled rather than in the order its paragraphs read.
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      const specs = Array.from({ length: 5 }, (_, i) => spec(`b${i}`, `Q${i}`, `A${i}`));

      cards.syncFromNote(noteId, deckId, specs, T0);

      expect(cards.listByDeck(deckId).map((c) => c.front)).toEqual([
        "Q0",
        "Q1",
        "Q2",
        "Q3",
        "Q4",
      ]);
    });

    it("carries kind/clozeText/clozeOrdinal onto a generated cloze row", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      const template = "Glavni grad je {{Beograd}}, a reka je {{Sava}}.";

      cards.syncFromNote(
        noteId,
        deckId,
        [clozeSpec("b1#0", template, 0), clozeSpec("b1#1", template, 1)],
        T0,
      );

      const listed = cards.listByDeck(deckId);
      expect(listed).toHaveLength(2);
      expect(listed.every((c) => c.kind === "cloze")).toBe(true);
      expect(listed.every((c) => c.clozeText === template)).toBe(true);
      expect(listed.map((c) => c.clozeOrdinal).sort()).toEqual([0, 1]);
      expect(listed.map((c) => c.front).sort()).toEqual(
        [
          `Glavni grad je ${CLOZE_MASK}, a reka je Sava.`,
          `Glavni grad je Beograd, a reka je ${CLOZE_MASK}.`,
        ].sort(),
      );
    });

    it("upgrades an existing note-derived row in place — same id, FSRS untouched (ADR-042 lazy migration)", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      const template = "Glavni grad je {{Beograd}}.";
      const sides = renderClozeCard(template, 0)!;

      // The row as a pre-ADR-042 build wrote it: right sides, no kind.
      cards.syncFromNote(noteId, deckId, [spec("b1#0", sides.front, sides.back)], T0);
      const before = cards.listByDeck(deckId)[0]!;
      expect(before.kind).toBe("basic");
      const reviewed = cards.review(before.id, 3, T0);

      const result = cards.syncFromNote(
        noteId,
        deckId,
        [clozeSpec("b1#0", template, 0)],
        "2026-07-08T11:00:00.000Z",
      );

      expect(result).toEqual({ created: 0, updated: 1, removed: 0 });
      const after = cards.listByDeck(deckId)[0]!;
      expect(after.id).toBe(before.id);
      expect(after.kind).toBe("cloze");
      expect(after.clozeText).toBe(template);
      expect(after.clozeOrdinal).toBe(0);
      expect(after.due).toBe(reviewed.due);
      expect(after.stability).toBe(reviewed.stability);
      expect(after.reps).toBe(reviewed.reps);
    });

    it("is still a no-op when only the kind fields are already in step", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      const specs = [clozeSpec("b1#0", "{{A}} i B", 0)];
      cards.syncFromNote(noteId, deckId, specs, T0);
      const before = cards.listByDeck(deckId)[0]!;

      const result = cards.syncFromNote(noteId, deckId, specs, "2026-07-08T11:00:00.000Z");

      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(cards.listByDeck(deckId)[0]?.updatedAt).toBe(before.updatedAt);
    });

    it("a changed TEMPLATE alone is an update, even when the rendered sides are identical", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [clozeSpec("b1#0", "{{A}} i B", 0)], T0);

      // `{{A}} i {{B}}` at ordinal 0 masks A and unwraps B — the same front and
      // back as `{{A}} i B`. Only the template differs, and it must still land.
      const result = cards.syncFromNote(
        noteId,
        deckId,
        [clozeSpec("b1#0", "{{A}} i {{B}}", 0)],
        "2026-07-08T11:00:00.000Z",
      );

      expect(result).toEqual({ created: 0, updated: 1, removed: 0 });
      expect(cards.listByDeck(deckId)[0]?.clozeText).toBe("{{A}} i {{B}}");
    });

    it("restores a soft-deleted cloze row with its kind fields rewritten", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [clozeSpec("b1#0", "{{A}} i B", 0)], T0);
      const created = cards.listByDeck(deckId)[0]!;
      cards.syncFromNote(noteId, deckId, [], "2026-07-08T11:00:00.000Z");

      cards.syncFromNote(
        noteId,
        deckId,
        [clozeSpec("b1#0", "{{C}} i D", 0)],
        "2026-07-08T12:00:00.000Z",
      );

      const restored = cards.listByDeck(deckId)[0]!;
      expect(restored.id).toBe(created.id);
      expect(restored.kind).toBe("cloze");
      expect(restored.clozeText).toBe("{{C}} i D");
    });

    it("rejects a cloze spec whose ordinal is not in its own template", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      expect(() =>
        cards.syncFromNote(
          noteId,
          deckId,
          [{ key: "b1#5", front: "f", back: "b", kind: "cloze", clozeText: "{{A}}", clozeOrdinal: 5 }],
          T0,
        ),
      ).toThrow(CardValidationError);
    });

    it("rejects a half-set kind pair in either direction", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      expect(() =>
        cards.syncFromNote(
          noteId,
          deckId,
          [{ key: "b1", front: "f", back: "b", kind: "cloze", clozeText: "{{A}}", clozeOrdinal: null }],
          T0,
        ),
      ).toThrow(CardValidationError);
      expect(() =>
        cards.syncFromNote(
          noteId,
          deckId,
          [{ key: "b1", front: "f", back: "b", kind: "basic", clozeText: "{{A}}", clozeOrdinal: 0 }],
          T0,
        ),
      ).toThrow(CardValidationError);
    });
  });

  describe("createCloze", () => {
    it("lands one row per deletion, in ordinal order, all sharing one template", () => {
      const { cards, deckId } = fixture();
      const template = "Glavni grad je {{Beograd}}, a reka je {{Sava}}.";

      const created = cards.createCloze(deckId, template, T0);

      expect(created).toHaveLength(2);
      expect(created.map((c) => c.clozeOrdinal)).toEqual([0, 1]);
      expect(created.every((c) => c.kind === "cloze")).toBe(true);
      expect(created.every((c) => c.clozeText === template)).toBe(true);
      expect(created.every((c) => c.deckId === deckId)).toBe(true);
    });

    it("derives each row's sides itself: this deletion masked, every other unwrapped", () => {
      const { cards, deckId } = fixture();
      const created = cards.createCloze(deckId, "Glavni grad je {{Beograd}}, a reka je {{Sava}}.", T0);

      expect(created[0]?.front).toBe(`Glavni grad je ${CLOZE_MASK}, a reka je Sava.`);
      expect(created[0]?.back).toBe("Glavni grad je Beograd, a reka je Sava.");
      expect(created[1]?.front).toBe(`Glavni grad je Beograd, a reka je ${CLOZE_MASK}.`);
      expect(created[1]?.back).toBe("Glavni grad je Beograd, a reka je Sava.");
    });

    it("seeds every sibling with a fresh FSRS state and no note origin", () => {
      const { cards, deckId } = fixture();
      const created = cards.createCloze(deckId, "{{A}} i {{B}}", T0);

      expect(created.every((c) => c.state === 0)).toBe(true);
      expect(created.every((c) => c.due === T0)).toBe(true);
      expect(created.every((c) => c.reps === 0)).toBe(true);
      expect(created.every((c) => c.sourceNoteId === null)).toBe(true);
      expect(created.every((c) => c.sourceBlockKey === null)).toBe(true);
    });

    it("persists every sibling and lists them back in ordinal order", () => {
      // `listByDeck` orders by `(created_at, id)` and `uuidv7`'s
      // sub-millisecond bits are random, so siblings are stamped a millisecond
      // apart — without that this order would be arbitrary.
      const { cards, deckId } = fixture();
      const created = cards.createCloze(deckId, "{{A}} i {{B}} i {{C}}", T0);
      expect(cards.listByDeck(deckId).map((c) => c.id)).toEqual(created.map((c) => c.id));
      expect(cards.listByDeck(deckId).map((c) => c.clozeOrdinal)).toEqual([0, 1, 2]);
    });

    it("refuses a text with no deletion at all, writing nothing", () => {
      const { cards, deckId } = fixture();
      expect(() => cards.createCloze(deckId, "obična rečenica", T0)).toThrow(CardValidationError);
      expect(() => cards.createCloze(deckId, "prazna {{}} praznina", T0)).toThrow(
        CardValidationError,
      );
      expect(cards.listByDeck(deckId)).toHaveLength(0);
    });

    it("refuses an empty text, an over-cap template, and an over-cap rendered side", () => {
      const { cards, deckId } = fixture();
      expect(() => cards.createCloze(deckId, "   ", T0)).toThrow(CardValidationError);
      // The template itself over the cap.
      expect(() => cards.createCloze(deckId, `{{${"x".repeat(10001)}}}`, T0)).toThrow(
        CardValidationError,
      );
      // A template at the cap whose MASKED front grows past it: the mask is 3
      // characters where the run's braces were 4, so a one-character deletion
      // renders longer than its own template.
      const atCap = `${"x".repeat(9994)} {{y}}`;
      expect(atCap.length).toBe(10000);
      expect(() => cards.createCloze(deckId, atCap, T0)).not.toThrow();
    });

    it("refuses the whole batch when the deck is not usable, writing nothing", () => {
      // The reachable half of the atomicity guarantee: every input is
      // validated and every side rendered BEFORE the transaction opens, so a
      // rejected batch never leaves a partial set behind. The unreachable half
      // — a mid-transaction SQLite failure — is what the transaction wrapper
      // itself covers.
      const { cards, decks, deckId } = fixture();
      decks.softDelete(deckId);
      expect(() => cards.createCloze(deckId, "{{A}} i {{B}}", T0)).toThrow(CardValidationError);
      decks.restore(deckId);
      expect(cards.listByDeck(deckId)).toHaveLength(0);
    });

    it("rejects a deck from another profile and a malformed now", () => {
      const { cards, deckId } = fixture();
      const foreignProfile = createProfile();
      const foreignSubjects = new SubjectStore(db.raw, foreignProfile);
      const foreignSubjectId = foreignSubjects.create({ name: "Elsewhere" }).id;
      const foreignDecks = new DeckStore(db.raw, foreignProfile);
      const foreignDeckId = foreignDecks.create({ subjectId: foreignSubjectId, name: "x" }).id;

      expect(() => cards.createCloze(foreignDeckId, "{{A}}", T0)).toThrow(CardValidationError);
      expect(() => cards.createCloze(deckId, "{{A}}", "not-a-date")).toThrow(CardValidationError);
    });
  });

  describe("update — cloze cards", () => {
    it("re-derives this row's own sides from a new template", () => {
      const { cards, deckId } = fixture();
      const created = cards.createCloze(deckId, "{{A}} i {{B}}", T0);
      const second = created[1]!;

      const updated = cards.update(second.id, { clozeText: "{{C}} i {{D}}" });

      expect(updated.clozeText).toBe("{{C}} i {{D}}");
      expect(updated.clozeOrdinal).toBe(1);
      expect(updated.front).toBe(`C i ${CLOZE_MASK}`);
      expect(updated.back).toBe("C i D");
      expect(updated.kind).toBe("cloze");
    });

    it("leaves FSRS scheduling state untouched", () => {
      const { cards, deckId } = fixture();
      const created = cards.createCloze(deckId, "{{A}} i B", T0)[0]!;
      const reviewed = cards.review(created.id, 3, T0);

      const updated = cards.update(created.id, { clozeText: "{{C}} i D" });

      expect(updated.due).toBe(reviewed.due);
      expect(updated.stability).toBe(reviewed.stability);
      expect(updated.reps).toBe(reviewed.reps);
      expect(updated.state).toBe(reviewed.state);
    });

    it("refuses a template in which this row's ordinal no longer exists", () => {
      const { cards, deckId } = fixture();
      const second = cards.createCloze(deckId, "{{A}} i {{B}}", T0)[1]!;

      // Dropping the second deletion would leave this row asking a question its
      // own template no longer contains — a card must not silently die.
      expect(() => cards.update(second.id, { clozeText: "{{A}} i B" })).toThrow(
        CardValidationError,
      );
      const unchanged = cards.listByDeck(deckId).find((c) => c.id === second.id)!;
      expect(unchanged.clozeText).toBe("{{A}} i {{B}}");
    });

    it("edits ONE sibling — the others are independent rows after creation", () => {
      const { cards, deckId } = fixture();
      const created = cards.createCloze(deckId, "{{A}} i {{B}}", T0);

      cards.update(created[0]!.id, { clozeText: "{{X}} i {{B}}" });

      const listed = cards.listByDeck(deckId);
      expect(listed.find((c) => c.id === created[0]!.id)?.clozeText).toBe("{{X}} i {{B}}");
      expect(listed.find((c) => c.id === created[1]!.id)?.clozeText).toBe("{{A}} i {{B}}");
    });

    it("refuses a direct front/back write on a cloze card — the template owns the sides", () => {
      const { cards, deckId } = fixture();
      const card = cards.createCloze(deckId, "{{A}} i B", T0)[0]!;
      expect(() => cards.update(card.id, { front: "ručno" })).toThrow(CardValidationError);
      expect(() => cards.update(card.id, { back: "ručno" })).toThrow(CardValidationError);
    });

    it("still moves a cloze card between decks", () => {
      const { cards, decks, subjectId, deckId } = fixture();
      const otherDeckId = decks.create({ subjectId, name: "Glava 2" }).id;
      const card = cards.createCloze(deckId, "{{A}} i B", T0)[0]!;

      expect(cards.update(card.id, { deckId: otherDeckId }).deckId).toBe(otherDeckId);
    });

    it("refuses a clozeText write on a BASIC card", () => {
      const { cards, deckId } = fixture();
      const basic = cards.create({ deckId, front: "Q", back: "A" }, T0);
      expect(() => cards.update(basic.id, { clozeText: "{{A}}" })).toThrow(CardValidationError);
    });

    it("leaves basic cards' front/back editing exactly as it was", () => {
      const { cards, deckId } = fixture();
      const basic = cards.create({ deckId, front: "Q", back: "A" }, T0);
      const updated = cards.update(basic.id, { front: "Q2", back: "A2" });
      expect(updated.front).toBe("Q2");
      expect(updated.back).toBe("A2");
      expect(updated.kind).toBe("basic");
      expect(updated.clozeText).toBeNull();
      expect(updated.clozeOrdinal).toBeNull();
    });
  });
});

