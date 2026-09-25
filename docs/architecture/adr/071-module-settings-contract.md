# ADR-071 — The per-module settings contract (SET; no migration, no interchange change)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Requested by the
founder**, verbatim: „refaktoriši tako da nam bude lakše nadalje". · **Sibling
of:** ADR-045's widget contract.

## 1. The problem is arithmetic, not taste

`SettingsPage.tsx` is ~5000 hand-composed lines. Every module's settings are
written into that one file, which was right at six modules and stops scaling
long before fifty. The registry already publishes manifests, and ADR-045 already
proved the shape once: **manifests publish widgets, the registry resolves
`moduleId:widgetId`, and the dashboard composes from that** instead of
hard-coding cards. The settings contract is that design's sibling and must be
recognisably the same, not a second invention.

## 2. The boundary IS the design

Two kinds of settings live on that page, and conflating them would produce a
worse abstraction rather than a bigger one:

- **Module settings** — owned by a module and meaningless without it (the task
  page's preferences, the calendar's clock / first day / semester dates, the
  notes editor width and markdown toggle, STUDY's settings, PRIV's section
  settings). **These move to the contract.**
- **Shell settings** — the app's own, true whatever modules exist (appearance,
  account and passcode, notifications, data/backup/restore/import, keyboard
  shortcuts, and the module gallery itself with its onboarding-rerun row).
  **These stay hand-composed, deliberately.**

A contract that also swallowed the passcode panel would be an abstraction that
has stopped meaning anything. The boundary is written into the contract's doc
comment so nobody later "finishes" the refactor by dragging the shell through it.

## 3. What the contract is

- A settings declaration on the manifest, in the **same shape family** as
  `WidgetContract`, with a **closed vocabulary** of field kinds — the ADR-059
  `configFields` lesson (count / choice / taskLists). An open escape hatch
  becomes "render arbitrary JSX" within two modules, which is where we started.
- It carries **both storage kinds honestly**: some module settings are
  device-local (`localStorage`, the `accent.ts` idiom) and some are per-profile
  rows. Neither is forced into the other's storage.
- The page composes module sections from the registry, in registry order, and
  renders nothing for a disabled module.
- **`settingsSearch.ts` derives its module entries from the same declaration.**
  The hand-written twin was exactly the drift this refactor exists to kill.
- The folding-but-still-**mounted** rule survives untouched: sections hide with
  CSS and stay mounted so a restore preview, a half-typed passcode or unsaved
  edits survive typing in the filter box.

## 4. The bar

**No behaviour change.** Every control still exists, in the same card, with the
same copy, writing the same thing to the same place, matching the same search
words. The proof the refactor worked is a test that registers a fake module
carrying settings and asserts the page and the search index both pick it up
**with no edit to `SettingsPage.tsx`** — after this, adding a module's settings
is a declaration plus a component, and that file stops growing.
