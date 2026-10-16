import { boardEngine, isBoardsGame } from "@nexus/core";
import type { BoardsGame } from "@nexus/core";

/** A new game the assistant asked this page to start: the game, who plays the other seat, and the computer's level. */
export interface StartRequest {
  readonly game: BoardsGame;
  readonly opponent: "computer" | "human";
  readonly level: number;
}

/**
 * The payload `boards.start` sends, read back by the page (the tool has already
 * checked it; the page checks it again, since the location travels through a window
 * event). Null for anything the page cannot start, which it reports handled anyway.
 *
 * The level is checked against the engine's own count, never a literal here, for the
 * reason the store's level check states.
 */
export function startRequestOf(payload: unknown): StartRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { game, opponent, level } = payload as Record<string, unknown>;
  if (!isBoardsGame(game)) return null;
  if (opponent !== "computer" && opponent !== "human") return null;
  if (typeof level !== "number" || !Number.isInteger(level)) return null;
  if (level < 1 || level > boardEngine(game).levels) return null;
  return { game, opponent, level };
}
