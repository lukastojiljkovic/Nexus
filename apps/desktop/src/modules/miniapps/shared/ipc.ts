import type { ScoreboardBoard, TallyCounter, TypingLayoutId } from "@nexus/core";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * MINI-APPS' contract: the channels it answers on, the payload each takes, and
 * the API its page calls - declared once, in its own folder (ADR-090).
 *
 * **One read, and six writes that each replace one tool's kept state.** The
 * module's whole surface is "what is kept" (`MiniappsView`), and every write
 * answers with the whole view for the reason the kit gives: the page then has
 * exactly one way to learn anything, and a local guess can never disagree with
 * main. The writes are per tool rather than one "save everything" op because a
 * page that sent its whole document back would be re-sending eight tool's worth
 * of state to change one, and main would have to trust a document it did not
 * build.
 *
 * **What is NOT on the wire.** Nothing about a tool's live session: the
 * metronome's click schedule, a typing run's keystrokes, a screen light's
 * current cast. Those are the page's own, and none of them is a fact the user
 * authored - which is exactly the line `main/imex.ts` draws for the archive too.
 */

/**
 * The module's tiles, in the order the grid draws them. A tile id is a KEY: it
 * ends up in the kept document's `lastApp` and in the page's own lookup tables,
 * so it never carries a diacritic and never changes when copy does.
 */
export const MINIAPPS_APP_IDS = [
  "metronome",
  "dice",
  "tally",
  "scoreboard",
  "typing",
  "dates",
  "worldclock",
  "screenlight",
  "qr",
] as const;

export type MiniappsAppId = (typeof MINIAPPS_APP_IDS)[number];

/** True for a string that names one of this build's tiles. What keeps a stored `lastApp` from a newer build from opening nothing. */
export function isMiniappsAppId(value: unknown): value is MiniappsAppId {
  return typeof value === "string" && (MINIAPPS_APP_IDS as readonly string[]).includes(value);
}

/** One remembered dice or pick result, as the page writes it out for the history list. */
export interface MiniappsDiceEntryView {
  readonly atMs: number;
  readonly label: string;
  readonly result: string;
}

/** One finished typing run. `accuracy` is a fraction in 0..1, `netWpm` words a minute. */
export interface MiniappsTypingRecordView {
  readonly layout: TypingLayoutId;
  readonly lessonId: string;
  readonly netWpm: number;
  readonly accuracy: number;
  readonly atMs: number;
}

/** The typing tutor's kept progress: what was drilled last, and the best runs. */
export interface MiniappsTypingProgressView {
  readonly layout: TypingLayoutId;
  readonly lessonId: string;
  readonly records: readonly MiniappsTypingRecordView[];
}

/** Everything one read of this module answers with, and what every write answers with too. */
export interface MiniappsView {
  /** The tile that was open last, or `null` for the grid. Unknown ids read as `null`. */
  readonly lastApp: MiniappsAppId | null;
  /** By the order the user keeps them in - a tally board is a column, not a sorted list. */
  readonly counters: readonly TallyCounter[];
  readonly scoreboard: ScoreboardBoard;
  readonly typing: MiniappsTypingProgressView;
  /** IANA zone ids, in the order the user picked them. */
  readonly cities: readonly string[];
  /** Newest first. */
  readonly diceHistory: readonly MiniappsDiceEntryView[];
}

interface ListPayload {
  profileId: string;
}

interface LastAppPayload {
  profileId: string;
  app: MiniappsAppId | null;
}

interface CountersPayload {
  profileId: string;
  counters: readonly TallyCounter[];
}

interface ScoreboardPayload {
  profileId: string;
  board: ScoreboardBoard;
}

interface TypingPayload {
  profileId: string;
  progress: MiniappsTypingProgressView;
}

interface CitiesPayload {
  profileId: string;
  cities: readonly string[];
}

interface HistoryPayload {
  profileId: string;
  history: readonly MiniappsDiceEntryView[];
}

/**
 * The declared ops, as a payload-to-result map. `ModuleApiOf` turns this into the
 * `nexus.modules.miniapps.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type MiniappsOps = {
  list: { request: ListPayload; response: MiniappsView };
  setLastApp: { request: LastAppPayload; response: MiniappsView };
  saveCounters: { request: CountersPayload; response: MiniappsView };
  saveScoreboard: { request: ScoreboardPayload; response: MiniappsView };
  saveTyping: { request: TypingPayload; response: MiniappsView };
  saveCities: { request: CitiesPayload; response: MiniappsView };
  saveDiceHistory: { request: HistoryPayload; response: MiniappsView };
};

/** This module's renderer API: one method per op, named after the op. */
export type MiniappsApi = ModuleApiOf<MiniappsOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the ONE name the kit's globs
 * agree on (`preload/moduleBridge.ts` throws at startup for a module whose
 * bridge is missing).
 */
export const contract = defineModuleContract<"miniapps", MiniappsOps>("miniapps", [
  "list",
  "setLastApp",
  "saveCounters",
  "saveScoreboard",
  "saveTyping",
  "saveCities",
  "saveDiceHistory",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.miniapps.list(...)` typed in this
 * module's own page without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    miniapps: MiniappsApi;
  }
}
