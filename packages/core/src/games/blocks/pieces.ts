/**
 * The seven pieces Blocks deals, and the one rotation rule they all obey.
 *
 * **The names are SHAPES, and the trademarked game's vocabulary is nowhere in
 * this module.** „Tetris" is a registered trademark of Tetris Holding, LLC, and
 * a United States court held in *Tetris Holding, LLC v. Xio Interactive, Inc.*
 * (D.N.J. 2012) that the game's distinctive LOOK is protected — so this module
 * has our own name for the game, our own spelling of the seven shapes (an `ell`
 * and a `jay`, not two letters), and stage 2 draws its own board with our own
 * palette. The seven four-cell pieces themselves are geometry, and geometry is
 * what any falling-blocks game needs.
 *
 * **Every piece lives in its OWN square frame, and rotation is about that
 * frame's centre.** A three-cell frame for the five pieces that fit one, a
 * four-cell frame for the bar (four cells in a line need four across), and a
 * two-cell frame for the square — which is what makes the square's four
 * rotations the same four cells rather than four translations, with no special
 * case anywhere. Because the centre of a 2- or 4-wide frame is a half-cell, the
 * rotation is `(x, y) → (side − 1 − y, x)`: whole-number coordinates in, whole
 * numbers out, a quarter turn clockwise on screen (`y` grows downwards), and
 * every piece stays inside its own frame.
 *
 * **This is deliberately NOT a published kick table.** The offsets that rescue a
 * rotation are three of our own, stated in `blocks.ts`, and no measured table
 * from any other game is reproduced here.
 */

/** The seven, in the order a bag is cut from — which is arbitrary, because the bag is shuffled. */
export const BLOCKS_PIECE_IDS = ["bar", "square", "tee", "ell", "jay", "ess", "zee"] as const;
export type BlockPieceId = (typeof BLOCKS_PIECE_IDS)[number];

/** One cell of a piece, in its frame's coordinates: `x` to the right, `y` downwards, both from the frame's top-left. */
export interface BlockCell {
  readonly x: number;
  readonly y: number;
}

/** The side of each piece's square frame. Four for the bar, two for the square, three for the rest — see the file doc. */
const FRAMES: Readonly<Record<BlockPieceId, number>> = {
  bar: 4,
  square: 2,
  tee: 3,
  ell: 3,
  jay: 3,
  ess: 3,
  zee: 3,
};

/**
 * The spawn orientation of each piece, drawn as the shape reads on screen:
 *
 *     bar     square   tee    ell    jay    ess    zee
 *     ....     ..      .#.    #..    ..#    .##    ##.
 *     ####     ##      ###    ###    ###    ##.    .##
 *
 * Four cells each. The picture is the reason there is no comment beside every
 * entry: a shape is easier to check than to read.
 */
const SPAWN: Readonly<Record<BlockPieceId, readonly BlockCell[]>> = {
  bar: [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ],
  square: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  tee: [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ],
  ell: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ],
  jay: [
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ],
  ess: [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  zee: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ],
};

/** A quarter turn clockwise on screen, about the centre of a `side`-wide frame. Whole numbers in, whole numbers out. */
function quarterTurn(cells: readonly BlockCell[], side: number): BlockCell[] {
  return cells.map((cell) => ({ x: side - 1 - cell.y, y: cell.x }));
}

/** The spawn orientation and three quarter turns of one piece, in order. */
function rotationsOf(id: BlockPieceId): readonly (readonly BlockCell[])[] {
  const side = FRAMES[id];
  const turns: BlockCell[][] = [[...SPAWN[id]]];
  for (let turn = 1; turn < 4; turn += 1) {
    turns.push(quarterTurn(turns[turn - 1] as readonly BlockCell[], side));
  }
  return turns;
}

/**
 * The four rotations of every piece, computed once at import rather than on every
 * keystroke, and in the SAME order for all seven: index `r` is `r` quarter turns
 * clockwise from the spawn orientation, so `r + 1` is one `rotateCW` and `r + 3`
 * is one `rotateCCW`. Spelled out one piece per line rather than built from the id
 * list, because `Object.fromEntries` widens the key type to `string` and the
 * lookup below is the one place a typo would be silent.
 */
const ROTATIONS: Readonly<Record<BlockPieceId, readonly (readonly BlockCell[])[]>> = {
  bar: rotationsOf("bar"),
  square: rotationsOf("square"),
  tee: rotationsOf("tee"),
  ell: rotationsOf("ell"),
  jay: rotationsOf("jay"),
  ess: rotationsOf("ess"),
  zee: rotationsOf("zee"),
};

/**
 * The cells of `id` at `rotation`, in the piece's own frame. Any integer
 * rotation is accepted and wrapped, so a caller counting turns cannot fall off
 * the end of the list.
 */
export function pieceCells(id: BlockPieceId, rotation: number): readonly BlockCell[] {
  const turns = ((rotation % 4) + 4) % 4;
  return ROTATIONS[id][turns] as readonly BlockCell[];
}

/** The side of `id`'s frame — what stage 2 needs to draw a hold or preview slot that does not jump when the piece changes. */
export function pieceFrame(id: BlockPieceId): number {
  return FRAMES[id];
}
