/**
 * The keyboard model of a dialog, as values rather than as DOM reads.
 *
 * Pure by construction, for the reason `focusOrder.ts` in the desktop renderer
 * states and this module meets: Vitest runs in a Node environment with no DOM
 * here, so a rule that read `document.activeElement` itself could not be pinned
 * by a test. `useFocusTrap.ts` measures the real elements; this file decides
 * what a key press means and which answer takes the opening focus. The wrap
 * itself lives one file up in `focusCycle.ts`, because the master-detail list
 * needs the identical rule.
 *
 * THE MODEL IS THE WAI-ARIA AUTHORING PRACTICES' ONE, and it is small enough to
 * state exactly:
 *
 *   - Escape closes the dialog and answers nothing. It is the same answer as
 *     the backdrop and as the cancel button, and it is the only key that
 *     answers: there is deliberately no default primary, so Enter picks nothing
 *     until a button has focus. A dialog that confirms a destructive act on a
 *     bare Enter is a dialog that deletes something nobody chose to delete.
 *   - Focus lands on the LEAST DESTRUCTIVE answer. For an act that destroys
 *     something that focus is the cancelling button; for the other kind it is
 *     the button that does the thing, because there the act IS what was asked
 *     for. The source is the APG's alert-dialog note that the initial focus
 *     "should be placed on the least destructive action", and the reason is
 *     that a keyboard user reads the dialog by pressing the obvious key.
 *   - Tab cycles inside the panel and wraps at both ends, so the page behind a
 *     modal is unreachable while it is open.
 */

/** Where a key press should send the dialog's own focus. */
export type DialogKeyIntent = "cancel" | "cycle" | "none";

/**
 * The meaning of one key press inside an open dialog.
 *
 * Tab is reported rather than handled because it needs the panel's real
 * elements; the two callers that only want the Escape half (`ConfirmDialog`'s
 * own listener, a page's keyboard shortcut) can ignore `"cycle"`.
 */
export function dialogKeyIntent(key: string): DialogKeyIntent {
  if (key === "Escape") return "cancel";
  if (key === "Tab") return "cycle";
  return "none";
}

/**
 * The index of the button that takes focus when the dialog opens, given the
 * panel's tabbable descendants in DOM order.
 *
 * The dialog's own two answers sit in the DOM in the order the house writes
 * them: the cancelling button first, then the button that does the thing. So
 * "the least destructive answer" is index 0 and "the answer that acts" is
 * index 1 — and when there are fewer than two (a panel that is pure prose, a
 * confirmation whose second control has not rendered) there is nothing to
 * choose between and the first candidate wins.
 */
export function initialFocusIndex(count: number, destructive: boolean): number | null {
  if (count <= 0) return null;
  if (count === 1) return 0;
  return destructive ? 0 : 1;
}
