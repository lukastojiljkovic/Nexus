/**
 * THE PAGE'S STATE RULES, as pure values the page and its tests both read.
 *
 * **Why a state is a value and not a flag.** A page that drew a skeleton whenever
 * one of its reads was still unset could not tell "still loading" from "failed and
 * never will load" - the skeleton stayed up forever after a failure. Stating the
 * phases here, and deciding them from what was read, is what lets a failure draw
 * its own sentence and a way forward.
 */

import { copy } from "./copy.js";

/** Where the page's first load stands. */
export type LoadPhase = "loading" | "failed" | "ready";

/** The page is ready once both reads answered; it has failed when one did not and nothing has answered since. */
export function loadPhase(loaded: { view: unknown; setup: unknown; failed: boolean }): LoadPhase {
  if (loaded.view !== null && loaded.setup !== null) return "ready";
  return loaded.failed ? "failed" : "loading";
}

/** What a parked tool's permission asks the user to notice: the app, a page, or the internet. */
export type ConfirmEffect = "write" | "navigate" | "network";

/** The effect's chip and the sentence under it, in the user's language. */
export function effectCopy(effect: ConfirmEffect): { readonly chip: string; readonly note: string } {
  return copy.confirm.effects[effect];
}

/** Whether web search is on, and whether this launch's network mode lets it act. */
export type WebStatus = "on" | "off" | "blocked";

/** A consent that is on but blocked by the network mode says so: the question would not leave the machine, and the reader should know why. */
export function webStatus(webSearch: { readonly enabled: boolean; readonly modeAllows: boolean }): WebStatus {
  if (!webSearch.enabled) return "off";
  return webSearch.modeAllows ? "on" : "blocked";
}
