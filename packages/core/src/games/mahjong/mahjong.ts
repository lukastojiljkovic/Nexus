/**
 * Mahjong solitaire — the traditional 144-tile set, the traditional turtle
 * layout, deals that are solvable because they were built backwards, the
 * free-tile rule, and the solver that checks all of it from the outside.
 *
 * **The tiles and the layout are data, and both are cited.** The set is the
 * standard 144 mahjong tiles — three suits of nine ranks in four copies (108),
 * four winds in four copies (16), three dragons in four copies (12), four
 * flowers (4) and four seasons (4) — the composition described in Wikipedia's
 * "Mahjong tiles" and "Mahjong solitaire" articles, where the flowers and the
 * seasons are one of each and match WITHIN their group rather than by face. The
 * turtle is the layout Wikipedia's article calls "the turtle" and calls the
 * default; `TURTLE_ROWS` below is that layout, transcribed from KMahjongg's
 * `layouts/default.layout` (the KDE game, GPL-2.0-or-later) and kept as rows of
 * coordinates rather than 144 pairs so a reader can check it against the picture.
 *
 * **Coordinates are quarter tiles and a tile is two of them.** A tile at
 * `(x, y, z)` occupies quarters `x..x+1` across and `y..y+1` down, so two tiles
 * in the same layer that overlap one quarter are half a tile apart, and a tile
 * one layer up at `x ± 1, y ± 1` rests across four of them. The layer counts the
 * layout must come to are 87, 36, 16, 4 and 1 — 144 — and the test asserts them,
 * which is what proves the transcription rather than trusting it.
 *
 * **The free-tile rule is KMahjongg's `GameScene::isSelectable`.** A tile may be
 * taken when nothing in the layer above sits within one quarter of it in BOTH
 * axes (a three-by-three neighbourhood, which is the four tiles it can rest on
 * plus the diagonals), and it has an open left or right side: no tile of its own
 * layer two quarters away with any vertical overlap. Left or right, not both,
 * which is the "open or exposed" rule the game is played by.
 *
 * **Deals are built backwards, and that is the whole trick.** A removal order is
 * searched over the LAYOUT alone — two free slots at a time, no faces involved
 * — and only then are the faces dealt out: the first pair of the order takes the
 * first matching face pair, the second takes the second, and so on. Every deal
 * this module makes is therefore solvable by the order it was built in, and that
 * order is kept as the deal's `witness`. The test does not take the witness's
 * word for it: it replays every witness against the rule, and it confirms a
 * thousand deals with the independent solver below.
 *
 * **The solver is a search, and it is a different program from the
 * construction.** It takes the faces as given, may only pair tiles that MATCH,
 * and walks the board with a node budget and a memo of positions it has already
 * failed from. Nothing about it knows which order the deal was built in.
 */

import type { SeededRandom } from "../random.js";
import { createSeededRandom, shuffled } from "../random.js";

/** A tile's place: quarter-tile coordinates and the layer it sits on. */
export interface MahjongSlot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The turtle, one entry per row of tiles: `[layer, y, first x, last x]`, with the
 * tiles of a row two quarters apart. Five layers, 87 + 36 + 16 + 4 + 1 = 144
 * tiles, and the middle row of the base layer carries the head at x=1 and the
 * two-tile tail at x=27 and x=29 that give the turtle its shape.
 */
const TURTLE_ROWS: readonly (readonly [number, number, number, number])[] = [
  // The base layer: a wide slab, with the head and tail on its middle row.
  [0, 0, 3, 25],
  [0, 2, 7, 21],
  [0, 4, 5, 23],
  [0, 6, 3, 25],
  [0, 7, 1, 1],
  [0, 7, 27, 29],
  [0, 8, 3, 25],
  [0, 10, 5, 23],
  [0, 12, 7, 21],
  [0, 14, 3, 25],
  // Four stepped layers above it.
  [1, 2, 9, 19],
  [1, 4, 9, 19],
  [1, 6, 9, 19],
  [1, 8, 9, 19],
  [1, 10, 9, 19],
  [1, 12, 9, 19],
  [2, 4, 11, 17],
  [2, 6, 11, 17],
  [2, 8, 11, 17],
  [2, 10, 11, 17],
  [3, 6, 13, 15],
  [3, 8, 13, 15],
  [4, 7, 14, 14],
];

