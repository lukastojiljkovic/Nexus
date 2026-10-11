import type Database from "better-sqlite3-multiple-ciphers";
import { MAX_BOARDS_EVENTS, MAX_BOARDS_SEED, BoardsStore } from "@nexus/db";
import type { BoardEnding } from "@nexus/db";
import { boardEngine, isBoardsGame } from "@nexus/core";
import type { BoardsGame } from "@nexus/core";
import type { ModuleHostSurface, ModuleValidators } from "../../../main/moduleIpc.js";
import { contract, type BoardsSaveView, type BoardsStatsView, type BoardsView } from "../shared/ipc.js";
import { buildBoardsExport, parseBoardsExport } from "./imex.js";

/**
 * BOARDS in the main process (ADR-090): its handlers and its archive section.
 *
 * **Nothing here computes a rule.** What a legal move is, who has won, whether the
 * log produces the position, and how a level counts for the person at the machine
 * are `BoardsStore`'s — which reads them off the six engines in `@nexus/core` —
 * and the AI search runs in the page's worker, never in main. This file's whole job
 * is the wire: validate the payload (SEC-EL-02), call the store, answer with the
 * one view every op answers with.
 *
 * **Why there is no scheduler and no session hook.** The timers module arms clocks
 * in main because a countdown outlives the page; a board game does not — its
 * position is written after every move and read back when somebody opens the page
 * again, so there is nothing for main to keep running between calls. A module that
 * armed something here would be a module burning a wakeup per game for nothing.
 *
 * **The page owns the live game, main owns the record.** A move is drawn the
 * moment it is played from the position the page holds; `save` writes that
 * position and the log that produced it, and refuses the pair when they disagree.
 * So the view this file answers with is what main knows about DISK — the saved
 * games, the record, the preference — and never a second opinion about the
 * position on screen.
 */

/** The message every array-shaped refusal carries, on the compiled-in handlers' terms. */
function asArrayOf(value: unknown, field: string, maxItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of at most ${maxItems} items.`,
    );
  }
  return value;
}

/** Something that can open this module's store for a profile: a handler's `ModuleCall` or a session. */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function boardsStore(bearer: StoreBearer, profileId: string): BoardsStore {
    return bearer.profileDb(profileId, (db, id) => new BoardsStore(db, id));
  }

  /**
   * The rows as the wire declares them. One mapping, so the store's shape and the
   * wire's cannot drift apart field by field: a column renamed in a migration is a
   * compile error here rather than `undefined` in the renderer.
   */
  function viewOf(bearer: StoreBearer, profileId: string): BoardsView {
    const boards = boardsStore(bearer, profileId);
    const saves: BoardsSaveView[] = boards.listSaves().map((save) => ({
      game: save.game,
      state: save.state,
      events: save.events,
      seed: save.seed,
      level: save.level,
      seats: save.seats,
      moves: save.moves,
      startedAt: save.startedAt,
      updatedAt: save.updatedAt,
    }));
    const stats: BoardsStatsView[] = boards.listStats().map((row) => ({
      game: row.game,
      variant: row.variant,
      level: row.level,
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      updatedAt: row.updatedAt,
    }));
    return { saves, stats, settings: boards.settings() };
  }

  /**
   * One game off the wire, in the shape the store takes.
   *
   * The checks here are the WIRE's: a game id this build knows, a position that is
   * an object rather than a string or a number, a log that is an array within its
   * bound, a seed within the generator's own width, a level that is an integer or
   * an explicit null, seats that are not a nested structure. Everything a value
   * MEANS — whether the log really produces the position, whether the level fits
   * the seats, whether the dice are the dice — is the store's, which is where the
   * engines are.
   */
  function readSave(
    as: ModuleValidators,
    game: BoardsGame,
    payload: {
      state: unknown;
      events: unknown;
      seed: unknown;
      level: unknown;
      seats: unknown;
    },
  ) {
    return {
      game,
      state: as.asRecord(payload.state),
      events: asArrayOf(payload.events, "events", MAX_BOARDS_EVENTS),
      seed: as.asBoundedInteger(payload.seed, "seed", 0, MAX_BOARDS_SEED),
      level:
        payload.level === null || payload.level === undefined
          ? null
          : // The engine's own number of levels, never a literal here: an engine
            // that grew a fourth rung must not need this line edited.
            as.asBoundedInteger(payload.level, "level", 1, boardEngine(game).levels),
      seats: asArrayOf(payload.seats, "seats", 4),
    };
  }

  /** A game id off the wire, or a refusal that names the field. */
  function asGame(as: ModuleValidators, value: unknown): BoardsGame {
    const game = as.asString(value, "game");
    if (!isBoardsGame(game)) {
      throw new Error('Invalid IPC payload: "game" is not one of this module\'s games.');
    }
    return game;
  }

  /**
   * How a match ended, off the wire. A closed set is checked here and MEANING is
   * the store's: whether the position is really over is a question only the
   * engines answer, and `BoardsStore` asks them.
   */
  function asEnding(value: unknown): BoardEnding {
    if (
      value === "position" ||
      value === "resigned" ||
      value === "cube-declined" ||
      value === "abandoned"
    ) {
      return value;
    }
    throw new Error(`Invalid IPC payload: "${String(value)}" is not a way a game ends.`);
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("save", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const game = asGame(call.as, payload.game);
    boardsStore(call, profileId).save(readSave(call.as, game, payload), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("remove", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    boardsStore(call, profileId).remove(asGame(call.as, payload.game));
    return viewOf(call, profileId);
  });

  ctx.handle("finish", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const game = asGame(call.as, payload.game);
    boardsStore(call, profileId).finish(
      { ...readSave(call.as, game, payload), ending: asEnding(payload.ending) },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("setDefaultLevel", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    boardsStore(call, profileId).setDefaultLevel(
      call.as.asBoundedInteger(payload.level, "level", 1, 3),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildBoardsExport(boardsStore(session, profileId));
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first - and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseBoardsExport,
    // The writing half. `undefined` is an archive that says nothing about board
    // games, which for a restore that replaces a profile whole means empty: no
    // saved games, no record and no preference row, so the profile answers the
    // store's own default rather than a number restated here.
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        const boards = boardsStore(session, profileId);
        if (payload === undefined) {
          boards.importData({ version: 1, saves: [], stats: [], settings: null });
          continue;
        }
        boards.importData(payload);
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several —
 * the timers rule, for its reason: an archive is written ONE profile at a time, so
 * "several" is not a shape the exporter meets, and answering `null` rather than
 * guessing keeps that true.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}
