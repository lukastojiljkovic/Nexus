import { MINESWEEPER_PRESET_IDS, type MinesweeperPresetId } from "@nexus/core";
import { ARCADE_GAME_IDS, type ArcadeGameId } from "../shared/ipc.js";

/**
 * Where an assistant request points the arcade page: a game, and for Minesweeper
 * the board it opens on (`main/assistant/tools/arcade.ts` writes the item).
 */
export interface ArcadeTarget {
  readonly game: ArcadeGameId;
  /** The Minesweeper preset to open on, or `null` to keep the board the page has. */
  readonly preset: MinesweeperPresetId | null;
}

/**
 * The target an item names, or `null` for an item this page does not know.
 *
 * The spelling is `game`, or `game/preset` for Minesweeper. A preset on any other
 * game, a custom board (which only the form can spell) and a third segment are all
 * refused here, so a request the page cannot honour changes nothing.
 */
export function arcadeTargetOf(item: string): ArcadeTarget | null {
  const [game, preset, extra] = item.split("/");
  if (extra !== undefined || game === undefined || !isGame(game)) return null;
  if (preset === undefined) return { game, preset: null };
  if (game !== "minesweeper" || !isPreset(preset)) return null;
  return { game, preset };
}

function isGame(value: string): value is ArcadeGameId {
  return (ARCADE_GAME_IDS as readonly string[]).includes(value);
}

function isPreset(value: string): value is MinesweeperPresetId {
  return (MINESWEEPER_PRESET_IDS as readonly string[]).includes(value);
}