/** The tiles of the turtle, in layer then row order. */
export const TURTLE_SLOTS: readonly MahjongSlot[] = TURTLE_ROWS.flatMap(([z, y, first, last]) => {
  const row: MahjongSlot[] = [];
  for (let x = first; x <= last; x += 2) row.push({ x, y, z });
  return row;
});

/** How many tiles each layer of the turtle must hold. 87 + 36 + 16 + 4 + 1 = 144. */
export const TURTLE_LAYER_COUNTS: readonly number[] = [87, 36, 16, 4, 1];

/** The three-by-three-above and two-to-the-side lookups a free-tile question needs. */
export interface MahjongNeighbourhood {
  readonly above: readonly (readonly number[])[];
  readonly left: readonly (readonly number[])[];
  readonly right: readonly (readonly number[])[];
}

export interface MahjongBoard {
  readonly slots: readonly MahjongSlot[];
  readonly neighbours: MahjongNeighbourhood;
}

/** Precompute what can cover or block each slot, once per layout. */
export function mahjongBoard(slots: readonly MahjongSlot[]): MahjongBoard {
  const above: number[][] = [];
  const left: number[][] = [];
  const right: number[][] = [];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index] as MahjongSlot;
    const up: number[] = [];
    const side: number[] = [];
    const other: number[] = [];
    for (let other2 = 0; other2 < slots.length; other2 += 1) {
      if (other2 === index) continue;
      const candidate = slots[other2] as MahjongSlot;
      const dx = candidate.x - slot.x;
      const dy = candidate.y - slot.y;
      if (candidate.z === slot.z + 1 && dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1) {
        up.push(other2);
        continue;
      }
      if (candidate.z !== slot.z || dy < -1 || dy > 1) continue;
      if (dx === -2) side.push(other2);
      if (dx === 2) other.push(other2);
    }
    above.push(up);
    left.push(side);
    right.push(other);
  }
  return { slots, neighbours: { above, left, right } };
}

/** The turtle as the engine uses it. */
export const TURTLE: MahjongBoard = mahjongBoard(TURTLE_SLOTS);

/**
 * Whether a tile may be taken: nothing resting on it, and one of its sides open.
 * `remaining` is indexed like `board.slots`.
 */
export function isMahjongFree(
  board: MahjongBoard,
  remaining: readonly boolean[],
  index: number,
): boolean {
  if (remaining[index] !== true) return false;
  const { above, left, right } = board.neighbours;
  for (const cover of above[index] as readonly number[]) {
    if (remaining[cover] === true) return false;
  }
  const held = (side: readonly number[]): boolean => side.some((neighbour) => remaining[neighbour] === true);
  // One open side is enough, and a tile with no neighbour on that side at all
  // is open on it — which is how the ends of every row are playable.
  if (!held(left[index] as readonly number[])) return true;
  return !held(right[index] as readonly number[]);
}

/** Every tile that may be taken right now, ascending. */
export function mahjongFreeSlots(board: MahjongBoard, remaining: readonly boolean[]): number[] {
  const free: number[] = [];
  for (let index = 0; index < board.slots.length; index += 1) {
    if (isMahjongFree(board, remaining, index)) free.push(index);
  }
  return free;
}

/** The seven kinds of face a tile can carry. */
export type MahjongGroup =
  | "bamboo"
  | "circles"
  | "characters"
  | "wind"
  | "dragon"
  | "flower"
  | "season";

/**
 * The faces of the 144 tiles, in the traditional order: three suits of nine
 * ranks in four copies each, then four winds in four copies, three dragons in
 * four copies, and the four flowers and four seasons one of each.
 */
