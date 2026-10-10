import { MINESWEEPER_PRESET_IDS, type MinesweeperPresetId } from "@nexus/core";
import type { ArcadeGameId } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * A board key spelled for a reader (ADR-090).
 *
 * **Why the key has to be turned back into words at all.** The store's row is
 * keyed by the board - `beginner`, `standard`, `4x4`, or `custom:9x9x10` - and
 * that key is what the shelf and the stats table receive. The key is a good
 * identifier and a poor label, so this is the one place it becomes one, and the
 * words come from the module's own copy table rather than from a second list.
 *
 * **A key this build does not know is shown as itself.** A row written by a later
 * build (or by a future board size) is a row this one cannot name, and printing
 * `5x5` is more honest than printing the word "unknown" over a number that is
 * perfectly real.
 */

/** The custom board a variant key spells, or null when it is not one. */
export function customBoardOf(
  variant: string,
): { readonly columns: number; readonly rows: number; readonly mines: number } | null {
  const match = /^custom:(\d+)x(\d+)x(\d+)$/.exec(variant);
  if (match === null) return null;
  const [, columns, rows, mines] = match;
  return { columns: Number(columns), rows: Number(rows), mines: Number(mines) };
}

/** One preset's name, for the level picker and the stats table. */
export function presetLabel(preset: MinesweeperPresetId): string {
  return copy.levels[preset];
}

/** A board key as the words the interface uses for it. */
export function boardLabel(game: ArcadeGameId, variant: string): string {
  if (game === "minesweeper") {
    if ((MINESWEEPER_PRESET_IDS as readonly string[]).includes(variant)) {
      return presetLabel(variant as MinesweeperPresetId);
    }
    const custom = customBoardOf(variant);
    if (custom !== null) {
      return `${copy.levels.custom} ${custom.columns}×${custom.rows}×${custom.mines}`;
    }
    return variant;
  }
  if (game === "tile2048") {
    // `4x4` is a size, not a key: it is read as "4 x 4" the way a board size is
    // written, which is the one place this module spells a dimension.
    const size = /^(\d+)x(\d+)$/.exec(variant);
    return size === null ? variant : `${size[1]}×${size[2]}`;
  }
  return variant === "standard" ? copy.boards.standard : variant;
}
