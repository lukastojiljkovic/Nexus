import type { ReactNode } from "react";

/**
 * The app's own icon set. Deliberately NOT a third-party icon library
 * (founder decision, 2026-08-06): a small drawn set that belongs to this
 * product, rather than the same rounded-stroke pictograms every other app
 * ships. Nothing is imported and nothing is licensed.
 *
 * House rules, so a twenty-eighth icon added next year still matches:
 *  - 24×24 view box, content inside 3…21 so nothing touches the edge;
 *  - stroke only, `currentColor`, no fills — colour comes from the call site;
 *  - one weight (1.75) at every size, round caps and joins;
 *  - built from rects, circles, straight lines and single smooth arcs.
 *    A shape that needs a page of bézier data is a shape drawn wrong.
 *
 * A "dot" is a zero-length subpath (`M x y h0`) with a round cap — a filled
 * circle of exactly the stroke weight, with no second fill rule to keep in
 * sync when the weight changes.
 */
export type IconName =
  // Navigation — one per registered module, plus search.
  | "dashboard"
  | "tasks"
  | "calendar"
  | "notes"
  | "study"
  | "focus"
  | "files"
  | "finance"
  | "habits"
  | "fitness"
  | "canvas"
  | "tools"
  | "priv"
  | "settings"
  | "search"
  // Primary actions.
  | "plus"
  | "check"
  | "pencil"
  | "trash"
  | "close"
  | "chevronDown"
  | "chevronRight"
  | "bell"
  | "filter"
  | "export"
  | "import"
  | "undo";

