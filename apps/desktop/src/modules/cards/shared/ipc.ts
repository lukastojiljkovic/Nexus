import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * CARDS' contract (ADR-090): the channels it answers on, the payload each one
 * takes, and the API its page calls — declared once, in its own folder.
 *
 * **The game's vocabulary comes from `@nexus/core` and that is a decision, not a
 * shortcut.** A game id, a variant, a seed, an opponent level and a win test are
 * the ENGINES' words — the same nine ids and the same three levels the engines and
 * the store already speak — and a module that restated them here would be a second
 * spelling of a rule that already has one. `@nexus/db` stays out of this file: it
 * is SQLite and therefore Node-only, and the preload and the renderer share this
 * folder, so the store's shapes cross the wire as this file's own views.
 *
 * **The PAGE owns the live game, main owns the record.** A card is drawn the
 * moment it is played, from the position the page holds (`renderer/rules.ts`,
 * over the engines); `save` writes the seed, the move log and the clock, and the
 * STORE is what refuses a log its own engine will not fold. So the view every op
 * answers with is what main knows about DISK — the saved games and the record —
 * and never a second opinion about the table on screen.
 */

/**
 * One move as it crosses the wire.
 *
 * `kind` is the game's own discriminator (`draw`, `recycle`, `move`, `match`,
 * `play`, `turn`, `pass`, `collect`, `bid`), and the rest of the object is that
 * move's own fields — `asRecord` in `main/register.ts` is what keeps a payload
 * from carrying a shape the engine's `isXMove` would throw on. Tightening this to
 * the nine engines' moves is a shape the compiler would walk one branch at a time
 * for nothing: the store replays the list through the game's own engine either
 * way, which is the only check that decides whether a move is a move.
 */
export interface CardMoveView {
  readonly kind: string;
  readonly [field: string]: unknown;
}

/** One saved game as it crosses the wire: the deal, the log, and the clock. */
export interface CardsSaveView {
  readonly game: string;
  readonly variant: string;
  readonly seed: number;
  readonly moves: readonly CardMoveView[];
  /** The score the engine folds from the log — read by main, never sent by the page. */
  readonly score: number;
  readonly elapsedSeconds: number;
  readonly updatedAt: string;
}

/** One row of the record, per game and variant. */
export interface CardsStatView {
  readonly game: string;
  readonly variant: string;
  readonly played: number;
  readonly won: number;
  /** The best win, milliseconds, or null until the first win. */
  readonly bestTimeMs: number | null;
  /** The best result in the game's OWN direction, or null until the first win. */
  readonly bestScore: number | null;
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly updatedAt: string | null;
}

/** Everything one read of this module answers with, and what every mutation answers with too. */
export interface CardsView {
  readonly saves: readonly CardsSaveView[];
  /** Zero-filled over every game and variant, in the vocabulary's own order. */
  readonly stats: readonly CardsStatView[];
}

/** One read: whose view is being asked for. */
interface ListPayload {
  profileId: string;
}

/**
 * Saving the game in progress: the deal, the whole log, and how long it has been
 * played. The score is NOT here — main folds the log through the engine and that
 * is the number the store keeps, because the point of a log is that the position
 * is derived rather than trusted.
 */
interface SavePayload {
  profileId: string;
  game: string;
  variant: string;
  seed: number;
  moves: readonly unknown[];
  elapsedSeconds: number;
}

/**
 * Recording a finished deal: the same shape plus `won`.
 *
 * The `moves` are still carried, because the score has to be re-derived from the
 * engine, and `won` is the engine's own answer (`isXWon`) — a rule the page reads
 * and main has no way to recompute from the score alone.
 */
interface RecordPayload extends SavePayload {
  won: boolean;
}

/** One game and variant, for the two ops that name a slot rather than a log. */
interface SlotPayload {
  profileId: string;
  game: string;
  variant: string;
}

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.cards.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type CardsOps = {
  list: { request: ListPayload; response: CardsView };
  save: { request: SavePayload; response: CardsView };
  record: { request: RecordPayload; response: CardsView };
  clear: { request: SlotPayload; response: CardsView };
};

/** This module's renderer API: one method per op, named after the op. */
export type CardsApi = ModuleApiOf<CardsOps>;

/** The contract the preload builds the bridge from and main refuses foreign ops against. */
export const contract = defineModuleContract<"cards", CardsOps>("cards", [
  "list",
  "save",
  "record",
  "clear",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here, which
 * is what makes `nexus.modules.cards.list(...)` typed in this module's own page and
 * in the dashboard widget without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    cards: CardsApi;
  }
}
