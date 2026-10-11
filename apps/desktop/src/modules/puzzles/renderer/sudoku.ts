import { SUDOKU_UNITS, sudokuConflicts, sudokuHint } from "@nexus/core";
import type { SudokuHint, SudokuTechnique } from "@nexus/core";
import type { SudokuStateView } from "../shared/ipc.js";

/**
 * Sudoku's board arithmetic, as pure functions (ADR-090).
 *
 * **The engine owns the rules; this file owns the editing.** What is a conflict,
 * what technique comes next, and whether a board has one completion are all
 * `@nexus/core`'s answers, and nothing here re-derives one of them. What it does
 * own is what a person's tap MEANS — a digit entered twice clears the cell, a
 * pencil mark toggles, a placement drops that digit from the pencil marks of its
 * peers — because that is an editing decision and not a rule of sudoku.
 *
 * **A placement clears its OWN cell's marks and nobody else's.** The engine
 * drops a placed digit from every peer's candidates because it only places
 * digits it has proved; a player places what they think, and a wrong entry that
 * silently erased the marks around it would be the app losing work the user did
 * — one undo step at a time, which is not a way to get it back. So the pencil
 * marks of the neighbouring cells are left exactly as the player wrote them.
 */

const CELL_COUNT = 81;

/** The twenty-seven cells of the row, the column and the box a cell stands in, deduplicated. */
export function unitsOf(cell: number): readonly number[] {
  const cells = new Set<number>();
  for (const unit of SUDOKU_UNITS) {
    if (!unit.includes(cell)) continue;
    for (const mate of unit) cells.add(mate);
  }
  return [...cells].sort((left, right) => left - right);
}

/** The board as the engine reads it: the givens with what the player has entered laid over them. */
export function mergedCells(state: SudokuStateView): number[] {
  const cells: number[] = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const given = state.givens[index] ?? 0;
    cells.push(given !== 0 ? given : (state.entries[index] ?? 0));
  }
  return cells;
}

/** Every cell that holds the same digit as `cell`, itself included. What „highlight the same digits" draws. */
export function sameDigitCells(state: SudokuStateView, cell: number): readonly number[] {
  const cells = mergedCells(state);
  const digit = cells[cell] ?? 0;
  if (digit === 0) return [cell];
  const found: number[] = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (cells[index] === digit) found.push(index);
  }
  return found;
}

/** How many cells hold a digit, givens included — the number printed as „Popunjeno". */
export function filledCount(state: SudokuStateView): number {
  let filled = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((state.givens[index] ?? 0) !== 0 || (state.entries[index] ?? null) !== null) filled += 1;
  }
  return filled;
}

/**
 * Whether the board is finished AND right.
 *
 * „Finished" alone is not enough: a full board with a duplicated digit is a
 * board the player cannot tell from a solved one by looking at how many cells
 * are filled, and the engine's own solution is the answer that settles it.
 */
export function isSolved(state: SudokuStateView, solution: readonly number[]): boolean {
  const cells = mergedCells(state);
  return cells.every((value, index) => value !== 0 && value === (solution[index] ?? 0));
}

/**
 * Enters a digit in a cell, or clears the cell when the same digit is entered
 * again — the one gesture that makes a small board playable with a mouse, and
 * the reason the digit pad has no separate „toggle off".
 */
export function enterDigit(state: SudokuStateView, cell: number, digit: number): SudokuStateView {
  if ((state.givens[cell] ?? 0) !== 0) return state;
  const current = state.entries[cell] ?? null;
  if (current === digit) return clearCell(state, cell);
  return withEntry(state, cell, digit);
}

/** Adds or removes one pencil mark. A cell holding a digit has no marks to toggle, so the call is refused by doing nothing. */
export function toggleNote(state: SudokuStateView, cell: number, digit: number): SudokuStateView {
  if ((state.givens[cell] ?? 0) !== 0 || (state.entries[cell] ?? null) !== null) return state;
  const notes = state.notes.map((marks) => [...marks]);
  const held = notes[cell] ?? [];
  notes[cell] = held.includes(digit)
    ? held.filter((mark) => mark !== digit)
    : [...held, digit].sort((left, right) => left - right);
  return { ...state, notes };
}

/** Empties a cell: the digit goes and the pencil marks stay, because a mark is a note about the cell rather than part of the entry. */
export function clearCell(state: SudokuStateView, cell: number): SudokuStateView {
  if ((state.givens[cell] ?? 0) !== 0) return state;
  const entries = [...state.entries];
  entries[cell] = null;
  return { ...state, entries };
}

/**
 * The cells that repeat a digit inside a unit when the user asked to see them,
 * and none when the user did not — the product's „conflicts shown only when the
 * user asks", in one function, so the board cannot accidentally draw one.
 */
export function conflictCells(state: SudokuStateView, show: boolean): readonly number[] {
  return show ? sudokuConflicts(mergedCells(state)) : [];
}

/**
 * The next step the technique ladder can take on this board, or `null` when it
 * has nothing left — a finished board, or one that needs a technique past
 * X-wing.
 */
export function hintFor(state: SudokuStateView): SudokuHint | null {
  return sudokuHint(mergedCells(state));
}

/**
 * A hint flattened into the four things a surface draws and a screen reader
 * announces: which technique, what it does, and where. The engine's union is
 * what it is because it is complete about eliminations; a panel does not need
 * that shape, and reading the fields out here is what keeps the narrowing in one
 * place rather than in the JSX.
 */
export interface HintFacts {
  readonly technique: SudokuTechnique;
  readonly action: "fill" | "eliminate" | "narrow";
  /** The cell a placement fills, or `null` for a step that removes candidates. */
  readonly cell: number | null;
  /** The digit a placement writes, or `null`. */
  readonly digit: number | null;
  /** Every cell the step touches: the cell it fills, or the cells it changes. */
  readonly cells: readonly number[];
  /** The cells that justify the step, so the board can mark them apart from the ones it changes. */
  readonly pattern: readonly number[];
  readonly digits: readonly number[];
}

export function hintFacts(hint: SudokuHint): HintFacts {
  if (hint.action === "fill") {
    return {
      technique: hint.technique,
      action: "fill",
      cell: hint.cell,
      digit: hint.digit,
      cells: [hint.cell],
      pattern: [...hint.pattern],
      digits: [hint.digit],
    };
  }
  return {
    technique: hint.technique,
    action: hint.action,
    cell: null,
    digit: null,
    cells: [...hint.cells],
    pattern: [...hint.pattern],
    digits: [...hint.digits],
  };
}

/**
 * One placement. The cell's own marks go — a cell shows a digit or its marks,
 * never both, which is also what the store refuses a save for — and the marks
 * around it are left alone (see the header).
 */
function withEntry(state: SudokuStateView, cell: number, digit: number): SudokuStateView {
  const entries = [...state.entries];
  entries[cell] = digit;
  const notes = state.notes.map((marks) => [...marks]);
  notes[cell] = [];
  return { ...state, entries, notes };
}
