# ADR-088 — „Podešavanja" becomes eight categories with sub-pages

**Status:** accepted (2026-10-07) · **Owner:** supervisor · **Supersedes
nothing.** Replaces the section index SET-014 left on the page and splits the
eleven-part „Rezervna kopija" card.

## 1. The finding

`SettingsPage.tsx` drew **twenty-seven cards in one column**, and its only
navigation was a sticky strip of chips above them. With that many chips the
strip wrapped onto several lines, a card far down the page was a long scroll
away, and the strip covered the top of the card it had just jumped to (DC-23).

Two problems sat under the strip:

- **Nothing grouped the subjects.** A name, a theme, keyboard shortcuts, a
  module gallery, notifications, backup, privacy and licences were one flat
  list, and nothing on the page said which of them belonged together.
- **„Rezervna kopija" held eleven blocks.** Backup, auto-backup, restore, the
  calendar export and seven importers (archive, `.ics`, Anki, tasks CSV,
  statement CSV, AI assistant, Markdown) lived in one card, so the import a
  reader came for sat below exports they did not.

The chip index helped a reader who already knew a card's name. It did not show
what the page held, and it did nothing for the backup card.

## 2. The decision

**Eight categories, each a pane with its own cards and, where a category has
more than a handful, one sub-page list.** The table lives in
`settingsCategories.ts` as data — ids, icons, card ids and sub-page lists — and
the page renders what it says; nothing about membership or order is decided in
JSX, so the one class of defect this page can produce (a card that is on the
page and unreachable) is a failing unit test rather than a screenshot.

| Category | Cards | List |
| --- | --- | --- |
| Profil i sigurnost | Profil, Profili, Sigurnost | |
| Izgled | Izgled | |
| Tastatura | Prečice | |
| Moduli | Kako je Nexus podešen za tebe, Moduli, Paketi alatki, Napomene | **Podešavanja modula** |
| Obaveštenja | Obaveštenja | |
| Podaci | Rezervna kopija i vraćanje | **Uvoz i izvoz**, then Sinhronizacija |
| Privatnost | Podaci i privatnost | |
| O aplikaciji | O aplikaciji, Licence | |

„Podešavanja modula" draws one row per module card this build actually renders
(`moduleSettingsCards`, so the flag gate is the registry's, not a list here).
„Uvoz i izvoz" is the eight flows that used to be blocks of „Rezervna kopija",
each now its own card whose title is the heading that block already drew.

**All cards stay mounted.** Navigation toggles `set__section--hidden`
(`display: none`) exactly as the SET-014 filter already did, and for the same
reason: a restore preview holding its archive open, a half-typed passphrase and
an unsaved quiet-hours edit are state a keystroke or a click must not destroy.
The filter and the navigation therefore share one visibility function
(`visibleSections`), which is also what makes „search across every category"
and „show me this category" the same mechanism rather than two.

**The layout is a container query on `.set`, not a media query on the window.**
The app's own sidebar takes 220px of the window before this page sees any of it,
so the viewport is the wrong measure of „is there room for two columns". At
760px of the page's own width the rail appears beside the pane; below that the
same location is a phone-style drill-down whose root is one card of eight rows.
The location is kept in a module-level variable for the session — it is a
browsing position, not a preference, and it is never written to disk.

**The active state is typographic.** The rail is `NavItem`s: accent ink, extra
weight and the ✦ marker, which is the app's single active-state recipe and the
founder's 2026-07-05 ruling. No pills, no filled backgrounds, no side bars, no
tabs-as-selection — and while a query is active every rail row carries its hit
count instead of the active mark, because the counts are the answer the reader
is looking at.

**Settled details the page would otherwise decide ad hoc:**

- DOM order is visual order. The cards are rendered grouped by category in the
  table's order, and under a query the category headings sit between the
  groups.
- Navigation scrolls the page's scroll container to the top and moves focus to
  the pane's heading (`tabIndex={-1}`), so a screen reader announces the page
  that just opened.
- The rail is a roving-`tabIndex` list: Arrow Up/Down move, Home/End jump, and
  Tab leaves the rail for the pane.
- A sub-page keeps the card's own title *and* draws the pane heading; the
  block's inner eyebrow is suppressed (`showTitle={false}`) because it would be
  the title a third time. The search hit then rides the card title
  (`.set__hit-card`), so a matched import flow is still the one thing on the
  page that is marked.

## 3. Consequences

- **The screenshot harness navigates.** Every settings frame now clicks the
  category (and the sub-page row, where there is one) before it scrolls, because
  a `display: none` card is not scrollable. `OPEN_SETTINGS_LOCATION` is that
  route in one helper; a scene written once covers both layouts, since the
  category row exists under the same selector in each. Three frames were added:
  `settings-modules`, `settings-data`, and `settings-root` at the narrow size.
- **Search spans categories.** `matchSettings` already answered with every
  matching section; the page now shows all of them at once, grouped under
  category headings, instead of narrowing a one-column list. The entries for the
  eight moved flows changed their `section` and kept their hit ids, so every
  highlight still lands where it did.
- **The chip index is gone**, along with `SHELL_SECTIONS_BEFORE_MODULES` /
  `SHELL_SECTIONS_AFTER_MODULES`, `SectionIndex`, and its `indexLabel` copy. A
  module added to `shared/modules.ts` still needs no edit here.
- **A card can be hidden by two mechanisms** — the filter and the location —
  but not by two answers: both go through `visibleSections`, which is pure and
  unit-tested.
- **`stickyOffset.ts` has no call site now, but stays.** Its only one was the
  index strip's measured height, and DC-23 still names the hook as the fix for
  two OPEN instances in the notes editor; deleting it would leave that document
  pointing at a file that does not exist. Its doc comment says so.

## 4. Alternatives rejected

- **Tabs across the top.** A tab strip is a filled/underlined selection
  indicator, which is exactly the shape the design direction bans; it also
  scales to about five labels, and the categories are eight.
- **Keeping the chip index and only splitting the backup card.** This is the
  smaller change and it does not show what is here: an index of twenty-seven
  short titles is a list of everything, printed twice.
- **Unmounting the cards a category does not own.** The cheapest way to make
  the DOM match the screen, and the one that throws away a restore preview on a
  rail click. `display: none` costs a larger DOM and buys the rule that
  in-progress state survives navigation.
- **Making the category a URL/document-level route.** Nexus has no router for
  page-internal position, and inventing one for a page whose state is a browsing
  convenience would put a history entry behind every rail click.
- **Persisting the location.** It is a position, not a preference: a reader who
  navigates to „Podaci" once does not want the app to open there a week later,
  and Settings already has two profiles' worth of real preferences to store.
