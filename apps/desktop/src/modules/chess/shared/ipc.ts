import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * CHESS' contract: the channels it answers on, the payload each one takes, and
 * the API its page calls — declared once, in its own folder (ADR-090).
 *
 * **`list` carries no PGN.** The games table holds a whole game per row, up to
 * `MAX_CHESS_PGN_LENGTH` characters each, so a read of every row for the list
 * would move megabytes over the wire to draw dates and results. The rows
 * therefore cross as summaries, and `getGame` fetches ONE game's PGN when the
 * page actually opens it — the one place this module departs from the kit's
 * „every read answers with the whole view" default, and for the reason that
 * default exists: the view here is genuinely too big to read whole.
 *
 * **Every mutation answers with the whole view**, as it does everywhere else, so
 * the page has exactly one way to update and a wrong local guess is impossible.
 *
 * **The game in progress is the renderer's to save.** `chess_resume` holds what
 * the user has played, and the store re-validates every write by REPLAYING the
 * move list — so the page may send its own moves and cannot send a position they
 * do not produce.
 */

/** Which side of the board a game was played from, as a FEN spells it. */
export type ChessSide = "w" | "b";
/** `engine` is this module's own opponent; `human` is two people on one machine. */
export type ChessOpponent = "engine" | "human";
/** The claim a finished game carries. `unfinished` is a game somebody stopped playing. */
export type ChessResult = "white" | "black" | "draw" | "unfinished";

/**
 * One saved game WITHOUT its PGN — what the list is drawn from. Declared here
 * rather than imported from `@nexus/db`, because no file under `shared/` may
 * reach a Node-only package; `main/register.ts` is the one mapping between the
 * two shapes, and the compiler is what keeps them in step.
 */
