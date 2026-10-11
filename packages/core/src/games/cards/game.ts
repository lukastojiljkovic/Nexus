/**
 * The card games' shared vocabulary: the nine games, the closed set of variants
 * each one ships, which way round „best“ runs for a particular score, what a seed
 * is, and the refusal a replay answers with.
 *
 * **The variant table lives here and nowhere else** because three callers need
 * the same answer — the store's enum check, stage 2's pickers, and the engines
 * themselves — and a list retyped three times is a list that drifts. `@nexus/db`
 * imports it rather than carrying a copy, on `finance/money.ts`'s terms: the wire
 * and the store have to refuse by the SAME rule or they disagree about what a
 * variant is.
 *
 * **The direction table is the second half of that argument.** `best_score` in
 * the store means „the best result somebody achieved“, and for Hearts and Golf a
 * smaller number is the better result while for the other seven a larger one is.
 * A store that compared the two directions with one operator would keep the wrong
 * half of its own records, so the direction is stated once, here, in the package
 * both sides import, and `CardGameStore.recordResult` reads it. The compiler
 * enforces one entry per game — the table is a `Record<CardGameId, …>` — so a game
 * added without a direction is a type error rather than a silent default.
 *
 * **The games are three kinds, in that order.** Klondike, FreeCell and Spider are
 * the solitaires whose engine already shipped. Pyramid, TriPeaks and Golf are the
 * three added beside them, dealt, logged and scored the same way, each with one
 * score of its own. Hearts, Spades and Tablić are the games against the computer:
 * hidden cards, several deals to a game, so their engines are the same shape with
 * a different reducer — a pure `apply`, a replay that refuses an illegal log, and
 * a level ladder the three opponents play at.
 *
 * A variant is a string because it is also a storage key: `cardgame_stats` is
 * keyed by (game, variant), a saved game is keyed by the same pair, and a state
 * carries its own variant so that `undo` can rebuild the deal it started from.
 */

export const CARD_GAMES = [
  "klondike",
  "freecell",
  "spider",
  "pyramid",
  "tripeaks",
  "golf",
  "hearts",
  "spades",
  "tablic",
] as const;
export type CardGameId = (typeof CARD_GAMES)[number];

/** Klondike's two deals. Both allow unlimited redeals; no Vegas mode exists in this app. */
export type KlondikeVariant = "draw1" | "draw3";
/** FreeCell has one variant; the deal NUMBER is its seed, and that is the variation players know. */
export type FreeCellVariant = "classic";
/** Spider with one suit (Spades), two (Spades and Hearts), or all four. */
export type SpiderVariant = "suits1" | "suits2" | "suits4";
/**
 * Pyramid turns its stock over ONCE (the game the article describes) or THREE
 * times (Par Pyramid, the one named variation that changes only the stock):
 * https://en.wikipedia.org/wiki/Pyramid_(solitaire) § Rules and § Variations.
 */
export type PyramidVariant = "pass1" | "pass3";

/**
 * TriPeaks plays its stock once. `wrap` is the optional turning of the corner,
 * King on Ace and Ace on King, which the article lists as a variation (as it
 * does for Golf); the strict game has none, so `classic` is the strict game.
 * https://en.wikipedia.org/wiki/Tri_Peaks_(game) § Gameplay
 */
export type TriPeaksVariant = "classic" | "wrap";

/**
 * Golf has one pass and no redeal; `wrap` is the article's named „Putt Putt"
 * variation, which permits a King on an Ace and an Ace on a King.
 * https://en.wikipedia.org/wiki/Golf_(patience) § Variations
 */
export type GolfVariant = "classic" | "wrap";

/** Hearts ships the four-player game; the passing cycle (left, right, across, hold) is part of it. */
export type HeartsVariant = "standard";

/** Spades ships the two-partnership game. */
export type SpadesVariant = "standard";

/** Tablić is two players, or four in two fixed partnerships sitting opposite each other. */
export type TablicVariant = "duo" | "pairs";

export type CardGameVariant =
  | KlondikeVariant
  | FreeCellVariant
  | SpiderVariant
  | PyramidVariant
  | TriPeaksVariant
  | GolfVariant
  | HeartsVariant
  | SpadesVariant
  | TablicVariant;

export const CARD_GAME_VARIANTS: Readonly<Record<CardGameId, readonly CardGameVariant[]>> = {
  klondike: ["draw1", "draw3"],
  freecell: ["classic"],
  spider: ["suits1", "suits2", "suits4"],
  pyramid: ["pass1", "pass3"],
  tripeaks: ["classic", "wrap"],
  golf: ["classic", "wrap"],
  hearts: ["standard"],
  spades: ["standard"],
  tablic: ["duo", "pairs"],
};

/**
 * Which end of a score is the good one. Klondike starts at zero and only pays
 * for progress, so more is better; Golf counts the tableau cards it failed to
 * clear and Hearts counts penalty points, so for those two fewer is better. The
 * store reads this rather than assuming, so „best“ means the best result in the
 * game's own direction.
 */
export type CardGameScoreDirection = "higher" | "lower";

export const CARD_GAME_SCORE_DIRECTION: Readonly<Record<CardGameId, CardGameScoreDirection>> = {
  klondike: "higher",
  freecell: "higher",
  spider: "higher",
  pyramid: "lower",
  tripeaks: "higher",
  golf: "lower",
  hearts: "lower",
  spades: "higher",
  tablic: "higher",
};

/**
 * How well the computer plays, for the three games it plays against the person.
 * The ladder is closed and shared so that stage 2's picker, the engines' level
 * tables and the tests that play a thousand games name the same three rungs.
 *
 * `easy` plays a uniformly random legal move; `medium` plays a rule of thumb —
 * void tracking, and the queen of spades in Hearts; `hard` plays a bounded search
 * or a Monte Carlo average over the cards it has not seen. Every rung plays a
 * move the engine's own `moves` enumeration allows, which is what makes „never
 * illegal" a statement about one function rather than about three.
 */
export const CARD_OPPONENT_LEVELS = ["easy", "medium", "hard"] as const;
export type CardOpponentLevel = (typeof CARD_OPPONENT_LEVELS)[number];

export function isCardOpponentLevel(value: unknown): value is CardOpponentLevel {
  return (CARD_OPPONENT_LEVELS as readonly unknown[]).includes(value);
}

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
 * Thrown by the `applyX` of every card engine when a move is not one the state
 * allows. It is for a caller that has already enumerated the legal moves — the UI
 * — because the untrusted path (`isXMove`, `isXMoveLegal`, `replayX`) refuses as
 * a VALUE and never throws.
 */
export class IllegalMoveError extends CardGameError {}
