import type {
  CalculatorAngleMode,
  CalculatorPrecision,
  CalculatorSession,
} from "@nexus/core";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * CALCULATOR's contract (ADR-090): the channels it answers on, the payload each
 * one takes, and the API its page calls - declared once, in its own folder.
 *
 * **The engine is NOT here.** Evaluation runs in the renderer's own Web Worker
 * (`renderer/engine.worker.ts`), because a typed expression is a program and a
 * program that does not finish must not be able to hold the UI thread: main
 * answers only about STORAGE - the history and the saved session - and never
 * evaluates anything. That is also why the renderer sends the session it has
 * just evaluated with; main validates it (`parseCalculatorSession`) and writes
 * it, and the store is what keeps the shape honest.
 *
 * **Why every mutation answers with the whole view.** The rows are a log of
 * text and the session is one JSON value; a full read is smaller than the
 * bookkeeping a per-op delta would need, and one result type means the page has
 * exactly one way to update - the same rule for every module, which is the point
 * of the kit.
 */

/**
 * One history row as it crosses the wire.
 *
 * `result` is what the engine SHOWED (`1.234,5`), and `value` is the same result
 * in mathjs's own lexical form (`1234.5`), which is what the page substitutes
 * for `#3` when somebody reuses a result by name. Both are here because they are
 * different things: the first is read, the second is re-parsed, and a page that
 * had only the first could not tell a Serbian decimal comma from a group
 * separator.
 */
export interface CalcHistoryEntryView {
  readonly id: string;
  readonly expression: string;
  readonly value: string;
  readonly result: string;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Everything one read of this module answers with, and what every mutation
 * answers with too.
 *
 * The session travels WITH the history because the two are read together on
 * every mount: the page needs the variables and functions to evaluate anything,
 * and `ans` is the previous result.
 */
export interface CalculatorView {
  /** Newest first, which is the order a log is read in and the order `#1` counts in. */
  readonly history: readonly CalcHistoryEntryView[];
  readonly session: CalculatorSession;
  /**
   * Whether the session above is the profile's OWN, or an empty one standing in
   * for a column that could not be read.
   *
   * The store reports a session it cannot parse rather than reading it as empty
   * (`CalculatorStore.getSession`), which is the right refusal at that layer and
   * would otherwise make this page unable to load at all - so the read catches
   * it, answers an empty session, and says so here. The page draws that as a
   * sentence with the way out (forget the variables) instead of losing the
   * history with it.
   */
  readonly sessionReadable: boolean;
  /**
   * The module's two preferences, as the page's switches and the settings card
   * read them.
   *
   * Declared here rather than imported from `@nexus/db` (where the ROW lives),
   * for the reason the row types above are: no file under `shared/` may reach
   * that package. The two unions ARE core's, because the engine is what owns the
   * closed sets - a third spelling of `deg`/`rad`/`grad` here would be a list
   * that agrees until the engine gains a mode.
   */
  readonly settings: CalculatorSettingsView;
}

/** The module's two preferences as they cross the wire. */
export interface CalculatorSettingsView {
  readonly angleMode: CalculatorAngleMode;
  readonly precision: CalculatorPrecision;
}

/** One read: whose view is being asked for. */
interface ListPayload {
  profileId: string;
}

/**
 * One committed evaluation: the expression as it was typed, the result in both
 * forms, and the session the engine produced for it.
 *
 * All four are validated in main - the three strings against the engine's and
 * the store's own bounds, and the session through core's
 * `parseCalculatorSession`, which is the same reader the store runs.
 */
interface CommitPayload {
  profileId: string;
  expression: string;
  value: string;
  result: string;
  session: unknown;
}

/** One history row of this module's table, by its own id. The store scopes it to the profile. */
interface RowPayload {
  profileId: string;
  id: string;
}

interface PinPayload {
  profileId: string;
  id: string;
  pinned: boolean;
}

/** Emptying the log, optionally leaving what the user pinned. */
interface ClearHistoryPayload {
  profileId: string;
  keepPinned: boolean;
}

/** Forgetting the variables, the user's own functions and `ans`, and nothing else. */
interface ForgetSessionPayload {
  profileId: string;
}

/** The angle unit the trig keys read their argument in. */
interface AngleModePayload {
  profileId: string;
  angleMode: CalculatorAngleMode;
}

/** Which arithmetic the engine runs. */
interface PrecisionPayload {
  profileId: string;
  precision: CalculatorPrecision;
}

type CalculatorOps = {
  list: { request: ListPayload; response: CalculatorView };
  commit: { request: CommitPayload; response: CalculatorView };
  setPinned: { request: PinPayload; response: CalculatorView };
  removeEntry: { request: RowPayload; response: CalculatorView };
  clearHistory: { request: ClearHistoryPayload; response: CalculatorView };
  clearSession: { request: ForgetSessionPayload; response: CalculatorView };
  setAngleMode: { request: AngleModePayload; response: CalculatorView };
  setPrecision: { request: PrecisionPayload; response: CalculatorView };
};

/** This module's renderer API: one method per op, named after the op. */
export type CalculatorApi = ModuleApiOf<CalculatorOps>;

/** The contract the preload builds the bridge from and main refuses foreign ops against. */
export const contract = defineModuleContract<"calculator", CalculatorOps>("calculator", [
  "list",
  "commit",
  "setPinned",
  "removeEntry",
  "clearHistory",
  "clearSession",
  "setAngleMode",
  "setPrecision",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here, so
 * `window.nexus.modules.calculator.list(...)` is typed in this module's page and
 * in its dashboard card without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    calculator: CalculatorApi;
  }
}
