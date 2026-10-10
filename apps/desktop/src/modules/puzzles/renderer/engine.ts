import {
  createBrojPuzzle,
  createMahjongGame,
  generateNonogram,
  generateSudoku,
  mahjongHint,
  solveBroj,
} from "@nexus/core";
import type {
  BrojPuzzle,
  BrojSolution,
  NonogramPuzzle,
  SudokuPuzzle,
} from "@nexus/core";
import type { MahjongStateView } from "../shared/ipc.js";
import { gameOf } from "./mahjong.js";
import { nonogramSizeOf } from "./nonogram.js";

/**
 * What the module asks the engine for, and what it answers — the whole of the
 * worker's protocol, as pure values (ADR-090).
 *
 * **Why these run in a worker at all.** Three of them are the heavy half of this
 * module: `generateSudoku` grades the grid after every hole it digs (a run of
 * the whole technique ladder per hole), `generateNonogram` draws and line-solves
 * candidates until one is accepted, and `mahjongHint` searches a board for a
 * move that still clears it. On the UI thread each of them is a frozen window
 * with no progress and no way out, which is the one thing the product's own rule
 * forbids — so the work happens off the thread that paints, and the page shows
 * which stage it is in.
 *
 * **Why the protocol is data and not a function.** The worker's global scope is
 * not the page's: it has its own module graph and no copy table, so a message
 * cannot carry a sentence. `stageOf` answers with a CODE, and the page maps that
 * code to its own copy in the language being read — which is also why the
 * protocol is declared here, where both sides import it by type.
 *
 * **Everything is a pure function of a seed or a position**, so nothing here is
 * a store, a cache or a session: the same request answers the same result, and
 * the page is what remembers.
 */

export type EngineRequest =
  | { readonly kind: "sudoku"; readonly seed: number; readonly variant: string }
  | { readonly kind: "nonogram"; readonly seed: number; readonly variant: string }
  | { readonly kind: "mahjong"; readonly seed: number }
  | { readonly kind: "broj"; readonly seed: number }
  | {
      readonly kind: "mahjong-hint";
      readonly seed: number;
      readonly state: MahjongStateView;
    }
  | {
      readonly kind: "broj-solution";
      readonly numbers: readonly number[];
      readonly target: number;
    };

export type EngineResponse =
  | { readonly kind: "sudoku"; readonly puzzle: SudokuPuzzle }
  | { readonly kind: "nonogram"; readonly puzzle: NonogramPuzzle }
  | { readonly kind: "mahjong"; readonly faces: readonly string[] }
  | { readonly kind: "broj"; readonly puzzle: BrojPuzzle }
  | { readonly kind: "mahjong-hint"; readonly pair: readonly [number, number] | null }
  | { readonly kind: "broj-solution"; readonly solution: BrojSolution };

/**
 * Which part of the work is happening, as a code the page turns into a sentence.
 * Two stages, because there are two kinds of work: a board is GENERATED, or a
 * position is SEARCHED for an answer.
 */
export type EngineStage = "deal" | "search";

export function stageOf(request: EngineRequest): EngineStage {
  return request.kind === "mahjong-hint" || request.kind === "broj-solution" ? "search" : "deal";
}

/** The messages that cross the worker boundary. `stage` is a progress note; a request has exactly one answer. */
export type EngineWorkerMessage =
  | { readonly type: "stage"; readonly id: number; readonly stage: EngineStage }
  | { readonly type: "result"; readonly id: number; readonly response: EngineResponse }
  | { readonly type: "error"; readonly id: number; readonly message: string };

export interface EngineClientMessage {
  readonly type: "request";
  readonly id: number;
  readonly request: EngineRequest;
}

/**
 * The worker's own half: one request in, one answer out.
 *
 * An unknown variant is thrown on rather than defaulted, because the variant
 * arrives from a row the store validates against the same list this switch is
 * written against — so reaching the default arm means the two lists have drifted,
 * which is a bug worth a message rather than a board of the wrong size. The
 * worker's entry point turns the throw into an `error` message and the page says
 * so, which is the honest end of a chain that cannot happen in a released build.
 */
export function runEngineRequest(request: EngineRequest): EngineResponse {
  switch (request.kind) {
    case "sudoku": {
      if (request.variant !== "easy" && request.variant !== "medium" && request.variant !== "hard") {
        throw new RangeError(`puzzles: "${request.variant}" is not a sudoku grade`);
      }
      return {
        kind: "sudoku",
        puzzle: generateSudoku(request.seed, { difficulty: request.variant }),
      };
    }
    case "nonogram": {
      const size = nonogramSizeOf(request.variant);
      if (size === null) {
        throw new RangeError(`puzzles: "${request.variant}" is not a nonogram board size`);
      }
      return {
        kind: "nonogram",
        puzzle: generateNonogram(request.seed, size.width, size.height),
      };
    }
    case "mahjong":
      return { kind: "mahjong", faces: [...createMahjongGame(request.seed).faces] };
    case "broj":
      return { kind: "broj", puzzle: createBrojPuzzle(request.seed) };
    case "mahjong-hint":
      return {
        kind: "mahjong-hint",
        pair: mahjongHint(gameOf(request.state, request.seed)),
      };
    case "broj-solution":
      return {
        kind: "broj-solution",
        solution: solveBroj([...request.numbers], request.target),
      };
  }
}
