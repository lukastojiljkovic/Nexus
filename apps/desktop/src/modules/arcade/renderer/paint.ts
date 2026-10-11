import { pieceCells, pieceFrame, type BlockPieceId } from "@nexus/core";
import type { BoardPalette } from "./palette.js";

/**
 * The drawing primitives every board shares (ADR-090), and the two rules they
 * keep.
 *
 * **Hairlines land on half pixels.** A one-pixel stroke centred on an integer
 * coordinate is drawn across two device pixels, which is the grey fuzzy grid this
 * codebase's half-pixel rule exists for; `+ 0.5` is what makes a grid line one
 * pixel wide and crisp at the ratio the canvas was sized for.
 *
 * **Nothing here knows a colour.** Every function takes the resolved
 * `BoardPalette`, so the five boards cannot invent a value, and a theme switch is
 * a repaint with a different palette rather than a second set of drawing code.
 */

/** The ground a board is drawn on, at the size its own canvas box was given. */
export function paintGround(
  ctx: CanvasRenderingContext2D,
  palette: BoardPalette,
  width: number,
  height: number,
): void {
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, 0, width, height);
}

/** The flat grid: one hairline per cell boundary, which is what makes a cell count readable. */
export function paintGrid(
  ctx: CanvasRenderingContext2D,
  palette: BoardPalette,
  columns: number,
  rows: number,
  cell: number,
): void {
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let column = 1; column < columns; column += 1) {
    const x = column * cell + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, rows * cell);
  }
  for (let row = 1; row < rows; row += 1) {
    const y = row * cell + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(columns * cell, y);
  }
  ctx.stroke();
}

/** One filled cell, inset by `inset` pixels so two neighbours read as two shapes. */
export function paintFill(
  ctx: CanvasRenderingContext2D,
  colour: string,
  column: number,
  row: number,
  cell: number,
  inset = 0,
): void {
  ctx.fillStyle = colour;
  ctx.fillRect(column * cell + inset, row * cell + inset, cell - inset * 2, cell - inset * 2);
}

/** One outlined cell, drawn on the half pixel so the line is a line. */
export function paintOutline(
  ctx: CanvasRenderingContext2D,
  colour: string,
  column: number,
  row: number,
  cell: number,
  inset = 0,
): void {
  const left = Math.round(column * cell + inset) + 0.5;
  const top = Math.round(row * cell + inset) + 0.5;
  const side = Math.round(cell - inset * 2) - 1;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, side, side);
}

/**
 * The font a board's readouts are set in, at `size`.
 *
 * A canvas takes a font STRING rather than a custom property, and a canvas
 * INHERITS `font-family` from the page - so the family is read off the element
 * (which resolves `--nx-font-family-ui` through the cascade) rather than copied
 * into this file, where it would be a style value in JavaScript and the one place
 * in the app set in something else.
 */
export function boardFont(ctx: CanvasRenderingContext2D, size: number): string {
  const family = window.getComputedStyle(ctx.canvas).fontFamily;
  return `${String(size)}px ${family === "" ? "sans-serif" : family}`;
}

/** Centred text in one cell: the Minesweeper numbers and the 2048 values. */
export function paintCellText(
  ctx: CanvasRenderingContext2D,
  text: string,
  column: number,
  row: number,
  cell: number,
  colour: string,
  font: string,
): void {
  ctx.fillStyle = colour;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, column * cell + cell / 2, row * cell + cell / 2 + 1);
}

/** Centred text in a whole box, for a board whose cells carry words rather than figures. */
export function paintBoxText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  colour: string,
  font: string,
): void {
  ctx.fillStyle = colour;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
}

/**
 * One Blocks piece, centred in a square box of four cells.
 *
 * The box is four cells whatever the piece's own frame is, so a hold slot and a
 * preview do not jump when the piece changes - which is the reason
 * `pieceFrame` is exported by the engine at all.
 */
export function paintPiece(
  ctx: CanvasRenderingContext2D,
  palette: BoardPalette,
  id: BlockPieceId | null,
  cell: number,
  originX: number,
  originY: number,
): void {
  if (id === null) return;
  const side = pieceFrame(id);
  const inset = (4 - side) / 2;
  for (const cellOfPiece of pieceCells(id, 0)) {
    const column = originX / cell + inset + cellOfPiece.x;
    const row = originY / cell + inset + cellOfPiece.y;
    paintFill(ctx, pieceColour(palette, id), column, row, cell, 1);
  }
}

/** The piece's index into `BoardPalette.pieces`, which is `BLOCKS_PIECE_IDS` order. */
const PIECE_INDEX: Readonly<Record<BlockPieceId, number>> = {
  bar: 0,
  square: 1,
  tee: 2,
  ell: 3,
  jay: 4,
  ess: 5,
  zee: 6,
};

/** The colour one Blocks piece is drawn in: its own slot of the accent palette. */
export function pieceColour(palette: BoardPalette, id: BlockPieceId): string {
  return palette.pieces[PIECE_INDEX[id]] ?? palette.accent;
}

