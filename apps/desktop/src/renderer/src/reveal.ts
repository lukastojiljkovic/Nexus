/**
 * Shared "you found it" mark for a global-search reveal (021-e): TasksPage,
 * DocumentsPanel and StudyPage all need the exact same "mark this row, then
 * drop the mark a couple of seconds later" behaviour, so it lives once here
 * rather than as four copies of the same timer.
 *
 * The mark itself is `.nx-revealed` in app.css (accent border + soft
 * background, the same idiom as the calendar's drop target, never a glow) and
 * that rule owns the fade; this module owns only which id currently carries
 * the class and the timer that takes it away once the fade has finished.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Must match `--nx-reveal-duration` on `.nx-revealed` in app.css — the class is removed exactly when the fade ends. */
const REVEAL_DURATION_MS = 2000;

export function useRevealedRow(): { revealedId: string | null; reveal: (id: string) => void } {
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    },
    [],
  );

  // Stable identity (useCallback, no deps) so a page's own intent-effect can
  // safely list `reveal` in its dependency array without that effect re-firing
  // on every unrelated re-render.
  const reveal = useCallback((id: string) => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    setRevealedId(id);
    timeoutRef.current = setTimeout(() => setRevealedId(null), REVEAL_DURATION_MS);
  }, []);

  return { revealedId, reveal };
}

/**
 * Scrolls a revealed row's DOM node into view — `"nearest"` so a row that is
 * already visible never jumps. Silently a no-op when the id is not (yet, or
 * no longer) in the DOM, which happens for free during the load races the
 * pages above already guard against.
 *
 * No `behavior`, so the scroll takes the computed `scroll-behavior`, which no
 * stylesheet sets to `smooth` and which the reduced-motion rule in @nexus/ui's
 * styles.css pins to `auto`. Nothing to opt out of here.
 */
export function scrollRevealedIntoView(domId: string): void {
  document.getElementById(domId)?.scrollIntoView({ block: "nearest" });
}
