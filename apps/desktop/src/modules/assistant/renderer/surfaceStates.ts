/**
 * THE PAGE'S STATE RULES, as pure values the page and its tests both read.
 *
 * **Why a state is a value and not a flag.** A page that drew a skeleton whenever
 * one of its reads was still unset could not tell "still loading" from "failed and
 * never will load" - the skeleton stayed up forever after a failure. Stating the
 * phases here, and deciding them from what was read, is what lets a failure draw
 * its own sentence and a way forward.
 */

import type { ModelTier } from "@nexus/core";
import { copy } from "./copy.js";

/** Where the page's first load stands. */
export type LoadPhase = "loading" | "failed" | "ready";

/** The page is ready once both reads answered; it has failed when one did not and nothing has answered since. */
export function loadPhase(loaded: { view: unknown; setup: unknown; failed: boolean }): LoadPhase {
  if (loaded.view !== null && loaded.setup !== null) return "ready";
  return loaded.failed ? "failed" : "loading";
}

/** An installed model, as the joins below read it. */
interface InstalledModel {
  readonly model: { readonly id: string; readonly capabilities: readonly string[] };
  readonly chosen: boolean;
}

/** The probe's picks, as the joins below read them; `null` until the probe has answered. */
interface Picks {
  readonly recommendations: readonly { readonly tier: ModelTier; readonly model: { readonly id: string } }[];
}

/** The tiers a model is the pick for on this machine, in the probe's order; none before the probe answers. */
export function servesTiers(probe: Picks | null, modelId: string): readonly ModelTier[] {
  return (probe?.recommendations ?? []).filter((pick) => pick.model.id === modelId).map((pick) => pick.tier);
}

/** Whether the disk has a pick. */
export function pickInstalled(installed: readonly InstalledModel[], modelId: string): boolean {
  return installed.some((entry) => entry.model.id === modelId);
}

/**
 * Whether a model can answer, so the page draws the chat rather than the setup
 * screen.
 *
 * A model the user chose answers whatever the probe says; otherwise the tier's
 * pick answers, and only the probe knows which that is. Until it answers, an
 * installed chat model is taken to be that pick, because it almost always is:
 * the page then draws the chat at once instead of flashing the setup screen at
 * everyone who has a model. When the probe says otherwise, the setup screen
 * comes up, which is the truth, and a turn sent in between waits for the same
 * probe in main before it picks a model.
 */
export function hasAnsweringModel(installed: readonly InstalledModel[], probe: Picks | null): boolean {
  if (installed.some((entry) => entry.chosen)) return true;
  if (probe === null) return installed.some((entry) => entry.model.capabilities.includes("chat"));
  return installed.some((entry) => servesTiers(probe, entry.model.id).length > 0);
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
