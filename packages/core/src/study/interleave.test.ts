import { describe, expect, it } from "vitest";
import { interleavePractice } from "./interleave.js";

/** What a practice card is to this module: something a deck can be read off. */
interface TestCard {
  id: string;
  deck: string;
}

const deckOf = (card: TestCard): string => card.deck;

/** `n` cards of one deck, in their queue order: a1, a2, … */
function deckCards(deck: string, count: number): TestCard[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${deck}${index + 1}`, deck }));
}

/** The longest run of one deck in a row. */
function longestRun(cards: readonly TestCard[]): number {
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const card of cards) {
    run = card.deck === previous ? run + 1 : 1;
    previous = card.deck;
    if (run > longest) longest = run;
  }
  return longest;
}

const ids = (cards: readonly TestCard[]): string[] => cards.map((card) => card.id);

describe("interleavePractice", () => {
  it("returns exactly the cards it was given, losing and inventing none", () => {
    const cards = [...deckCards("a", 4), ...deckCards("b", 3), ...deckCards("c", 5)];
    const mixed = interleavePractice(cards, deckOf, 7);

    expect(mixed).toHaveLength(cards.length);
    expect([...ids(mixed)].sort()).toEqual([...ids(cards)].sort());
  });

  it("returns a NEW array and leaves the input untouched", () => {
    const cards = [...deckCards("a", 3), ...deckCards("b", 3)];
    const before = ids(cards);

    const mixed = interleavePractice(cards, deckOf, 1);

    expect(mixed).not.toBe(cards);
    expect(ids(cards)).toEqual(before);
  });

  it("returns an empty array for an empty session", () => {
    expect(interleavePractice([], deckOf, 42)).toEqual([]);
  });

  it("plainly shuffles a single deck — there is nothing to interleave it with", () => {
    const cards = deckCards("a", 12);
    const mixed = interleavePractice(cards, deckOf, 3);

    expect([...ids(mixed)].sort()).toEqual([...ids(cards)].sort());
    expect(ids(mixed)).not.toEqual(ids(cards));
  });

  it("is a pure function of (cards, deckOf, seed): the same seed replays exactly", () => {
    const cards = [...deckCards("a", 6), ...deckCards("b", 6), ...deckCards("c", 6)];

    expect(ids(interleavePractice(cards, deckOf, 2026))).toEqual(
      ids(interleavePractice(cards, deckOf, 2026)),
    );
  });

  it("gives a different seed a different arrangement", () => {
    const cards = [...deckCards("a", 8), ...deckCards("b", 8)];

    expect(ids(interleavePractice(cards, deckOf, 1))).not.toEqual(
      ids(interleavePractice(cards, deckOf, 2)),
    );
  });

  it("never lets one deck run three cards deep while another still has cards", () => {
    // The round-robin merge is what buys this: a deck may repeat across a round
    // boundary (last of one round, first of the next), never further.
    const cards = [...deckCards("a", 9), ...deckCards("b", 9), ...deckCards("c", 9)];

    for (let seed = 0; seed < 40; seed += 1) {
      expect(longestRun(interleavePractice(cards, deckOf, seed))).toBeLessThanOrEqual(2);
    }
  });

  it("spends one card per deck per round when the decks are the same size", () => {
    const cards = [...deckCards("a", 5), ...deckCards("b", 5), ...deckCards("c", 5)];
    const mixed = interleavePractice(cards, deckOf, 11);

    for (let round = 0; round < 5; round += 1) {
      const decks = mixed.slice(round * 3, round * 3 + 3).map(deckOf);
      expect([...decks].sort()).toEqual(["a", "b", "c"]);
    }
  });

  it("drops an exhausted deck out of the rotation instead of padding it", () => {
    // One card of `b` against five of `a`: `b` is spent in the first round, and
    // the rest is `a` alone — the only place a long run of one deck is right.
    const cards = [...deckCards("a", 5), ...deckCards("b", 1)];

    for (let seed = 0; seed < 20; seed += 1) {
      const mixed = interleavePractice(cards, deckOf, seed);
      expect(mixed.findIndex((card) => card.deck === "b")).toBeLessThanOrEqual(1);
      expect(mixed).toHaveLength(6);
    }
  });

  it("groups decks by first appearance, so the queue's own order seeds the rotation", () => {
    // Same cards, two input orders: the deck grouping follows the input, so the
    // two arrangements are allowed to differ — what must not differ is the set.
    const cards = [...deckCards("a", 3), ...deckCards("b", 3)];
    const woven = [cards[0]!, cards[3]!, cards[1]!, cards[4]!, cards[2]!, cards[5]!];

    expect([...ids(interleavePractice(woven, deckOf, 5))].sort()).toEqual(
      [...ids(cards)].sort(),
    );
  });

  it("pins the arrangement for a known seed — the session's order is reproducible", () => {
    const cards = [...deckCards("a", 3), ...deckCards("b", 3), ...deckCards("c", 2)];

    // Three rounds, readable in the arrangement itself: (c,b,a) (b,c,a) (a,b),
    // with `c` leaving the rotation once its two cards are spent.
    expect(ids(interleavePractice(cards, deckOf, 2026))).toEqual([
      "c2",
      "b1",
      "a3",
      "b3",
      "c1",
      "a1",
      "a2",
      "b2",
    ]);
  });
});
