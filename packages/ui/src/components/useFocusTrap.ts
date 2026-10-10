import { useEffect, useRef, type RefObject } from "react";

import { wrappedStep } from "../focusCycle.js";

/**
 * The modal focus trap, for every `role="dialog"` surface this package draws.
 *
 * WHERE THIS RULE ALREADY LIVED. The renderer has carried its own copy since
 * 2026-08 (`apps/desktop/src/renderer/src/useFocusTrap.ts`, over the pure index
 * arithmetic in `focusOrder.ts` there), and that copy is why its dialogs behave
 * — Tab cycles inside the panel, Escape answers nothing, and focus goes back
 * where it came from. This is the same rule stated inside the package that now
 * OWNS a dialog, so a component shipped from here is not a dialog without a
 * trap. A later pass that adopts `ConfirmDialog` across the app can delete the
 * renderer's copy wholesale; until then the two must not drift, and the two
 * halves that could drift (the initial index, the wrap) are the ones this
 * package tests directly in `dialogFocus.test.ts`.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable]:not([contenteditable="false"])',
  "[tabindex]",
].join(",");

/** Not rendered right now — `hidden` on the element or on any ancestor. */
function isHidden(element: HTMLElement): boolean {
  return element.hidden || element.closest("[hidden]") !== null;
}

/** Every element inside `container` that the browser would put in its own Tab order, in DOM order. */
function queryTabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && !isHidden(element) && !element.matches(":disabled"),
  );
}

export interface UseFocusTrapOptions {
  /** While false the hook measures nothing, listens to nothing and restores nothing. */
  readonly open: boolean;
  /**
   * A dialog that already knows which of its own controls should take the
   * opening focus. `ConfirmDialog` uses it for the safe answer; the hook
   * otherwise falls back to the first tabbable descendant.
   */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Returns a ref to attach to the dialog's outermost `role="dialog"` element.
 * While `open`, Tab and Shift+Tab cycle through the container's tabbable
 * descendants and wrap at both ends; on close, focus returns to whatever held
 * it when the dialog opened, unless that element has since left the DOM (then
 * nothing is focused, rather than throwing).
 */
export function useFocusTrap<T extends HTMLElement>({
  open,
  initialFocusRef,
}: UseFocusTrapOptions): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const container = containerRef.current;
    if (container === null) return undefined;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const tabbable = queryTabbable(container);
    const wanted = wrappedStep(-1, tabbable.length, 1);
    const preferred = initialFocusRef?.current ?? null;
    if (preferred !== null && container.contains(preferred)) {
      preferred.focus();
    } else if (wanted !== null && tabbable[wanted] !== undefined) {
      tabbable[wanted]?.focus();
    } else {
      // No tabbable descendant at all — the container itself becomes the
      // fallback landing spot, so a dialog that is pure prose does not open
      // with focus stranded on the page behind it.
      if (container.tabIndex < 0) container.tabIndex = -1;
      container.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const current = queryTabbable(container);
      if (current.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const index = active instanceof HTMLElement ? current.indexOf(active) : -1;
      const next = wrappedStep(index, current.length, event.shiftKey ? -1 : 1);
      if (next === null) return;
      event.preventDefault();
      current[next]?.focus();
    };
    container.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused !== null && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, initialFocusRef]);

  return containerRef;
}
