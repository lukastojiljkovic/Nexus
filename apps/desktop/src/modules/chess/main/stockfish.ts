/**
 * The strength this module asks the Stockfish pack for, level by level
 * (ADR-094).
 *
 * **Why the pack plays only the top of the ladder.** `@nexus/core`'s eight
 * levels are a designed ladder with three dials each (depth, a soft time budget,
 * and a deliberate weakness: a window a beginner's move may fall inside, and a
 * chance of playing any legal move at all — `levels.ts` argues the whole of it).
 * A UCI engine has no equivalent of „pick a move within 350 centipawns, and
 * sometimes play anything“, and pretending otherwise would silently turn level 1
 * into a much stronger opponent than the level the user chose. So levels 1–5 stay
 * the module's own engine, and levels `PACK_FIRST_LEVEL` and up — the ones whose
 * point is strength rather than weakness — are played by the pack when it is
 * installed. Without the pack every level is the module's own engine, as before.
 *
 * **Where the two dials come from, and where they do not.** The SEARCH budget is
 * this module's own ladder: `CHESS_LEVELS[level].depth` and `.timeMs`, the same
 * numbers the built-in engine searches to. The STRENGTH is asked for as a
 * `UCI_Elo`, interpolated across the range the engine itself advertises in its
 * handshake — never a number written down here, because an engine that ships a
 * different range is an engine whose ratings mean something else:
 *
 * - `UCI_LimitStrength` (check, default false) and `UCI_Elo` (spin, default
 *   1320, range 1320–3190 in Stockfish 19) are the two options the engine
 *   advertises for exactly this purpose; the level below reads their bounds from
 *   the handshake so the top of our ladder is the top of the engine's own scale.
 * - Stockfish converts that Elo to an internal skill level anchored to another
 *   engine, „based on a fit of the Elo results“ — its own comment, in
 *   `src/search.h` at tag `sf_19`
 *   (<https://github.com/official-stockfish/Stockfish/blob/sf_19/src/search.h#L247-L267>),
 *   and it defines the option in `src/engine.cpp` at the same tag
 *   (<https://github.com/official-stockfish/Stockfish/blob/sf_19/src/engine.cpp#L107-L121>).
 *   `Skill Level` (0–20, default 20) is the other knob; this module does not set
 *   it, because `UCI_LimitStrength` + `UCI_Elo` is the pair that carries a rating
 *   and setting both would leave the engine in the state of whichever option it
 *   read last.
 * - An engine that advertises neither option gets NO strength limit and only the
 *   search budget, which is stated here rather than guessed at: with no way to
 *   ask for a rating, the honest thing is to not pretend to have asked.
 *
 * **Level 8 is the engine's own maximum, not „no limit“.** Reading the range
 * means level 8 asks for the highest Elo the engine offers, so this module never
 * requests something the engine cannot honour — and the module's own ladder still
 * decides how long each level may think.
 */

import { chessLevel, CHESS_LEVELS } from "@nexus/core";
import type { UciOption } from "../../../main/tools/uci.js";
import { PACK_FIRST_LEVEL } from "../shared/levels.js";

// The threshold and the catalogue pointer are the module's own two facts about
// the pack, and the page needs them as well: they live in `shared/levels.ts`, and
// this file re-exports them so a caller in main has one import for the pack.
export { PACK_CATALOGUE_ENTRY, PACK_FIRST_LEVEL } from "../shared/levels.js";

/** The pack whose engine plays the top of the ladder. Its id is the pack registry's, not a path. */
export const STOCKFISH_PACK_ID = "stockfish";

/** The bounds of the `UCI_Elo` option, as the engine advertised them. */
export interface EloRange {
  readonly min: number;
  readonly max: number;
}

/** What one level of this module asks the pack for. */
export interface PackStrength {
  /**
   * The `UCI_Elo` to ask for, or `null` to leave the engine's own strength
   * alone — which is what an engine that advertises no `UCI_Elo` gets.
   */
  readonly elo: number | null;
  /** The deep and shallow budgets of this level, from this module's own ladder. */
  readonly depth: number;
  readonly timeMs: number;
}

/** The level whose search this module's own engine stops serving. */
export function needsPack(level: number): boolean {
  return level >= PACK_FIRST_LEVEL;
}

/**
 * The `UCI_Elo`/`UCI_LimitStrength` pair an engine advertised, or `null`.
 *
 * Both options are required, and the pair is only usable when `UCI_Elo`'s bounds
 * are numbers the engine actually sent (`min` < `max`): an engine that advertises
 * a rating it will not accept is an engine whose rating means nothing, and asking
 * for one is answered by a `No such option:` line nobody reads.
 */
export function eloRangeOf(options: readonly UciOption[]): EloRange | null {
  const elo = options.find((option) => option.name === "UCI_Elo");
  const limit = options.find((option) => option.name === "UCI_LimitStrength");
  if (elo === undefined || limit === undefined) return null;
  if (elo.min === null || elo.max === null || elo.min >= elo.max) return null;
  return { min: elo.min, max: elo.max };
}

/**
 * What `level` asks for, across the engine's own Elo range.
 *
 * `PACK_FIRST_LEVEL` gets the bottom of the range and the top level gets its top;
 * the levels between are spread evenly. With one level in between (the three
 * levels this build has) that is the exact midpoint, so the numbers are
 * 1320 / 2255 / 3190 against Stockfish 19's own advertised range — a hand
 * calculation, not a reading: `3190 - 1320 = 1870`, half of it is `935`, and
 * `1320 + 935 = 2255`.
 */
export function packStrength(level: number, range: EloRange | null): PackStrength {
  // `chessLevel` refuses a level outside the ladder, which is the same range the
  // wire validates against; a level that reached here out of range is a bug and
  // not a move to guess at.
  const config = chessLevel(level);
  if (range === null) return { elo: null, depth: config.depth, timeMs: config.timeMs };
  const span = (level - PACK_FIRST_LEVEL) / (CHESS_LEVELS.length - PACK_FIRST_LEVEL);
  return {
    elo: Math.round(range.min + span * (range.max - range.min)),
    depth: config.depth,
    timeMs: config.timeMs,
  };
}

/** The engine calls this module makes to apply a strength: `setoption` plus the `isready` that proves it landed. */
export interface OptionSetter {
  setOption(name: string, value: string | null): Promise<void>;
}

/**
 * Applies a level's strength to a started engine.
 *
 * `UCI_LimitStrength` is set in both directions rather than only when a limit
 * exists, because a `setoption` that was never sent is a setting the engine keeps
 * from whatever session used it before — UCI is one process, and „the previous
 * value“ is not a state this module left on purpose.
 */
export async function applyStrength(engine: OptionSetter, strength: PackStrength): Promise<void> {
  if (strength.elo === null) {
    await engine.setOption("UCI_LimitStrength", "false");
    return;
  }
  await engine.setOption("UCI_LimitStrength", "true");
  await engine.setOption("UCI_Elo", String(strength.elo));
}
