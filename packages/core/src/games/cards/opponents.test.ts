import { describe, expect, it } from "vitest";
import { createSeededRandom, type SeededRandom } from "../random.js";
import type { CardOpponentLevel, TablicVariant } from "./game.js";
import {
  applyHearts,
  dealHearts,
  heartsChooseMove,
  isHeartsMoveLegal,
  type HeartsState,
} from "./hearts.js";
import {
  applySpades,
  dealSpades,
  isSpadesMoveLegal,
  spadesChooseMove,
  type SpadesState,
} from "./spades.js";
import {
  applyTablic,
  dealTablic,
  isTablicMoveLegal,
  tablicChooseMove,
  type TablicState,
} from "./tablic.js";

/**
 * The three levels, proved legal by playing whole games with them.
 *
 * **The counts are the brief's**: a thousand seeded full games per game at `easy`
 * and at `medium`, and as many `hard` games as keep this file inside its budget on
 * the development machine. Every move of every game is checked against the
 * engine's own enumeration before it is applied, and the count of moves that were
 * NOT legal is what the tests assert is zero — an assertion per move would make
 * the file about the test runner rather than about the games.
 *
 * **The hard level is measured rather than assumed.** Its samples and its soft
 * clock are this project's own numbers (`HEARTS_LEVELS` and the two beside it),
 * and the test records the milliseconds per move it actually cost, because „a
 * bounded search" that takes a second a move is a search nobody would play
 * against.
 */

/** A hard cap on a game that never ends, so a defect is a failure rather than a hang. */
const MAX_MOVES = 40_000;

interface Played<S> {
  readonly state: S;
  readonly moves: number;
  readonly illegal: number;
  /** Milliseconds spent inside `chooseMove` alone — the opponent's own cost. */
  readonly ms: number;
}

function playHearts(seed: number, level: CardOpponentLevel): Played<HeartsState> {
  const random: SeededRandom = createSeededRandom(seed ^ 0x5eed);
  let state = dealHearts("standard", seed);
  let moves = 0;
  let illegal = 0;
  let ms = 0;
  while (state.board.phase !== "complete") {
    const started = performance.now();
    const move = heartsChooseMove(state, level, random);
    ms += performance.now() - started;
    if (!isHeartsMoveLegal(state, move)) illegal += 1;
    state = applyHearts(state, move);
    moves += 1;
    if (moves > MAX_MOVES) throw new Error(`hearts seed ${seed} did not end`);
  }
  return { state, moves, illegal, ms };
}

function playSpades(seed: number, level: CardOpponentLevel): Played<SpadesState> {
  const random: SeededRandom = createSeededRandom(seed ^ 0x5eed);
  let state = dealSpades("standard", seed);
  let moves = 0;
  let illegal = 0;
  let ms = 0;
  while (state.board.phase !== "complete") {
    const started = performance.now();
    const move = spadesChooseMove(state, level, random);
    ms += performance.now() - started;
    if (!isSpadesMoveLegal(state, move)) illegal += 1;
    state = applySpades(state, move);
    moves += 1;
    if (moves > MAX_MOVES) throw new Error(`spades seed ${seed} did not end`);
  }
  return { state, moves, illegal, ms };
}

function playTablic(seed: number, variant: TablicVariant, level: CardOpponentLevel): Played<TablicState> {
  const random: SeededRandom = createSeededRandom(seed ^ 0x5eed);
  let state = dealTablic(variant, seed);
  let moves = 0;
  let illegal = 0;
  let ms = 0;
  while (state.board.phase !== "complete") {
    const started = performance.now();
    const move = tablicChooseMove(state, level, random);
    ms += performance.now() - started;
    if (!isTablicMoveLegal(state, move)) illegal += 1;
    state = applyTablic(state, move);
    moves += 1;
    if (moves > MAX_MOVES) throw new Error(`tablic seed ${seed} did not end`);
  }
  return { state, moves, illegal, ms };
}

