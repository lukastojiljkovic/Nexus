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
  MAX_QUEUE_DECK_IDS,
  NexusDatabase,
  NoteStore,
  openDatabase,
  StudySettingsStore,
  SubjectStore,
  uuidv7,
} from "../index.js";
import type { NoteCardSpecInput } from "./cardStore.js";

let dir: string;
let db: NexusDatabase;

const T0 = "2026-07-08T10:00:00.000Z";
const T1 = "2026-07-08T11:00:00.000Z";
const T2 = "2026-07-08T12:00:00.000Z";

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

/**
 * Local noon of a bare `YYYY-MM-DD`, as an ISO instant. The daily review cap
 * counts by the LOCAL calendar day, so a fixture that named a UTC instant would
 * land on the previous or next day depending on where the suite runs.
 */
function localNoon(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12).toISOString();
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
      const queue = cards.dueQueue({ newLimit: 2 }, queryNow).cards;

      expect(queue.map((c) => c.id)).toEqual([dueA.id, dueB.id, n1.id, n2.id]);
    });

    it("filters by deck", () => {
      const { cards, decks, subjectId, deckId } = fixture();
      const otherDeckId = decks.create({ subjectId, name: "Glava 2" }).id;
      const inDeck = cards.create({ deckId, front: "a", back: "a" }, T0);
      cards.create({ deckId: otherDeckId, front: "b", back: "b" }, T0);

      const queue = cards.dueQueue({ deckId, newLimit: 10 }, T0).cards;
      expect(queue.map((c) => c.id)).toEqual([inDeck.id]);
    });

    it("filters by subject (across that subject's decks)", () => {
      const { cards, decks, subjects, subjectId, deckId } = fixture();
      const otherSubjectId = subjects.create({ name: "Analiza 2" }).id;
      const otherDeckId = decks.create({ subjectId: otherSubjectId, name: "x" }).id;
      const inSubject = cards.create({ deckId, front: "a", back: "a" }, T0);
      cards.create({ deckId: otherDeckId, front: "b", back: "b" }, T0);

      const queue = cards.dueQueue({ subjectId, newLimit: 10 }, T0).cards;
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

    it("omits cards of a soft-deleted deck from an unscoped queue", () => {
      // The unscoped queue never joined `decks`, so a deleted deck's cards kept
      // surfacing in „Uči sve" and in every unscoped session (ADR-047).
      const { cards, decks, subjectId, deckId } = fixture();
      const goneDeckId = decks.create({ subjectId, name: "Obrisan" }).id;
      const kept = cards.create({ deckId, front: "a", back: "a" }, T0);
      const orphanNew = cards.create({ deckId: goneDeckId, front: "b", back: "b" }, T0);
      const orphanDue = cards.create({ deckId: goneDeckId, front: "c", back: "c" }, T0);
      cards.review(orphanDue.id, 3, T0); // leaves the New section, enters the due one
      decks.softDelete(goneDeckId);

      const queue = cards.dueQueue({ newLimit: 10 }, "2026-07-09T00:00:00.000Z").cards;
      const ids = queue.map((c) => c.id);
      expect(ids).toContain(kept.id);
      expect(ids).not.toContain(orphanNew.id);
      expect(ids).not.toContain(orphanDue.id);
    });

    it("keeps cards of an ARCHIVED subject in an unscoped queue", () => {
      // Archiving hides a subject from the hub's active list; it does not
      // retire its cards, so the unscoped queue deliberately still holds them.
      const { cards, subjects, subjectId, deckId } = fixture();
      const card = cards.create({ deckId, front: "a", back: "a" }, T0);
      subjects.update(subjectId, { archived: true });

      expect(cards.dueQueue({ newLimit: 10 }, T0).cards.map((c) => c.id)).toEqual([card.id]);
    });

    it("filters by a deck SET (interleaved practice, ADR-047)", () => {
      const { cards, decks, subjectId, deckId } = fixture();
      const secondDeckId = decks.create({ subjectId, name: "Glava 2" }).id;
      const thirdDeckId = decks.create({ subjectId, name: "Glava 3" }).id;
      const a = cards.create({ deckId, front: "a", back: "a" }, T0);
      const b = cards.create({ deckId: secondDeckId, front: "b", back: "b" }, T0);
      cards.create({ deckId: thirdDeckId, front: "c", back: "c" }, T0);

      const queue = cards.dueQueue({ deckIds: [deckId, secondDeckId], newLimit: 10 }, T0).cards;
      expect(new Set(queue.map((c) => c.id))).toEqual(new Set([a.id, b.id]));
    });

    it("ignores a deckIds entry naming no live deck of this profile", () => {
      // A selection built in the renderer can go stale (another window deletes
      // a deck); the SQL restriction simply matches nothing for that id.
      const { cards, decks, subjectId, deckId } = fixture();
      const goneDeckId = decks.create({ subjectId, name: "Obrisan" }).id;
      const kept = cards.create({ deckId, front: "a", back: "a" }, T0);
      const orphan = cards.create({ deckId: goneDeckId, front: "b", back: "b" }, T0);
      decks.softDelete(goneDeckId);

      const queue = cards.dueQueue({ deckIds: [deckId, goneDeckId, "missing"], newLimit: 10 }, T0)
        .cards;
      expect(queue.map((c) => c.id)).toEqual([kept.id]);
      expect(queue.map((c) => c.id)).not.toContain(orphan.id);
    });

    it("rejects an empty, over-long or non-string deckIds", () => {
      const { cards, deckId } = fixture();
      expect(() => cards.dueQueue({ deckIds: [] }, T0)).toThrow(CardValidationError);
      expect(() =>
        cards.dueQueue({ deckIds: new Array<string>(MAX_QUEUE_DECK_IDS + 1).fill(deckId) }, T0),
      ).toThrow(CardValidationError);
      expect(() =>
        cards.dueQueue({ deckIds: new Array<string>(MAX_QUEUE_DECK_IDS).fill(deckId) }, T0),
      ).not.toThrow();
      expect(() => cards.dueQueue({ deckIds: [""] }, T0)).toThrow(CardValidationError);
      expect(() =>
        cards.dueQueue({ deckIds: [7] as unknown as string[] }, T0),
      ).toThrow(CardValidationError);
    });

    it("keeps only problem cards when problemsOnly is set, in BOTH sections", () => {
      // A problem card's kind is `basic` (ADR-046), so "problems only" can only
      // ever be expressed as "has worked steps".
      const { cards, deckId } = fixture();
      const problemNew = cards.createProblem(deckId, "Zadatak", "prvi\n--\ndrugi", T0);
      const problemDue = cards.createProblem(deckId, "Drugi zadatak", "korak", T0);
      cards.review(problemDue.id, 3, T0);
      const plainNew = cards.create({ deckId, front: "a", back: "a" }, T0);
      const plainDue = cards.create({ deckId, front: "b", back: "b" }, T0);
      cards.review(plainDue.id, 3, T0);

      const queue = cards.dueQueue(
        { problemsOnly: true, newLimit: 10 },
        "2026-07-09T00:00:00.000Z",
      ).cards;
      const ids = queue.map((c) => c.id);
      expect(new Set(ids)).toEqual(new Set([problemNew.id, problemDue.id]));
      expect(ids).not.toContain(plainNew.id);
      expect(ids).not.toContain(plainDue.id);
    });

    it("combines problemsOnly with a deck set", () => {
      const { cards, decks, subjectId, deckId } = fixture();
      const secondDeckId = decks.create({ subjectId, name: "Glava 2" }).id;
      const wanted = cards.createProblem(deckId, "Zadatak", "korak", T0);
      cards.create({ deckId, front: "a", back: "a" }, T0); // right deck, not a problem
      cards.createProblem(secondDeckId, "Drugi", "korak", T0); // a problem, wrong deck

      const queue = cards.dueQueue({ deckIds: [deckId], problemsOnly: true, newLimit: 10 }, T0)
        .cards;
      expect(queue.map((c) => c.id)).toEqual([wanted.id]);
    });

    it("refuses more than one scope — deckId/subjectId/deckIds are mutually exclusive", () => {
      const { cards, subjectId, deckId } = fixture();
      expect(() => cards.dueQueue({ deckId, subjectId }, T0)).toThrow(CardValidationError);
      expect(() => cards.dueQueue({ deckId, deckIds: [deckId] }, T0)).toThrow(CardValidationError);
      expect(() => cards.dueQueue({ subjectId, deckIds: [deckId] }, T0)).toThrow(
        CardValidationError,
      );
    });

    it("answers with capReached false when the profile has no review cap", () => {
      const { cards, deckId } = fixture();
      const due = cards.create({ deckId, front: "a", back: "a" }, T0);
      cards.review(due.id, 3, T0);

      expect(cards.dueQueue({}, "2026-07-09T00:00:00.000Z").capReached).toBe(false);
    });
  });

  // --- STUDY-007: the profile's own scheduling preferences ------------------

  describe("study settings", () => {
    /** Forces a card into the Review state, where the requested retention actually decides an interval. */
    function makeReviewState(cardId: string): void {
      db.raw
        .prepare(
          `UPDATE cards
              SET state = 2, stability = 10, difficulty = 5, reps = 3,
                  scheduled_days = 10, elapsed_days = 10, last_review = ?
            WHERE id = ?`,
        )
        .run(T0, cardId);
    }

    it("schedules at the profile's stored target retention — a lower one buys a longer interval", () => {
      const { cards, profileId, deckId } = fixture();
      const settings = new StudySettingsStore(db.raw, profileId);
      const card = cards.create({ deckId, front: "a", back: "a" }, T0);
      makeReviewState(card.id);

      settings.save({ targetRetention: 0.97, newPerDay: 20, maxReviewsPerDay: null }, T0);
      const strict = cards.previewIntervals(card.id, T0).good;

      settings.save({ targetRetention: 0.7, newPerDay: 20, maxReviewsPerDay: null }, T0);
      const relaxed = cards.previewIntervals(card.id, T0).good;

      expect(relaxed > strict).toBe(true);
    });

    it("reads the retention through on every call — a store built before the change picks it up", () => {
      const { cards, profileId, deckId } = fixture();
      const settings = new StudySettingsStore(db.raw, profileId);
      const card = cards.create({ deckId, front: "a", back: "a" }, T0);
      makeReviewState(card.id);

      const before = cards.previewIntervals(card.id, T0).good;
      settings.save({ targetRetention: 0.7, newPerDay: 20, maxReviewsPerDay: null }, T0);
      expect(cards.previewIntervals(card.id, T0).good > before).toBe(true);
    });

    it("never retro-reschedules an existing card when the retention changes", () => {
      const { cards, profileId, deckId } = fixture();
      const settings = new StudySettingsStore(db.raw, profileId);
      const card = cards.create({ deckId, front: "a", back: "a" }, T0);
      const graded = cards.review(card.id, 3, T0);

      settings.save({ targetRetention: 0.7, newPerDay: 20, maxReviewsPerDay: null }, T0);

      const stored = cards.listByDeck(deckId).find((c) => c.id === card.id);
      expect(stored?.due).toBe(graded.due);
    });

    it("caps the New section at the profile's stored new_per_day when no newLimit is passed", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
      const { cards, profileId, deckId } = fixture();
      new StudySettingsStore(db.raw, profileId).save(
        { targetRetention: 0.9, newPerDay: 2, maxReviewsPerDay: null },
        T0,
      );
      for (let index = 0; index < 4; index += 1) {
        vi.setSystemTime(new Date(`2026-07-06T10:00:0${index}.000Z`));
        cards.create({ deckId, front: `n${index}`, back: `n${index}` }, T0);
      }

      expect(cards.dueQueue({}, T0).cards).toHaveLength(2);
    });

    it("lets an explicit newLimit win over the stored setting", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
      const { cards, profileId, deckId } = fixture();
      new StudySettingsStore(db.raw, profileId).save(
        { targetRetention: 0.9, newPerDay: 1, maxReviewsPerDay: null },
        T0,
      );
      for (let index = 0; index < 4; index += 1) {
        vi.setSystemTime(new Date(`2026-07-06T10:00:0${index}.000Z`));
        cards.create({ deckId, front: `n${index}`, back: `n${index}` }, T0);
      }

      expect(cards.dueQueue({ newLimit: 3 }, T0).cards).toHaveLength(3);
      expect(cards.dueQueue({ newLimit: 0 }, T0).cards).toHaveLength(0);
    });

    /**
     * Three due cards and one review already logged today, so a cap of 2 leaves
     * an allowance of 1. `now` is a LOCAL-noon instant so the day window is the
     * same day in every time zone the suite might run in.
     */
    function dueCardsFixture(count: number): {
      cards: CardStore;
      profileId: string;
      deckId: string;
      now: string;
      ids: string[];
    } {
      const { cards, profileId, deckId } = fixture();
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const card = cards.create({ deckId, front: `c${index}`, back: `c${index}` }, T0);
        cards.review(card.id, 3, T0); // leaves the New section for the due one
        ids.push(card.id);
      }
      // Every review above is logged at T0; the queue is read two days later, by
      // which time all of them are due and none of them counts as "done today".
      return { cards, profileId, deckId, now: localNoon("2026-07-10"), ids };
    }

    it("truncates the due section to what is left of the daily review cap", () => {
      const { cards, profileId, now } = dueCardsFixture(3);
      new StudySettingsStore(db.raw, profileId).save(
        { targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: 2 },
        T0,
      );

      const queue = cards.dueQueue({}, now);
      expect(queue.cards).toHaveLength(2);
      expect(queue.capReached).toBe(true);
    });

    it("counts today's own reviews against the allowance", () => {
      const { cards, profileId, deckId, now } = dueCardsFixture(3);
      // One more card, reviewed TODAY — it spends one of the two allowed.
      const extra = cards.create({ deckId, front: "x", back: "x" }, T0);
      cards.review(extra.id, 3, now);
      new StudySettingsStore(db.raw, profileId).save(
        { targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: 2 },
        T0,
      );

      const queue = cards.dueQueue({}, now);
      expect(queue.cards).toHaveLength(1);
      expect(queue.capReached).toBe(true);
    });

    it("yields an empty due section once the cap is fully spent", () => {
      const { cards, profileId, deckId, now } = dueCardsFixture(3);
      const spender = cards.create({ deckId, front: "x", back: "x" }, T0);
      cards.review(spender.id, 3, now);
      new StudySettingsStore(db.raw, profileId).save(
        { targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: 1 },
        T0,
      );

      const queue = cards.dueQueue({}, now);
      expect(queue.cards).toHaveLength(0);
      expect(queue.capReached).toBe(true);
    });

    it("reports capReached false when the cap is set but nothing was actually cut", () => {
      const { cards, profileId, now } = dueCardsFixture(2);
      new StudySettingsStore(db.raw, profileId).save(
        { targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: 5 },
        T0,
      );

      const queue = cards.dueQueue({}, now);
      expect(queue.cards).toHaveLength(2);
      expect(queue.capReached).toBe(false);
    });

    it("does not count New cards against the review cap, nor truncate them by it", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
      const { cards, profileId, deckId } = fixture();
      const due = cards.create({ deckId, front: "due", back: "due" }, T0);
      cards.review(due.id, 3, T0);
      for (let index = 0; index < 3; index += 1) {
        vi.setSystemTime(new Date(`2026-07-06T10:00:0${index + 1}.000Z`));
        cards.create({ deckId, front: `n${index}`, back: `n${index}` }, T0);
      }
      new StudySettingsStore(db.raw, profileId).save(
        { targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: 1 },
        T0,
      );
      vi.useRealTimers();

      // The cap is 1 and nothing has been reviewed today, so the one due card
      // fits; all three New cards ride along untouched by that ceiling.
      const queue = cards.dueQueue({}, localNoon("2026-07-10"));
      expect(queue.cards).toHaveLength(4);
      expect(queue.capReached).toBe(false);
    });

    it("counts the cap by the LOCAL calendar day — yesterday's reviews do not spend today's", () => {
      const { cards, profileId, deckId } = fixture();
      const yesterday = localNoon("2026-07-09");
      const today = localNoon("2026-07-10");
      const spent = cards.create({ deckId, front: "x", back: "x" }, T0);
      cards.review(spent.id, 3, yesterday);
      const due = cards.create({ deckId, front: "a", back: "a" }, T0);
      cards.review(due.id, 3, T0);
      new StudySettingsStore(db.raw, profileId).save(
        { targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: 1 },
        T0,
      );

      // Cap 1, nothing reviewed TODAY: the allowance is a whole 1, so one card
      // comes back. Had yesterday's review counted, the allowance would be 0
      // and this queue would be empty.
      const queue = cards.dueQueue({}, today);
      expect(queue.cards.map((c) => c.id)).toEqual([due.id]);
    });

    it("applies the cap alongside a scope rather than instead of it", () => {
      const { cards, decks, subjectId, deckId, profileId } = fixture();
      const otherDeckId = decks.create({ subjectId, name: "Glava 2" }).id;
      for (const target of [deckId, deckId, otherDeckId]) {
        const card = cards.create({ deckId: target, front: "a", back: "a" }, T0);
        cards.review(card.id, 3, T0);
      }
      new StudySettingsStore(db.raw, profileId).save(
        { targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: 1 },
        T0,
      );

      const queue = cards.dueQueue({ deckId }, localNoon("2026-07-10"));
      expect(queue.cards).toHaveLength(1);
      expect(queue.cards[0]?.deckId).toBe(deckId);
      expect(queue.capReached).toBe(true);
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
      const reviewed = cards.review(created.id, 3, T0); // Good — moves state off New

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
      const queue = cards.dueQueue({ deckId, newLimit: 10 }, T0).cards;
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
        [clozeSpec("b1#1", template, 1), clozeSpec("b1#2", template, 2)],
        T0,
      );

      const listed = cards.listByDeck(deckId);
      expect(listed).toHaveLength(2);
      expect(listed.every((c) => c.kind === "cloze")).toBe(true);
      expect(listed.every((c) => c.clozeText === template)).toBe(true);
      expect(listed.map((c) => c.clozeOrdinal).sort()).toEqual([1, 2]);
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
      const sides = renderClozeCard(template, 1)!;

      // The row as a pre-ADR-042 build wrote it: right sides, no kind.
      cards.syncFromNote(noteId, deckId, [spec("b1#1", sides.front, sides.back)], T0);
      const before = cards.listByDeck(deckId)[0]!;
      expect(before.kind).toBe("basic");
      const reviewed = cards.review(before.id, 3, T0);

      const result = cards.syncFromNote(
        noteId,
        deckId,
        [clozeSpec("b1#1", template, 1)],
        "2026-07-08T11:00:00.000Z",
      );

      expect(result).toEqual({ created: 0, updated: 1, removed: 0 });
      const after = cards.listByDeck(deckId)[0]!;
      expect(after.id).toBe(before.id);
      expect(after.kind).toBe("cloze");
      expect(after.clozeText).toBe(template);
      expect(after.clozeOrdinal).toBe(1);
      expect(after.due).toBe(reviewed.due);
      expect(after.stability).toBe(reviewed.stability);
      expect(after.reps).toBe(reviewed.reps);
    });

    it("is still a no-op when only the kind fields are already in step", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      const specs = [clozeSpec("b1#1", "{{A}} i B", 1)];
      cards.syncFromNote(noteId, deckId, specs, T0);
      const before = cards.listByDeck(deckId)[0]!;

      const result = cards.syncFromNote(noteId, deckId, specs, "2026-07-08T11:00:00.000Z");

      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(cards.listByDeck(deckId)[0]?.updatedAt).toBe(before.updatedAt);
    });

    it("a changed TEMPLATE alone is an update, even when the rendered sides are identical", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [clozeSpec("b1#1", "{{A}} i B", 1)], T0);

      // `{{A}} i {{B}}` at ordinal 0 masks A and unwraps B — the same front and
      // back as `{{A}} i B`. Only the template differs, and it must still land.
      const result = cards.syncFromNote(
        noteId,
        deckId,
        [clozeSpec("b1#1", "{{A}} i {{B}}", 1)],
        "2026-07-08T11:00:00.000Z",
      );

      expect(result).toEqual({ created: 0, updated: 1, removed: 0 });
      expect(cards.listByDeck(deckId)[0]?.clozeText).toBe("{{A}} i {{B}}");
    });

    it("restores a soft-deleted cloze row with its kind fields rewritten", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [clozeSpec("b1#1", "{{A}} i B", 1)], T0);
      const created = cards.listByDeck(deckId)[0]!;
      cards.syncFromNote(noteId, deckId, [], "2026-07-08T11:00:00.000Z");

      cards.syncFromNote(
        noteId,
        deckId,
        [clozeSpec("b1#1", "{{C}} i D", 1)],
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
          [{ key: "b1", front: "f", back: "b", kind: "basic", clozeText: "{{A}}", clozeOrdinal: 1 }],
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
      expect(created.map((c) => c.clozeOrdinal)).toEqual([1, 2]);
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

    it("takes a labelled template's numbers as the rows' ordinals, in number order", () => {
      const { cards, deckId } = fixture();
      const created = cards.createCloze(deckId, "{{c3::A}} i {{c1::B}}", T0);

      expect(created.map((c) => c.clozeOrdinal)).toEqual([1, 3]);
      expect(created[0]?.front).toBe(`A i ${CLOZE_MASK}`);
      expect(created[1]?.front).toBe(`${CLOZE_MASK} i B`);
    });

    it("makes ONE row of two runs sharing a number, masking both blanks", () => {
      const { cards, deckId } = fixture();
      const created = cards.createCloze(deckId, "{{c1::A}} i {{c2::B}} i {{c1::C}}", T0);

      expect(created).toHaveLength(2);
      expect(created.map((c) => c.clozeOrdinal)).toEqual([1, 2]);
      expect(created[0]?.front).toBe(`${CLOZE_MASK} i B i ${CLOZE_MASK}`);
    });

    it("persists every sibling and lists them back in ordinal order", () => {
      // `listByDeck` orders by `(created_at, id)` and `uuidv7`'s
      // sub-millisecond bits are random, so siblings are stamped a millisecond
      // apart — without that this order would be arbitrary.
      const { cards, deckId } = fixture();
      const created = cards.createCloze(deckId, "{{A}} i {{B}} i {{C}}", T0);
      expect(cards.listByDeck(deckId).map((c) => c.id)).toEqual(created.map((c) => c.id));
      expect(cards.listByDeck(deckId).map((c) => c.clozeOrdinal)).toEqual([1, 2, 3]);
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
      expect(updated.clozeOrdinal).toBe(2);
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

    it("survives a deletion inserted AHEAD of this row's own, once the text is labelled", () => {
      // The defect ADR-068 exists for: under positions, inserting a blank in
      // front of this one would have handed this row's history to the new
      // blank's content. With numbers the row keeps asking „B".
      const { cards, deckId } = fixture();
      const second = cards.createCloze(deckId, "{{c1::A}} i {{c2::B}}", T0)[1]!;
      expect(second.clozeOrdinal).toBe(2);

      const updated = cards.update(second.id, { clozeText: "{{c1::A}} i {{c3::X}} i {{c2::B}}" });

      expect(updated.clozeOrdinal).toBe(2);
      expect(updated.front).toBe(`A i X i ${CLOZE_MASK}`);
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

  describe("createProblem", () => {
    const STEPS = "Izvod je $2x$.\n--\nU tački $x=1$ to je $2$.";

    it("is a BASIC card that carries steps — there is no third kind", () => {
      const { cards, deckId } = fixture();
      const created = cards.createProblem(deckId, "Nađi izvod od $x^2$ u $x=1$.", STEPS, T0);

      expect(created.kind).toBe("basic");
      expect(created.clozeText).toBeNull();
      expect(created.clozeOrdinal).toBeNull();
      expect(created.problemSteps).toBe(STEPS);
      expect(created.front).toBe("Nađi izvod od $x^2$ u $x=1$.");
    });

    it("derives `back` from the steps — the caller never sends one", () => {
      const { cards, deckId } = fixture();
      const created = cards.createProblem(deckId, "Q", STEPS, T0);
      expect(created.back).toBe("Izvod je $2x$.\n\nU tački $x=1$ to je $2$.");
      expect(created.back).not.toContain("--");
    });

    it("accepts a single step and stores it as its own back", () => {
      const { cards, deckId } = fixture();
      const created = cards.createProblem(deckId, "Q", "  Jedan potez.  ", T0);
      expect(created.problemSteps).toBe("Jedan potez.");
      expect(created.back).toBe("Jedan potez.");
    });

    it("seeds a fresh FSRS state and no note origin, and lists back like any card", () => {
      const { cards, deckId } = fixture();
      const created = cards.createProblem(deckId, "Q", STEPS, T0);

      expect(created.state).toBe(0);
      expect(created.due).toBe(T0);
      expect(created.reps).toBe(0);
      expect(created.sourceNoteId).toBeNull();
      expect(cards.listByDeck(deckId).map((c) => c.id)).toEqual([created.id]);
      expect(cards.listByDeck(deckId)[0]?.problemSteps).toBe(STEPS);
    });

    it("refuses steps that hold no step at all, and an empty statement", () => {
      const { cards, deckId } = fixture();
      expect(() => cards.createProblem(deckId, "Q", "   ", T0)).toThrow(CardValidationError);
      expect(() => cards.createProblem(deckId, "Q", "--\n--", T0)).toThrow(CardValidationError);
      expect(() => cards.createProblem(deckId, "  ", STEPS, T0)).toThrow(CardValidationError);
      expect(cards.listByDeck(deckId)).toHaveLength(0);
    });

    it("refuses an over-cap statement and over-cap steps", () => {
      const { cards, deckId } = fixture();
      const long = "x".repeat(10001);
      expect(() => cards.createProblem(deckId, long, STEPS, T0)).toThrow(CardValidationError);
      expect(() => cards.createProblem(deckId, "Q", long, T0)).toThrow(CardValidationError);
    });

    it("rejects a deck from another profile and a malformed now", () => {
      const { cards, deckId } = fixture();
      const foreignProfile = createProfile();
      const foreignSubjects = new SubjectStore(db.raw, foreignProfile);
      const foreignSubjectId = foreignSubjects.create({ name: "Elsewhere" }).id;
      const foreignDecks = new DeckStore(db.raw, foreignProfile);
      const foreignDeckId = foreignDecks.create({ subjectId: foreignSubjectId, name: "x" }).id;

      expect(() => cards.createProblem(foreignDeckId, "Q", STEPS, T0)).toThrow(CardValidationError);
      expect(() => cards.createProblem(deckId, "Q", STEPS, "not-a-date")).toThrow(
        CardValidationError,
      );
    });
  });

  describe("update — problem cards", () => {
    const STEPS = "prvi\n--\ndrugi";

    it("re-derives `back` from new steps on every write", () => {
      const { cards, deckId } = fixture();
      const created = cards.createProblem(deckId, "Q", STEPS, T0);

      const updated = cards.update(created.id, { problemSteps: "a\n--\nb\n--\nc" });

      expect(updated.problemSteps).toBe("a\n--\nb\n--\nc");
      expect(updated.back).toBe("a\n\nb\n\nc");
      expect(updated.kind).toBe("basic");
    });

    it("turns a plain basic card into a problem card — same row, same identity", () => {
      const { cards, deckId } = fixture();
      const basic = cards.create({ deckId, front: "Q", back: "A" }, T0);

      const updated = cards.update(basic.id, { problemSteps: STEPS });

      expect(updated.id).toBe(basic.id);
      expect(updated.kind).toBe("basic");
      expect(updated.problemSteps).toBe(STEPS);
      expect(updated.back).toBe("prvi\n\ndrugi");
    });

    it("clears the steps on null — the card becomes a plain basic card, keeping its back", () => {
      const { cards, deckId } = fixture();
      const created = cards.createProblem(deckId, "Q", STEPS, T0);

      const updated = cards.update(created.id, { problemSteps: null });

      expect(updated.problemSteps).toBeNull();
      expect(updated.kind).toBe("basic");
      // The derived solution stays as the plain back — clearing the source does
      // not throw away the answer the user could already see.
      expect(updated.back).toBe("prvi\n\ndrugi");
      expect(cards.listByDeck(deckId)[0]?.problemSteps).toBeNull();
    });

    it("leaves the steps untouched when the patch does not mention them", () => {
      const { cards, deckId } = fixture();
      const created = cards.createProblem(deckId, "Q", STEPS, T0);
      const updated = cards.update(created.id, { front: "Q2" });
      expect(updated.front).toBe("Q2");
      expect(updated.problemSteps).toBe(STEPS);
      expect(updated.back).toBe("prvi\n\ndrugi");
    });

    it("leaves FSRS scheduling state untouched", () => {
      const { cards, deckId } = fixture();
      const created = cards.createProblem(deckId, "Q", STEPS, T0);
      const reviewed = cards.review(created.id, 3, T0);

      const updated = cards.update(created.id, { problemSteps: "jedan korak" });

      expect(updated.due).toBe(reviewed.due);
      expect(updated.stability).toBe(reviewed.stability);
      expect(updated.reps).toBe(reviewed.reps);
      expect(updated.state).toBe(reviewed.state);
    });

    it("refuses a direct `back` write alongside steps — the steps own the back", () => {
      const { cards, deckId } = fixture();
      const created = cards.createProblem(deckId, "Q", STEPS, T0);
      expect(() => cards.update(created.id, { problemSteps: "a", back: "ručno" })).toThrow(
        CardValidationError,
      );
    });

    it("refuses steps that hold no step at all, and over-cap steps", () => {
      const { cards, deckId } = fixture();
      const created = cards.createProblem(deckId, "Q", STEPS, T0);
      expect(() => cards.update(created.id, { problemSteps: "--\n--" })).toThrow(
        CardValidationError,
      );
      expect(() => cards.update(created.id, { problemSteps: "x".repeat(10001) })).toThrow(
        CardValidationError,
      );
      expect(cards.listByDeck(deckId)[0]?.problemSteps).toBe(STEPS);
    });

    it("refuses problemSteps on a CLOZE card, by name", () => {
      const { cards, deckId } = fixture();
      const cloze = cards.createCloze(deckId, "{{A}} i B", T0)[0]!;
      expect(() => cards.update(cloze.id, { problemSteps: STEPS })).toThrow(CardValidationError);
      expect(() => cards.update(cloze.id, { problemSteps: null })).toThrow(CardValidationError);
    });

    it("still moves a problem card between decks", () => {
      const { cards, decks, subjectId, deckId } = fixture();
      const otherDeckId = decks.create({ subjectId, name: "Glava 2" }).id;
      const created = cards.createProblem(deckId, "Q", STEPS, T0);

      const moved = cards.update(created.id, { deckId: otherDeckId });
      expect(moved.deckId).toBe(otherDeckId);
      expect(moved.problemSteps).toBe(STEPS);
    });
  });

  describe("syncFromNote — problem steps", () => {
    it("writes no steps: there is no note syntax for them (ADR-046 section 6)", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);
      expect(cards.listByDeck(deckId)[0]?.problemSteps).toBeNull();
    });

    it("clears steps a hand edit left on a note-sourced row, on the next sync", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);
      const generated = cards.listByDeck(deckId)[0]!;
      cards.update(generated.id, { problemSteps: "korak" });

      const result = cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);

      // The note owns this row's content: a stale source for its back would
      // survive every future sync unless the reconcile notices it.
      expect(result.updated).toBe(1);
      expect(cards.listByDeck(deckId)[0]?.problemSteps).toBeNull();
    });
  });

  // PRD 09 section 7: deleting a note asks what becomes of the cards it
  // generated. These three operations are the two answers plus the undo of the
  // destructive one.
  describe("countCardsOfNote", () => {
    it("counts this note's live cards only", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q1", "A1"), spec("b2", "Q2", "A2")], T0);
      expect(cards.countCardsOfNote(noteId)).toBe(2);

      cards.syncFromNote(noteId, deckId, [spec("b1", "Q1", "A1")], T0); // b2 vanishes
      expect(cards.countCardsOfNote(noteId)).toBe(1);
    });

    it("counts no hand-made card, and nothing for a note that generated none", () => {
      const { cards, deckId, profileId } = fixture();
      cards.create({ deckId, front: "Q", back: "A" }, T0);
      expect(cards.countCardsOfNote(insertNote(profileId))).toBe(0);
    });

    it("counts nothing for another profile's note", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);

      const other = fixture();
      expect(other.cards.countCardsOfNote(noteId)).toBe(0);
    });
  });

  describe("detachCardsFromNote", () => {
    it("clears both source columns, leaving an ordinary card in the same deck", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);
      const generated = cards.listByDeck(deckId)[0]!;
      const reviewed = cards.review(generated.id, 3, T0);

      expect(cards.detachCardsFromNote(noteId)).toBe(1);

      const detached = cards.listByDeck(deckId)[0]!;
      expect(detached.id).toBe(generated.id);
      expect(detached.sourceNoteId).toBeNull();
      expect(detached.sourceBlockKey).toBeNull();
      // Review history is sacred (ADR-031/046): nothing about scheduling moves.
      expect(detached.due).toBe(reviewed.due);
      expect(detached.stability).toBe(reviewed.stability);
      expect(detached.reps).toBe(reviewed.reps);
      expect(detached.state).toBe(reviewed.state);
      expect(countReviewLogs(generated.id)).toBe(1);
    });

    it("leaves content, kind and steps alone", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [clozeSpec("b1", "Rim je {{prestonica}} Italije", 1)], T0);
      const before = cards.listByDeck(deckId)[0]!;

      cards.detachCardsFromNote(noteId);

      const after = cards.listByDeck(deckId)[0]!;
      expect(after.front).toBe(before.front);
      expect(after.back).toBe(before.back);
      expect(after.kind).toBe("cloze");
      expect(after.clozeText).toBe(before.clozeText);
      expect(after.clozeOrdinal).toBe(before.clozeOrdinal);
      expect(after.deckId).toBe(deckId);
    });

    it("leaves the note's already soft-deleted cards attached", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q1", "A1"), spec("b2", "Q2", "A2")], T0);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q1", "A1")], T0); // b2 vanishes

      expect(cards.detachCardsFromNote(noteId)).toBe(1);

      // The removed block's row keeps its slot, so restoring the note and
      // re-adding that block still finds it (syncFromNote's rule 3).
      const rows = db.raw
        .prepare("SELECT source_block_key FROM cards WHERE source_note_id = ?")
        .all(noteId) as { source_block_key: string }[];
      expect(rows.map((row) => row.source_block_key)).toEqual(["b2"]);
    });

    it("is a clean no-op for a note with no cards, and never reaches another profile", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);

      expect(cards.detachCardsFromNote(insertNote(profileId))).toBe(0);
      expect(new CardStore(db.raw, createProfile()).detachCardsFromNote(noteId)).toBe(0);
      expect(cards.listByDeck(deckId)[0]?.sourceNoteId).toBe(noteId);
    });
  });

  describe("deleteCardsOfNote", () => {
    it("soft-deletes the note's live cards at the given stamp, keeping the review_log", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q1", "A1"), spec("b2", "Q2", "A2")], T0);
      const [first] = cards.listByDeck(deckId);
      cards.review(first!.id, 3, T0);

      expect(cards.deleteCardsOfNote(noteId, T1)).toBe(2);

      expect(cards.listByDeck(deckId)).toHaveLength(0);
      expect(countReviewLogs(first!.id)).toBe(1);
      const stamps = db.raw
        .prepare("SELECT deleted_at FROM cards WHERE source_note_id = ?")
        .all(noteId) as { deleted_at: string }[];
      expect(stamps.map((row) => row.deleted_at)).toEqual([T1, T1]);
    });

    it("leaves hand-made cards of the same deck alone", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);
      const handMade = cards.create({ deckId, front: "Ručno", back: "A" }, T0);

      expect(cards.deleteCardsOfNote(noteId, T1)).toBe(1);
      expect(cards.listByDeck(deckId).map((card) => card.id)).toEqual([handMade.id]);
    });

    it("is a clean no-op for a note with no cards, and never reaches another profile", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);

      expect(cards.deleteCardsOfNote(insertNote(profileId), T1)).toBe(0);
      expect(new CardStore(db.raw, createProfile()).deleteCardsOfNote(noteId, T1)).toBe(0);
      expect(cards.listByDeck(deckId)).toHaveLength(1);
    });

    it("rejects a stamp that is not an ISO-8601 date-time", () => {
      const { cards, profileId } = fixture();
      expect(() => cards.deleteCardsOfNote(insertNote(profileId), "juče")).toThrow(
        CardValidationError,
      );
    });
  });

  describe("restoreCardsOfNote", () => {
    it("brings back exactly the cards deleted at that stamp, FSRS intact", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);
      const generated = cards.listByDeck(deckId)[0]!;
      const reviewed = cards.review(generated.id, 3, T0);
      cards.deleteCardsOfNote(noteId, T1);

      expect(cards.restoreCardsOfNote(noteId, T1)).toBe(1);

      const restored = cards.listByDeck(deckId)[0]!;
      expect(restored.id).toBe(generated.id);
      expect(restored.due).toBe(reviewed.due);
      expect(restored.reps).toBe(reviewed.reps);
      expect(restored.state).toBe(reviewed.state);
    });

    it("leaves cards a sync removed earlier deleted — only the same act is undone", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q1", "A1"), spec("b2", "Q2", "A2")], T0);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q1", "A1")], T0); // b2 vanishes
      cards.deleteCardsOfNote(noteId, T1);

      expect(cards.restoreCardsOfNote(noteId, T1)).toBe(1);
      expect(cards.listByDeck(deckId).map((card) => card.sourceBlockKey)).toEqual(["b1"]);
    });

    it("is a clean no-op when the note's cards were kept rather than deleted", () => {
      const { cards, deckId, profileId } = fixture();
      const noteId = insertNote(profileId);
      cards.syncFromNote(noteId, deckId, [spec("b1", "Q", "A")], T0);

      expect(cards.restoreCardsOfNote(noteId, T1)).toBe(0);
      expect(cards.listByDeck(deckId)).toHaveLength(1);
    });
  });

  /**
   * The two answers as the desktop main process composes them across both
   * stores (PRD 09 section 7) — the contract its one transaction relies on,
   * and the reason `NoteStore.restore` hands back the stamp it cleared.
   */
  describe("note delete disposition — the composed act", () => {
    /** A note of this profile, mapped to `deckId` and generating one reviewed card. */
    function noteWithCard(profileId: string, deckId: string, cards: CardStore) {
      const notes = new NoteStore(db.raw, profileId);
      const note = notes.create(T0);
      notes.setCardDeck(note.id, deckId, T0);
      cards.syncFromNote(note.id, deckId, [spec("b1", "Q", "A")], T0);
      const card = cards.listByDeck(deckId)[0]!;
      return { notes, noteId: note.id, reviewed: cards.review(card.id, 3, T0) };
    }

    it("„Obriši i kartice“: the note's restore brings the cards back with it", () => {
      const { cards, deckId, profileId } = fixture();
      const { notes, noteId, reviewed } = noteWithCard(profileId, deckId, cards);

      cards.deleteCardsOfNote(noteId, T1);
      notes.softDelete(noteId, T1);
      expect(cards.listByDeck(deckId)).toHaveLength(0);

      cards.restoreCardsOfNote(noteId, notes.restore(noteId, T2));

      const restored = cards.listByDeck(deckId)[0]!;
      expect(restored.id).toBe(reviewed.id);
      expect(restored.sourceNoteId).toBe(noteId);
      expect(restored.due).toBe(reviewed.due);
      expect(restored.reps).toBe(reviewed.reps);
    });

    it("„Zadrži kartice“: the card outlives the note, and the restore leaves it alone", () => {
      const { cards, deckId, profileId } = fixture();
      const { notes, noteId, reviewed } = noteWithCard(profileId, deckId, cards);

      cards.detachCardsFromNote(noteId);
      notes.setCardDeck(noteId, null, T1); // unmapped, so a restore cannot regenerate copies
      notes.softDelete(noteId, T1);

      const kept = cards.listByDeck(deckId)[0]!;
      expect(kept.id).toBe(reviewed.id);
      expect(kept.sourceNoteId).toBeNull();
      expect(kept.due).toBe(reviewed.due);

      cards.restoreCardsOfNote(noteId, notes.restore(noteId, T2));

      expect(cards.listByDeck(deckId).map((card) => card.id)).toEqual([reviewed.id]);
      expect(notes.list()[0]?.cardDeckId).toBeNull();
    });
  });
});

