import { useEffect, useRef, type RefObject } from "react";

import { wrappedStep } from "../focusCycle.js";

/**
 * The modal focus trap, for every `role="dialog"` surface this package draws.
 *
 * WHERE THIS RULE ALREADY LIVED. The renderer carried a second implementation
 * since 2026-08 (`apps/desktop/src/renderer/src/useFocusTrap.ts`, over the pure
 * index arithmetic in `focusOrder.ts` there), because this package had no
 * dialog for it to belong to. The two agreed by being read side by side, which
 * is a rule held by whoever remembers to compare them — so this is now the one
 * implementation, and the renderer's file re-exports it. The two options that
 * copy needs and this one did not have are stated here rather than left to it:
 * `restoreFocus`, and the media elements its selector had learned to count.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  // A recording or a video with its own controls is tabbable in every browser,
  // so a dialog that holds one (the recorder's preview) must count it: leaving
  // it out of the trap makes Tab jump past a control the user can see.
  "audio[controls]",
  "video[controls]",
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
  readonly initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  /**
   * Whether closing hands focus back to whatever held it when the dialog
   * opened. Defaults to true, which is what every dialog wants; false is for
   * the one caller — the search palette — that restores focus itself under a
   * policy this hook cannot express, because it suppresses the restore when the
   * palette closed by navigating rather than by being dismissed.
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
      if (restoreFocus && previouslyFocused !== null && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, initialFocusRef, restoreFocus]);

  return containerRef;
}
