import { describe, expect, it } from "vitest";
import {
  CARD_CODES,
  cardCode,
  cardFromCode,
  colourOf,
  deckOf,
  isCard,
  isRank,
  isSuit,
  RANKS,
  rankBelow,
  rankStrength,
  sameCard,
  standardDeck,
  SUITS,
} from "./card.js";

describe("the card model", () => {
  it("builds the Rosetta Code deck order the FreeCell deal algorithm names", () => {
    // Ace of Clubs at index 0 … King of Spades at 51 — the order Rosetta Code's
    // „Deal cards for FreeCell" requires, which is why it is the canonical one
    // here rather than an alphabetical or per-suit arrangement.
    const deck = standardDeck();
    expect(deck).toHaveLength(52);
    expect(deck[0]).toEqual({ suit: "clubs", rank: 1 });
    expect(deck[1]).toEqual({ suit: "diamonds", rank: 1 });
    expect(deck[2]).toEqual({ suit: "hearts", rank: 1 });
    expect(deck[3]).toEqual({ suit: "spades", rank: 1 });
    expect(deck[51]).toEqual({ suit: "spades", rank: 13 });
    // Every (suit, rank) pair exactly once.
    expect(new Set(deck.map(cardCode)).size).toBe(52);
  });

  it("reads and writes the published fixture notation both ways", () => {
    expect(cardCode({ suit: "clubs", rank: 1 })).toBe("AC");
    expect(cardCode({ suit: "diamonds", rank: 10 })).toBe("TD");
    expect(cardCode({ suit: "hearts", rank: 11 })).toBe("JH");
    expect(cardCode({ suit: "spades", rank: 12 })).toBe("QS");
    expect(cardCode({ suit: "spades", rank: 13 })).toBe("KS");
    // The 52 codes are exactly the deck, so the notation is a bijection.
    expect(CARD_CODES).toHaveLength(52);
    for (const card of standardDeck()) {
      expect(cardFromCode(cardCode(card))).toEqual(card);
    }
  });

  it("refuses a code that is not a card, including the ones a typo produces", () => {
    for (const bad of ["", "1H", "AS ", "as", "AX", "HT", "10H", "ZZ", "QSX"]) {
      expect({ bad, card: cardFromCode(bad) }).toEqual({ bad, card: null });
    }
    // „TH" is the trap this notation sets: T is ten, H is hearts, so it is a
    // real card rather than the typo it looks like — and a reader who has read
    // the list above without this line will test exactly that and be wrong.
    expect(cardFromCode("TH")).toEqual({ suit: "hearts", rank: 10 });
  });

  it("says which colour a suit is, which is the only use of suit in play", () => {
    expect(SUITS.map(colourOf)).toEqual(["black", "red", "red", "black"]);
  });

  it("guards the untrusted shapes an IPC payload can carry", () => {
    expect(isSuit("hearts")).toBe(true);
    expect(isSuit("Hearts")).toBe(false);
    expect(isRank(1)).toBe(true);
    expect(isRank(13)).toBe(true);
    expect(isRank(0)).toBe(false);
    expect(isRank(14)).toBe(false);
    expect(isRank(2.5)).toBe(false);
    expect(isCard({ suit: "spades", rank: 13 })).toBe(true);
    expect(isCard({ suit: "spades", rank: 14 })).toBe(false);
    expect(isCard({ suit: "spades" })).toBe(false);
    expect(isCard(null)).toBe(false);
    expect(isCard("KS")).toBe(false);
  });

  it("compares two cards by suit and rank, not by object identity", () => {
    expect(sameCard({ suit: "clubs", rank: 7 }, { suit: "clubs", rank: 7 })).toBe(true);
    expect(sameCard({ suit: "clubs", rank: 7 }, { suit: "spades", rank: 7 })).toBe(false);
    expect(sameCard({ suit: "clubs", rank: 7 }, { suit: "clubs", rank: 8 })).toBe(false);
  });

  it("walks a rank down to the Ace and stops there", () => {
    expect(rankBelow(13)).toBe(12);
    expect(rankBelow(2)).toBe(1);
    expect(rankBelow(1)).toBeNull();
    expect(RANKS).toHaveLength(13);
  });

  it("builds the multi-deck, multi-suit decks Spider deals from", () => {
    const fourSuit = deckOf(SUITS, 2);
    expect(fourSuit).toHaveLength(104);
    expect(new Set(fourSuit.map(cardCode)).size).toBe(52);

    const twoSuit = deckOf(["spades", "hearts"], 2);
    expect(twoSuit).toHaveLength(52);
    expect(new Set(twoSuit.map(cardCode)).size).toBe(26);

    const oneSuit = deckOf(["spades"], 2);
    expect(oneSuit).toHaveLength(26);
    expect(new Set(oneSuit.map(cardCode)).size).toBe(13);
    // Document order: copy, then rank, then suit — the order the deal walks.
    expect(oneSuit.slice(0, 3).map(cardCode)).toEqual(["AS", "2S", "3S"]);
  });

  it("puts the Ace at the top of the suit for the trick-taking games", () => {
    // Rank is arithmetic — the Ace is 1 so that `rankBelow(1)` is null — and
    // strength is the order a trick is won in. The two disagree about the Ace and
    // about nothing else, which is what this pins.
    expect(rankStrength(1)).toBe(14);
    expect(rankStrength(13)).toBe(13);
    expect(rankStrength(12)).toBe(12);
    expect(rankStrength(2)).toBe(2);
    expect(rankStrength(1)).toBeGreaterThan(rankStrength(13));
    expect(rankStrength(13)).toBeGreaterThan(rankStrength(12));
    expect(rankStrength(2)).toBeLessThan(rankStrength(3));
  });
});
