import type Database from "better-sqlite3-multiple-ciphers";
import {
  ChessNotFoundError,
  ChessStore,
  MAX_CHESS_LEVEL,
  MAX_CHESS_PGN_LENGTH,
  MAX_CHESS_RESUME_MOVES,
} from "@nexus/db";
import type { ResumableGame } from "@nexus/db";
import type { ModuleHostSurface, ModuleValidators } from "../../../main/moduleIpc.js";
import {
  contract,
  type ChessGameDetailView,
  type ChessGameView,
  type ChessLevelStatsView,
  type ChessOpponent,
  type ChessResult,
  type ChessResumeView,
  type ChessSide,
  type ChessView,
} from "../shared/ipc.js";
import { applyChessExport, buildChessExport, parseChessExport } from "./imex.js";

/**
 * CHESS in the main process (ADR-090): its handlers and its archive section.
 *
 * **Nothing about chess is decided here.** Legality, FEN, PGN and every draw are
 * `chess.js` through `@nexus/core`, wrapped by the STORE — which replays a saved
 * move list before it writes a resume slot and re-parses a PGN before it writes a
 * game. This file validates the wire (SEC-EL-02), maps the store's rows onto the
 * wire's own shapes, and reads back what it just wrote. The one place it could
 * have computed a chess fact — whether a move list produces a position — is
 * deliberately the store's, so the rule has one home.
 *
 * **Why the list read carries no PGN.** A stored game holds a whole game's PGN,
 * so the summary shapes here drop it; the page asks for one game at a time
 * through `getGame`, which is where a PGN is actually read.
 *
 * **Why there are no main-owned timers.** A clock in this module runs while a
 * game is being played, and a game being played is a page the user is looking at:
 * the countdown in TOOls that outlives its page has no counterpart here, and a
 * clock armed in main would keep running against a game nobody can see. The
 * stored clock is a FACT about the game (`timeControl`), never a running clock.
 */

/**
 * The longest `base+increment` text worth letting through the wire. The store's
 * own ceiling is `7200+300`, so this is twice the longest clock it accepts — a
 * bound on an untrusted string, not a rule about clocks (which is the store's).
 */
const MAX_TIME_CONTROL_LENGTH = 16;

const RESULTS: readonly ChessResult[] = ["white", "black", "draw", "unfinished"];
const OPPONENTS: readonly ChessOpponent[] = ["engine", "human"];
const SIDES: readonly ChessSide[] = ["w", "b"];

