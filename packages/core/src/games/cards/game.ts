/**
 * The card games' shared vocabulary: the three games, the closed set of variants
 * each one ships, what a seed is, and the refusal a replay answers with.
 *
 * **The variant table lives here and nowhere else** because three callers need
 * the same answer — the store's enum check, stage 2's pickers, and the engines
 * themselves — and a list retyped three times is a list that drifts. `@nexus/db`
 * imports it rather than carrying a copy, on `finance/money.ts`'s terms: the wire
 * and the store have to refuse by the SAME rule or they disagree about what a
 * variant is.
 *
 * A variant is a string because it is also a storage key: `cardgame_stats` is
 * keyed by (game, variant), a saved game is keyed by the same pair, and a state
 * carries its own variant so that `undo` can rebuild the deal it started from.
 */

export const CARD_GAMES = ["klondike", "freecell", "spider"] as const;
export type CardGameId = (typeof CARD_GAMES)[number];

/** Klondike's two deals. Both allow unlimited redeals; no Vegas mode exists in this app. */
export type KlondikeVariant = "draw1" | "draw3";
/** FreeCell has one variant; the deal NUMBER is its seed, and that is the variation players know. */
export type FreeCellVariant = "classic";
/** Spider with one suit (Spades), two (Spades and Hearts), or all four. */
export type SpiderVariant = "suits1" | "suits2" | "suits4";
export type CardGameVariant = KlondikeVariant | FreeCellVariant | SpiderVariant;

export const CARD_GAME_VARIANTS: Readonly<Record<CardGameId, readonly CardGameVariant[]>> = {
  klondike: ["draw1", "draw3"],
  freecell: ["classic"],
  spider: ["suits1", "suits2", "suits4"],
};

/** A seed is a 32-bit unsigned integer — the widest thing `cardgame_saves.seed` can carry as an INTEGER. */
export const MAX_CARD_SEED = 4_294_967_295;

/** The classic Windows game ships 32 000 numbered deals, and „game #1" is a layout players know by name. */
export const FREE_CELL_MIN_DEAL = 1;
export const FREE_CELL_MAX_DEAL = 32_000;

export function isCardGameId(value: unknown): value is CardGameId {
  return (CARD_GAMES as readonly unknown[]).includes(value);
}

export function isCardGameVariant(game: CardGameId, value: unknown): value is CardGameVariant {
  return (CARD_GAME_VARIANTS[game] as readonly unknown[]).includes(value);
}

export function isCardSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CARD_SEED;
}

/**
 * Whether `value` is a deal number the classic FreeCell set carries. Exported
 * beside the two bounds because the store's own check and stage 2's „game
 * number" field have to refuse by the same rule the deal does.
 */
export function isFreeCellDeal(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= FREE_CELL_MIN_DEAL &&
    value <= FREE_CELL_MAX_DEAL
  );
}

/**
 * Why a replay refused a stored or handed-in action log. A closed set, because
 * stage 2 turns it into a sentence in both languages and a code it has never
 * seen must be a compile error rather than an empty screen.
 */
export type CardGameRefusalCode =
  | "bad-seed"
  | "unknown-variant"
  | "bad-entry"
  | "illegal-move"
  | "empty-undo";

export interface CardGameRefusal {
  readonly code: CardGameRefusalCode;
  /** The log position at fault, or null when the refusal is about the whole input. */
  readonly atIndex: number | null;
  /** What was refused and by which rule — a developer's sentence, never the user's copy. */
  readonly detail: string;
}

export type CardGameReplay<S> =
  | { readonly ok: true; readonly state: S }
  | { readonly ok: false; readonly refusal: CardGameRefusal };

/** Base class for every card-engine refusal, so a caller can catch the family. */
export class CardGameError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Thrown by `applyKlondike`/`applyFreeCell`/`applySpider` when a move is not one
 * the state allows. It is for a caller that has already enumerated the legal
 * moves — the UI — because the untrusted path (`isXMove`, `isXMoveLegal`,
 * `replayX`) refuses as a VALUE and never throws.
 */
export class IllegalMoveError extends CardGameError {}
