import type { ArcadeGameId, ArcadeScoreView, ArcadeView } from "../shared/ipc.js";
import { formatArchiveInstant } from "../../../renderer/src/timeFormat.js";
import { copy } from "./copy.js";
import { formatBestTime, formatCount } from "./format.js";
import { summarize, type GameSummary } from "./stats.js";

/**
 * The words the shelf and the stats table put around the numbers (ADR-090).
 *
 * **Why this is a file rather than JSX.** Every figure here is a small sentence
 * with a label, a value and a direction, and a component that built them inline
 * would be a component nobody could ask "what does the shelf say about Blocks".
 * As functions, they are exact strings a test asserts - and the arithmetic they
 * lean on (`stats.ts`) is a second, separately tested layer.
 *
 * **The count is named by its game.** A row's `bestCount` is lines for Blocks,
 * food for Snake, levels for Bricks and moves for 2048, so the label comes from a
 * switch on the game rather than from a generic word: "Najbolji rezultat: 1.200"
 * followed by "Najviše linija 34" says what happened, where "Dodatno 34" would
 * need a legend.
 */

/** The games whose rows carry a score and a second count under their own names. */
type ScoreGame = Exclude<ArcadeGameId, "minesweeper">;

/** One game's name, as the shelf, the panel and the stats table draw it. */
export function gameName(game: ArcadeGameId): string {
  return copy.games[game];
}

/** What one game calls its second count. */
export function countLabel(game: ScoreGame): string {
  switch (game) {
    case "blocks":
      return copy.counts.lines;
    case "snake":
      return copy.counts.food;
    case "bricks":
      return copy.counts.levels;
    case "tile2048":
      return copy.counts.moves;
  }
}

/** The `nema` a figure shows when a profile has never finished a game of that board. */
function missing(): string {
  return copy.stats.none;
}

/**
 * The shelf's headline figure for one game: a Minesweeper time or a score.
 *
 * A time improves downwards and a score upwards, and both are read from
 * `summarize`, so the shelf cannot show the slowest win or the lowest score.
 */
export function shelfFigure(view: ArcadeView, game: ArcadeGameId): string {
  const totals: GameSummary = summarize(view, game);
  if (game === "minesweeper") {
    return totals.bestTimeMs === null ? missing() : formatBestTime(totals.bestTimeMs);
  }
  return totals.bestScore === null ? missing() : formatCount(totals.bestScore);
}

/**
 * The shelf's second line: the fact that game's own rows carry beyond the
 * headline - how much has been played, how good the run was, or how long the
 * streak on the board being played is.
 */
export function shelfDetail(view: ArcadeView, game: ArcadeGameId): string {
  const totals = summarize(view, game);
  if (totals.boards === 0) return copy.stats.unplayed;
  if (game === "minesweeper") return `${copy.stats.played} ${formatCount(totals.played)}`;
  if (game === "tile2048") {
    return `${copy.stats.longestStreak} ${formatCount(totals.longestStreak)}`;
  }
  return `${countLabel(game)} ${totals.bestCount === null ? missing() : formatCount(totals.bestCount)}`;
}

/** One labelled figure in a board's row of the stats table. */
export interface BoardFact {
  readonly label: string;
  readonly value: string;
}

/**
 * A board's row in the stats table, as figures with their own labels.
 *
 * A board nobody has played has no facts at all: the row is drawn (so the table
 * shows the game's shapes) and says so under the headline, which is this
 * module's own reading of "a table of bests".
 */
export function boardFacts(row: ArcadeScoreView | null, game: ArcadeGameId): readonly BoardFact[] {
  if (row === null) return [];
  const facts: BoardFact[] = [
    { label: copy.stats.played, value: formatCount(row.played) },
  ];
  if (game === "minesweeper") {
    facts.push(
      { label: copy.stats.currentStreak, value: formatCount(row.currentStreak) },
      { label: copy.stats.longestStreak, value: formatCount(row.longestStreak) },
    );
  } else {
    facts.push({
      label: countLabel(game),
      value: row.bestCount === null ? missing() : formatCount(row.bestCount),
    });
    if (game === "tile2048") {
      facts.push(
        { label: copy.stats.currentStreak, value: formatCount(row.currentStreak) },
        { label: copy.stats.longestStreak, value: formatCount(row.longestStreak) },
      );
    }
  }
  facts.push({ label: copy.stats.lastPlayed, value: formatArchiveInstant(row.lastPlayedAt) });
  return facts;
}

/** The figure a board's row leads with, or `nema` when it has never been played. */
export function boardHeadline(row: ArcadeScoreView | null, game: ArcadeGameId): string {
  if (row === null) return missing();
  if (game === "minesweeper") {
    return row.bestTimeMs === null ? missing() : formatBestTime(row.bestTimeMs);
  }
  return row.bestScore === null ? missing() : formatCount(row.bestScore);
}

