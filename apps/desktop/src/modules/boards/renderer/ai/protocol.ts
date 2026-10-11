import {
  boardEngine,
  createSeededRandom,
  isBoardsGame,
  normalizeBoardState,
} from "@nexus/core";
import type { BoardsGame } from "@nexus/core";

/**
 * The AI worker's protocol (ADR-090 stage 2) — one request, one answer, and no
 * state shared with the page.
 *
 * **Why a worker at all.** Every board engine's `bestMove` is a search: alpha-beta
 * to a depth, or an expectimax over six dice faces. On the UI thread that is a
 * frozen window for as long as it runs, which is exactly the thing a game must not
 * do — and the brief's rule is that heavy computation never runs on the UI thread.
 *
 * **Why the protocol is a PURE function and the worker is a shell.** A worker's
 * `onmessage` cannot be tested without a worker, so the whole of the protocol —
 * what a request must look like, what it answers, what it refuses — is
 * `answerMoveRequest`, a plain function of a plain value. `ai.worker.ts` is three
 * lines that hand it the message and post the result back, and this file is what
 * the module's tests drive.
 *
 * **Why the page rolls and the worker thinks. The dice belong to the game, the
 * tie-break does not.** A roll advances the game's seeded stream, which is what
 * makes a saved game replayable; a search draws from the stream it is GIVEN, once
 * per call, for its equal-move shuffle. Handing the search the game's own stream
 * would make the dice depend on how many searches happened to run, so the page
 * rolls the dice itself and gives the worker a per-move stream derived from the
 * game's seed (`rules.ts`'s `moveSeed`). The worker therefore never has to tell
 * the page which dice it drew: it answers with a MOVE and the position it left its
 * own stream in, and the page's state is the only state.
 *
 * **Every refusal is a token, not a sentence.** `problem` is a machine word the
 * page maps onto its own copy, which is the only place a user-facing sentence
 * lives in this repository.
 */

/** Which game, how well, which position — and where the search's own stream starts. */
export interface AiMoveRequest {
  readonly id: number;
  readonly game: string;
  readonly level: number;
  readonly state: unknown;
  /** The stream the search shuffles with, derived per move — never the game's own. */
  readonly seed: number;
}

/** Why a request was refused, as a token the page's copy names. */
export type AiProblem = "invalid-request" | "unreadable-position" | "must-roll";

/** What one search answered: a move (or none, on a finished position) and what it cost. */
export type AiMoveAnswer =
  | {
      readonly id: number;
      readonly ok: true;
      readonly move: unknown | null;
      readonly nodes: number;
      readonly depth: number;
      readonly cut: boolean;
      /** Where the search's own stream ended, so a caller can continue it. */
      readonly rng: number;
    }
  | { readonly id: number; readonly ok: false; readonly problem: AiProblem };

/** The engine's generator is thirty-two bits wide (`games/random.ts`), so a stream's position is too. */
const MAX_SEED = 0xffff_ffff;

/**
 * Answers one move request. Total: anything it cannot read comes back as a
 * refusal naming the reason rather than as a thrown error, because a worker that
 * throws kills the promise somebody is waiting on.
 */
export function answerMoveRequest(request: unknown): AiMoveAnswer {
  const record = asRecord(request);
  const id = whole(record["id"]);
  if (id === null) return { id: 0, ok: false, problem: "invalid-request" };
  const game = record["game"];
  if (!isBoardsGame(game)) return { id, ok: false, problem: "invalid-request" };
  const engine = boardEngine(game);
  const level = whole(record["level"]);
  if (level === null || level < 1 || level > engine.levels) {
    return { id, ok: false, problem: "invalid-request" };
  }
  const seed = whole(record["seed"]);
  if (seed === null || seed < 0 || seed > MAX_SEED) {
    return { id, ok: false, problem: "invalid-request" };
  }
  let state: unknown;
  try {
    state = normalizeBoardState(game, record["state"]);
  } catch {
    return { id, ok: false, problem: "unreadable-position" };
  }
  if (engine.outcome(state).status !== "in_progress") {
    return { id, ok: true, move: null, nodes: 0, depth: 0, cut: false, rng: seed };
  }
  // A dice game decides about the dice it was given: the page rolls first, and a
  // request that arrives before a roll is a caller's bug rather than a search to
  // run on a position nobody may move in.
  if (engine.needsRoll(state)) return { id, ok: false, problem: "must-roll" };
  const rng = createSeededRandom(seed);
  const choice = engine.bestMove(state, level, rng);
  return {
    id,
    ok: true,
    move: choice.move,
    nodes: choice.nodes,
    depth: choice.depth,
    cut: choice.cut,
    rng: rng.state,
  };
}

/** The requested game id, for a caller that wants to check before answering. */
export function requestedGame(request: unknown): BoardsGame | null {
  const game = asRecord(request)["game"];
  return isBoardsGame(game) ? game : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