export const MAHJONG_FACES: readonly string[] = (() => {
  const faces: string[] = [];
  for (const suit of ["bamboo", "circles", "characters"] as const) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) faces.push(`${suit}-${rank}`);
    }
  }
  for (const wind of ["east", "south", "west", "north"]) {
    for (let copy = 0; copy < 4; copy += 1) faces.push(`wind-${wind}`);
  }
  for (const dragon of ["red", "green", "white"]) {
    for (let copy = 0; copy < 4; copy += 1) faces.push(`dragon-${dragon}`);
  }
  for (let flower = 1; flower <= 4; flower += 1) faces.push(`flower-${flower}`);
  for (let season = 1; season <= 4; season += 1) faces.push(`season-${season}`);
  return faces;
})();

/**
 * What a face matches against. A suit card matches its own rank, a wind its own
 * wind and a dragon its own dragon; the flowers match each other whatever they
 * are, and so do the seasons. That is the traditional rule and the reason the
 * group is not the face for those last two.
 */
export function mahjongGroupOf(face: string): string {
  if (face.startsWith("flower-")) return "flower";
  if (face.startsWith("season-")) return "season";
  return face;
}

/** Whether two faces may be taken together. */
export function mahjongFacesMatch(left: string, right: string): boolean {
  return mahjongGroupOf(left) === mahjongGroupOf(right);
}

/**
 * The fifty faces paired the way a deal needs them: two copies of each suit,
 * wind and dragon rank, and two pairs drawn from the flowers and two from the
 * seasons. Seventy-two pairs, which is the 144 tiles taken two at a time.
 */
function facePairs(): [string, string][] {
  const byGroup = new Map<string, string[]>();
  for (const face of MAHJONG_FACES) {
    const group = mahjongGroupOf(face);
    const held = byGroup.get(group);
    if (held) held.push(face);
    else byGroup.set(group, [face]);
  }
  const pairs: [string, string][] = [];
  for (const group of byGroup.values()) {
    for (let index = 0; index + 1 < group.length; index += 2) {
      pairs.push([group[index] as string, group[index + 1] as string]);
    }
  }
  return pairs;
}

/** A deal: one face per slot, and the order that proves it can be cleared. */
export interface MahjongDeal {
  readonly faces: readonly string[];
  readonly witness: readonly (readonly [number, number])[];
  readonly seed: number;
}

/** A removal a player made, with the faces it took, which is what undo restores. */
export interface MahjongMove {
  readonly a: number;
  readonly b: number;
  readonly faces: readonly [string, string];
}

export interface MahjongGame {
  readonly board: MahjongBoard;
  /** The face on each slot; a shuffle rearranges these, never the slots. */
  readonly faces: readonly string[];
  readonly remaining: readonly boolean[];
  readonly moves: readonly MahjongMove[];
  readonly seed: number;
  readonly rngState: number;
  /** How many times the remaining faces have been dealt out again. */
  readonly shuffles: number;
}

/**
 * A deterministic Zobrist table for the solver's memo, so a board position is
 * one pair of thirty-two-bit words rather than a list of 144 flags. It is
 * derived from a fixed seed of this module's own, so the hash of a position is
 * the same on every run — which the memo does not require, but the report of a
 * node count does.
 */
const ZOBRIST: readonly { readonly lo: number; readonly hi: number }[] = (() => {
  const random = createSeededRandom(0x5eed);
  return Array.from({ length: 512 }, () => ({
    lo: Math.floor(random.next() * 4294967296) >>> 0,
    hi: Math.floor(random.next() * 4294967296) >>> 0,
  }));
})();

function positionKey(lo: number, hi: number): string {
  return `${lo}:${hi}`;
}

/**
 * How many positions one search may visit before giving up. Measured: each of
 * the thousand deals the test solves takes exactly 72 positions -- one per pair,
 * because peeling the topmost pair first walks a deal built the same way
 * straight down -- and the hand-built boards in the test are what reach the
 * take-back path. The limit is there so a position the search cannot settle
 * reports "not solved within the budget" instead of hanging a renderer, and it
 * is a few hundred times the worst case measured.
 */
export const MAHJONG_SOLVER_NODE_BUDGET = 50_000;

const MAHJONG_CONSTRUCTION_NODE_BUDGET = 200_000;

