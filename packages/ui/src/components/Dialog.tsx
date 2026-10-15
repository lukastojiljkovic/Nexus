import { useEffect, useId, type ReactNode, type RefObject } from "react";

import { useFocusTrap } from "./useFocusTrap.js";
import { useModalLayer } from "./useModalLayer.js";

/**
 * The panel's ARIA, derived from the ids the frame renders.
 *
 * `aria-describedby` is present only when there IS something to describe: a
 * panel pointing at an id no element carries announces its heading and then
 * stops, which reads as a dialog whose question was never written — worse than
 * a panel that describes nothing, because nothing about the screen looks wrong.
 *
 * The role is `dialog` and never `alertdialog`. `alertdialog` makes several
 * screen readers cut across whatever is being read, and the panels this frame
 * draws are questions the user opened rather than alarms.
 */
export function dialogAria(input: {
  readonly titleId: string;
  readonly describedById?: string | undefined;
}): {
  role: "dialog";
  "aria-modal": true;
  "aria-labelledby": string;
  "aria-describedby"?: string;
} {
  const aria = {
    role: "dialog" as const,
    "aria-modal": true as const,
    "aria-labelledby": input.titleId,
  };
  return input.describedById === undefined
    ? aria
    : { ...aria, "aria-describedby": input.describedById };
}

export interface DialogProps {
  /** The panel's heading, and the name a screen reader announces it by. */
  title: string;
  /**
   * What the panel is about — a row's label, a file's name. Rendered between
   * the heading and the description, in full-strength text, so the one fact a
   * reader needs before answering is the one thing that is read first.
   */
  subject?: string | undefined;
  /** The sentence under the heading: what the panel is asking, or what it is for. */
  description?: string | undefined;
  /** Escape and the backdrop both answer this. Suppressed while `busy`. */
  onClose: () => void;
  /**
   * Which of the panel's own controls takes the opening focus, for a caller
   * that has a least-destructive answer to land on. Without it the first
   * tabbable descendant takes it.
   */
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  /**
   * True while the panel is answering a request of its own. Every way out is
   * then closed: a request already in flight owns the answer it is about to
   * give, and closing out from under it throws away the very error or success
   * it is about to report.
   */
  busy?: boolean | undefined;
  /** The panel's row of answers, right-aligned at its foot. */
  actions?: ReactNode;
  /** The panel's body, between the description and the answers. */
  children?: ReactNode;
}

/**
 * The house modal panel, as a component rather than as a markup recipe.
 *
 * **Why it exists now.** The app had one dialog recipe with two owners: the
 * renderer carries it in `styles/recurrence.css` under `recur-dialog__*` and
 * `styles.css` states the same box once as `nx-dialog__*` for the panels this
 * package draws. Fifteen-odd surfaces in the renderer wear the first, so the
 * launcher and the command palette — which are the app's house dialogs by
 * construction — had stopped being so the day the second recipe appeared. This
 * is the frame both recipes describe, so a panel that adopts it cannot drift
 * from the others, and the two things a modal must not get wrong are enforced
 * here rather than per caller:
 *
 *   - `role="dialog"` with `aria-modal`, named by the heading and described by
 *     the sentence, with the focus trapped inside the panel and returned where
 *     it came from (`useFocusTrap.ts`);
 *   - „a modal is open" published for the shell's global shortcut guard
 *     (`useModalLayer.ts`), so a chord cannot act through the panel.
 *
 * **Deliberately without a portal.** The shell's scrolling column creates no
 * containing block (no transform, filter or containment on it), so a
 * `position: fixed` panel here is already positioned against the window and
 * already paints at the dialog layer — and this package deliberately does not
 * depend on `react-dom`, which is what a portal would cost it.
 *
 * `actions` rather than `children` for the answers, because the row's
 * arrangement (right-aligned, at the foot, after the body) is the frame's
 * business and not the caller's.
 */
export function Dialog({
  title,
  subject,
  description,
  onClose,
  initialFocusRef,
  busy = false,
  actions,
  children,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true, initialFocusRef });
  useModalLayer();

  // A document listener rather than the panel's own handler: Escape has to
  // close even in the frame before focus has settled inside the panel, and
  // every dialog in the app answers Escape the same way.
  useEffect(() => {
    if (busy) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, busy]);

  return (
    <div className="nx-dialog__overlay">
      <div className="nx-dialog__backdrop" onClick={busy ? undefined : onClose} />
      <div
        ref={panelRef}
        className="nx-dialog__panel"
        {...dialogAria({ titleId, describedById: description === undefined ? undefined : descriptionId })}
      >
        <h2 id={titleId} className="nx-dialog__title">
          {title}
        </h2>
        {subject != null && <p className="nx-dialog__name">„{subject}“</p>}
        {description != null && (
          <p id={descriptionId} className="nx-hint">
            {description}
          </p>
        )}
        {children}
        {actions != null && <div className="nx-dialog__actions">{actions}</div>}
      </div>
    </div>
  );
}
