/**
 * The index arithmetic behind every keyboard focus cycle in the renderer:
 * `useFocusTrap.ts`'s Tab/Shift+Tab wrap inside a modal, and
 * `notePopover.tsx`'s ArrowUp/ArrowDown/Home/End roving focus inside a
 * `role="menu"` panel. One rule, because both are the same question — "given
 * where focus is now and which way it is moving, which candidate is next?" —
 * asked over two different DOM shapes.
 *
 * Pure by construction: Vitest runs in a Node environment with no DOM in this
 * repo (`apps/desktop/vitest.config.ts`), so a rule that read `tabIndex` or
 * `disabled` off real elements itself could not be pinned by a test. Each
 * candidate arrives as a plain descriptor instead — the DOM half (the hook,
 * the popover) is responsible for measuring real elements into this shape and
 * turning the returned index back into a `.focus()` call.
 */

/** What a caller needs to know about one candidate to decide if it is reachable. */
export interface FocusCandidate {
  /** The element's live `tabIndex` — negative means excluded from the tab order (an explicit `tabindex="-1"`, or an element with none at all). */
  readonly tabIndex: number;
  readonly disabled: boolean;
  /** Not rendered right now — `hidden`, or inside a `hidden` ancestor. */
  readonly hidden: boolean;
}

function isReachable(candidate: FocusCandidate): boolean {
  return candidate.tabIndex >= 0 && !candidate.disabled && !candidate.hidden;
}

/** The first reachable candidate, or `null` if the list is empty or every candidate is skippable. */
export function firstFocusableIndex(candidates: readonly FocusCandidate[]): number | null {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate !== undefined && isReachable(candidate)) return index;
  }
  return null;
}

/** The last reachable candidate, or `null` if the list is empty or every candidate is skippable. */
export function lastFocusableIndex(candidates: readonly FocusCandidate[]): number | null {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate !== undefined && isReachable(candidate)) return index;
  }
  return null;
}

/**
 * The next reachable candidate from `currentIndex`, moving `direction` steps
 * at a time and wrapping at both ends. `currentIndex` need not be a valid
 * index itself — `-1` (nothing focused yet) is what both callers pass when
 * focus has not entered the container, and this still resolves to the first
 * (or, moving backward, the last) reachable candidate.
 *
 * **That last clause is why the start is normalised rather than fed straight
 * into the modulo.** `-1` is „before the list" moving forward, but moving
 * BACKWARD from „nothing focused" has to begin AFTER the list, or the first
 * step lands on `count - 2` — one short of the end, silently, and only when
 * focus happens not to be on a candidate. Both out-of-range directions are
 * mapped to the sentinel that makes step 1 arrive at the right edge.
 *
 * Walks at most `candidates.length` steps before giving up, so a list where
 * every candidate is disabled, hidden or excluded from the tab order returns
 * `null` rather than looping forever.
 */
export function nextFocusableIndex(
  candidates: readonly FocusCandidate[],
  currentIndex: number,
  direction: 1 | -1,
): number | null {
  const count = candidates.length;
  if (count === 0) return null;
  const start =
    currentIndex >= 0 && currentIndex < count ? currentIndex : direction === 1 ? -1 : count;
  for (let step = 1; step <= count; step += 1) {
    const index = (((start + direction * step) % count) + count) % count;
    const candidate = candidates[index];
    if (candidate !== undefined && isReachable(candidate)) return index;
  }
  return null;
}
