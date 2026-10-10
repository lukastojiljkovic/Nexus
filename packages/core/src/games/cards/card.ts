/**
 * The one card model the three solitaire engines share: a suit, a rank, and the
 * colour that is the only property of a suit the rules ever ask about.
 *
 * **Rank is a number, and the Ace is 1.** Klondike, FreeCell and Spider all
 * build ascending on the foundations and descending on the tableau, so „rank + 1"
 * has to be arithmetic rather than a lookup; a King is 13 and `rankBelow(1)` is
 * null, which is the Ace's own sentence.
 *
 * **`cardCode`/`cardFromCode` speak the notation the published fixtures use**
 * (`A`, `2`…`9`, `T`, `J`, `Q`, `K` beside `C`, `D`, `H`, `S`), because the
 * FreeCell deals this module must reproduce are published in exactly that form
 * and a fixture that has been transliterated is a fixture that can be wrong.
 * `T` for ten comes from there, not from taste, and it is why `TH` is the trap
 * the tests name.
 *
 * Nothing here is user-facing copy: a card the user reads is drawn by stage 2's
 * page, and the Serbian words for the suits and the picture cards live with the
 * rest of the strings.
 */

/** The four suits, in the order the FreeCell deal algorithm's deck array uses. */
export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
/** 1 is the Ace, 11 the Jack, 12 the Queen, 13 the King. */
export type Rank = (typeof RANKS)[number];

/** Which of the two colours a card is — the only thing a tableau placement asks about a suit. */
export type CardColour = "black" | "red";

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

const RANK_CODES: Readonly<Record<Rank, string>> = {
  1: "A",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
};

const SUIT_CODES: Readonly<Record<Suit, string>> = {
  clubs: "C",
  diamonds: "D",
  hearts: "H",
  spades: "S",
};

const RED_SUITS: readonly Suit[] = ["diamonds", "hearts"];

export function isSuit(value: unknown): value is Suit {
  return (SUITS as readonly unknown[]).includes(value);
}

export function isRank(value: unknown): value is Rank {
  return (RANKS as readonly unknown[]).includes(value);
}

export function isCard(value: unknown): value is Card {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { suit?: unknown; rank?: unknown };
  return isSuit(candidate.suit) && isRank(candidate.rank);
}

export function colourOf(suit: Suit): CardColour {
  return RED_SUITS.includes(suit) ? "red" : "black";
}

export function sameCard(left: Card, right: Card): boolean {
  return left.suit === right.suit && left.rank === right.rank;
}

/** The rank one below, or null at the Ace — the floor every descending run stops at. */
export function rankBelow(rank: Rank): Rank | null {
  return rank === 1 ? null : ((rank - 1) as Rank);
}

/** The published fixture form of one card: `AC`, `TD`, `KS`. */
export function cardCode(card: Card): string {
  return RANK_CODES[card.rank] + SUIT_CODES[card.suit];
}

/**
 * One standard 52-card deck in the order the FreeCell deal algorithm's own
 * description names it — Ace of Clubs, Ace of Diamonds, Ace of Hearts, Ace of
 * Spades, 2 of Clubs, and so on through King of Spades.
 */
export function standardDeck(): Card[] {
  return deckOf(SUITS, 1);
}

/**
 * `copies` decks restricted to `suits`, which is how Spider makes its three
 * variants: two decks of all four suits, two decks of Spades and Hearts, or two
 * decks of Spades alone. Order is copy, then rank, then suit — the order the
 * deal walks, so the same seed and the same variant always deal the same table.
 */
export function deckOf(suits: readonly Suit[], copies: number): Card[] {
  const deck: Card[] = [];
  for (let copy = 0; copy < copies; copy += 1) {
    for (const rank of RANKS) {
      for (const suit of suits) deck.push({ suit, rank });
    }
  }
  return deck;
}

/** The 52 codes, deck order — the fixture vocabulary as a closed list. */
export const CARD_CODES: readonly string[] = standardDeck().map(cardCode);

const BY_CODE: ReadonlyMap<string, Card> = new Map(
  standardDeck().map((card) => [cardCode(card), card]),
);

/** The inverse of `cardCode`; null for anything that is not a card's code, including the slightly-off ones a typo makes. */
export function cardFromCode(code: string): Card | null {
  return BY_CODE.get(code) ?? null;
}