/** A move's own shape, as the store's `validateMoveList` spells it (which stays the authority on legality). */
const MOVE_TEXT = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function chessStore(bearer: StoreBearer, profileId: string): ChessStore {
    return bearer.profileDb(profileId, (db, id) => new ChessStore(db, id));
  }

  /**
   * The rows as the wire declares them. One mapping, so the store's shape and the
   * wire's cannot drift field by field: a column renamed in a migration is a
   * compile error here rather than `undefined` in the renderer.
   *
   * The two row readers differ in exactly one field — the PGN — and share one
   * implementation, so a change to the summary cannot leave the detail behind.
   */
  function gameOf(game: {
    id: string;
    playedAt: string;
    playedColor: ChessSide;
    opponent: ChessOpponent;
    level: number | null;
    timeControl: string | null;
    result: ChessResult;
    createdAt: string;
    updatedAt: string;
  }): ChessGameView {
    return {
      id: game.id,
      playedAt: game.playedAt,
      playedColor: game.playedColor,
      opponent: game.opponent,
      level: game.level,
      timeControl: game.timeControl,
      result: game.result,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
    };
  }

  function resumeOf(resume: ResumableGame | null): ChessResumeView | null {
    if (resume === null) return null;
    return {
      startFen: resume.startFen,
      fen: resume.fen,
      moves: [...resume.moves],
      playedColor: resume.playedColor,
      opponent: resume.opponent,
      level: resume.level,
      timeControl: resume.timeControl,
      createdAt: resume.createdAt,
      updatedAt: resume.updatedAt,
    };
  }

  function viewOf(bearer: StoreBearer, profileId: string): ChessView {
    const chess = chessStore(bearer, profileId);
    const stats: ChessLevelStatsView[] = chess.listLevelStats().map((entry) => ({
      level: entry.level,
      played: entry.played,
      won: entry.won,
      drawn: entry.drawn,
      lost: entry.lost,
      updatedAt: entry.updatedAt,
    }));
    return {
      resume: resumeOf(chess.getResume()),
      games: chess.listGames().map(gameOf),
      stats,
    };
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const raw = call.as.asRecord(payload);
    return viewOf(call, call.as.asId(raw["profileId"], "profileId"));
  });

  ctx.handle("getGame", (payload, call) => {
    const raw = call.as.asRecord(payload);
    const profileId = call.as.asId(raw["profileId"], "profileId");
    const id = call.as.asId(raw["id"], "id");
    try {
      const game = chessStore(call, profileId).getGame(id);
      const detail: ChessGameDetailView = { ...gameOf(game), pgn: game.pgn };
      return detail;
    } catch (error) {
      // A game that is not there is an ordinary answer rather than an error: the
      // row may have been deleted in another window between the read that drew
      // the list and the click that opened it. Anything else is a real failure
      // and keeps travelling.
      if (error instanceof ChessNotFoundError) return null;
      throw error;
    }
  });

  ctx.handle("saveGame", (payload, call) => {
    const raw = call.as.asRecord(payload);
    const profileId = call.as.asId(raw["profileId"], "profileId");
    chessStore(call, profileId).saveGame(
      {
        pgn: call.as.asCappedChars(
          call.as.asNonEmptyString(raw["pgn"], "pgn"),
          "pgn",
          MAX_CHESS_PGN_LENGTH,
        ),
        result: asEnum(raw["result"], "result", RESULTS),
        playedAt: call.as.asNonEmptyString(raw["playedAt"], "playedAt"),
        playedColor: asEnum(raw["playedColor"], "playedColor", SIDES),
        opponent: asEnum(raw["opponent"], "opponent", OPPONENTS),
        level: asLevel(call, raw["level"]),
        timeControl: asTimeControl(call, raw["timeControl"]),
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("deleteGame", (payload, call) => {
    const raw = call.as.asRecord(payload);
    const profileId = call.as.asId(raw["profileId"], "profileId");
    chessStore(call, profileId).deleteGame(call.as.asId(raw["id"], "id"), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("setResume", (payload, call) => {
    const raw = call.as.asRecord(payload);
    const profileId = call.as.asId(raw["profileId"], "profileId");
    chessStore(call, profileId).setResume(
      {
        startFen: call.as.asNonEmptyString(raw["startFen"], "startFen"),
        fen: call.as.asNonEmptyString(raw["fen"], "fen"),
        moves: asMoveList(call, raw["moves"]),
        playedColor: asEnum(raw["playedColor"], "playedColor", SIDES),
        opponent: asEnum(raw["opponent"], "opponent", OPPONENTS),
        level: asLevel(call, raw["level"]),
        timeControl: asTimeControl(call, raw["timeControl"]),
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("clearResume", (payload, call) => {
    const raw = call.as.asRecord(payload);
    const profileId = call.as.asId(raw["profileId"], "profileId");
    chessStore(call, profileId).clearResume();
    return viewOf(call, profileId);
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildChessExport(chessStore(session, profileId));
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload — the version first — and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseChessExport,
    // The writing half, once per profile the session names. `undefined` is an
    // archive that says nothing about chess, which for a restore that replaces a
    // profile whole means empty — no games, no game in progress, no ladder.
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        applyChessExport(chessStore(session, profileId), payload);
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 * An archive is written ONE profile at a time (`main/imex.ts`'s `handleExport`),
 * so answering `null` rather than guessing is what keeps a session that ever
 * named several from writing the first profile's games under somebody else's
 * name.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/**
 * The validator bag, as the kit hands it to a handler. Named here so the helpers
 * below take exactly what they use — and so the compiler checks every call
 * against `ipcValidators.ts` itself rather than against a description of it.
 */
type As = {
  readonly as: ModuleValidators;
};

/** One of a closed vocabulary, refused by name — the store checks the same list again (SEC-EL-02). */
function asEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

/** The engine level, or null for a game against a person — bounded exactly as the store's own range. */
function asLevel(call: As, value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return call.as.asBoundedInteger(value, "level", 1, MAX_CHESS_LEVEL);
}

/** A `base+increment` clock, or null. The SHAPE is the store's rule; the bound is what the wire owes it. */
function asTimeControl(call: As, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return call.as.asCappedChars(value, "timeControl", MAX_TIME_CONTROL_LENGTH);
}

/**
 * The saved move list, as an array of moves in the store's own range.
 *
 * The SHAPE of one move is checked here and its LEGALITY is not, which is the
 * split the store keeps: a list of well-formed moves that cannot be played is
 * refused by the replay, and a field that is not a move at all is refused at the
 * wire before it reaches a row.
 */
function asMoveList(call: As, value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid IPC payload: "moves" must be an array of moves.');
  }
  if (value.length > MAX_CHESS_RESUME_MOVES) {
    throw new Error(
      `Invalid IPC payload: "moves" must hold at most ${MAX_CHESS_RESUME_MOVES} moves.`,
    );
  }
  return value.map((move) => {
    const text = call.as.asCappedChars(move, "moves[]", 5).toLowerCase();
    if (!MOVE_TEXT.test(text)) {
      throw new Error(`Invalid IPC payload: "${String(move)}" is not a move.`);
    }
    return text;
  });
}
