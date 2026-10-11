/**
 * The Stockfish pack, as the chess module's own opponent and analyst (ADR-094).
 *
 * **One session per game, and never more.** A UCI engine is started once and
 * answers many searches, but it also holds state — a hash table, a skill level,
 * the position — that belongs to one board. So a session here IS a game: it is
 * opened by the first search a game asks for, it is reused for every search that
 * game makes, and it is ended by the page when the game ends or the page closes
 * (`engineClose`, and `closeAll` at the session end). One process per move would
 * pay a 100 MB hash per move; one process for the whole app would let one game's
 * position and skill leak into another's.
 *
 * **What this file does NOT do.** It does not decide which level the pack plays —
 * `./stockfish.ts` does, from this module's own ladder and the engine's
 * advertised Elo range — and it does not decide anything about chess. It speaks
 * UCI through `main/tools/uci.ts`, which is the client ADR-094 built for exactly
 * this, and it maps what came back onto the three answers the page can use.
 *
 * **A refusal is an answer.** A missing pack, a pack whose engine died, and an
 * engine that broke the protocol all end as `{ outcome: "refused" }` with a code,
 * so the page draws a sentence in the language it is reading rather than a stack
 * trace. The one thing that throws is a payload the wire should never carry.
 *
 * **A mate score is not a centipawn score.** `info` reports `score cp N` or
 * `score mate N`, two different units, and the page shows a number of pawns; a
 * mate distance reported as `+2.00` would be a lie about what the engine said.
 * `score` is therefore answered only for a centipawn line, and `null` otherwise.
 */

import { UciEngine, UciError, type UciInfo } from "../../../main/tools/uci.js";
import type { ModuleToolsAccess } from "../../../main/moduleTools.js";
import { ModuleToolError } from "../../../main/moduleTools.js";
import type { ToolSession } from "../../../main/tools/run.js";
import {
  applyStrength,
  eloRangeOf,
  packStrength,
  STOCKFISH_PACK_ID,
  type PackStrength,
} from "./stockfish.js";

/** One search a game asks for. `game` is the page's own game key, and it is what a session is held under. */
export interface EngineMoveRequest {
  readonly game: string;
  readonly fen: string;
  readonly moves: readonly string[];
  readonly level: number;
}

/** What the page gets back. `none` is a position with no move in it, which is not an error. */
export type EngineMoveView =
  | {
      readonly outcome: "move";
      readonly move: string;
      /** The last iteration's depth, nodes and centipawn score, as the engine stated them. */
      readonly depth: number | null;
      readonly nodes: number | null;
      readonly score: number | null;
    }
  | { readonly outcome: "none" }
  | { readonly outcome: "refused"; readonly code: "no-pack" | "engine" };

export interface EngineMoveRefusal {
  readonly outcome: "refused";
  readonly code: "no-pack" | "engine";
}

/** The pack's searches, one session per game, plus the two ways a page ends one. */
export interface StockfishSessions {
  /** Plays one move for `request.game`, opening that game's session on first use. */
  move(request: EngineMoveRequest): Promise<EngineMoveView>;
  /** Ends one game's session, answering whether there was one. Safe to call for a game that never had one. */
  close(game: string): Promise<boolean>;
  /** Ends every session: the session end of a lock, a profile switch or a quit. */
  closeAll(): Promise<void>;
}

interface LiveEngine {
  readonly engine: UciEngine;
  /**
   * The strength applied to this process, so a second search at the same level
   * does not repeat the `setoption`s and `ucinewgame`.
   */
  applied: PackStrength | null;
  /** The promise chain that makes this session sequential: UCI carries no correlation id. */
  queue: Promise<unknown>;
}