const SHAPES: Record<IconName, ReactNode> = {
  // Three panes, uneven on purpose: a board someone arranged, not a 2×2 grid.
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="18" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7" rx="1.6" />
      <rect x="13.5" y="14" width="7.5" height="7" rx="1.6" />
    </>
  ),
  // Two done rows. The list is the point, so the ticks lead and the text follows.
  tasks: (
    <>
      <path d="M3.5 7.4 5.6 9.5 9.2 5.6" />
      <path d="M12.5 7.5h8" />
      <path d="M3.5 16.4 5.6 18.5 9.2 14.6" />
      <path d="M12.5 16.5h8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9.6h18" />
      <path d="M8 3v4.2" />
      <path d="M16 3v4.2" />
      <path d="M8.6 14.4h0" />
    </>
  ),
  // A page with a turned corner, and only as many rules as fit.
  notes: (
    <>
      <path d="M6.2 3h7.6l5 5v12a1 1 0 0 1-1 1H6.2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M13.8 3v5h5" />
      <path d="M8.6 13h6.8" />
      <path d="M8.6 16.8h4.4" />
    </>
  ),
  // An open book: two leaves meeting at a spine.
  study: (
    <>
      <path d="M12 7.4C10.4 5.9 8.1 5.1 4.9 5.1H3.4v13.2h1.5c3.2 0 5.5.8 7.1 2.3" />
      <path d="M12 7.4c1.6-1.5 3.9-2.3 7.1-2.3h1.5v13.2h-1.5c-3.2 0-5.5.8-7.1 2.3" />
    </>
  ),
  // A stopwatch, not a clock: focus is a span you start, not a time of day.
  focus: (
    <>
      <circle cx="12" cy="13.6" r="7.4" />
      <path d="M12 9.6v4l2.6 2" />
      <path d="M9.6 2.6h4.8" />
      <path d="M12 2.6v3.6" />
    </>
  ),
  files: (
    <path d="M3 6.6A1.6 1.6 0 0 1 4.6 5h4.2c.5 0 1 .25 1.3.67L11.5 7.4h7.9A1.6 1.6 0 0 1 21 9v8.4a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 17.4z" />
  ),
  finance: (
    <>
      <rect x="2.6" y="6" width="18.8" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.8" />
      <path d="M6.2 9.6v4.8" />
      <path d="M17.8 9.6v4.8" />
    </>
  ),
  // Two arcs closing a cycle — a habit is the loop, not the tally.
  habits: (
    <>
      <path d="M4.6 10.6A7.6 7.6 0 0 1 18.9 8.6" />
      <path d="M19.6 4.9v3.9h-3.9" />
      <path d="M19.4 13.4a7.6 7.6 0 0 1-14.3 2" />
      <path d="M4.4 19.1v-3.9h3.9" />
    </>
  ),
  fitness: (
    <>
      <circle cx="12" cy="14" r="7" />
      <path d="M12 7V4.6" />
      <path d="M12 4.6c1.4-1.6 3.1-2.1 4.7-1.6-.3 1.8-1.7 3-3.4 3.1" />
    </>
  ),
  // A frame with one freehand stroke across it.
  canvas: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M6.6 15.4c2-4.6 4-4.6 5.5-1.6s3.5 3 5.4-2" />
    </>
  ),
  // A ruler: UTIL is converters and calculators, so it measures.
  tools: (
    <>
      <rect x="2.6" y="8.4" width="18.8" height="7.2" rx="1.6" />
      <path d="M7 8.4v3" />
      <path d="M11 8.4v4.4" />
      <path d="M15 8.4v3" />
      <path d="M19 8.4v4.4" />
    </>
  ),
  priv: (
    <>
      <rect x="4.4" y="10.4" width="15.2" height="10.6" rx="2" />
      <path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" />
      <path d="M12 14.6v2.4" />
    </>
  ),
  // Sliders, not a gear: settings are things you set, not machinery.
  settings: (
    <>
      <path d="M3.6 7h16.8" />
      <circle cx="9" cy="7" r="2.1" />
      <path d="M3.6 12h16.8" />
      <circle cx="15.4" cy="12" r="2.1" />
      <path d="M3.6 17h16.8" />
      <circle cx="7.4" cy="17" r="2.1" />
    </>
  ),
  search: (
    <>
      <circle cx="10.6" cy="10.6" r="6.6" />
      <path d="m15.4 15.4 5.1 5.1" />
    </>
  ),

  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  check: <path d="m4.6 12.4 5 5L19.4 6.6" />,
  pencil: (
    <>
      <path d="m4 20 1-4.3L16.3 4.4a2.2 2.2 0 0 1 3.1 3.1L8.3 19z" />
      <path d="m14.7 6 3.3 3.3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.6 6.6h14.8" />
      <path d="M9.6 6.6V4.6h4.8v2" />
      <path d="m6.6 6.6 1 13.4h8.8l1-13.4" />
      <path d="M10.4 10.2v6.4" />
      <path d="M13.6 10.2v6.4" />
    </>
  ),
  close: (
    <>
      <path d="m6.2 6.2 11.6 11.6" />
      <path d="M17.8 6.2 6.2 17.8" />
    </>
  ),
  chevronDown: <path d="m6.4 9.4 5.6 5.6 5.6-5.6" />,
  chevronRight: <path d="m9.4 6.4 5.6 5.6-5.6 5.6" />,
  bell: (
    <>
      <path d="M6.2 17.4V11a5.8 5.8 0 0 1 11.6 0v6.4" />
      <path d="M4.2 17.4h15.6" />
      <path d="M10 20.4a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  filter: <path d="M3.6 5.4h16.8l-6.6 7.6v5.8l-3.6 1.8V13z" />,
  export: (
    <>
      <path d="M12 15.2V3.6" />
      <path d="m8.2 7.4 3.8-3.8 3.8 3.8" />
      <path d="M4.6 15.4v3a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-3" />
    </>
  ),
  import: (
    <>
      <path d="M12 3.6v11.6" />
      <path d="m8.2 11.4 3.8 3.8 3.8-3.8" />
      <path d="M4.6 15.4v3a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-3" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9.6h8.4a5.6 5.6 0 0 1 0 11.2H8.2" />
      <path d="m7.6 5.6-3.6 4 3.6 4" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Edge length in px. 18 sits on a 15px line without crowding it. */
  size?: number;
  className?: string;
  /**
   * A name for assistive technology. Omit it — the default — whenever the icon
   * sits beside its own label, which is every navigation row: announcing
   * „Zadaci Zadaci" is worse than announcing nothing.
   */
  title?: string;
}

export function Icon({ name, size = 18, className, title }: IconProps) {
  return (
    <svg
      className={className == null ? "nx-icon" : `nx-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title == null ? undefined : "img"}
      aria-hidden={title == null ? true : undefined}
      focusable="false"
    >
      {title != null && <title>{title}</title>}
      {SHAPES[name]}
    </svg>
  );
}
