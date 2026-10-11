import { isCardGameId, isCardOpponentLevel } from "@nexus/core";
import type { CardGameId, CardOpponentLevel } from "@nexus/core";
import { computerMove, hasMovesLeft, isFinished } from "../rules.js";
import type { CardSession } from "../rules.js";

/**
 * The card games' AI worker protocol (ADR-090 stage 2) — one request, one answer,
 * and no state shared with the page.
 *
 * **Why a worker at all, measured rather than assumed.** Hearts at `hard` averages
 * twelve determinizations of the unseen cards per move. The probe run for this
 * module timed one such move at 4.6 ms worst case and a full game's worth of them
 * (660 calls) at 88 ms, with Spades at 1.4/179 ms and Tablić at 1.9/83 ms. A few
 * milliseconds inside one frame is survivable; hundreds of them, on the thread that
 * draws the table, is a window that stops responding — so the choice is made off the
 * UI thread and the page shows that the computer is thinking.
 *
 * **Why the protocol is a PURE function and the worker is a shell.** A worker's
 * `onmessage` cannot be tested without a worker, so the whole of the protocol —
 * what a request must look like, what it answers, what it refuses — is
 * `answerMoveRequest`, a plain function of a plain value. `ai.worker.ts` is three
 * lines that hand it the message and post the result back, and this file is what the
 * module's tests drive.
 *
 * **Every refusal is a token, not a sentence.** `problem` is a machine word the page
 * maps onto its own copy, which is the only place a user-facing sentence lives.
 */

/** Which game, how well, which position — and where the search's own stream starts. */
export interface AiMoveRequest {
  readonly id: number;
  readonly game: string;
  readonly level: string;
  readonly state: unknown;
  /** The stream the search shuffles with, derived per move — never the deal's own. */
  readonly seed: number;
}

/** Why a request was refused, as a token the page's copy names. */
export type AiProblem = "invalid-request" | "unreadable-position";

/** What one search answered: a move (or none, on a finished position) and what it cost. */
export type AiMoveAnswer =
  | {
      readonly id: number;
      readonly ok: true;
      readonly move: unknown | null;
    }
  | { readonly id: number; readonly ok: false; readonly problem: AiProblem };

/**
 * Answers one move request. Total: anything it cannot read comes back as a refusal
 * naming the reason rather than as a thrown error, because a worker that throws kills
 * the promise somebody is waiting on.
 */
export function answerMoveRequest(request: unknown): AiMoveAnswer {
  const record = asRecord(request);
  const id = whole(record["id"]);
  if (id === null) return { id: 0, ok: false, problem: "invalid-request" };
  const game: unknown = record["game"];
  if (!isCardGameId(game)) return { id, ok: false, problem: "invalid-request" };
  const level: unknown = record["level"];
  if (!isCardOpponentLevel(level)) return { id, ok: false, problem: "invalid-request" };
  const seed = whole(record["seed"]);
  if (seed === null || seed < 0 || seed > 0xffff_ffff) {
    return { id, ok: false, problem: "invalid-request" };
  }
  const state = record["state"];
  if (typeof state !== "object" || state === null) {
    return { id, ok: false, problem: "unreadable-position" };
  }
  // The rules the engine needs to be asked through: a position whose log does not
  // replay is not one to search, and a finished one has no move to answer with.
  const session = probeSession(game, state);
  if (session === null) return { id, ok: false, problem: "unreadable-position" };
  if (isFinished(session) || !hasMovesLeft(session)) {
    return { id, ok: true, move: null };
  }
  try {
    // The search is handed the POSITION, which is what the wire carried; the engines
    // are reached through the same `computerMove` the page calls, so there is one
    // reading of „what a position is" and it is `rules.ts`'s.
    return { id, ok: true, move: computerMove(game, level as CardOpponentLevel, state, seed) };
  } catch {
    return { id, ok: false, problem: "unreadable-position" };
  }
}

/**
 * The smallest session a question about „is this position over" needs.
 *
 * The worker is handed a POSITION, not a game in progress — the page keeps the seed
 * and the log — so this wraps the state in a session whose log is empty and whose
 * score is a placeholder. Every fact the worker reads (the legal moves, the win
 * test, the seat to act) is a function of the state alone, which is what makes the
 * wrapper honest rather than a shortcut.
 */
function probeSession(game: CardGameId, state: unknown): CardSession | null {
  if (typeof state !== "object" || state === null) return null;
  // Most engines carry their variant on the state; FreeCell has exactly one and does
  // not, so the vocabulary's own first entry is the answer there.
  const carried = (state as { variant?: unknown }).variant;
  return {
    game,
    variant: (typeof carried === "string" ? carried : "standard") as CardSession["variant"],
    seed: 0,
    state,
    log: [],
    score: 0,
    elapsedSeconds: 0,
    level: "medium",
    undo: [],
    anchoredAt: null,
  };
}

/** The requested game id, for a caller that wants to check before answering. */
export function requestedGame(request: unknown): CardGameId | null {
  const game = asRecord(request)["game"];
  return isCardGameId(game) ? game : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
