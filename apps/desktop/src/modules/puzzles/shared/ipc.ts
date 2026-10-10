import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * PUZZLES' contract (ADR-090): the channels it answers on, the payload each one
 * takes, and the API its page calls — declared once, in its own folder.
 *
 * **Three processes read this file**, as the kit's worked example puts it: main
 * globs it through `main/moduleIpc.ts`'s registration glue, the preload through
 * `preload/moduleBridge.ts`, and the module's own page imports its types. None
 * of them lists a channel; `contract.channels` IS the allowlist.
 *
 * **Why every mutation answers with the whole view.** The rows here are a few
 * saved games, their records and one boolean. A full read of all of them is
 * smaller than the bookkeeping a per-op delta would need, and one result type
 * means the page has exactly one way to update — the same rule for every module,
 * which is the point of the kit.
 */

/**
 * The four puzzles, declared here rather than imported from `@nexus/db`.
 *
 * No file under `shared/` may reach that package: it is SQLite, and therefore
 * Node-only, while the renderer shares this file. The two lists are kept in step
 * by the compiler at the one place they meet — `main/register.ts`, which maps
 * the store's rows onto these views — and by a test that asks the store for its
 * own list.
 */
export type PuzzleId = "sudoku" | "nonogram" | "mahjong" | "broj";

/** A sudoku as the page plays it and as main stores it. */
export interface SudokuStateView {
  /** Eighty-one cells, row-major, `0` where the puzzle is empty — the givens. */
  readonly givens: readonly number[];
  /** What the player has entered: a digit or `null`, cell by cell. */
  readonly entries: readonly (number | null)[];
  /** Pencil marks per cell: digits ascending, empty where a digit stands. */
  readonly notes: readonly (readonly number[])[];
  readonly hintsUsed: number;
}

/** A nonogram: its board's size and one mark per cell. `0` untouched, `1` filled, `2` crossed. */
export interface NonogramStateView {
  readonly width: number;
  readonly height: number;
  readonly marks: readonly number[];
}

/** A mahjong board as it stands: the faces, what is left of them, and how often they have been dealt out again. */
export interface MahjongStateView {
  readonly faces: readonly string[];
  readonly remaining: readonly boolean[];
  readonly shuffles: number;
}

/** One Broj expression, as the page builds it with `renderer/broj.ts`'s parser. */
export type BrojExpressionView =
  | { readonly kind: "number"; readonly value: number }
  | {
      readonly kind: "operation";
      readonly operation: "+" | "-" | "*" | "/";
      readonly left: BrojExpressionView;
      readonly right: BrojExpressionView;
    };

/** A Broj round: the drawn pool, the target, and the expression the player has built. */
export interface BrojStateView {
  readonly numbers: readonly number[];
  readonly target: number;
  readonly expression: BrojExpressionView | null;
}

export type PuzzleStateView =
  | SudokuStateView
  | NonogramStateView
  | MahjongStateView
  | BrojStateView;

/**
 * One puzzle in progress as it crosses the wire.
 *
 * `state` is deliberately the union of the four shapes rather than one loose
 * object: the page narrows it the way the puzzle it asked for narrows it, and a
 * mistyped field is a compile error rather than `undefined` on a board. Main
 * re-reads it with the store's own per-puzzle reader (SEC-EL-02), so the union
 * here is the page's side of the same statement.
 */
export interface PuzzleSaveView {
  readonly puzzle: PuzzleId;
  /** The grade or board this game is played at — a key from the puzzle's own list. */
  readonly variant: string;
  readonly seed: number;
  readonly state: PuzzleStateView;
  readonly elapsedSeconds: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The record for one puzzle at one grade, or zero-filled for a grade nobody has played. */
export interface PuzzleStatsView {
  readonly puzzle: PuzzleId;
  readonly variant: string;
  readonly played: number;
  readonly solved: number;
  readonly bestTimeSeconds: number | null;
  /** Broj only: the closest a finished attempt came to the target. */
  readonly bestDistance: number | null;
  readonly updatedAt: string | null;
}

/** The module's one preference. */
export interface PuzzlesSettingsView {
  readonly checkWhileTyping: boolean;
}

/** Everything one read of this module answers with, and what every mutation answers with too. */
export interface PuzzlesView {
  readonly saves: readonly PuzzleSaveView[];
  readonly stats: readonly PuzzleStatsView[];
  readonly settings: PuzzlesSettingsView;
  /**
   * The grades each puzzle is played at, in the order the page offers them.
   *
   * Carried across the wire rather than declared here, because the STORE already
   * declares it (`PUZZLE_VARIANTS`, which its own reader validates against) and a
   * second list in the renderer would be a second vocabulary that agrees until
   * one of the two moves. The page draws its grade chips from this.
   */
  readonly variants: Readonly<Record<PuzzleId, readonly string[]>>;
}

/** One read: whose view is being asked for. */
interface ListPayload {
  profileId: string;
}

/** Writing the game in progress. `state` is read by the store's own per-puzzle reader before the row moves. */
interface SavePayload {
  profileId: string;
  puzzle: PuzzleId;
  variant: string;
  seed: number;
  state: PuzzleStateView;
  elapsedSeconds: number;
}

/** Dropping one game in progress: a new game starts the same way wherever there was one. */
interface ClearPayload {
  profileId: string;
  puzzle: PuzzleId;
  variant: string;
}

/**
 * Folding a finished game into the record. `distance` is Broj's own field and is
 * refused on any other puzzle, by the schema and by the store.
 */
interface FinishPayload {
  profileId: string;
  puzzle: PuzzleId;
  variant: string;
  solved: boolean;
  elapsedSeconds: number;
  distance?: number | null;
}

interface SettingsPayload {
  profileId: string;
  checkWhileTyping: boolean;
}

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.puzzles.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type PuzzlesOps = {
  list: { request: ListPayload; response: PuzzlesView };
  save: { request: SavePayload; response: PuzzlesView };
  clearSave: { request: ClearPayload; response: PuzzlesView };
  finish: { request: FinishPayload; response: PuzzlesView };
  setCheckWhileTyping: { request: SettingsPayload; response: PuzzlesView };
};

/** This module's renderer API: one method per op, named after the op. */
export type PuzzlesApi = ModuleApiOf<PuzzlesOps>;

/** The contract the preload builds its bridge from and main refuses foreign ops against. */
export const contract = defineModuleContract<"puzzles", PuzzlesOps>("puzzles", [
  "list",
  "save",
  "clearSave",
  "finish",
  "setCheckWhileTyping",
]);

/** The type-level half: this module's API joins `NexusApi.modules` from here. */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    puzzles: PuzzlesApi;
  }
}
