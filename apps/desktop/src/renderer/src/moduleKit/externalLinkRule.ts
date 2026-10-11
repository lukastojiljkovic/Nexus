import { openExternal } from "../links.js";

/**
 * The rule behind the kit's `ExternalLink` (ADR-107), as three lines that can be
 * tested without a DOM.
 *
 * **Why the decision is not in the component.** A kit module draws links on
 * pages the shell never renders itself, so the ONE thing that has to be true of
 * every one of them — the address goes out through the app's one channel, and an
 * address main refuses is not opened — is a rule rather than a habit. A
 * component cannot be unit-tested here (there is no DOM library in this
 * repository) and a rule inside one is therefore checked by nothing until the
 * screenshot sweep, which cannot see a link that refused to open.
 *
 * **What a refusal IS.** `window.nexus.openExternal` carries the address to
 * main, which applies `allowsExternalUrl` (https only, no credentials, bounded)
 * and answers `false` when it will not open it. That answer is the whole
 * evidence the renderer has, and it is the honest one: a scheme allowlist copied
 * into the renderer would be a second opinion about a security rule, and the
 * second one is always the one that drifts.
 */

/** What pressing a link produced. */
export type ExternalLinkOutcome =
  /** The OS was handed the address: the user's browser is opening it. */
  | "opened"
  /** The rule in main refused it, so nothing was opened and nothing will be. */
  | "refused"
  /** The channel itself failed — a wiring bug, not a decision about the address. */
  | "channel-failed";

/**
 * The address as a control labels it: its HOST, which is the part a person reads
 * to decide whether to press it, or the string as it came when it does not parse
 * (a pack with a strange address must not stop a page from drawing that row).
 */
export function externalLinkLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** What the control IS once a press has been answered. */
export type ExternalLinkState =
  /** A control that can be pressed again: the address opened, or the channel itself failed. */
  | "control"
  /** The address itself, as selectable text, because main refused to open it. */
  | "address";

/**
 * Which of the two the control is after `outcome`.
 *
 * `ExternalLink` reads this rather than comparing outcomes itself, so the one
 * thing the component decides — a refusal makes the control inert and a channel
 * failure does not — is a line this suite can pin without a DOM.
 */
export function linkStateAfter(outcome: ExternalLinkOutcome): ExternalLinkState {
  return outcome === "refused" ? "address" : "control";
}

/**
 * Follows one link and says what happened.
 *
 * `open` is injected so the rule can be driven from a test; in the app it is the
 * renderer's one door to `external:open` (`../links.js`).
 *
 * A rejection is NOT a refusal: "the address may not be opened" and "the channel
 * is broken" are different facts, and a component that painted the second as the
 * first would hide a wiring bug behind an inert address.
 */
export async function followExternalLink(
  url: string,
  open: (url: string) => Promise<boolean> = openExternal,
): Promise<ExternalLinkOutcome> {
  try {
    return (await open(url)) ? "opened" : "refused";
  } catch (error) {
    console.error("Nexus: the external-link channel did not answer:", error);
    return "channel-failed";
  }
}