/** One level of one game, over a range of seeds: the whole aggregate the test asserts. */
function runAll<S>(
  count: number,
  play: (seed: number) => Played<S>,
  finished: (state: S) => boolean,
): { illegal: number; unfinished: number; moves: number; ms: number } {
  let illegal = 0;
  let unfinished = 0;
  let moves = 0;
  let ms = 0;
  for (let seed = 0; seed < count; seed += 1) {
    const played = play(seed);
    illegal += played.illegal;
    unfinished += finished(played.state) ? 0 : 1;
    moves += played.moves;
    ms += played.ms;
  }
  return { illegal, unfinished, moves, ms };
}

const GAMES = 1_000;
/**
 * Fewer hard games: eight a level is what keeps this file at about sixteen
 * seconds here, which is the brief's budget for it, and the measured cost of the
 * level is in `LEVEL_CEILING_MS` beside the assertion.
 */
const HARD_GAMES = 8;
/**
 * The ceiling one opponent move must stay under, in milliseconds, per level.
 *
 * Measured on the development machine over the games these tests play, in
 * milliseconds per move at easy / medium / hard — Hearts 0.0011 / 0.0017 / 0.103,
 * Spades 0.0007 / 0.0015 / 0.112, Tablić `duo` 0.0036 / 0.0024 / 0.202 and `pairs`
 * 0.0034 / 0.0023 / 0.380. The ceilings are set far above those so that a slow CI
 * runner — four suites at once on four cores — fails only on a level that has
 * genuinely stopped being bounded, and `hard` sits under its own soft clock of
 * thirty milliseconds by two orders of magnitude.
 */
const LEVEL_CEILING_MS: Readonly<Record<CardOpponentLevel, number>> = {
  easy: 0.2,
  medium: 0.2,
  hard: 25,
};

interface Measurement {
  readonly level: CardOpponentLevel;
  readonly moves: number;
  readonly perMove: number;
}

/** The rows whose average cost per move is over the level's ceiling; empty is the pass. */
function overCeiling(rows: readonly Measurement[]): readonly Measurement[] {
  return rows.filter((row) => row.perMove > LEVEL_CEILING_MS[row.level]);
}

describe("the opponents never play an illegal move", () => {
  it("plays a thousand Hearts games at easy, then at medium, and a few at hard", () => {
    const measured: Measurement[] = [];
    for (const level of ["easy", "medium", "hard"] as const) {
      const count = level === "hard" ? HARD_GAMES : GAMES;
      const result = runAll(count, (seed) => playHearts(seed, level), (state) => state.board.phase === "complete");
      expect({ level, illegal: result.illegal, unfinished: result.unfinished }).toEqual({
        level,
        illegal: 0,
        unfinished: 0,
      });
      expect(result.moves).toBeGreaterThan(0);
      measured.push({ level, moves: result.moves, perMove: result.ms / result.moves });
    }
    expect(overCeiling(measured)).toEqual([]);
  });

  it("plays a thousand Spades games at easy, then at medium, and a few at hard", () => {
    const measured: Measurement[] = [];
    for (const level of ["easy", "medium", "hard"] as const) {
      const count = level === "hard" ? HARD_GAMES : GAMES;
      const result = runAll(count, (seed) => playSpades(seed, level), (state) => state.board.phase === "complete");
      expect({ level, illegal: result.illegal, unfinished: result.unfinished }).toEqual({
        level,
        illegal: 0,
        unfinished: 0,
      });
      expect(result.moves).toBeGreaterThan(0);
      measured.push({ level, moves: result.moves, perMove: result.ms / result.moves });
    }
    expect(overCeiling(measured)).toEqual([]);
  });

  it("plays a thousand Tablić games at easy, then at medium, and a few at hard, in both variants", () => {
    const measured: Measurement[] = [];
    for (const variant of ["duo", "pairs"] as const) {
      for (const level of ["easy", "medium", "hard"] as const) {
        const count = level === "hard" ? HARD_GAMES : GAMES;
        const result = runAll(
          count,
          (seed) => playTablic(seed, variant, level),
          (state) => state.board.phase === "complete",
        );
        expect({ variant, level, illegal: result.illegal, unfinished: result.unfinished }).toEqual({
          variant,
          level,
          illegal: 0,
          unfinished: 0,
        });
        expect(result.moves).toBeGreaterThan(0);
        measured.push({ level, moves: result.moves, perMove: result.ms / result.moves });
      }
    }
    expect(overCeiling(measured)).toEqual([]);
  });
});
