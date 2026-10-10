import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * TIMERS' contract: the channels it answers on, the payload each one takes, and
 * the API its page calls - declared once, in its own folder (ADR-090).
 *
 * **Three processes read this file.** Main globs it through
 * `main/moduleIpc.ts`'s registration glue, the preload through
 * `preload/moduleBridge.ts`, and the module's own page imports its types. None
 * of them lists a channel: `contract.channels` IS the allowlist, and the op
 * names are the channel names, which is what makes "every channel starts with
 * `timers:`" a property of the declaration rather than of anybody's care.
 *
 * **Why every mutation answers with the whole view.** The rows here are a
 * preset's name and duration and a countdown's two instants; a full read of all
 * of them is smaller than the bookkeeping a per-op delta would need, and one
 * result type means the page has exactly one way to update - the same rule for
 * every module, which is the point of the kit. It is also what keeps a wrong
 * local guess impossible: the page renders what main says, never what it hoped.
 */

/**
 * One saved countdown as it crosses the wire.
 *
 * Declared here rather than imported from `@nexus/db`, which is where the row
 * itself lives: no file under `shared/` may reach that package (it is SQLite and
 * therefore Node-only, and the renderer shares this file). The two shapes are
 * kept in step by `main/register.ts`, which is the only thing that maps one onto
 * the other - and by the compiler, since the store's row is what it maps FROM.
 */
export interface TimersPresetView {
  readonly id: string;
  readonly name: string;
  readonly durationSeconds: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One countdown as it crosses the wire: exactly one of `endsAt` and
 * `remainingSeconds` is set, and the STORE is what guarantees it (migration
 * 071's CHECK). The page never computes a state it then asks main to store -
 * `endsAt` is the fact, and every clock on screen is derived from it.
 */
export interface TimersCountdownView {
  readonly id: string;
  readonly label: string;
  readonly durationSeconds: number;
  /** The instant it ends, or `null` while paused. */
  readonly endsAt: string | null;
  /** Whole seconds still owed, or `null` while running. */
  readonly remainingSeconds: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The module's one preference, as the settings card and the page read it. */
export interface TimersSettingsView {
  readonly soundOnEnd: boolean;
}

/** Everything one read of this module answers with, and what every mutation answers with too (see the header). */
export interface TimersView {
  /** By name, the way a person reads them (`Intl.Collator(["sr-Latn", "sr"])`, in the store). */
  readonly presets: readonly TimersPresetView[];
  /** Running first, by the instant each ends; paused ones after, by name. */
  readonly countdowns: readonly TimersCountdownView[];
  readonly settings: TimersSettingsView;
}

/** One read: whose view is being asked for. */
interface ListPayload {
  profileId: string;
}

/** Saving a countdown as a named preset, or starting one: a label and a duration. */
interface CreatePayload {
  profileId: string;
  name: string;
  durationSeconds: number;
}

/** One row of this module's tables, by its own id. The store scopes it to the profile. */
interface RowPayload {
  profileId: string;
  id: string;
}

interface RenamePayload {
  profileId: string;
  id: string;
  name: string;
}

/** The „+1 min" button: the one write whose amount is not the row's own duration. */
interface ExtendPayload {
  profileId: string;
  id: string;
  seconds: number;
}

interface SoundPayload {
  profileId: string;
  soundOnEnd: boolean;
}

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.timers.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type TimersOps = {
  list: { request: ListPayload; response: TimersView };
  createPreset: { request: CreatePayload; response: TimersView };
  renamePreset: { request: RenamePayload; response: TimersView };
  removePreset: { request: RowPayload; response: TimersView };
  createCountdown: { request: CreatePayload; response: TimersView };
  pauseCountdown: { request: RowPayload; response: TimersView };
  resumeCountdown: { request: RowPayload; response: TimersView };
  extendCountdown: { request: ExtendPayload; response: TimersView };
  cancelCountdown: { request: RowPayload; response: TimersView };
  setSoundOnEnd: { request: SoundPayload; response: TimersView };
};

/** This module's renderer API: one method per op, named after the op. */
export type TimersApi = ModuleApiOf<TimersOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the ONE name the kit's globs
 * agree on: `preload/moduleBridge.ts` reads `module.contract` from every
 * `modules/*&#47;shared/ipc.ts` and throws, at startup, for a file that exports
 * none - so a module whose bridge is missing fails loudly instead of becoming a
 * `TypeError` on the first click.
 */
export const contract = defineModuleContract<"timers", TimersOps>("timers", [
  "list",
  "createPreset",
  "renamePreset",
  "removePreset",
  "createCountdown",
  "pauseCountdown",
  "resumeCountdown",
  "extendCountdown",
  "cancelCountdown",
  "setSoundOnEnd",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.timers.list(...)` typed in this
 * module's own page, in the dashboard widget and in the settings card without a
 * line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    timers: TimersApi;
  }
}
