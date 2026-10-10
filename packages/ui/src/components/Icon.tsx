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
  | "electronics"
  | "tools"
  | "pro"
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
  | "undo"
  // Direction. Chevrons disclose, arrows move — the app had only half of each
  // pair, which is why eight surfaces reached for a literal „↑" instead.
  | "chevronLeft"
  | "chevronUp"
  | "arrowUp"
  | "arrowDown"
  | "arrowLeft"
  | "arrowRight"
  // Structure and overflow.
  | "more"
  | "moreVertical"
  | "menu"
  | "drag"
  | "grid"
  | "rows"
  | "sort"
  | "expand"
  | "collapse"
  // Status. Four shapes that must never be told apart by colour alone.
  | "info"
  | "warning"
  | "success"
  | "error"
  | "minus"
  // The focus timer, which had been spelling its transport in glyphs.
  | "play"
  | "pause"
  | "stop"
  | "clock"
  | "repeat"
  // The countdown: an hourglass, deliberately NOT another stopwatch. `focus`
  // above is one and `clock` is a time of day, so the third timer in this set
  // had to be a shape of its own — and an hourglass says what a countdown is
  // (time running out of a fixed amount) rather than what time it is.
  | "timer"
  // Objects the modules actually name.
  | "star"
  | "starFilled"
  | "pin"
  | "pinFilled"
  | "swatchNone"
  | "tag"
  | "link"
  | "unlink"
  | "attach"
  | "copy"
  | "image"
  | "person"
  | "people"
  | "list"
  | "archive"
  | "unarchive"
  | "swap"
  | "flame"
  | "target"
  | "trendUp"
  | "trendDown"
  | "chart"
  | "wallet"
  | "book"
  | "lock"
  | "unlock"
  | "eye"
  | "eyeOff"
  | "shield"
  | "key"
  | "globe"
  | "palette"
  | "keyboard"
  | "printer"
  | "database"
  | "home"
  | "external"
  | "sun"
  | "moon"
  // The drawn window frame. Deliberately the OS's own vocabulary rather than
  // an invention: a rule, a square and a square-behind-a-square are what every
  // desktop has meant by minimise / maximise / restore for thirty years, and a
  // title bar is the last place in a product to be original about meaning.
  | "windowMinimize"
  | "windowMaximize"
  | "windowRestore"
  // The culture corner's own mark: a pediment over three columns, which is what
  // a person means by „going to see something". `book` is STUDY's (a library
  // shelf) and `palette` says nothing about leaving the house, so the module
  // brought this one rather than borrowing either.
  | "museum";

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
  // A DIP chip seen from above: the body, three legs a side, and the dot that
  // marks pin 1. A schematic squiggle would have been the obvious draw and the
  // wrong one — „canvas" is already a rect with a curve through it, and at
  // 16px the two would be one smudge apart. A chip is a THING rather than a
  // diagram, which is also what the module is: a drawer of components.
  electronics: (
    <>
      <rect x="7" y="6" width="10" height="12" rx="1.5" />
      <path d="M7 9H4" />
      <path d="M7 12H4" />
      <path d="M7 15H4" />
      <path d="M17 9h3" />
      <path d="M17 12h3" />
      <path d="M17 15h3" />
      <path d="M9.5 8.5h0" />
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
  // A case with a handle. This mark used to be angle brackets around a slash —
  // „source" in every editor and every terminal — and it was right for as long
  // as the drawer behind it was „Programerske alatke". „Stručne alatke" holds an
  // architect's quantity take-off and a baker's dough hydration beside the
  // RISC-V assembler, and a source-code mark over that list would name one of
  // the eighteen subjects and mislead about the other seventeen.
  //
  // A case rather than a wrench, because what the drawer holds is a KIT that
  // belongs to a trade — which is exactly what a pack is — and because a wrench
  // is the pictogram every other app already ships. A ruler for „Alatke",
  // because it measures; this, because it is what you carry.
  pro: (
    <>
      <rect x="3.2" y="9" width="17.6" height="10.4" rx="1.8" />
      <path d="M9.4 9V7.2a1.6 1.6 0 0 1 1.6-1.6h2a1.6 1.6 0 0 1 1.6 1.6V9" />
      <path d="M10.4 13.4h3.2" />
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
  // The three window glyphs are drawn tighter than the house 3…21 box on
  // purpose: they are rendered at 14 px beside a 12 px label, and a shape that
  // fills its box at that size reads as a button rather than as a control mark.
  windowMinimize: <path d="M6.4 12h11.2" />,
  windowMaximize: <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.6" />,
  windowRestore: (
    <>
      <rect x="5.6" y="9.2" width="9.2" height="9.2" rx="1.6" />
      <path d="M9.2 5.6h6.2a3 3 0 0 1 3 3v6.2" />
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

  // --- Direction --------------------------------------------------------
  // Chevrons DISCLOSE (a thing opens), arrows MOVE (a thing changes place).
  // The set carried only `chevronDown`/`chevronRight`, so the missing halves
  // were being written as literal „↑" and „‹" in twenty-two files.
  chevronLeft: <path d="m14.6 6.4-5.6 5.6 5.6 5.6" />,
  chevronUp: <path d="m6.4 14.6 5.6-5.6 5.6 5.6" />,
  arrowUp: (
    <>
      <path d="M12 20.4V4.6" />
      <path d="m6.8 9.8 5.2-5.2 5.2 5.2" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M12 3.6v15.8" />
      <path d="m6.8 14.2 5.2 5.2 5.2-5.2" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M20.4 12H4.6" />
      <path d="m9.8 6.8-5.2 5.2 5.2 5.2" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M3.6 12h15.8" />
      <path d="m14.2 6.8 5.2 5.2-5.2 5.2" />
    </>
  ),

  // --- Structure and overflow -------------------------------------------
  more: (
    <>
      <path d="M5.6 12h0" />
      <path d="M12 12h0" />
      <path d="M18.4 12h0" />
    </>
  ),
  moreVertical: (
    <>
      <path d="M12 5.6h0" />
      <path d="M12 12h0" />
      <path d="M12 18.4h0" />
    </>
  ),
  menu: (
    <>
      <path d="M3.8 6.6h16.4" />
      <path d="M3.8 12h16.4" />
      <path d="M3.8 17.4h16.4" />
    </>
  ),
  // Six dots in two columns — the universal "pick this up" affordance.
  drag: (
    <>
      <path d="M9 6.4h0" />
      <path d="M15 6.4h0" />
      <path d="M9 12h0" />
      <path d="M15 12h0" />
      <path d="M9 17.6h0" />
      <path d="M15 17.6h0" />
    </>
  ),
  grid: (
    <>
      <rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.4" />
      <rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.4" />
      <rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.4" />
      <rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.4" />
    </>
  ),
  rows: (
    <>
      <rect x="3.4" y="4.6" width="17.2" height="4.2" rx="1.2" />
      <rect x="3.4" y="15.2" width="17.2" height="4.2" rx="1.2" />
      <path d="M3.4 12h17.2" />
    </>
  ),
  // Descending rule lengths: the shape IS the ordering it performs.
  sort: (
    <>
      <path d="M4 6.6h13" />
      <path d="M4 12h9" />
      <path d="M4 17.4h5" />
    </>
  ),
  expand: (
    <>
      <path d="m8 10.4 4-4 4 4" />
      <path d="m8 13.6 4 4 4-4" />
    </>
  ),
  collapse: (
    <>
      <path d="m8 6.4 4 4 4-4" />
      <path d="m8 17.6 4-4 4 4" />
    </>
  ),

  // --- Status -----------------------------------------------------------
  // Four DISTINCT silhouettes on purpose: round, triangular, round-with-tick,
  // round-with-cross. Severity must never be carried by colour alone.
  info: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11.2v5" />
      <path d="M12 8h0" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4.4 20.6 19.6H3.4z" />
      <path d="M12 10v4" />
      <path d="M12 16.9h0" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="m8.2 12.2 2.6 2.6 5-5.4" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="m9.2 9.2 5.6 5.6" />
      <path d="M14.8 9.2 9.2 14.8" />
    </>
  ),
  minus: <path d="M5 12h14" />,

  // --- Transport (the focus timer) --------------------------------------
  play: <path d="M8.4 5.4 18.6 12 8.4 18.6z" />,
  pause: (
    <>
      <path d="M9.4 5.6v12.8" />
      <path d="M14.6 5.6v12.8" />
    </>
  ),
  stop: <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.8" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.2V12l3.4 2.2" />
    </>
  ),
  repeat: (
    <>
      <path d="M4.6 10.6V9a3 3 0 0 1 3-3h11.8" />
      <path d="m16.4 3.2 3 2.8-3 2.8" />
      <path d="M19.4 13.4V15a3 3 0 0 1-3 3H4.6" />
      <path d="m7.6 20.8-3-2.8 3-2.8" />
    </>
  ),
  // Two caps and two arcs: the sand is implied by the shape, the way every other
  // glyph here implies its subject rather than drawing a filled region.
  timer: (
    <>
      <path d="M6.8 3.4h10.4" />
      <path d="M6.8 20.6h10.4" />
      <path d="M7.6 3.4c0 4.2 8.8 4.2 8.8 8.6s-8.8 4.4-8.8 8.6" />
      <path d="M16.4 3.4c0 4.2-8.8 4.2-8.8 8.6s8.8 4.4 8.8 8.6" />
    </>
  ),

  // --- Objects the modules name -----------------------------------------
  star: <path d="M12 4l2.4 5.2 5.6.7-4.1 3.9 1 5.7-4.9-2.7-4.9 2.7 1-5.7L3.9 9.9l5.6-.7z" />,
  // The one fill in the set, and it earns it: „favourited" has to read as a
  // solid at 16px, where a stroked star and a filled star are the same smudge.
  starFilled: (
    <path
      d="M12 4l2.4 5.2 5.6.7-4.1 3.9 1 5.7-4.9-2.7-4.9 2.7 1-5.7L3.9 9.9l5.6-.7z"
      fill="currentColor"
    />
  ),
  pin: (
    <>
      <path d="M12 21v-6.4" />
      <path d="M8 4.6h8l-1 5.2 2.6 2.4v2.4H6.4v-2.4L9 9.8z" />
    </>
  ),
  // The second fill in the set, and it earns it exactly as `starFilled` does:
  // „pinned" is a STATE, and a state carried by colour alone fails the house
  // rule. Hollow and solid are two silhouettes; gold and grey are one.
  pinFilled: (
    <>
      <path d="M12 21v-6.4" />
      <path d="M8 4.6h8l-1 5.2 2.6 2.4v2.4H6.4v-2.4L9 9.8z" fill="currentColor" />
    </>
  ),
  // The „no colour" choice in a swatch row, and deliberately not `close`. It is
  // a state toggle inside a group of tiles, not a dismiss — a close glyph there
  // reads as „shut the picker" — so it draws the tile itself, struck through.
  swatchNone: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m5.8 18.2 12.4-12.4" />
    </>
  ),
  tag: (
    <>
      <path d="M11.2 3.6H4.6a1 1 0 0 0-1 1v6.6a1 1 0 0 0 .3.7l8.4 8.4a1 1 0 0 0 1.4 0l6.6-6.6a1 1 0 0 0 0-1.4L11.9 3.9a1 1 0 0 0-.7-.3z" />
      <path d="M7.8 7.8h0" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.4.4l2.8-2.8a3.6 3.6 0 0 0-5.1-5.1l-1.6 1.6" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.4-.4l-2.8 2.8a3.6 3.6 0 0 0 5.1 5.1l1.6-1.6" />
    </>
  ),
  // The chain with the set's own negation slash — `eyeOff`'s convention, and it
  // is the convention because a broken chain and a whole one are the same
  // smudge at 16px, while a slash reads at any size. Detaching is not deleting
  // and not dismissing, which is why neither `trash` nor `close` can stand here.
  unlink: (
    <>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.4.4l2.8-2.8a3.6 3.6 0 0 0-5.1-5.1l-1.6 1.6" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.4-.4l-2.8 2.8a3.6 3.6 0 0 0 5.1 5.1l1.6-1.6" />
      <path d="m4.4 4.4 15.2 15.2" />
    </>
  ),
  attach: (
    <path d="M18.4 11.6l-7.6 7.6a4.4 4.4 0 0 1-6.2-6.2l8-8a2.9 2.9 0 0 1 4.1 4.1l-8 8a1.5 1.5 0 0 1-2-2l7.3-7.3" />
  ),
  copy: (
    <>
      <rect x="8.4" y="8.4" width="11.6" height="11.6" rx="2" />
      <path d="M15.6 8.4V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.6a2 2 0 0 0 2 2h2.4" />
    </>
  ),
  image: (
    <>
      <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2" />
      <circle cx="9" cy="9.8" r="1.8" />
      <path d="m3.6 16.4 4.6-4.2 4 3.4 3.4-3 4.8 4.4" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  people: (
    <>
      <circle cx="9.4" cy="8.4" r="3.6" />
      <path d="M3.4 20.4a6 6 0 0 1 12 0" />
      <path d="M16 5.2a3.6 3.6 0 0 1 0 6.6" />
      <path d="M17.6 14.8a6 6 0 0 1 3 5.6" />
    </>
  ),
  list: (
    <>
      <path d="M8.4 6.6h11.6" />
      <path d="M8.4 12h11.6" />
      <path d="M8.4 17.4h11.6" />
      <path d="M4.6 6.6h0" />
      <path d="M4.6 12h0" />
      <path d="M4.6 17.4h0" />
    </>
  ),
  archive: (
    <>
      <rect x="3.4" y="4.4" width="17.2" height="4.4" rx="1.4" />
      <path d="M5.2 8.8v9.4a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V8.8" />
      <path d="M10 12.6h4" />
    </>
  ),
  unarchive: (
    <>
      <rect x="3.4" y="4.4" width="17.2" height="4.4" rx="1.4" />
      <path d="M5.2 8.8v9.4a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V8.8" />
      <path d="M12 17.6v-5.2" />
      <path d="m9.6 14.8 2.4-2.4 2.4 2.4" />
    </>
  ),
  swap: (
    <>
      <path d="M4.6 8.4h13.2" />
      <path d="m14.8 5.4 3 3-3 3" />
      <path d="M19.4 15.6H6.2" />
      <path d="m9.2 12.6-3 3 3 3" />
    </>
  ),
  flame: (
    <path d="M13.4 3.6c.6 3.4 4.2 4.6 4.2 8.8a5.6 5.6 0 0 1-11.2 0c0-2 .8-3.4 1.8-4.6.2 1.8 1 2.8 2 2.8 1.6 0 2.2-2.2 3.2-7z" />
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 12h0" />
    </>
  ),
  trendUp: (
    <>
      <path d="m3.6 16.6 5.4-5.4 3.6 3.6 7.8-7.8" />
      <path d="M14.8 7h5.6v5.6" />
    </>
  ),
  trendDown: (
    <>
      <path d="m3.6 7.4 5.4 5.4 3.6-3.6 7.8 7.8" />
      <path d="M14.8 17h5.6v-5.6" />
    </>
  ),
  chart: (
    <>
      <path d="M4.6 20.4h15.8" />
      <path d="M7.6 20.4v-6.2" />
      <path d="M12 20.4V8.6" />
      <path d="M16.4 20.4v-8.8" />
    </>
  ),
  wallet: (
    <>
      <path d="M20.4 9.4V7.6a2 2 0 0 0-2-2H5.6a2 2 0 0 0-2 2v9.4a2 2 0 0 0 2 2h12.8a2 2 0 0 0 2-2v-1.8" />
      <path d="M14.6 9.4h6.4v5.2h-6.4a2.6 2.6 0 0 1 0-5.2z" />
    </>
  ),
  book: (
    <>
      <path d="M5.6 4.6h11.8a2 2 0 0 1 2 2v12.8H7.6a2 2 0 0 1-2-2z" />
      <path d="M5.6 17.4a2 2 0 0 1 2-2h11.8" />
    </>
  ),
  lock: (
    <>
      <rect x="4.6" y="10.2" width="14.8" height="10.4" rx="2" />
      <path d="M8.2 10.2V7.4a3.8 3.8 0 0 1 7.6 0v2.8" />
      <circle cx="12" cy="14.4" r="1.3" />
      <path d="M12 15.7v1.9" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.6" y="10.2" width="14.8" height="10.4" rx="2" />
      <path d="M8.2 10.2V7.4a3.8 3.8 0 0 1 7.6 0" />
      <circle cx="12" cy="14.4" r="1.3" />
      <path d="M12 15.7v1.9" />
    </>
  ),
  eye: (
    <>
      <path d="M3.2 12s3.3-6.2 8.8-6.2S20.8 12 20.8 12s-3.3 6.2-8.8 6.2S3.2 12 3.2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.4 6.2A9.4 9.4 0 0 1 12 5.8c5.5 0 8.8 6.2 8.8 6.2a15.6 15.6 0 0 1-3 3.9" />
      <path d="M14.3 14.5a2.8 2.8 0 0 1-3.9-3.9" />
      <path d="M6.4 7.6A15.6 15.6 0 0 0 3.2 12s3.3 6.2 8.8 6.2a9.4 9.4 0 0 0 3.1-.5" />
      <path d="m4.4 4.4 15.2 15.2" />
    </>
  ),
  shield: (
    <path d="M12 3.6l7.4 2.8v5.6c0 4.4-3 7.6-7.4 8.4-4.4-.8-7.4-4-7.4-8.4V6.4z" />
  ),
  key: (
    <>
      <circle cx="15.6" cy="8.4" r="4.6" />
      <path d="M12.3 11.7 4.4 19.6" />
      <path d="m7 17 2.2 2.2" />
      <path d="m9.4 14.6 2.2 2.2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.6 12h16.8" />
      <path d="M12 3.6a13 13 0 0 1 0 16.8 13 13 0 0 1 0-16.8z" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.6a8.4 8.4 0 0 0 0 16.8c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2a1.7 1.7 0 0 1 1.2-2.9h2.1a5.4 5.4 0 0 0 5.4-5.4c0-3.2-4.5-5.5-10-5.5z" />
      <path d="M7.6 10.4h0" />
      <path d="M10.4 7h0" />
      <path d="M14.8 7.6h0" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3.2" y="6.4" width="17.6" height="11.2" rx="2" />
      <path d="M6.8 10h0" />
      <path d="M10 10h0" />
      <path d="M13.2 10h0" />
      <path d="M16.4 10h0" />
      <path d="M8.4 14h7.2" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8.4V4.6h10v3.8" />
      <path d="M6.6 8.4h10.8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.4" />
      <path d="M7.4 16.4H7a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2" />
      <path d="M7 13.4h10v6H7z" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6.4" rx="7.6" ry="2.8" />
      <path d="M4.4 6.4v11.2c0 1.6 3.4 2.8 7.6 2.8s7.6-1.2 7.6-2.8V6.4" />
      <path d="M4.4 12c0 1.6 3.4 2.8 7.6 2.8s7.6-1.2 7.6-2.8" />
    </>
  ),
  home: (
    <>
      <path d="m3.6 10.4 8.4-6.8 8.4 6.8" />
      <path d="M5.6 9v10.4a1 1 0 0 0 1 1h10.8a1 1 0 0 0 1-1V9" />
    </>
  ),
  external: (
    <>
      <path d="M13.6 4.6h5.8v5.8" />
      <path d="m19.4 4.6-8 8" />
      <path d="M17.4 13.6v4.8a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2V8.6a2 2 0 0 1 2-2h4.8" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3.4v2.2" />
      <path d="M12 18.4v2.2" />
      <path d="M3.4 12h2.2" />
      <path d="M18.4 12h2.2" />
      <path d="m6.3 6.3 1.6 1.6" />
      <path d="m16.1 16.1 1.6 1.6" />
      <path d="m17.7 6.3-1.6 1.6" />
      <path d="m7.9 16.1-1.6 1.6" />
    </>
  ),
  moon: <path d="M20 14.4A8.6 8.6 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4z" />,
  museum: (
    <>
      <path d="M4 10 12 4l8 6" />
      <path d="M8 10.5v8" />
      <path d="M12 10.5v8" />
      <path d="M16 10.5v8" />
      <path d="M5.5 19h13" />
    </>
  ),
};

/**
 * Every icon the set ships, in declaration order.
 *
 * DERIVED, never typed out. The gallery used to hold its own hand-written list
 * under a comment claiming it showed all of them; it showed twenty-seven of
 * ninety-one, and had done since the day the second batch landed. That is the
 * defect exactly: a list somebody has to remember to extend is a list that
 * quietly stops being true, and nothing fails when it does. Reading the keys
 * off the shape table makes the claim structural — a new icon is in the gallery
 * the moment it is drawn, and there is no second place to forget.
 *
 * The cast is safe by construction: `SHAPES` is a `Record<IconName, …>`, so its
 * keys ARE the union, and `Object.keys` preserves the declaration order of
 * string keys.
 */
export const ICON_NAMES = Object.keys(SHAPES) as readonly IconName[];

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
