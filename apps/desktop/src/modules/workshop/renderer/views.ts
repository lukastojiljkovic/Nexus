import { WORKSHOP_TARGETS, type WorkshopTarget } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * The page's five views, as data (ADR-090's split: a decision, not a JSX
 * branch).
 *
 * Three of them are the file viewers main opens a dialog for, and their list is
 * `WORKSHOP_TARGETS` rather than a second spelling of it: a view and the picker
 * main switches on are the same three words, and two lists would eventually
 * disagree about one of them. The other two are the tool sets, which carry their
 * files in and out themselves.
 *
 * `isViewer` is the narrow of that union, so a caller that needs a
 * `WorkshopTarget` (the open call, the recent-files list) asks for one instead of
 * casting.
 */
export type WorkshopView = WorkshopTarget | "pdf" | "images";

/** Every view in the order the switcher draws them: the viewers, then the tools. */
export const WORKSHOP_VIEWS: readonly WorkshopView[] = [...WORKSHOP_TARGETS, "pdf", "images"];

/** Whether a view is one of the three that open a file through main's dialog. */
export function isViewer(view: WorkshopView): view is WorkshopTarget {
  return view === "model" || view === "toolpath" || view === "board";
}

/**
 * What one switcher segment reads.
 *
 * A viewer's word is its own (`copy.targets`, which the open buttons and the
 * recent list also use), and a tool set's is the pair under `copy.views` — read
 * at CALL time, so a language switch changes the segments with the rest of the
 * page.
 */
export function viewLabel(view: WorkshopView): string {
  return isViewer(view) ? copy.targets[view] : copy.views[view];
}