export interface ChessGameView {
  readonly id: string;
  /** When the game was played, as an ISO-8601 instant. */
  readonly playedAt: string;
  /** The colour the USER played. */
  readonly playedColor: ChessSide;
  readonly opponent: ChessOpponent;
  /** The engine level, 1..8, or null for a game against a person. */
  readonly level: number | null;
  /** A `base+increment` clock in seconds, or null when the game had no clock. */
  readonly timeControl: string | null;
  readonly result: ChessResult;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One saved game WITH its PGN — what `getGame` answers when a row is opened. */
export interface ChessGameDetailView extends ChessGameView {
  readonly pgn: string;
}

/**
 * The game in progress: the position it started from, the moves played, and the
 * position they produce. The store refuses a write where the third is not what
 * the first two say, so the page never has to doubt a resumption.
 */
export interface ChessResumeView {
  readonly startFen: string;
  readonly fen: string;
  /** The moves played so far, in UCI text, in order. */
  readonly moves: readonly string[];
  readonly playedColor: ChessSide;
  readonly opponent: ChessOpponent;
  readonly level: number | null;
  readonly timeControl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The player's record against one engine level. `played` is always `won + drawn + lost`. */
export interface ChessLevelStatsView {
  readonly level: number;
  readonly played: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly updatedAt: string | null;
}

/** Everything one read of this module answers with, and what every mutation answers with too. */
export interface ChessView {
  readonly resume: ChessResumeView | null;
  /** Newest first, the way the store orders them. */
  readonly games: readonly ChessGameView[];
  /** All eight levels, ascending, zero-filled. */
  readonly stats: readonly ChessLevelStatsView[];
  /**
   * The tool pack that plays the strongest levels, when one is installed
   * (ADR-094), or `null`.
   *
   * A pack is a signed folder the USER installs, and its licence and source have
   * to be shown wherever the engine is named (ADR-094 §5), so the page is handed
   * those facts rather than reading a manifest itself. `null` is not an error: it
   * is the profile this build has always been, with the module's own engine
   * playing every level.
   */
  readonly pack: ChessPackView | null;
}

/**
 * The installed engine pack, as the page needs it.
 *
 * `fromLevel` is the module's own decision about which levels the pack plays
 * (see `main/stockfish.ts`), sent as DATA so the level picker can mark them
 * without the page holding a second copy of the number. `catalogue` is a
 * pointer at the app's own Packs card, in the shape the drawings module already
 * sends: a kit page has no navigation of its own, so the surface that can act on
 * the pointer is named rather than a URL invented.
 */
export interface ChessPackView {
  readonly id: string;
  readonly version: string;
  readonly title: { readonly sr: string; readonly en: string };
  readonly licence: {
    readonly spdx: string;
    readonly attribution: string;
    readonly url: string;
  };
  readonly source: { readonly name: string; readonly url: string };
  /** The first level the pack plays; every level at or above it needs the pack to be at its strength. */
  readonly fromLevel: number;
  readonly catalogue: string;
}

interface ListPayload {
  profileId: string;
}

interface RowPayload {
  profileId: string;
  id: string;
}

/** Saving a finished — or abandoned — game. The PGN is built by the page, with its tags, and validated by the store. */
interface SaveGamePayload {
  profileId: string;
  pgn: string;
  result: ChessResult;
  playedAt: string;
  playedColor: ChessSide;
  opponent: ChessOpponent;
  level: number | null;
  timeControl: string | null;
}

/** Writing the game in progress. The store replays `moves` on `startFen` and refuses a `fen` they do not produce. */
interface ResumePayload {
  profileId: string;
  startFen: string;
  fen: string;
  moves: readonly string[];
  playedColor: ChessSide;
  opponent: ChessOpponent;
  level: number | null;
  timeControl: string | null;
}

/**
 * One search for an installed engine pack (ADR-094).
 *
 * **No profile id, and that is not an oversight.** Every other op in this module
 * carries one because every other op opens the profile's store; a search writes
 * nothing and reads nothing, and the pack is a folder on this machine rather than
 * a profile's data. So the payload is the position and the level, and the store is
 * never reached.
 *
 * **`game` is a page-chosen key, not a row id.** It names the session on the
 * MAIN side — one UCI process per game — so `engineClose` can end the right one
 * when a game ends or the page closes. It is validated as an id, because it is a
 * string the renderer chose and it becomes a map key.
 */
interface EngineMovePayload {
  game: string;
  fen: string;
  moves: readonly string[];
  /** One of the levels the pack plays; the module's own engine plays the levels below it. */
  level: number;
}

/** Ends one game's engine session. Safe for a game that never started one. */
interface EngineClosePayload {
  game: string;
}

/** Why a level the pack was asked to play was not played. */
export type ChessEngineRefusal =
  /** No usable engine pack is installed. */
  | "no-pack"
  /** The pack's engine failed, or stopped speaking UCI. */
  | "engine";

/**
 * What a pack search answers: the move and the engine's own numbers, a position
 * with no move in it, or a refusal by code.
 *
 * `score` is centipawns and is `null` for anything that is not a `cp` line — a
 * mate is a distance, not a score, and a page that formatted one as pawns would
 * be inventing a number the engine did not state.
 */
export type ChessEngineMoveResult =
  | {
      readonly outcome: "move";
      readonly move: string;
      readonly depth: number | null;
      readonly nodes: number | null;
      readonly score: number | null;
    }
  | { readonly outcome: "none" }
  | { readonly outcome: "refused"; readonly code: ChessEngineRefusal };

/**
 * The half of `ChessEngineMoveResult` that is a game being played.
 *
 * Named for the page's own shape: a refusal is what it falls BACK from — to the
 * module's own engine, which is the product without a pack — so its request
 * helper answers this or `null`, and the compiler is what keeps a refusal from
 * reaching the board as a move.
 */
export type ChessEnginePlayed = Extract<
  ChessEngineMoveResult,
  { readonly outcome: "move" | "none" }
>;

/** What `engineClose` answers: whether a session was actually ended. */
export interface ChessEngineCloseResult {
  readonly closed: boolean;
}

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.chess.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type ChessOps = {
  list: { request: ListPayload; response: ChessView };
  getGame: { request: RowPayload; response: ChessGameDetailView | null };
  saveGame: { request: SaveGamePayload; response: ChessView };
  deleteGame: { request: RowPayload; response: ChessView };
  setResume: { request: ResumePayload; response: ChessView };
  clearResume: { request: ListPayload; response: ChessView };
  engineMove: { request: EngineMovePayload; response: ChessEngineMoveResult };
  engineClose: { request: EngineClosePayload; response: ChessEngineCloseResult };
};

/** This module's renderer API: one method per op, named after the op. */
export type ChessApi = ModuleApiOf<ChessOps>;

/** The contract the preload builds the bridge from and main refuses foreign ops against. */
export const contract = defineModuleContract<"chess", ChessOps>("chess", [
  "list",
  "getGame",
  "saveGame",
  "deleteGame",
  "setResume",
  "clearResume",
  "engineMove",
  "engineClose",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here, so
 * `window.nexus.modules.chess.list(…)` is typed in the page and the widget
 * without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    chess: ChessApi;
  }
}
