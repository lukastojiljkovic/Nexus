import {
  MAHJONG_FACES,
  TURTLE_SLOTS,
  isMahjongFree,
  mahjongFacesMatch,
  mahjongFreeSlots,
  mahjongGameFrom,
  mahjongLegalPairs,
  mahjongRemove,
  mahjongShuffle,
  mahjongUndo,
  mahjongWon,
} from "@nexus/core";
import type { MahjongGame, MahjongSlot } from "@nexus/core";
import type { MahjongStateView } from "../shared/ipc.js";

/**
 * Mahjong solitaire's board arithmetic and its drawing geometry, as pure
 * functions (ADR-090).
 *
 * **The rules are the engine's and stay there.** What may be taken, what matches
 * what, whether a shuffle can still rescue a board and whether the board is
 * clear are all `@nexus/core` answers, and this file only holds the board as a
 * value the page hands back and forth — plus the geometry, which is the one
 * thing a renderer has to own.
 *
 * **The geometry is the layout's own numbers.** A tile at `(x, y)` occupies
 * quarters `x..x+2` and `y..y+2` of the board, so a quarter is the unit and a
 * tile is two of them (`mahjong.ts`'s header states the quarter convention, and
 * the layer counts 87/36/16/4/1 that the turtle's own test pins come out of it).
 * The higher layers are NOT lifted by a whole tile: the layout data already
 * insets them by half a tile, which is exactly what „a tile one layer up rests
 * across four of them" means. The only thing added here is a 2px visual lift per
 * layer, so a stack reads as a stack to a person — pure presentation, and no
 * part of what a click targets.
 */

/** How far a layer is drawn above the one below, in px. Presentation only: the hit boxes are the layout's own quarters. */
const LAYER_LIFT_PX = 2;

const bounds = (() => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = 0;
  for (const slot of TURTLE_SLOTS) {
    minX = Math.min(minX, slot.x);
    maxX = Math.max(maxX, slot.x);
    minY = Math.min(minY, slot.y);
    maxY = Math.max(maxY, slot.y);
    maxZ = Math.max(maxZ, slot.z);
  }
  return { minX, maxX, minY, maxY, maxZ };
})();

/** The one tile the store and the engine both deal: `puzzlesStore.readMahjongState` refuses a face off this set, so the panel can draw every face it is handed. */
export const TILE_FACES: readonly string[] = MAHJONG_FACES;

/** The board as the page holds it, rebuilt for the engine. */
export function gameOf(state: MahjongStateView, seed: number): MahjongGame {
  return mahjongGameFrom({
    slots: TURTLE_SLOTS,
    faces: [...state.faces],
    remaining: [...state.remaining],
    seed,
  });
}

/** The board as the page stores it. `shuffles` is the row's own counter, which the engine does not carry on a game built from a value. */
export function stateOf(game: MahjongGame, shuffles: number): MahjongStateView {
  return { faces: [...game.faces], remaining: [...game.remaining], shuffles };
}

/** How many tiles are still on the board. */
export function remainingCount(state: MahjongStateView): number {
  return state.remaining.filter((present) => present).length;
}

/** Whether a tile may be taken right now. */
export function isFree(game: MahjongGame, index: number): boolean {
  return isMahjongFree(game.board, game.remaining, index);
}

/** Every tile that may be taken right now. */
export function freeSlots(game: MahjongGame): number[] {
  return mahjongFreeSlots(game.board, game.remaining);
}

/** Whether two faces may be taken together — the engine's rule, so a panel never guesses. */
export function facesMatch(left: string, right: string): boolean {
  return mahjongFacesMatch(left, right);
}

/** Takes a pair, or `null` when that is not a play. A blocked tile is a normal thing to click and not a mistake, so this answers nothing rather than throwing. */
export function takePair(game: MahjongGame, a: number, b: number): MahjongGame | null {
  return mahjongRemove(game, a, b);
}

/** Steps back over the last removal. Undoing past a shuffle is not offered, on the engine's own terms: a shuffle rearranges faces rather than removing tiles. */
export function stepBack(game: MahjongGame): MahjongGame | null {
  return mahjongUndo(game);
}

