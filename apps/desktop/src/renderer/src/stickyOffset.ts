import { useCallback, useEffect, useRef } from "react";

/**
 * Publishes a sticky bar's MEASURED height as a CSS custom property, so
 * `scroll-margin-top` can be the real number instead of a guess at it.
 *
 * ─── The defect this exists to make unrepresentable ─────────────────────────
 *
 * `scrollIntoView({ block: "start" })` aligns an element's margin box with the
 * top of its scrollport. A `position: sticky; top: 0` bar sits ON that edge, so
 * whatever was scrolled to lands BEHIND it — the jump arrives at a card whose
 * title is covered by the very index that jumped there. The platform's answer
 * is `scroll-margin-top` on the target, and it is the right answer; the trap is
 * the number.
 *
 * The settings page had `scroll-margin-top: calc(var(--nx-space-8) +
 * var(--nx-space-4))`, with a comment calling it „one index strip's height". It
 * was — for a strip on one line. The strip is a wrapping flex row of twenty-odd
 * entries, so it stands two or three lines tall at every window size the app
 * actually opens at, and its height changes again as the filter hides sections.
 * A constant is correct at exactly one width and one filter state, which is why
 * the layout sweep found the card title under the strip at all three sizes in
 * both themes.
 *
 * So the height is measured and republished whenever it changes. There is no
 * declarative version of this: CSS cannot make one element's margin depend on
 * another element's height, and `position: sticky` deliberately keeps the bar
 * out of flow so nothing downstream can see it.
 *
 * ─── Where it writes ───────────────────────────────────────────────────────
 *
 * On the bar's PARENT, not on `:root`. The parent is the common ancestor of the
 * bar and of what it scrolls over, so the property is inherited by exactly the
 * elements entitled to it — and two of these on screen at once cannot overwrite
 * each other, which a document-level property would allow.
 *
 * The value carries its `px` unit and is written only when it changes, so a
 * resize that does not move the bar invalidates no style.
 *
 * ─── Where it is used today ──────────────────────────────────────────────
 *
 * Nowhere, since SET-015 replaced the settings index with a category rail —
 * that rail is a `position: sticky` column in a grid, not a bar laid over the
 * cards, so nothing has to clear it and Settings no longer publishes a height.
 * The hook is KEPT rather than deleted because `docs/defect-classes.md` names
 * it as the fix for DC-23's two still-open instances in the notes editor
 * (`noteTableOfContents.tsx`'s scroll under NOTE's sticky toolbar, and
 * ProseMirror's `tr.scrollIntoView()` under `.note__find`), and deleting it
 * would leave that document pointing at a file that no longer exists.
 */
export function useStickyBarHeight(property: string): (node: HTMLElement | null) => void {
  const attached = useRef<{ scope: HTMLElement; observer: ResizeObserver } | null>(null);

  const detach = useCallback(() => {
    const current = attached.current;
    if (current === null) return;
    current.observer.disconnect();
    current.scope.style.removeProperty(property);
    attached.current = null;
  }, [property]);

  // Unmount without a `null` ref call — a full tree teardown — still clears it.
  useEffect(() => detach, [detach]);

  return useCallback(
    (node: HTMLElement | null): void => {
      detach();
      if (node === null) return;
      const scope = node.parentElement;
      if (scope === null) return;

      const publish = (): void => {
        const value = `${Math.round(node.getBoundingClientRect().height)}px`;
        if (scope.style.getPropertyValue(property) !== value) {
          scope.style.setProperty(property, value);
        }
      };
      publish();

      const observer = new ResizeObserver(publish);
      observer.observe(node);
      attached.current = { scope, observer };
    },
    [detach, property],
  );
}