interface SearchResult {
  readonly solved: boolean;
  readonly order: readonly (readonly [number, number])[];
  readonly nodes: number;
  /** True when the budget ran out rather than the board being unusable. */
  readonly exhausted: boolean;
}

/**
 * Peel the board: at every step take two free tiles that `canPair` accepts, and
 * back off when the position is one the search has already failed from (the memo
 * keeps those hashes). Pairs are tried topmost-first, which is the order a
 * person plays in, and is what keeps the node count small.
 *
 * `canPair` is the whole difference between the two callers: the deal builder
 * accepts any two slots, because faces are dealt afterwards; the solver accepts
 * only matching faces.
 */
function searchPeel(
  board: MahjongBoard,
  remaining: boolean[],
  budget: number,
  canPair: (left: number, right: number) => boolean,
): SearchResult {
  const order: [number, number][] = [];
  const failed = new Set<string>();
  let nodes = 0;
  let exhausted = false;
  let count = remaining.filter(Boolean).length;
  let hashLo = 0;
  let hashHi = 0;
  for (let index = 0; index < remaining.length; index += 1) {
    if (remaining[index] !== true) continue;
    const zobrist = ZOBRIST[index % ZOBRIST.length] as { lo: number; hi: number };
    hashLo ^= zobrist.lo;
    hashHi ^= zobrist.hi;
  }

  const peel = (lo: number, hi: number): boolean => {
    if (count === 0) return true;
    if (nodes >= budget) {
      exhausted = true;
      return false;
    }
    const key = positionKey(lo, hi);
    if (failed.has(key)) return false;
    nodes += 1;

    const free = mahjongFreeSlots(board, remaining);
    if (free.length < 2) return false;
    const pairs: [number, number][] = [];
    for (let first = 0; first < free.length; first += 1) {
      for (let second = first + 1; second < free.length; second += 1) {
        const a = free[first] as number;
        const b = free[second] as number;
        if (!canPair(a, b)) continue;
        pairs.push([a, b]);
      }
    }
    if (pairs.length === 0) return false;
    const { slots } = board;
    pairs.sort((left, right) => {
      const leftScore = (slots[left[0]] as MahjongSlot).z + (slots[left[1]] as MahjongSlot).z;
      const rightScore = (slots[right[0]] as MahjongSlot).z + (slots[right[1]] as MahjongSlot).z;
      return rightScore - leftScore;
    });

    for (const [a, b] of pairs) {
      remaining[a] = false;
      remaining[b] = false;
      count -= 2;
      order.push([a, b]);
      const zobristA = ZOBRIST[a % ZOBRIST.length] as { lo: number; hi: number };
      const zobristB = ZOBRIST[b % ZOBRIST.length] as { lo: number; hi: number };
      if (peel(lo ^ zobristA.lo ^ zobristB.lo, hi ^ zobristA.hi ^ zobristB.hi)) return true;
      order.pop();
      count += 2;
      remaining[a] = true;
      remaining[b] = true;
      if (exhausted) return false;
    }
    failed.add(key);
    return false;
  };

  const solved = peel(hashLo, hashHi);
  return { solved, order: solved ? [...order] : [], nodes, exhausted };
}

/**
 * One removal order for a whole board, by peeling. `remaining` is left untouched.
 */
function removalOrder(board: MahjongBoard, budget: number): readonly (readonly [number, number])[] {
  const remaining = new Array<boolean>(board.slots.length).fill(true);
  const result = searchPeel(board, remaining, budget, () => true);
  if (!result.solved) {
    throw new RangeError(
      "mahjong: this layout has no removal order that starts from two free tiles" +
        (result.exhausted ? ` within ${budget} positions` : ""),
    );
  }
  return result.order;
}

/**
 * A solvable deal: a removal order for the turtle, then the faces handed out in
 * that order. Deterministic for a seed.
 */
export function createMahjongDeal(seed: number, board: MahjongBoard = TURTLE): MahjongDeal {
  const random = createSeededRandom(seed);
  const { faces, witness } = dealFrom(board, random);
  return { faces, witness, seed };
}

