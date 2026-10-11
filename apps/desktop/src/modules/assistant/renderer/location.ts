import type { AppLocation } from "@nexus/core";

/**
 * THE ONE WAY A KIT MODULE ASKS THE SHELL TO SHOW A PLACE (ADR-106).
 *
 * **Why this exists.** A citation the assistant draws names where its answer came
 * from, and the point of the whole feature is that clicking one TAKES the user
 * there: a manual page opens Settings, a note citation opens the note's module.
 * A kit module's page is handed its `profileId` and nothing else (ADR-090), so
 * there is no prop to call - and a module that could switch the shell's page
 * itself would be a module holding the shell's own state.
 *
 * **Why a window event and not an IPC op.** Navigation is renderer state:
 * `App.tsx` owns which module is shown. An op would have to travel to main and
 * back - and main has no business knowing which page is on screen - so the
 * request goes straight to the shell, on a name both sides spell: this constant
 * here, and one listener in `App.tsx` that is commented with this file's name.
 * The alternative (a prop on every kit page) is an edit to the kit's contract for
 * one module's need.
 *
 * **What the shell does with it** is deliberately the shell's decision and not
 * this module's promise: it switches to `location.module`, and it opens the
 * module's settings card when `settings` names a module that publishes one. The
 * `item` field travels with the citation for a shell that learns to reveal an
 * item, and this module does not pretend that it already does.
 */
export const OPEN_LOCATION_EVENT = "nexus:open-location";

/** Asks the shell to show a place in the app. */
export function openAppLocation(location: AppLocation): void {
  window.dispatchEvent(new CustomEvent(OPEN_LOCATION_EVENT, { detail: location }));
}

/**
 * Opens an https address in the user's own browser, through main's one external-
 * link rule (ADR-103). Answers whether it was opened: a refused address answers
 * `false` and opens nothing, which is why the caller keeps the address as
 * selectable text as well.
 */
export async function openWebAddress(url: string): Promise<boolean> {
  return await window.nexus.openExternal(url);
}
