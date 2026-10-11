# ADR-093 — Navigation groups, the pinned shortlist and the launcher

**Status:** accepted (2026-10-09) · **Owner:** supervisor · **Supersedes**
ADR-008 decision #11 (the five PRD `category` groups, as the navigation
taxonomy; a manifest's `group` replaces the field outright) and **amends**
ADR-086 §4 (the pinned shortlist gains a second author — the user).

## 1. The finding

The sidebar lists sixteen modules under the five categories ADR-008 took from
PRD 00, and roughly twenty more are being built right now — timers, calculator,
library, culture log and music, car, pantry, cookbook, recorder, emergency
card, games, sun and moon — with reference libraries, maps and survival packs
after them. A flat list of thirty-five does not work, and neither does the
taxonomy it would be flat *under*:

- **One group would hold a third of the app.** "Professional & utilities"
  already holds Focus, Tools, Canvas, Electronics and Pro; Calculator lands
  there too. A group that is a third of the rail is a scroll region with a
  heading on top, and the heading stops helping exactly when it is needed.
- **The five names describe departments, not days.** "Content & knowledge" and
  "Growth & platform" are a registry's vocabulary. A person looking for the
  pantry does not ask which department it belongs to.
- **Five is not a smaller number than six when the five are wrong.** The
  grouping is a claim about how somebody thinks about their own modules, and
  the honest cut for a life-management app is by what you are doing: planning
  time, handling knowledge, running your life, making things, and — later —
  culture and play.

## 2. Groups replace the categories (a manifest declares `group`)

`ModuleManifest.category` is **gone**; `ModuleManifest.group` replaces it, typed
as `ModuleGroup` from `MODULE_GROUPS`, which is the canonical order:

| Group | Label (sr / en) | Ships with | Later |
| --- | --- | --- | --- |
| `plan` | Planiranje / Plan | Zadaci, Kalendar, Navike, Fokus | Timers |
| `knowledge` | Znanje / Knowledge | Beleške, Datoteke, Učenje | the reference libraries |
| `life` | Život / Life | Privatno, Finansije, Ishrana | Car, Pantry, Cookbook, Emergency card |
| `culture` | Kultura / Culture | — | Library, Culture log, Music |
| `make` | Stvaranje / Make | Alatke, Tabla, Elektronika, Stručne alatke | Calculator |
| `play` | Igra / Play | — | the games |

`registry.byCategory()` is `byGroup()`, and **every** reader of the taxonomy
moved with it rather than a second field being added: the sidebar, the launcher,
the Settings module gallery, the settings search index and the „Oblasti"
onboarding chooser. Adding `group` beside `category` was the alternative and is
the worse one twice over — every module would then declare two taxonomies that
say almost the same thing and will drift, and a group a user meets in the rail
would be called something else in the gallery two clicks away. The five names
survive as history and in the ADRs that made them; they are not labels anywhere.

**Three modules moved, and each move is the point of the change.** Učenje is
Knowledge rather than Life: it is the handling of knowledge, not an area of a
life. Privatno is Life rather than Knowledge: a sealed section is something a
person keeps, not something they study. Fokus is Plan rather than the tool
drawer: a Pomodoro phase is twenty-five minutes of a day you planned, and the
old grouping's own comment ("a timer is a TOOL rather than an area of a life")
was true of a sixteen-module rail and is not true of one where the tool group is
where you make things.

**`shell` is a group and is not a heading.** „Kontrolna tabla" and
„Podešavanja" are the two rows nothing may switch off (`LOCKED_MODULE_IDS`), so
they belong to no subject and the rail draws them at its two ends, outside every
block: the home surface heads the list, the settings page closes it. They live
in `MODULE_GROUPS` anyway so that every manifest declares its place and a test
can assert that the shell's members are exactly the locked pair.