/** Deal the faces out along a removal order, which is what makes the deal winnable. */
function dealFrom(
  board: MahjongBoard,
  random: SeededRandom,
): { faces: string[]; witness: readonly (readonly [number, number])[] } {
  const witness = removalOrder(board, MAHJONG_CONSTRUCTION_NODE_BUDGET);
  const pairs = shuffled(facePairs(), random);
  if (pairs.length * 2 !== board.slots.length) {
    throw new RangeError(
      `createMahjongDeal: a ${board.slots.length}-slot layout needs ${board.slots.length / 2} pairs, the set holds ${pairs.length}`,
    );
  }
  const faces = new Array<string>(board.slots.length);
  witness.forEach(([a, b], index) => {
    const pair = pairs[index] as [string, string];
    faces[a] = pair[0];
    faces[b] = pair[1];
  });
  return { faces, witness };
}

/** A game on top of a deal, or on top of a board a test built by hand. */
export function createMahjongGame(seed: number, board: MahjongBoard = TURTLE): MahjongGame {
  const random = createSeededRandom(seed);
  const { faces } = dealFrom(board, random);
  return {
    board,
    faces,
    remaining: new Array<boolean>(board.slots.length).fill(true),
    moves: [],
    seed,
    rngState: random.state,
    shuffles: 0,
  };
}

/**
 * A game whose faces are chosen by the caller — a board a test wants to pin, or
 * a saved game being restored. The faces are not validated against the set: a
 * caller restoring a game is not this module's boundary, and the rules below are
 * the same whatever the faces are.
 */
export function mahjongGameFrom(setup: {
  readonly slots: readonly MahjongSlot[];
  readonly faces: readonly string[];
  readonly remaining?: readonly boolean[];
  readonly seed?: number;
}): MahjongGame {
  if (setup.faces.length !== setup.slots.length) {
    throw new RangeError(
      `mahjongGameFrom: ${setup.slots.length} slots need ${setup.slots.length} faces, got ${setup.faces.length}`,
    );
  }
  const board = mahjongBoard(setup.slots);
  return {
    board,
    faces: [...setup.faces],
    remaining: setup.remaining ? [...setup.remaining] : new Array<boolean>(setup.slots.length).fill(true),
    moves: [],
    seed: setup.seed ?? 0,
    rngState: createSeededRandom(setup.seed ?? 0).state,
    shuffles: 0,
  };
}

