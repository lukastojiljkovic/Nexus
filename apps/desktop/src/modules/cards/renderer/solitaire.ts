import { SUITS, type CardGameId, type Suit } from "@nexus/core";
import { copy } from "./copy.js";
import type { CardSelection } from "./moves.js";

/**
 * The solitaires' one selection model, as pure functions (ADR-090 stage 2).
 *
 * **One box vocabulary, six games.** A board is a handful of BOXES — a column, a
 * cell, a foundation, the stock, the waste — and the person's choice is one box and
 * the boxes it may move to. Every solitaire renders itself with these three functions
 * and no rules of its own, which is why the pictures cannot disagree with the
 * engines: `boxOf` and `targetOf` read the ENGINE's own move list, so what is
 * clickable is exactly what `apply*` will accept.
 *
 * **The move objects never cross this seam.** A box is a key; the move is looked up
 * from the engine's list again when a click happens (`moveFor`), so no board holds a
 * move of a type it cannot name, and a stale move from a previous position cannot be
 * played.
 */

/** One place on a solitaire's table — the solitaires' own reading of a person's choice. */
export type Box = CardSelection;

/** One place on a solitaire's table. */
export function boxKey(box: CardSelection): string {
  switch (box.kind) {
    case "stock":
      return "stock";
    case "waste":
      return "waste";
    case "base":
      return "base";
    case "foundation":
      return `foundation-${box.suit}`;
    case "column":
      return `column-${box.column}`;
    case "cell":
      return `cell-${box.cell}`;
    case "card":
      return `card-${box.index}`;
    case "hand":
      return `hand-${box.index}`;
  }
}

/** The four foundations, in the engines' own suit order. */
export const FOUNDATIONS: readonly Suit[] = SUITS;

/**
 * The box a move TAKES from — the box a click picks up.
 *
 * A move whose source is not a box a person can address (a card inside a buried
 * run) answers null, and the board draws that card as part of its stack rather than
 * as something to click.
 */
export function sourceBox(game: CardGameId, move: unknown): CardSelection | null {
  const record = asRecord(move);
  switch (game) {
    case "klondike":
      if (record.kind === "draw" || record.kind === "recycle") return { kind: "stock" };
      return record.kind === "move" ? pileBox(record.from) : null;
    case "freecell":
      return pileBox(record.from);
    case "spider":
      if (record.kind === "deal") return { kind: "stock" };
      if (record.kind === "move" && typeof record.from === "number") {
        return { kind: "column", column: record.from };
      }
      if (record.kind === "collect" && typeof record.column === "number") {
        return { kind: "column", column: record.column };
      }
      return null;
    case "pyramid":
      if (record.kind === "draw" || record.kind === "recycle") return { kind: "stock" };
      return record.kind === "match" ? pyramidBox(record.first) : null;
    case "tripeaks":
      return record.kind === "play" && typeof record.slot === "number"
        ? { kind: "card", index: record.slot }
        : record.kind === "turn"
          ? { kind: "stock" }
          : null;
    case "golf":
      return typeof record.column === "number"
        ? { kind: "column", column: record.column }
        : record.kind === "turn"
          ? { kind: "stock" }
          : null;
    case "hearts":
      return null;
    case "spades":
      return null;
    case "tablic":
      return null;
  }
}

/** The box a move PUTS its cards in — the box a click targets. */
export function targetBox(game: CardGameId, move: unknown): CardSelection | null {
  const record = asRecord(move);
  switch (game) {
    case "klondike":
      return record.kind === "move" ? pileBox(record.to) : null;
    case "freecell":
      return pileBox(record.to);
    case "spider":
      return typeof record.to === "number" ? { kind: "column", column: record.to } : null;
    case "pyramid":
      if (record.kind !== "match") return null;
      return record.second === undefined ? null : pyramidBox(record.second);
    case "tripeaks":
      return record.kind === "play" ? { kind: "waste" } : null;
    case "golf":
      return record.kind === "play" ? { kind: "base" } : null;
    case "hearts":
      return null;
    case "spades":
      return null;
    case "tablic":
      return null;
  }
}

