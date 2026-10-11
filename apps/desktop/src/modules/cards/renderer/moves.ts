import { type Card, type Suit } from "@nexus/core";
import { cardLabel } from "./table.js";
import { copy } from "./copy.js";

/**
 * The table's shared interaction vocabulary (ADR-090 stage 2).
 *
 * **Why a `CardSelection` and not each engine's move type.** The nine engines each
 * carry their own move union, and a page that switched on all nine would restate
 * the rules one branch at a time. What every board actually needs of a move is
 * smaller than that: which slot it is about, whether the slot is a valid target,
 * and what to print in the move list. So each board narrows its own moves with its
 * own engine's type guard and expresses the rest in the shared vocabulary below —
 * and nothing here re-derives a rule an engine owns.
 */

/**
 * What the person has picked out of the table: one of the piles a board draws.
 * `index` addresses a card inside a list the board owns (a tableau column, a hand,
 * a pyramid), and `cell` addresses one of FreeCell's four cells.
 */
export type CardSelection =
  | { readonly kind: "waste" }
  | { readonly kind: "stock" }
  /** Golf's base card: a pile everything is played onto, which is a target and never a source. */
  | { readonly kind: "base" }
  | { readonly kind: "foundation"; readonly suit: Suit }
  | { readonly kind: "column"; readonly column: number; readonly index?: number }
  | { readonly kind: "cell"; readonly cell: number }
  | { readonly kind: "card"; readonly index: number }
  | { readonly kind: "hand"; readonly index: number };

/** One legal move as a board renders it: the target a click plays, and the move it applies. */
export interface Destination {
  readonly key: string;
  readonly title: string;
  readonly move: unknown;
}

/**
 * How many cards at the end of a column descend from `index` in one suit — the run
 * Klondike and Spider will move as a unit.
 *
 * This is the board's own measurement and not a rule: the engine decides whether a
 * move exists, and the count here is only what a click on a lower card means, which
 * the engine then accepts or refuses like any other move.
 */
export function runFrom(
  pile: readonly { readonly card: Card; readonly faceUp: boolean }[],
  index: number,
): number {
  const head = pile[index];
  if (head === undefined || !head.faceUp) return 0;
  let count = 1;
  for (let at = index + 1; at < pile.length; at += 1) {
    const previous = pile[at - 1]?.card;
    const next = pile[at];
    if (previous === undefined || next === undefined || !next.faceUp) return 0;
    if (next.card.suit !== previous.suit || next.card.rank !== previous.rank - 1) return 0;
    count += 1;
  }
  return count;
}

/** One move as the move list prints it: a verb, and the card it is about when it is about one. */
export interface CardMoveText {
  readonly label: string;
  readonly card: string | null;
}

/**
 * The move list's line for one action.
 *
 * Every branch is a leaf of the copy table, so a move kind added to an engine is a
 * sentence to write in two languages rather than an empty cell on the screen — and a
 * kind this function has not met falls back to its own name rather than to nothing,
 * because a list of blanks would hide the fact that something happened.
 */
export function describeMove(move: unknown): CardMoveText {
  const record = move as { kind?: unknown; card?: Card };
  const card = record.card === undefined ? null : cardLabel(record.card);
  switch (record.kind) {
    case "draw":
      return { label: copy.moves.draw, card: null };
    case "recycle":
      return { label: copy.moves.recycle, card: null };
    case "deal":
      return { label: copy.moves.deal, card: null };
    case "collect":
      return { label: copy.moves.collect, card: null };
    case "turn":
      return { label: copy.moves.turn, card: null };
    case "match":
      return {
        label: (move as { second?: unknown }).second === undefined ? copy.moves.matchKing : copy.moves.match,
        card: null,
      };
    case "pass":
      return { label: copy.moves.pass, card: null };
    case "bid": {
      const value = (move as { bid?: number }).bid ?? 0;
      return {
        label:
          value === 0
            ? copy.moves.bidNil
            : copy.moves.bid.replace("{value}", String(value)),
        card: null,
      };
    }
    case "move":
      return { label: copy.moves.move, card };
    case "play":
      return { label: copy.moves.play, card };
    default:
      return { label: copy.moves.move, card };
  }
}
