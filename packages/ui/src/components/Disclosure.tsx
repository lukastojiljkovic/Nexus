import type { ReactNode } from "react";

/**
 * The quiet typographic disclosure: a triangle, a name, and an optional
 * summary of what is behind it.
 *
 * It is the product's answer to „this is available, not advertised" — settings
 * that most people never open, an archive that exists but is not today's work,
 * a chart that explains the list without being the list. There is no card, no
 * rule and no chevron button, because the thing being offered is secondary and
 * a control that shouts about a secondary thing has mis-stated the page.
 *
 * **Written once because it had already been written four times.**
 * `.set__disclosure` (twice), `.set__licence-toggle` and
 * `.tasks__archive-toggle` were the same fourteen declarations in two files,
 * and the drift DC-02 predicts had already started:
 *
 *  - the summary drifted a whole tier. `--nx-font-size-label` with tracking,
 *    subtle ink and tabular figures beside the settings copy's name; plain
 *    `--nx-font-size-caption` beside the archive's. Both are counts of what is
 *    behind the triangle, and they were two different-looking counts.
 *  - the 24px pointer floor was stated in both, but not in the same PLACE:
 *    `settings.css` puts it in the control's own rule, `tasks.css` in a
 *    page-wide pointer-target block seventy lines further down. Neither is
 *    wrong and that is the point — the floor is a property of this control,
 *    and a property held by whichever rule each file happened to reach for is
 *    one nobody can check.
 *
 * Both are now structural. `settings.css` names the remaining half of this and
 * it is NOT folded in here on the way past: the shared `Button` has only
 * bordered variants, so a quiet TEXT button without a triangle (`.set__reset`,
 * `.fin__quiet`) is still hand-rolled at each site. That is a different
 * control, it wants a `Button` variant rather than this, and it is recorded in
 * `docs/STATUS.md`.
 *
 * CONTROLLED, deliberately. Every call site already owns this state and owns
 * it differently — settings keeps it in a `useState`, the licence list is an
 * accordion where opening one closes another, and a module's chart persists it
 * per profile. A component that held the state would have to grow an escape
 * hatch for each of them, which is how a shared control becomes three.
 */
export interface DisclosureProps {
  /** What is behind it. A noun phrase, not a verb: the triangle says the verb. */
  label: string;
  /** Whether `children` are showing. Drives the triangle and `aria-expanded`. */
  open: boolean;
  /** Called with the state being asked for, so a call site never re-derives it. */
  onToggle: (open: boolean) => void;
  /**
   * A count or short value shown after the label — what is behind it, without
   * opening it. `12`, `3/9`, „sve".
   */
  summary?: string;
  /**
   * A pointer tooltip. `aria-expanded` is what states the control's state to
   * assistive technology, so this is for the mouse only and most call sites
   * want nothing here — it earns its place in a LIST of these, where the
   * triangle is the only affordance and there is no prose to explain it.
   */
  title?: string;
  /**
   * Rendered only while open. Optional: a call site whose body cannot be a
   * child — an accordion row whose panel is a sibling in the grid — passes
   * none and renders it itself.
   */
  children?: ReactNode;
  className?: string;
}

export function Disclosure({
  label,
  open,
  onToggle,
  summary,
  title,
  children,
  className,
}: DisclosureProps) {
  return (
    <>
      <button
        type="button"
        className={className == null ? "nx-disclosure" : `nx-disclosure ${className}`}
        aria-expanded={open}
        {...(title == null ? {} : { title })}
        onClick={() => {
          onToggle(!open);
        }}
      >
        <span className="nx-disclosure__mark" aria-hidden="true" />
        {/* A span rather than bare text so the label can take the free space
            when there is any. That is what makes the full-width form — a row in
            a list, `width: 100%` from the call site — the same control rather
            than a second one: `flex-grow` with an `auto` basis changes nothing
            in a shrink-to-fit box and does the right thing in a stretched one.
            A `variant` prop for one call site would have been a width wearing
            a name. */}
        <span className="nx-disclosure__label">{label}</span>
        {summary != null && <span className="nx-disclosure__summary">{summary}</span>}
      </button>
      {open && children}
    </>
  );
}