**Documents and People have nothing to assign.** Both were named in the brief
and neither is a module: „Dokumenta" is a view of the CALENDAR page
(`DocumentsPanel`, with `DocDeadlines` inside it) and „Osobe" is another
(`PeoplePanel`) — they are sub-views of one registered module, they have no
manifest, no flag and no row of their own, and they therefore ride Calendar's
`plan` group wherever they are opened from. A registry row for either would be
a new module, which is a different decision and nobody's to make here.

## 3. The pinned shortlist is the user's (ADR-086 §4, amended)

ADR-086 introduced `nexus.nav.pinned.<profileId>` and said the plan writes it
outright because it had "no chooser and no prior author". It has both now: every
rail row and every launcher tile carries a pin toggle, so the shortlist is a
preference the user owns.

- `pinModule` appends, `unpinModule` removes, `movePinned` moves — three pure
  functions, so the toggles, the drag and the keyboard all write through one
  path and cannot disagree about what the order means.
- **The cap is five, and it is the plan's own number**, not a second one. A
  shortlist that reached seven would be half the sidebar restated above the
  sidebar; at thirty-five modules a rail that quietly grew a second copy of
  itself is exactly what the launcher exists to prevent. A sixth pin is refused
  rather than replacing one, and the control says why.
- **Reordering is drag or keyboard, and the two share a write.** A pinned row is
  draggable (native HTML5, identity in renderer state — the dashboard's own
  grammar) and `Alt+↑`/`Alt+↓` moves the row that has focus. Alt, because the
  rail is a list of links and a bare arrow that reordered the sidebar would be a
  trap.
- **A rerun of „Priprema" still replaces the shortlist**, on the board's terms
  (ADR-086 §6): the flow recomposes the app and the reveal screen names what it
  decided. A hand-made shortlist is not lost silently — it is lost loudly, on a
  screen the user had to open.

## 4. The launcher is where the rail stops being a catalogue

The foot of the rail gains **„Svi moduli"**, which opens an overlay listing every
*enabled* module by group as a grid of tiles: icon, name, and the one-line
description `settings.moduleDescriptions` already carries for the gallery (one
name and one sentence per module, everywhere).

- **The shell's two rows are deliberately absent.** They cannot be switched off
  and they are always on screen, one at each end of the rail; an overlay that
  offered them would be a shortcut to something already there.
- **The search grammar is the palette's**, not a second one: `foldSearchText`
  over name and description, every typed term a prefix of some folded word. That
  is what makes the search diacritic-insensitive in both locales — „ucenje"
  finds „Učenje", „djordje" would find „Đorđe", a Cyrillic query finds the Latin
  copy — and it is why a hit can surprise you with a module you did not know
  carried the word you typed.
- **↑/↓ move the highlight, Enter opens it, Escape closes.** One step along the
  reading order, which is the DOM order: the grid is responsive, so a
  left/right step would be a column count this component cannot know. The
  highlight also follows focus and the pointer, so Tab and ↓ can never disagree
  about which tile Enter would open.
- **The palette already answered half of this** — one „Idi na: …" command per
  enabled module — so nothing was added there. The launcher is the same question
  asked with a picture of the answer.

## 5. The rail's groups fold

A group heading is a disclosure: it folds its rows away, and the state is
remembered **per profile** under `nexus.nav.collapsed.<profileId>`. The stored
set is the *collapsed* keys, so a module arriving in a group nobody has folded
is expanded — which is what every new module has always been.

**The group holding the page on screen always draws open**, whatever the stored
state says. Without that rule a folded group loses its module: opened from the
launcher, from the palette, from a dashboard card or with `Alt+3`, the rail would
say only that somewhere else is active. The stored state is not rewritten when
that happens — fold a group, visit one of its modules, walk away, and it is
folded again.

There is no collapsed *rail* mode in this shell, so the brief's "collapsed mode
shows separators instead of headers" has nothing to apply to; if one is added,
that is where the rule goes.

## 6. What this does not do

Nothing about a module's page, its flag or its contracts changes: this is the
taxonomy, the rail's drawing and one new overlay. Culture and Play have no
member yet, so neither draws a heading — a group is omitted when it has no
enabled module, exactly as an empty category always was.