export function createStockfishSessions(input: {
  readonly tools: ModuleToolsAccess;
}): StockfishSessions {
  const games = new Map<string, LiveEngine>();

  /** Opens this game's session, or refuses with the code the page can act on. */
  async function open(): Promise<LiveEngine | EngineMoveRefusal> {
    let session: ToolSession;
    try {
      session = await input.tools.session(STOCKFISH_PACK_ID, "uci");
    } catch (error) {
      // Both a missing pack and a pack that is not an engine mean the same thing
      // to a page: this level cannot be played by the pack. Anything else is a
      // bug in the wiring and keeps travelling.
      if (error instanceof ModuleToolError) return { outcome: "refused", code: "no-pack" };
      throw error;
    }
    try {
      const engine = await UciEngine.start({ session });
      return { engine, applied: null, queue: Promise.resolve() };
    } catch (error) {
      // A session that never handshook must not leave a working directory (or a
      // process the handshake's own kill missed) behind.
      await session.close();
      if (error instanceof UciError) return { outcome: "refused", code: "engine" };
      throw error;
    }
  }

  /**
   * Applies this level's strength to a session, once per (session, level).
   *
   * `ucinewgame` rides with the options rather than with every search: it is the
   * protocol's „the next position is unrelated to the last“, which is true once
   * per game and false between two moves of one. Sending it per move would clear
   * the engine's transposition table on every move, which is exactly the
   * strength the pack is installed for.
   */
  async function configure(live: LiveEngine, level: number): Promise<PackStrength> {
    const strength = packStrength(level, eloRangeOf(live.engine.options));
    if (live.applied?.elo === strength.elo && live.applied.depth === strength.depth) {
      return strength;
    }
    await applyStrength(live.engine, strength);
    await live.engine.newGame();
    live.applied = strength;
    return strength;
  }

  /** Ends one game's session, waiting for whatever it was doing first. */
  async function closeGame(game: string): Promise<boolean> {
    const live = games.get(game);
    if (live === undefined) return false;
    games.delete(game);
    // The queue is awaited before the session goes: a close that arrived while a
    // search was in flight must end the engine rather than race it.
    await live.queue.catch(() => undefined);
    // `quit` then `close`: the engine is asked to leave, and the working
    // directory is removed whether it did or whether the runner had to kill it.
    await live.engine.quit().catch(() => undefined);
    return true;
  }

  return {
    async move(request): Promise<EngineMoveView> {
      let live = games.get(request.game);
      if (live === undefined) {
        const opened = await open();
        if ("outcome" in opened) return opened;
        live = opened;
        games.set(request.game, live);
      }
      const current = live;
      // One request per session at a time, enforced HERE rather than by the
      // client's `busy` refusal: two searches for one game can only come from the
      // page asking twice, and the second is answered after the first rather than
      // refused at a user who pressed „new game“ twice.
      const run = current.queue.then(async (): Promise<EngineMoveView> => {
        try {
          const strength = await configure(current, request.level);
          current.engine.position({ fen: request.fen, moves: [...request.moves] });
          const result = await current.engine.go({
            depth: strength.depth,
            moveTimeMs: strength.timeMs,
          });
          return engineAnswer(result.bestmove, result.info);
        } catch (error) {
          // A session that failed a search is not trusted for the next one: the
          // engine ignored a limit or answered something that is not UCI, and the
          // page gets a refusal while the process is closed behind it.
          if (error instanceof UciError) {
            await closeGame(request.game);
            return { outcome: "refused", code: "engine" };
          }
          throw error;
        }
      });
      current.queue = run.catch(() => undefined);
      return await run;
    },

    async close(game): Promise<boolean> {
      return await closeGame(game);
    },

    async closeAll(): Promise<void> {
      for (const game of [...games.keys()]) await closeGame(game);
    },
  };
}

/**
 * The three answers the page can use, from what the engine said.
 *
 * `(none)` is the protocol's own word for „no move in this position“ (a mate or
 * a stalemate), and it is reported as such rather than as a move: every engine
 * that answers a finished position answers it this way, and a page that tried to
 * play it would be playing a string.
 *
 * Exported because it is the one decision in this file that is pure: a test can
 * hand it the engine's own lines and assert the three fields the page draws,
 * which is cheaper and more exact than arranging a process to produce them.
 */
export function engineAnswer(bestmove: string, info: readonly UciInfo[]): EngineMoveView {
  if (bestmove === "(none)") return { outcome: "none" };
  const last = info[info.length - 1];
  return {
    outcome: "move",
    move: bestmove,
    depth: last?.depth ?? null,
    nodes: last?.nodes ?? null,
    score: last?.score?.kind === "cp" ? last.score.value : null,
  };
}
