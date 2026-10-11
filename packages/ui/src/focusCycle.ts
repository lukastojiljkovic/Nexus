/**
 * The one piece of arithmetic behind every keyboard cycle in this package:
 * which index comes next, given where focus is now, how many candidates there
 * are and which way it is moving.
 *
 * Two consumers, asking the same question over two different shapes: the
 * dialog's Tab/Shift+Tab wrap in `components/useFocusTrap.ts`, and the
 * master-detail list's ↑/↓ walk in `views/ListDetail.tsx`. It is stated once
 * because the second consumer is exactly how a rule written twice starts to
 * drift — the renderer already carries this arithmetic (`focusOrder.ts`) for
 * the same two reasons, and that copy is one every acceptance pass has to keep
 * in step by hand.
 *
 * Pure by construction: Vitest runs in a Node environment with no DOM here, so
 * the DOM half of each consumer measures real elements and turns the returned
 * index back into a `.focus()` call, while the rule itself is pinned by a test.
 */

/**
 * The next index in a cycle of `count` candidates, given where focus is now.
 *
 * `current` need not be a valid index: `-1` is "focus has not entered the
 * container", which resolves to the first candidate moving forward and the
 * last one moving backward. Normalising that sentinel rather than feeding it
 * straight into the modulo is what keeps the backward edge honest — `-1 - 1` is
 * `-2`, which the modulo maps to one SHORT of the last candidate, silently, and
 * only in the case where focus has not landed on a candidate yet.
 *
 * Returns `null` for an empty container, so a caller can tell "there is nothing
 * to move to" from "stay where you are" instead of guessing.
 */
export function wrappedStep(current: number, count: number, direction: 1 | -1): number | null {
  if (count <= 0) return null;
  const start = current >= 0 && current < count ? current : direction === 1 ? -1 : count;
  return (((start + direction) % count) + count) % count;
}
