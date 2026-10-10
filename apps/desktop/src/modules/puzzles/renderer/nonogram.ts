import { NONOGRAM_MAX, NONOGRAM_MIN, checkNonogram, cluesOf } from "@nexus/core";
import type { NonogramPuzzle } from "@nexus/core";

/**
 * Nonograms' board arithmetic, as pure functions (ADR-090).
 *
 * **Three marks, and the engine's two states.** A player marks a cell filled, or
 * crosses it to say „I am sure this is empty", or leaves it alone — three things
 * a person distinguishes and only two the engine does, because a puzzle's own
 * state never asks anyone to be sure. So this file owns the third mark and maps
 * back onto `NonogramCell` for every question the engine answers (is the picture
 * complete, how much of it is right), rather than re-deriving either.
 *
 * **A clue is „done" when the line's filled cells match it exactly**, which is a
 * readout and not a proof: the same shape a pencil-and-paper solver gets from
 * crossing off a number as the line fills up. It deliberately says nothing about
 * whether the line is RIGHT — that is the picture's question, and the only one
 * the engine's `checkNonogram` answers.
 */

export const MARK_UNKNOWN = 0;
export const MARK_FILLED = 1;
export const MARK_CROSSED = 2;

export type NonogramTool = "fill" | "cross";

/** The cell sizes the zoom control steps through, in px. Three steps, because a board is either readable at a glance, comfortable to tap, or large — and a fourth would be a slider. */
export const ZOOM_CELL_SIZES: readonly number[] = [16, 22, 28];

/** A blank board. */
export function emptyMarks(width: number, height: number): number[] {
  return new Array<number>(width * height).fill(MARK_UNKNOWN);
}

/**
 * Applies the current tool to one cell: a cell already carrying that mark is
 * cleared, which is how one button both marks and unmarks.
 *
 * The other tool's mark is replaced rather than added to, because a cell is
 * filled or crossed and not both, and a board that could hold both would need a
 * rule for what the second one means.
 */
export function applyMark(marks: readonly number[], index: number, tool: NonogramTool): number[] {
  const wanted = tool === "fill" ? MARK_FILLED : MARK_CROSSED;
  const next = [...marks];
  next[index] = next[index] === wanted ? MARK_UNKNOWN : wanted;
  return next;
}

/** Whether one line's filled cells are exactly what its clues describe. A crossed cell is not a filled one. */
export function lineIsDone(line: readonly number[], clues: readonly number[]): boolean {
  const filled = line.map((mark) => mark === MARK_FILLED);
  const runs = cluesOf(filled);
  return runs.length === clues.length && runs.every((run, index) => run === clues[index]);
}

/**
 * Which rows and columns have been crossed off, in the puzzle's own order. What
 * the clues draw themselves from: a number that is accounted for is muted, and
 * the board says at a glance where the work is finished.
 */
export function completedLines(
  marks: readonly number[],
  puzzle: Pick<NonogramPuzzle, "width" | "height" | "rowClues" | "colClues">,
): { rows: boolean[]; columns: boolean[] } {
  const { width, height } = puzzle;
  const rows: boolean[] = [];
  for (let row = 0; row < height; row += 1) {
    rows.push(lineIsDone(marks.slice(row * width, (row + 1) * width), puzzle.rowClues[row] ?? []));
  }
  const columns: boolean[] = [];
  for (let column = 0; column < width; column += 1) {
    const line: number[] = [];
    for (let row = 0; row < height; row += 1) line.push(marks[row * width + column] ?? MARK_UNKNOWN);
    columns.push(lineIsDone(line, puzzle.colClues[column] ?? []));
  }
  return { rows, columns };
}

/** The board as the engine reads it: filled or not filled, with a cross and an untouched cell the same thing. */
function playerCells(marks: readonly number[]): (boolean | null)[] {
  return marks.map((mark) => (mark === MARK_FILLED ? true : false));
}

/** How many of the picture's cells the player has filled, and how many of the player's fills are wrong. */
export function progressOf(
  marks: readonly number[],
  puzzle: NonogramPuzzle,
): { progress: number; wrong: number } {
  const check = checkNonogram(puzzle, playerCells(marks));
  return { progress: check.progress, wrong: check.wrong.length };
}

/** Whether the picture is finished AND right — the engine's own answer, asked through the third mark. */
export function isSolved(marks: readonly number[], puzzle: NonogramPuzzle): boolean {
  return checkNonogram(puzzle, playerCells(marks)).complete;
}

/**
 * The board size a variant names — `"10x10"` is ten by ten. `null` for anything
 * else rather than a guess: the variant is a key the store validates against its
 * own list, and a key this function does not recognise is a bug rather than a
 * value to repair.
 */
export function nonogramSizeOf(variant: string): { width: number; height: number } | null {
  const match = /^(\d{1,2})x(\d{1,2})$/.exec(variant);
  if (match === null) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < NONOGRAM_MIN || width > NONOGRAM_MAX) return null;
  if (height < NONOGRAM_MIN || height > NONOGRAM_MAX) return null;
  return { width, height };
}

/** The cell size for a zoom level, clamped to the three steps rather than wrapping: a control at its end is a control that stays there. */
export function zoomCellSize(level: number): number {
  const index = Math.min(Math.max(Math.trunc(level), 0), ZOOM_CELL_SIZES.length - 1);
  return ZOOM_CELL_SIZES[index] as number;
}
