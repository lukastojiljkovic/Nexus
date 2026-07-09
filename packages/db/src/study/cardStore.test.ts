import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
} {
  const profileId = createProfile();
  const subjects = new SubjectStore(db.raw, profileId);
  const subjectId = subjects.create({ name: "Analiza 1" }).id;
  const decks = new DeckStore(db.raw, profileId);
  const deckId = decks.create({ subjectId, name: "Glava 1" }).id;
  return { cards: new CardStore(db.raw, profileId), decks, subjects, deckId, subjectId };
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
});