/** Deals the tiles that are left out again. Throws when no arrangement can rescue the shape, which the panel turns into the module's own sentence rather than a raw error. */
export function shuffleRemaining(game: MahjongGame, seed: number): MahjongGame {
  return mahjongShuffle(game, seed);
}

/** Whether every tile is gone. */
export function isWon(game: MahjongGame): boolean {
  return mahjongWon(game);
}

/** Whether no pair can be taken and the board is not clear: what „Promešaj" is for. */
export function isStuck(game: MahjongGame): boolean {
  return !mahjongWon(game) && mahjongLegalPairs(game).length === 0;
}

/**
 * The faces split into what a tile draws. `unknown` is the branch that exists
 * because this function has to be total: the store refuses a face off
 * `MAHJONG_FACES`, so a board built from a saved game cannot carry one, and a
 * page that threw here would be a page that blanked instead of saying so.
 */
export interface TileFace {
  readonly kind: "suit" | "wind" | "dragon" | "flower" | "season" | "unknown";
  /** The suit, for a suit tile. */
  readonly suit: "circles" | "bamboo" | "characters" | null;
  /** The wind's or dragon's own name, for those two. */
  readonly name: string | null;
  /** The rank, for a suit, a flower or a season; `0` otherwise. */
  readonly rank: number;
}

export function tileFace(face: string): TileFace {
  const separator = face.indexOf("-");
  if (separator <= 0) return { kind: "unknown", suit: null, name: null, rank: 0 };
  const group = face.slice(0, separator);
  const rest = face.slice(separator + 1);
  const rank = Number(rest);
  switch (group) {
    case "circles":
    case "bamboo":
    case "characters":
      return Number.isInteger(rank) && rank >= 1 && rank <= 9
        ? { kind: "suit", suit: group, name: null, rank }
        : { kind: "unknown", suit: null, name: null, rank: 0 };
    case "wind":
    case "dragon":
      return rest.length > 0
        ? { kind: group, suit: null, name: rest, rank: 0 }
        : { kind: "unknown", suit: null, name: null, rank: 0 };
    case "flower":
    case "season":
      return Number.isInteger(rank) && rank >= 1 && rank <= 4
        ? { kind: group, suit: null, name: null, rank }
        : { kind: "unknown", suit: null, name: null, rank: 0 };
    default:
      return { kind: "unknown", suit: null, name: null, rank: 0 };
  }
}

/** Where one tile is drawn, in px, at `cell` px per quarter. */
export function tileBox(
  slot: MahjongSlot,
  cell: number,
): { left: number; top: number; width: number; height: number } {
  return {
    left: (slot.x - bounds.minX) * cell,
    top: (slot.y - bounds.minY) * cell - slot.z * LAYER_LIFT_PX,
    width: 2 * cell,
    height: 2 * cell,
  };
}

/**
 * The layout's own slot at an index — the board is data the engine ships, and
 * this is the one place a caller reads it by position rather than by asking the
 * engine a question about it.
 */
export function slotAt(index: number): MahjongSlot {
  const slot = TURTLE_SLOTS[index];
  if (slot === undefined) throw new RangeError(`puzzles: the turtle has no tile ${index}`);
  return slot;
}

/** The board's own box, in px, at `cell` px per quarter — the box the tiles are absolutely placed in. */
export function boardBox(cell: number): { width: number; height: number } {
  return {
    width: (bounds.maxX + 2 - bounds.minX) * cell,
    height: (bounds.maxY + 2 - bounds.minY) * cell + bounds.maxZ * LAYER_LIFT_PX,
  };
}

/**
 * The order the tiles are drawn in: layer by layer, and within a layer row by
 * row. Painting order IS stacking order here — a positioned box with no
 * `z-index` paints where it stands in the tree — so the higher layers are
 * deliberately written after the lower ones and no surface has to name a layer
 * number (`check:layers`' whole point).
 */
export function stackOrder(): readonly number[] {
  return TURTLE_SLOTS.map((_, index) => index).sort((left, right) => {
    const a = TURTLE_SLOTS[left] as MahjongSlot;
    const b = TURTLE_SLOTS[right] as MahjongSlot;
    if (a.z !== b.z) return a.z - b.z;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
}
