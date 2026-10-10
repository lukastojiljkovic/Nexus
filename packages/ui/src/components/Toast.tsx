import { Button } from "./Button.js";
import { Icon } from "./Icon.js";

/** What a toast is announcing, and therefore how it interrupts. */
export type ToastKind = "info" | "error";

/**
 * The live-region contract of a toast, as a value a test can pin.
 *
 * `status` is a polite region: the news waits for the reader to reach a pause.
 * `alert` is assertive: a failure the user just caused is worth interrupting
 * for, because the thing they tried did not happen. The two roles also carry
 * the two glyphs the house keeps apart — `check` and `error` — so the reading
 * never rests on the colour of the line.
 */
export function toastAnnouncement(kind: ToastKind): {
  role: "status" | "alert";
  "aria-live": "polite" | "assertive";
  icon: "check" | "error";
} {
  return kind === "error"
    ? { role: "alert", "aria-live": "assertive", icon: "error" }
    : { role: "status", "aria-live": "polite", icon: "check" };
}

export interface ToastProps {
  /** What happened. One sentence, past tense, in the page's register. */
  message: string;
  kind?: ToastKind;
  /**
   * The offer to take it back, when the act can be taken back. Both halves are
   * required together: a button with no handler is not an offer.
   */
  undo?: { readonly label: string; readonly onUndo: () => void } | undefined;
  /** The name of the control that closes the offer — „Odbaci" or „Zatvori". */
  dismissLabel: string;
  onDismiss: () => void;
}

/**
 * The one undo bar the product had four of.
 *
 * „Deleted, with an offer to take it back" had been hand-written in HABIT,
 * FOCUS, TASK and FINANCE, under four class prefixes (`hab__undo`, `foc__undo`,
 * `tasks__undo`, `fin__undo`) and one recipe: a `role="status"` line, the
 * notice, an undo button and a quiet way to drop the offer. Four copies of one
 * arrangement is four places for the next change to land in three of them, and
 * the copy in FINANCE had already drifted one declaration away from the other
 * three — it drew its hairline on `--nx-border-subtle` where they drew theirs
 * on `--nx-border`. This one takes the majority's value.
 *
 * **It does not time out, and that is the pattern rather than an omission.** An
 * offer to take something back that disappears on a timer is an offer that
 * punishes a slow reader, and the dwell would be a number nobody can defend.
 * The offer stands until the user answers it, or until the page replaces it
 * with the next one: one offer at a time, which is why the bar is a slot rather
 * than a stack.
 *
 * The FAILURE case is the same component with `kind="error"` — a save the store
 * refused, a restore that did not land. It has no undo, it announces
 * assertively, and it is dismissed the same way.
 */
export function Toast({ message, kind = "info", undo, dismissLabel, onDismiss }: ToastProps) {
  const announcement = toastAnnouncement(kind);
  const classes = ["nx-toast", `nx-toast--${kind}`];
  return (
    <div className={classes.join(" ")} role={announcement.role} aria-live={announcement["aria-live"]}>
      <span className="nx-toast__mark" aria-hidden="true">
        <Icon name={announcement.icon} size={15} />
      </span>
      <span className="nx-toast__text">{message}</span>
      {undo != null && (
        <Button size="sm" className="nx-toast__undo" onClick={undo.onUndo}>
          {undo.label}
        </Button>
      )}
      <Button
        size="sm"
        variant="quiet"
        className="nx-toast__dismiss"
        aria-label={dismissLabel}
        title={dismissLabel}
        onClick={onDismiss}
      >
        <Icon name="close" size={14} />
      </Button>
    </div>
  );
}
