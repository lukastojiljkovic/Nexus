/**
 * Whether a module's OVERVIEW — the chart above its content — is expanded.
 *
 * **The defect this exists to close.** Four module landings opened with a stat
 * row, then a full-width chart, then a three-line caption and a legend, and
 * only then the thing the module is for. At 900x600 — the enforced floor — and
 * at 1120x720, the size the app actually opens at, NOTE showed no note, TASK
 * no task, UČENJE no subject and NAVIKE no habit. The screenshot audit had
 * photographed it every run since the bands were added and could not see it:
 * nothing is clipped, nothing escapes its parent, nothing overlaps, no target
 * is small. Every geometric rule passes on a page that is not showing its own
 * subject.
 *
 * So the chart folds, and the fold is CLOSED by default. That direction is the
 * whole fix: a disclosure that defaults open reproduces the defect for everyone
 * who never touches it, which is most people. What defaulting closed costs is
 * one click for the reader who wants the picture — and this file is what makes
 * that click last, so it is one click ever rather than one per visit.
 *
 * FOKUS is the surface that was already right and is left alone: its start
 * card is first, its figures second, its chart last. It is the proof that the
 * rule being enforced here is the app's own and not an import.
 *
 * **One file, four keys, on the `notePrefs.ts` recipe** (`localStorage`, a safe
 * fallback for anything unrecognised, no IPC — it describes how this machine
 * draws a page, not what the profile contains). One file rather than a copy of
 * the same reader in each module's own prefs, because four booleans with one
 * meaning are one preference with four subjects; four copies would be DC-02
 * before the ink was dry.
 *
 * THREE of the four are forgotten by their module's „Vrati na podrazumevano“
 * (SET §5), each taking its OWN key and only its own — the fold is device
 * state, and a card that reset a module while leaving it standing would be
 * lying. UČENJE has no such link and must not grow one: its settings card
 * holds three PROFILE values, so `isDeviceOnlyPanel` refuses it and the
 * promise that a reset touches only this device cannot be made over three
 * settings that live in the profile. The fold is set and unset by its own
 * control on the page instead, which is in view and one click away.
 */

/** The four landings that open with a chart above their content. */
export type OverviewModule = "notes" | "tasks" | "habits" | "study";

export const OVERVIEW_MODULES: readonly OverviewModule[] = [
  "notes",
  "tasks",
  "habits",
  "study",
];

const keyFor = (module: OverviewModule): string => `nexus.${module}.overview`;

/**
 * Closed unless this machine has been told otherwise, and ONLY the exact opt-in
 * string opens it: a corrupt value, a hand-edited one and the very common
 * „nothing stored yet" all mean closed. A fallback that guessed open would put
 * the defect back for exactly the users whose storage is in an unknown state.
 */
export function readStoredOverviewOpen(module: OverviewModule): boolean {
  return localStorage.getItem(keyFor(module)) === "open";
}

export function persistOverviewOpen(module: OverviewModule, open: boolean): void {
  localStorage.setItem(keyFor(module), open ? "open" : "closed");
}

/** Forgets one module's choice — its own „Vrati na podrazumevano", never a sweep. */
export function clearStoredOverviewOpen(module: OverviewModule): void {
  localStorage.removeItem(keyFor(module));
}
