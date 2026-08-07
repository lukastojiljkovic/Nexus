import { useEffect, useRef, type RefObject } from "react";

import { firstFocusableIndex, nextFocusableIndex, type FocusCandidate } from "./focusOrder.js";

/**
 * The modal focus trap every `role="dialog"` surface in the renderer was
 * missing: Tab walked straight out of the panel into the page behind it, and
 * closing left focus wherever it happened to be rather than handing it back.
 * Fixing that per dialog, by hand, is exactly the shape of bug this codebase
 * keeps re-finding — one copy of the arithmetic, adopted everywhere, so the
 * next dialog gets it for free.
 *
 * The index math (which candidate is "next") lives in `focusOrder.ts`, pure,
 * because Vitest runs with no DOM in this repo. This hook is the thin DOM
 * half: it collects the container's real tabbable descendants, maps them to
 * the pure module's plain descriptors, and turns the answer back into a
 * `.focus()` call.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false"])',
  "[tabindex]",
].join(",");

/** Not rendered right now — shared with `notePopover.tsx`'s roving focus, the other DOM-side consumer of `focusOrder.ts`. */
export function isElementHidden(element: HTMLElement): boolean {
  return element.hidden || element.closest("[hidden]") !== null;
}

/** A real element, measured into the plain shape `focusOrder.ts` reasons over. */
export function elementToFocusCandidate(element: HTMLElement): FocusCandidate {
  return {
    tabIndex: element.tabIndex,
    disabled: element.matches(":disabled"),
    hidden: isElementHidden(element),
  };
}

/** Every element inside `container` that the browser would put in its own Tab order, in DOM order. */
function queryTabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && !isElementHidden(element) && !element.matches(":disabled"),
  );
}

export interface UseFocusTrapOptions {
  /** While false the hook measures nothing, listens to nothing, and restores nothing. */
  readonly open: boolean;
  /**
   * A dialog that already knows which of its own controls should get the
   * opening focus (a destructive default deliberately skipped, a "Zatvori"
   * button standing in front of other actions) — the hook defers to it
   * instead of forcing the first tabbable descendant.
   */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * False for the one caller (`SearchPalette`) that already restores focus
   * itself under a policy this hook cannot express — it suppresses a restore
   * when the dialog closed because the user navigated away, not because they
   * dismissed it. Defaults to true.
   */
  readonly restoreFocus?: boolean;
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
  restoreFocus = true,
}: UseFocusTrapOptions): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const container = containerRef.current;
    if (container === null) return undefined;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const initial = initialFocusRef?.current ?? null;
    if (initial !== null && container.contains(initial)) {
      initial.focus();
    } else {
      const tabbable = queryTabbable(container);
      const firstIndex = firstFocusableIndex(tabbable.map(elementToFocusCandidate));
      const first = firstIndex !== null ? tabbable[firstIndex] : undefined;
      if (first !== undefined) {
        first.focus();
      } else {
        // No tabbable descendant at all — the container itself becomes the
        // fallback landing spot, so a dialog that is pure prose (or still
        // loading its content) does not open with focus stranded outside it.
        if (container.tabIndex < 0) container.tabIndex = -1;
        container.focus();
      }
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const tabbable = queryTabbable(container);
      if (tabbable.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const currentIndex = active instanceof HTMLElement ? tabbable.indexOf(active) : -1;
      const direction = event.shiftKey ? -1 : 1;
      const nextIndex = nextFocusableIndex(tabbable.map(elementToFocusCandidate), currentIndex, direction);
      if (nextIndex === null) return;
      event.preventDefault();
      tabbable[nextIndex]?.focus();
    };
    container.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (restoreFocus && previouslyFocused !== null && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, initialFocusRef, restoreFocus]);

  return containerRef;
}
