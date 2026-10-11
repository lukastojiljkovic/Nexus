import { validateMinesweeperConfig, type MinesweeperConfig } from "@nexus/core";

/**
 * The Minesweeper custom-board form, as a pure function (ADR-090).
 *
 * **The three fields are TEXT, because a half-typed number is not a value.** "1"
 * on the way to "10" is a board of one column, and a form that read it as one
 * would flicker through shapes the player never asked for; this reads all three
 * at once, when the player asks for a game.
 *
 * **The rule is the ENGINE's**, and it is asked rather than restated:
 * `validateMinesweeperConfig` is what refuses a board whose first click could not
 * be guaranteed safe, in the same words the store's own boundary refuses it - so
 * a custom board the form accepts is exactly one the game can be played on.
 */

/** The form's three fields, as typed. */
export interface CustomBoardFields {
  readonly columns: string;
  readonly rows: string;
  readonly mines: string;
}

/** A field as a whole number, or null. Only digits count: a sign or a comma is not a board. */
function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** The board the three fields spell, or null when they do not spell a playable one. */
export function readCustomBoard(fields: CustomBoardFields): MinesweeperConfig | null {
  const columns = wholeNumber(fields.columns);
  const rows = wholeNumber(fields.rows);
  const mines = wholeNumber(fields.mines);
  if (columns === null || rows === null || mines === null) return null;
  const checked = validateMinesweeperConfig({ columns, rows, mines });
  return checked.ok ? checked.config : null;
}

/** The four boards a picker offers: the engine's three presets, and the custom one. */
export const MINESWEEPER_LEVELS = ["beginner", "intermediate", "expert", "custom"] as const;
export type MinesweeperLevel = (typeof MINESWEEPER_LEVELS)[number];