/** Every pair of free tiles that may be taken together, in slot order. */
export function mahjongLegalPairs(game: MahjongGame): (readonly [number, number])[] {
  const free = mahjongFreeSlots(game.board, game.remaining);
  const pairs: (readonly [number, number])[] = [];
  for (let first = 0; first < free.length; first += 1) {
    for (let second = first + 1; second < free.length; second += 1) {
      const a = free[first] as number;
      const b = free[second] as number;
      if (!mahjongFacesMatch(game.faces[a] as string, game.faces[b] as string)) continue;
      pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * Take two tiles, or `null` when that is not a play: one of them is not free, or
 * their faces do not match. The caller is a player's click, where a blocked tile
 * is a normal thing to try and not a programming error, so this returns nothing
 * rather than throwing.
 */
export function mahjongRemove(game: MahjongGame, a: number, b: number): MahjongGame | null {
  if (a === b) return null;
  if (!isMahjongFree(game.board, game.remaining, a)) return null;
  if (!isMahjongFree(game.board, game.remaining, b)) return null;
  const faceA = game.faces[a] as string;
  const faceB = game.faces[b] as string;
  if (!mahjongFacesMatch(faceA, faceB)) return null;
  const remaining = [...game.remaining];
  remaining[a] = false;
  remaining[b] = false;
  return {
    ...game,
    remaining,
    moves: [...game.moves, { a, b, faces: [faceA, faceB] }],
  };
}

/** True when every tile is gone. */
export function mahjongWon(game: MahjongGame): boolean {
  return game.remaining.every((present) => present !== true);
}

/**
 * Step back over the last removal: those two tiles come back with the faces they
 * had. A shuffle in between is not stepped back over — undo undoes a removal, and
 * saying otherwise would need the whole arrangement stored per move.
 */
export function mahjongUndo(game: MahjongGame): MahjongGame | null {
  const last = game.moves[game.moves.length - 1];
  if (last === undefined) return null;
  const remaining = [...game.remaining];
  remaining[last.a] = true;
  remaining[last.b] = true;
  const faces = [...game.faces];
  faces[last.a] = last.faces[0];
  faces[last.b] = last.faces[1];
  return { ...game, remaining, faces, moves: game.moves.slice(0, -1) };
}

/**
 * Deal the tiles that are left out again, keeping the same multiset and keeping
 * the position solvable: a removal order over the remaining slots is found
 * first, and the remaining faces are handed out along it, exactly as the first
 * deal was made. The slots never move, so what changes is which face is where.
 *
 * A shape with no removal left (a lone tile under another, say) cannot be
 * rescued by any arrangement of faces, and this says so rather than looping.
 */
export function mahjongShuffle(game: MahjongGame, seed?: number): MahjongGame {
  const random = createSeededRandom(seed ?? game.rngState + 1);
  const remaining = [...game.remaining];
  const result = searchPeel(game.board, remaining, MAHJONG_CONSTRUCTION_NODE_BUDGET, () => true);
  if (!result.solved) {
    throw new RangeError("mahjongShuffle: the tiles left cannot be cleared in any order");
  }
  const held: string[] = [];
  for (let index = 0; index < game.faces.length; index += 1) {
    if (game.remaining[index] === true) held.push(game.faces[index] as string);
  }
  const byGroup = new Map<string, string[]>();
  for (const face of held) {
    const group = mahjongGroupOf(face);
    const list = byGroup.get(group);
    if (list) list.push(face);
    else byGroup.set(group, [face]);
  }
  const pairs: [string, string][] = [];
  for (const group of byGroup.values()) {
    if (group.length % 2 !== 0) {
      throw new RangeError("mahjongShuffle: the faces left do not pair up");
    }
    for (let index = 0; index + 1 < group.length; index += 2) {
      pairs.push([group[index] as string, group[index + 1] as string]);
    }
  }
  const shuffledPairs = shuffled(pairs, random);
  const faces = [...game.faces];
  result.order.forEach(([a, b], index) => {
    const pair = shuffledPairs[index] as [string, string];
    faces[a] = pair[0];
    faces[b] = pair[1];
  });
  return { ...game, faces, rngState: random.state, shuffles: game.shuffles + 1 };
}

export interface MahjongSolution {
  readonly solved: boolean;
  /** The order that clears the board, empty when it cannot be cleared. */
  readonly order: readonly (readonly [number, number])[];
  /** How many positions the search visited, so a budget can be seen to be enough. */
  readonly nodes: number;
  /** True when the budget ran out, which is not the same as "no solution". */
  readonly exhausted: boolean;
}

/**
 * Clear the board from where it stands, pairing only faces that match. This is
 * the independent check the deals are held to: it never sees the order a deal
 * was built in, and it may stop early when its budget runs out.
 */
export function solveMahjong(
  game: MahjongGame,
  budget: number = MAHJONG_SOLVER_NODE_BUDGET,
): MahjongSolution {
  const remaining = [...game.remaining];
  const result = searchPeel(
    game.board,
    remaining,
    budget,
    (a, b) => mahjongFacesMatch(game.faces[a] as string, game.faces[b] as string),
  );
  return {
    solved: result.solved,
    order: result.order,
    nodes: result.nodes,
    exhausted: result.exhausted,
  };
}

/**
 * One pair that keeps the board solvable, or `null` when nothing does — the
 * position is lost, or the budget ran out before the search could say. The pair
 * is the first move of the order the solver found, so a hint is a move that is
 * really on a winning line rather than merely legal.
 */
export function mahjongHint(
  game: MahjongGame,
  budget: number = MAHJONG_SOLVER_NODE_BUDGET,
): readonly [number, number] | null {
  const solution = solveMahjong(game, budget);
  if (!solution.solved) return null;
  const first = solution.order[0];
  return first === undefined ? null : [first[0], first[1]];
}
