import type { BoardEvent, BoardSeatKind, BoardsGame } from "@nexus/core";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * BOARDS' contract (ADR-090): the channels it answers on, the payload each one
 * takes, and the API its page calls — declared once, in its own folder.
 *
 * **The types come from `@nexus/core` and that is a decision, not a shortcut.**
 * A game's event log and its position are the ENGINES' vocabulary — the same
 * `BoardEvent` and the same game ids the six engines and their protocol speak —
 * and a module that restated them here would be a second spelling of a rule that
 * already has one. `@nexus/db` stays out of this file (it is SQLite and therefore
 * Node-only, and the preload and the renderer share this folder); `@nexus/core`
 * is the package both halves already depend on.
 *
 * **Why every mutation answers with the whole view.** A profile's board games are
 * at most six saved games, one record row per level and one preference: a full
 * read of all of it is smaller than the bookkeeping a per-op delta would need, and
 * one result type means the page has exactly one way to update — the same rule for
 * every module, which is the point of the kit. The PAGE's own live game is not in
 * this view: it holds its own session, because a move is drawn before it is
 * stored, and the view is what main says about what is on disk.
 */

/** One game in progress as it crosses the wire. */
export interface BoardsSaveView {
  readonly game: BoardsGame;
  /** The engine's canonical JSON, exactly as the store holds it. */
  readonly state: unknown;
  readonly events: readonly BoardEvent[];
  readonly seed: number;
  readonly level: number | null;
  readonly seats: readonly BoardSeatKind[];
  readonly moves: number;
  readonly startedAt: string;
  readonly updatedAt: string;
}

/** One row of the record against the computer. */
export interface BoardsStatsView {
  readonly game: BoardsGame;
  /** `""` for a game without variants; `english`/`russian` for draughts. */
  readonly variant: string;
  readonly level: number;
  readonly played: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly updatedAt: string | null;
}

/** The module's one preference, as the settings card and the page read it. */
export interface BoardsSettingsView {
  readonly defaultLevel: number;
}

/** Everything one read of this module answers with, and what every mutation answers with too. */
export interface BoardsView {
  /** Most recently played first. */
  readonly saves: readonly BoardsSaveView[];
  /** Zero-filled over every game and level, in the module's own order. */
  readonly stats: readonly BoardsStatsView[];
  readonly settings: BoardsSettingsView;
}

/** One read: whose view is being asked for. */
interface ListPayload {
  profileId: string;
}

/**
 * One game as the page writes it: the position it is in, the log that produced
 * it, the seed the dice come out of, who plays each seat and the level.
 *
 * The store is what decides whether the log really produces the position (it
 * replays it through the engines) and whether the level belongs to these seats —
 * the wire carries the shape, main carries the rules.
 */
interface SavePayload {
  profileId: string;
  game: string;
  state: unknown;
  events: readonly unknown[];
  seed: number;
  level: number | null;
  seats: readonly unknown[];
}

/** Ending a game: the same shape, plus how the MATCH ended rather than how the position stands. */
interface FinishPayload extends SavePayload {
  ending: string;
}

/** One game in progress, by its own game id. */
interface GamePayload {
  profileId: string;
  game: string;
}

/** The level a new game opens at. */
interface LevelPayload {
  profileId: string;
  level: number;
}

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.boards.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type BoardsOps = {
  list: { request: ListPayload; response: BoardsView };
  save: { request: SavePayload; response: BoardsView };
  remove: { request: GamePayload; response: BoardsView };
  finish: { request: FinishPayload; response: BoardsView };
  setDefaultLevel: { request: LevelPayload; response: BoardsView };
};

/** This module's renderer API: one method per op, named after the op. */
export type BoardsApi = ModuleApiOf<BoardsOps>;

/** The contract the preload builds the bridge from and main refuses foreign ops against. */
export const contract = defineModuleContract<"boards", BoardsOps>("boards", [
  "list",
  "save",
  "remove",
  "finish",
  "setDefaultLevel",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here, which
 * is what makes `nexus.modules.boards.list(...)` typed in this module's own page,
 * in the dashboard widget and in the settings card without a line in
 * `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    boards: BoardsApi;
  }
}
