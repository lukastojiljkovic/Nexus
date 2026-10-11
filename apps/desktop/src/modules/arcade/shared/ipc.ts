import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * ARCADE's contract (ADR-090): the two channels its page answers on, the payload
 * each takes, and the API the page calls.
 *
 * **Two ops, and the shape of the second one is the design.** A game's whole
 * interaction with main is "these are my rows" and "fold this finished game in":
 * nothing about a game in progress crosses the wire, because a game in progress
 * is a value this page holds and rebuilds from a seed and an input log. So a
 * mutation here is a RESULT and never a move, which is also what keeps the
 * renderer from being able to write a score it did not play for.
 *
 * **The variant is NOT on the wire.** The store's row is keyed by the BOARD, and
 * `@nexus/core` is what derives a Minesweeper board's key from its dimensions;
 * a renderer that sent its own bucket name could file a beginner time under the
 * expert board and no validator could tell. So the payload carries the board's
 * own numbers and `main/register.ts` derives the key from them, exactly as
 * `minesweeperVariant` documents.
 */

/** The five games this module ships, in the order the shelf draws them. */
export const ARCADE_GAME_IDS = ["minesweeper", "blocks", "snake", "bricks", "tile2048"] as const;
export type ArcadeGameId = (typeof ARCADE_GAME_IDS)[number];

/**
 * One board's running total as the shelf reads it.
 *
 * Declared here rather than imported from `@nexus/db`, which is where the row
 * lives: no file under `shared/` may reach that package (it is SQLite and
 * therefore Node-only, and the renderer shares this folder). The two shapes are
 * kept in step by `main/register.ts`, the only thing that maps one onto the
 * other - and by the compiler, since the store's row is what it maps FROM.
 *
 * `bestCount` is the store's `bestLines` under the name the wire can honestly
 * use: the column holds each game's own second count (lines for Blocks, food
 * for Snake, levels for Bricks, moves for 2048) and every screen labels it with
 * the game it belongs to. The primitive has one column, so one name here is
 * better than five fields of which four are always null.
 */
export interface ArcadeScoreView {
  readonly game: ArcadeGameId;
  /** The board: a Minesweeper preset's own name or `custom:CxRxM`, a 2048 board's `4x4`, and `standard` for the three games the engine gives one board. */
  readonly variant: string;
  readonly played: number;
  readonly won: number;
  readonly bestTimeMs: number | null;
  readonly bestScore: number | null;
  readonly bestCount: number | null;
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly lastPlayedAt: string;
}

/** Everything a read answers with, and what a recorded game answers with too. */
export interface ArcadeView {
  /** One row per board this profile has finished a game of, ordered by game and then board (the store's own order). */
  readonly scores: readonly ArcadeScoreView[];
}

/**
 * One finished game, in the shape its own engine ends in.
 *
 * A union rather than one flat payload, for the store's own reason: a caller
 * cannot hand Blocks a `won` or 2048 a `timeMs`, so the two facts that only some
 * games have cannot be sent by the games that do not. The fields are the
 * engine's own names (`eaten`, `lines`, `levels`, `moves`), because a page that
 * read one game's number under another game's name would be a page that quietly
 * recorded the wrong thing.
 */
export type ArcadeResultPayload =
  | {
      readonly game: "minesweeper";
      readonly columns: number;
      readonly rows: number;
      readonly mines: number;
      readonly won: boolean;
      /** Milliseconds the game took; required by the store for a win and ignored for a loss. */
      readonly timeMs: number | null;
    }
  | { readonly game: "blocks"; readonly score: number; readonly lines: number }
  | { readonly game: "snake"; readonly score: number; readonly eaten: number }
  | { readonly game: "bricks"; readonly score: number; readonly levels: number }
  | {
      readonly game: "tile2048";
      /** The board's side: the engine builds 4, 5 and 6, and the page ships the first. */
      readonly size: number;
      readonly score: number;
      readonly moves: number;
      /** True once 2048 appeared, whether or not the play went on past it. */
      readonly won: boolean;
    };

/** One read: whose shelf is being asked for. */
interface ListPayload {
  profileId: string;
}

/** Folding one finished game into its board's row. */
interface RecordPayload {
  profileId: string;
  result: ArcadeResultPayload;
}

type ArcadeOps = {
  list: { request: ListPayload; response: ArcadeView };
  record: { request: RecordPayload; response: ArcadeView };
};

/** This module's renderer API: one method per op, named after the op. */
export type ArcadeApi = ModuleApiOf<ArcadeOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the one name the kit's globs
 * agree on.
 */
export const contract = defineModuleContract<"arcade", ArcadeOps>("arcade", ["list", "record"]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.arcade.list(...)` typed in this
 * module's own page without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    arcade: ArcadeApi;
  }
}