function pileBox(value: unknown): CardSelection | null {
  const record = asRecord(value);
  if (record.kind === "waste") return { kind: "waste" };
  // Klondike names its columns „tableau", FreeCell „column": both are a column box.
  if ((record.kind === "column" || record.kind === "tableau") && typeof record.column === "number") {
    return { kind: "column", column: record.column };
  }
  if (record.kind === "cell" && typeof record.cell === "number") {
    return { kind: "cell", cell: record.cell };
  }
  if (record.kind === "foundation" && typeof record.suit === "string") {
    return { kind: "foundation", suit: record.suit as Suit };
  }
  return null;
}

function pyramidBox(value: unknown): CardSelection | null {
  const record = asRecord(value);
  if (record.kind === "waste") return { kind: "waste" };
  if (record.kind === "pyramid" && typeof record.index === "number") {
    return { kind: "card", index: record.index };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The first move whose source is `box`, so a board can tell whether a box is a control at all. */
export function moveFrom(game: CardGameId, moves: readonly unknown[], box: CardSelection): unknown | null {
  const key = boxKey(box);
  for (const move of moves) {
    const source = sourceBox(game, move);
    if (source !== null && boxKey(source) === key) return move;
  }
  return null;
}

/**
 * Whether a legal move takes exactly the `count` cards at the foot of `column`:
 * the test for a card a click may pick up, since what it picks up is the run from
 * that card down — „a run" in Klondike, FreeCell and Spider alike.
 */
export function picksRun(game: CardGameId, moves: readonly unknown[], column: number, count: number): boolean {
  return moves.some((move) => {
    const source = sourceBox(game, move);
    return source?.kind === "column" && source.column === column && asRecord(move).count === count;
  });
}

/** The move from `from` into `to`, or null when the position does not allow it. */
export function moveTo(
  game: CardGameId,
  moves: readonly unknown[],
  from: CardSelection,
  to: CardSelection,
): unknown | null {
  const fromKey = boxKey(from);
  const toKey = boxKey(to);
  for (const move of moves) {
    const source = sourceBox(game, move);
    const target = targetBox(game, move);
    if (source === null || target === null) continue;
    if (boxKey(source) === fromKey && boxKey(target) === toKey) return move;
  }
  return null;
}

/**
 * The move a click on `box` makes by itself: one with no destination — turning
 * or drawing from the stock, a Spider deal, a Pyramid King — offered only when
 * no move from that box has a destination to choose. Without it the stock could
 * be picked up and never played, because there was no box to put it in.
 */
export function directMove(game: CardGameId, moves: readonly unknown[], box: CardSelection): unknown | null {
  const key = boxKey(box);
  let direct: unknown | null = null;
  for (const move of moves) {
    const source = sourceBox(game, move);
    if (source === null || boxKey(source) !== key) continue;
    if (targetBox(game, move) !== null) return null;
    direct ??= move;
  }
  return direct;
}

/** One box a click can pick up, and one it can put them down in. */
export interface Highlight {
  readonly pickable: ReadonlySet<string>;
  readonly targets: ReadonlySet<string>;
}

/**
 * What the table lights up for one selection: every box with a move out of it when
 * nothing is chosen, and every box the chosen one can go to when something is.
 */
export function highlights(game: CardGameId, moves: readonly unknown[], selected: CardSelection | null): Highlight {
  const pickable = new Set<string>();
  const targets = new Set<string>();
  for (const move of moves) {
    const source = sourceBox(game, move);
    if (source !== null) pickable.add(boxKey(source));
    if (selected === null) continue;
    const target = targetBox(game, move);
    if (target === null || source === null) continue;
    if (boxKey(source) === boxKey(selected)) targets.add(boxKey(target));
  }
  return { pickable, targets };
}

/** A name for one card, in the language being read. */
export function nameOf(suit: Suit): string {
  return copy.card.suit[suit];
}
