# Nexus — Project Status

**What this document is.** The state of the project today: what works, what is
being built, what is not done yet, and what is waiting on a decision from the
founder. It should be readable in one sitting.

**What it is not.** A journal. Finished work moves to [log/](log/) as soon as it
finishes, and recurring failure shapes go to [defect-classes.md](defect-classes.md).
If a sentence here describes work that is already done, that is a defect in this
file.

**New agent, read in this order:** [../CLAUDE.md](../CLAUDE.md) (how we work and
the binding rules) → §1 and §2 below (where we are, what exists) → §4 (what is
left) → §5 (what needs the founder). [README.md](README.md) maps every other
document.

**Last updated:** 2026-10-04. The state below was verified on that date against
`main`, and against the branch named under „Unmerged work" for what is not on
`main` yet. Deliberately no commit sha: a sha in a header goes stale the moment
anything is pushed, which is the defect class this file keeps recording.

**Read alongside:** [OVERVIEW.md](OVERVIEW.md) (plain-language tour) ·
[SPECIFICATION.md](SPECIFICATION.md) (the whole product) ·
[roadmap.md](roadmap.md) (what order).

**Where things stand (2026-10-08).** The desktop application is finished and
the repository is public. The latest release, **1.5.0**, is tagged `v1.5.0` on
`main`, built by the release workflow and published with its checksums, their
Ed25519 signature, an SBOM and build provenance; 1.4.0 was the first. The installer is unsigned, and web and
sync are paused.

---

## 1. Where the project is

**The desktop app is finished, and the repository is public.** Sixteen modules,
all usable end to end, on an encrypted local SQLite database with no network
path; the only connection Nexus can open is the update check, and only when the
user turns it on. It installs like an ordinary Windows program and the founder
has used it daily since 2026-08-02. The first public release is **1.4.0**,
tagged `v1.4.0` (§4), and the latest is **1.5.0** (2026-10-08); every installer
before 1.4.0 was built by hand and never tagged, the last being 1.3.0, from
`eceb07e` on 2026-09-23.

**The interface ships in two languages** (2026-10-02). English joins Serbian as
a whole second table, `strings.en.ts`, checked against the Serbian-derived
`Strings` type so a leaf left untranslated or a key invented is one compile
error each. First run follows the system language — Serbian when it reads `sr*`,
English otherwise — and the device remembers the choice from then on, with
Settings → Appearance switching it at runtime. The main process learns the
choice over a `locale:set` report, so native dialogs and OS notifications follow
the same language, and the demo profile seeds its content in it too.

**The choice reaches the numbers as well as the words** (2026-10-04). Every
date, time, duration, number, unit, file size and money figure the interface
draws is produced through one `intl.ts`, and every alphabetical list sorts with
the active locale's collator — an English reader sees `1,234.50` and
`2 October`, a Serbian reader `1.234,50` and `2. oktobar` — with nothing
capturing a formatter at import time, so the switch takes effect without a
reload. The shipped catalogues carry English names: the 426-entry food table
(`nameEn`/`labelEn`/`notesEn`), the 230 exercises (their existing `nameEn`), and
the 153-entry electronics catalogue (`nameEn`/`summaryEn`), with both food and
component search matching either language. The generated Arduino sketch and ROS
package take a `GeneratedLanguage` so an English session writes English files,
and the business demo seeder carries the same `EN` map the others do. `<html
lang>` follows the locale on both the desktop and the web shell, so assistive
technology reads the same language the copy does.

**Web and sync are on hold permanently** (founder, 2026-10-08; paused since
2026-08-31). Nexus is positioned as an offline application: no public copy
mentions sync, cloud or a web app, and nothing in §4.2 is scheduled. The code
stays in the repository and in CI, so it keeps building and passing, but no work
is planned on it.

**What exists of sync is real, and it has never run against the real server.**
The server half ran against a real Postgres 17: 14 migrations, an RLS wall
proved by 165 pgTAP assertions in CI, and the wire measured against a running
PostgREST. On the client side, `@nexus/sync-engine` drives sweep → pull → push,
`syncRound.test.ts` runs two real SQLite databases against one server (a
creation, a deletion and a two-device merge), and the scheduler
(`createSyncLoop`) and desktop wiring (`runSyncRound`, `createSyncScheduler`)
are built. What has never happened is a round against a deployed Supabase
project: nothing here has `MAIN_VITE_SUPABASE_URL` set, so every round refuses
`cloud_off` before making a request. That is the boundary working, and also why
no round has run for real. It is the head of the web/sync queue.

**The installed 1.3.0 can erase a board in „Tabla"; the fix is in the tree and
not in any installer yet** (found and fixed 2026-09-26, [[DC-144]] in
[defect-classes.md](defect-classes.md)). Opening a board — or changing one — and
then going to another module within about a second wrote an empty drawing over
it. It is proven on 1.3.0, the last installer built; the exit flush that does it
dates from the canvas's first slice (ADR-079 §11.6), so every installer built so
far is likely to carry it, and 1.4.0 is the first that will not. Until 1.4.0 is
installed, wait two seconds after opening or changing a board before going to
another module — opening counts as a change. A board that is already empty can
only come back from a backup (`.nexus.zip`) taken before it emptied.

**Elektronika, the sixteenth module, is complete.** E1–E6 are all built and
verified, and the module is in the 1.3.0 installer. Two open ends remain, neither
blocking; both are §5 items.


|  |  |
| --- | --- |
| Desktop version | **1.5.0**, released as `v1.5.0`: unsigned, with its fuses read back |
| Installer bytes | 183 215 709 (1.5.0, as published) · `sha256` 3737A3DC… — the release's signed `SHA256SUMS.txt` |
| Linux | AppImage, tarball and a Gentoo ebuild, all built and verified |
| Modules registered | **16** |
| Local migrations | **70** (latest `070-circuit-search`) |
| Server | 14 Supabase migrations, 3 Edge Functions, 165 pgTAP assertions |
| Static gates | **26**, each its own CI step |
| Commits | **787** on `main` at `v1.5.0` |
| Unmerged work | none |
| Open pull requests | none at the 1.5.0 release |
| Git tags / GitHub releases | `v1.4.0`, the first (§4), and `v1.5.0` |
| Repository | public since 2026-10-05; `main` changes only through a pull request with CI green (ruleset `main`, no bypass) |

---

## 2. What is built

### Foundations

- **Monorepo** — pnpm 11 + Turborepo, TypeScript 5.9 strict
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), React 19, Vite 7,
  Vitest. Packages: `tokens`, `core`, `db`, `ui`, `sync`, `sync-crypto`,
  `sync-engine`, `sync-port`, `sync-transport`. Apps: `desktop`, `gallery`,
  `web`.
- **Encrypted storage** — one local SQLite file through
  `better-sqlite3-multiple-ciphers`, opened only under a passcode-derived key
  wrapped by DPAPI and by the Recovery Kit. Forward-only migrations, UUIDv7
  keys, soft-delete for undo. Attachment blobs are AES-256-GCM containers under
  the same data key. ([ADR-018](architecture/adr/018-local-account-passcode.md),
  [ADR-019](architecture/adr/019-encrypted-blob-store.md))
- **Hardened Electron shell** — `contextIsolation` + `sandbox` on,
  `nodeIntegration` off, navigation and window-open locked, strict production
  CSP. The database lives only in the main process; the renderer reaches it
  through a frozen, one-method-per-channel, per-field-validated IPC bridge.
- **A renderer loaded by page** (2026-09-26) — startup parses the shell and
  nothing else; each of the sixteen pages is its own chunk, loaded the first
  time it is opened (`routes.tsx`), and so is each professional toolkit, the
  first time one of its tools is (`proToolSurfaces.tsx`). `routes.test.ts`
  fails if anything the shell imports reaches a page statically. `smoke` opens
  every page and every tool from the built renderer, under the production CSP,
  and fails if one does not arrive or does not draw. Every package declares `sideEffects`, and
  `scripts/package-side-effects.test.mjs` keeps each declaration true. The
  renderer is minified; the main process deliberately is not, so the crash
  dialog Electron shows for an uncaught main-process error still names its
  functions (`electron.vite.config.ts` says why).
- **Design tokens** — a three-tier Dan/Noć pipeline to CSS variables; every
  colour, space, radius and type value is a `--nx-*` token, with a gate that
  keeps raw hex out of the tree.
- **Headless views engine** — one filter/sort/group core (sr-Latn-correct
  collation) behind list, kanban, cards and calendar-grid presentations, so any
  module's data gets all four.
- **Interchange** — a versioned `.nexus.zip` archive (NDJSON + Markdown/CSV
  mirrors), encrypted under an export-time passphrase, with restore and merge.
- **The profile plan** (2026-08-23, [ADR-086](architecture/adr/086-profile-plan.md))
  — the layer that makes one build of the app arrive differently for different
  people. Six organic questions produce `Signal`s, `buildProfilePlan` turns
  those into a `ProfilePlan` (modules, professional packs, a dashboard, the
  calendar's opening view, the accent, a capped sidebar shortlist) and
  `applyProfilePlan` writes it. Four laws hold it honest: **no signals means the
  app exactly as it is today**; the plan is total over the live registry, so a
  module added next year is planned for without editing the questionnaire; every
  board entry is a widget something actually publishes; and **every decision
  names at least one answer that caused it** — which is what the reveal screen
  and the Settings card „Kako je Nexus podešen za tebe" read out loud. The
  **answers** are what is stored, never the plan, so the explanation cannot drift
  and re-running the questionnaire a year later gets the modules that exist then.
  The plan never turns a module OFF.
- **Twenty-six static gates in CI**, registered in `package.json` and each its
  own CI step so a red check names the rule. **They are deliberately not listed
  here.** The list is generated from `package.json` by
  `scripts/ci-workflow.test.mjs`, and the hand-kept copy that used to stand in
  this bullet had already lost four of them — [[DC-109]]: a list beside a
  generated list fails by omission, and the omission looks exactly like a gate
  that is fine. `CLAUDE.md` carries the full set with the rule each one holds.
  Every one of them exists because a class in [defect-classes.md](defect-classes.md)
  could not be caught by review; the newest, **`check:runner`** (2026-09-22), is
  the one that keeps a process from being started by data.
  **`check:names`** (2026-09-22, DC-131)
  is the one that reads the ACCESSIBLE name: a `<label>` that wraps its control
  takes the element's whole text content as that control's name, so a hint
  inside the label joins it. Four rows were read that way — PRIVATNO's four
  credential choices, whose radios heard „Zasebna šifra za Privatno Zasebna
  šifra ostaje na ovom uređaju…" — and the sweep cannot see it, because an
  accessible name is not in the picture.
  `check:controls` (2026-09-02, DC-98) is the design system holding its own
  rule, and since 2026-09-08 it holds **two**: `packages/ui` replaces the OS
  radio and checkbox with a CLASS, and the OS select with a COMPONENT. A native
  `<input type="radio">` renders at 13×13 — grey in Dan and grey in Noć, because
  the OS does not know the app has themes — with a pointer target eleven pixels
  under the floor; it has now been written three times, and the third had been
  sitting unnoticed in the fitness routine editor. A hand-written `<select>`
  keeps the operating system's own arrow inside a form whose other controls do
  not, and that half accepts no class at all, because none would make it right
  (DC-121). Nothing else can see either: they use no colour, declare no token
  and typecheck, so the only check that ever caught one was the screenshot sweep
  — which holds exactly where the camera goes, and cannot drive a form three
  modal steps inside a create flow.
  `check:address` (2026-08-23, DC-80) is a rule about **Serbian grammar**: the
  past tense agrees with its subject, so „šta si uneo" has chosen the reader's
  gender, and the only one this product ever chose was masculine. Forty lines
  shipped that way — several of them a house convention six file headers told
  the next author to copy — and nothing else could see them: the text is valid
  Serbian, valid TypeScript, and photographs correctly. It was widened on
  2026-08-30 to watch predicative **adjectives** („ako nisi siguran" picks a
  gender exactly as „uneo" does) and to read a `"…" + "…"` chain as one
  sentence, since the copy is hand-wrapped near 100 columns; each widening had a
  live line behind it, and the second is how the fortieth was found. On
  2026-09-01 it grew a third time, in what it READS rather than in what it looks
  for: „only the copy tables" was the whole of the Serbian right up until
  ADR-085 E4b started *generating* it — a README, a Python docstring and a
  manifest description, written into files the user opens outside Nexus. It now
  also scans main's native-dialog strings and every non-test source under
  `packages/core/src/electronics/`, the catalogue's 153 component summaries
  included. `check:elec` (2026-08-21) is a rule over a REACHABILITY SET: a
  `--nx-elec-*` token — DEV-006's exemption, and the only place blue and orange
  are allowed — may be read or declared in `styles/electronics.css` and nowhere
  else. `check:rows` (2026-09-09, DC-122) is a rule about a row's CONTENTS
  rather than its name: a labelled `TextField`/`Select` is two boxes tall and a
  bare input, button, checkbox or `inline` select is one, so a flex row holding
  both has children of two heights — and there `align-items: center` centres
  the BOXES and leaves the CONTROLS half a label apart. It reads the markup and
  the stylesheet together, because neither carries the discriminator alone, and
  it fires only where the children mix, which is why the fifty-odd toolbars and
  chip rows that are correctly centred need no exemption list. Their own suite
  is 547 tests across 33 files — twenty-five unit suites for the gates that live
  in `scripts/` (the twenty-sixth, `check:rls`, is tested in
  `supabase/tests/static/`) and eight for the shared scanners, the root config,
  the CI step list and the run lock.
- **Packaging** — NSIS per-user installer, a Serbian uninstaller that defaults
  to keeping data, an app icon, and ADR-089's updater — no electron-updater and
  no feed: a check against the GitHub release API, offered only in „offline +
  update checks" mode and verified against a key compiled into the app.
  Chromium's and Node's own notices ship
  beside the executable (confirmed by watching a real build, 2026-08-16).
- **A root `Makefile` as the build entry point** (2026-08-16, `a438e32`, on
  `origin/main`). It wraps the existing pnpm scripts and adds only the two
  things the Linux build actually gets wrong: `pnpm build` before `dist` as a
  prerequisite rather than a sentence in a README, and a host guard, since the
  SQLite native module is fetched per `process.platform` and a cross-built Linux
  archive dies at the first query. Both guards are prerequisites, so the refusal
  arrives before `install` and `build` rather than after them; `.NOTPARALLEL` is
  set because `-j` would break the guard ordering and race the two over the same
  `node_modules`. Documented in the tracked `README.md` — the Linux build was
  previously described only inside the Gentoo overlay's README, which is not
  where anyone looks. **No `make` binary exists on this machine**, so the layout,
  every recipe under `bash -n`/`dash -n`, and the guard recipes executed directly
  were verified; no target has been run end to end.

### The modules

Sixteen registered modules, each enabled per profile and usable end to end, plus
onboarding — which is a flow rather than a module and so carries no manifest.

| Module | State |
| --- | --- |
| **Onboarding** (ONB) | Rebuilt 2026-08-23 ([ADR-086](architecture/adr/086-profile-plan.md)) — six screens (name, four organic questions about the person rather than about the software, notification appetite), then „Priprema" and the „Evo tvog Nexusa" reveal. Nothing is a checkbox over a module list; the module list is still reachable, once, behind „Napredno". |
| **Dashboard** (DASH) | Whole — edit mode with drag/resize, a widget gallery, several named dashboards, per-widget configuration, a background image. |
| **Tasks** (TASK) | Complete — priorities, due dates, sub-tasks, lists and sections, recurrence, dependencies, templates, attachments, four views, smart lists, batch edits, undo. |
| **Calendar** (CAL) | Complete — month/week/day/agenda, drag and resize, recurrence, birthdays, semester dates, the document-expiry tracker with per-type reminder ladders, ICS in and out. |
| **Notes** (NOTE) | Complete — Yjs CRDT documents, folders, categories, tags, attachments, wiki links with backlinks, version history, templates, inline flashcards. |
| **Private notes** (PRIV) | Built — zero-knowledge vault with its own Recovery Kit, separate from the account's. |
| **Files** (DOC) | Built — tiered preview for PDF, images, text, code, spreadsheets and archives, all sandboxed. |
| **Study** (STUDY) | Complete — FSRS scheduling, cloze and problem cards, KaTeX, interleaved practice, the backward exam planner with re-planning, Anki import, honest statistics. |
| **Finance** (FIN) | Complete — accounts, transactions, categories, budgets, subscriptions with pause, CSV statement import. Each currency separate; **Nexus never converts**. |
| **Habits** (HABIT) | Complete — daily/weekly quotas, a completion calendar, gentle streaks. |
| **Fitness** (FIT) | Complete — a 426-entry public-domain food catalogue with per-number provenance, meal logging, a 230-exercise Serbian catalogue, sessions and routines, personal records and 1RM trend, body measurements with measured energy expenditure. |
| **Focus** (FOCUS) | Built — one timer for the whole app; a study session and a Pomodoro phase are the same row. |
| **Tools** (UTIL) | Built — the everyday drawer of converters and calculators. Eleven tools, so it opens ON one: the tool this device used last, or the first in the rail. |
| **Professional tools** (PRO) | Built — 18 toolkits, **322 tools** (counted 2026-09-26: 274 across the seventeen professions, 48 in the developer toolkit), 1 991 hand-derived assertions. Each toolkit's surfaces are fetched the first time one of its tools is opened. `riskClass` is a required contract field that draws the tool's notice, the line appended to every copied result, the Settings long form, and whether a surface may render a verdict at all. Its resting surface is the drawer's own index — the toolkits this profile chose, who each is for, and what it gave them — over „Nedavno". |
| **Canvas** (CANV) | Whole — Excalidraw driven through its imperative API behind our own Serbian toolbar, with notes, tasks and events as live cards that arrows bind to. |
| **Electronics** (ELEC) | **All six slices complete** ([ADR-085](architecture/adr/085-electronics-module.md)) — a 153-component catalogue, a pan/zoom bench with rotation and snapping, two-click wiring in the trade's nine jumper colours, a panel that reports the *electrical* faults too (thirteen rules over a derived net model, from a 5 V rail on a 3.3 V part to two I²C devices strapped to the same address), and „Kod": the code the wiring implies — an Arduino sketch for a microcontroller, a ROS 2 `ament_python` package for a board that runs Linux — previewed in the app and written out through the native dialog the artefact calls for (a save dialog for the `.ino`, a directory picker for the package, and main decides which from the stored circuit). And „Mašina": two parametric chassis and nine measured numbers turn the mounted sensors into a URDF that ships inside the ROS 2 package, listing what it has no honest geometry for rather than guessing at it (ADR-085 §8, answered 2026-09-01). And „Klupa" (E5): the same derivation running on a deterministic clock — one channel per board pin that carries a signal, with its direction, its unit, its ROS topic and a waveform the *user* declares, plus the one warning a static rule cannot give (a value above the board’s logic level at THIS tick). And **E6, the external runner**: the module can hand the generated workspace to a real toolchain — `colcon build`, natively, through WSL2 or in a Docker container pinned by digest — with the command line written down in one table in source, off until the user consents once, one run at a time, and killed on quit. All six slices are complete. |
| **Settings** (SET) | Built — themes, accent, module switches, per-module preferences, remappable shortcuts, notification appetite and quiet hours, profiles, scheduled encrypted backups, third-party notices. |

Plus **global search** (Ctrl+K over every module, Serbian-fold-correct, with a
command palette) and **notifications** (OS-level, snoozable, with a cleanup
contract).

Both tool drawers are **one page** and, since 2026-08-21, one *instrument*: a
bordered box that fills the pane with the rail and the surface scrolling
independently inside it, the search pinned at the head of the rail, and every
form a grid rather than a column of full-width controls — so a tool's ANSWER
sits beside its inputs instead of below the fold. One stylesheet rule reaches
all 327 surfaces; none of them was edited.

### The server and sync substrate

Built, executed, and not yet reachable from any screen.

- **14 Supabase migrations** applied to a real Postgres 17, with **165 pgTAP
  assertions** (the sum of `select plan(…)` across `tests/database/`) running in
  CI against the whole stack rather than a bare
  container. Running it rather than reading it is what proved that
  `storage.objects` and `realtime.messages` can never be FORCED on a Supabase
  project, and that `anon` is refused at the privilege layer before any policy
  is consulted.
- **`@nexus/sync-transport`** — the wire, *measured* against a running
  PostgREST. Four of its rules contradict what a careful reader would assume: a
  filter value must be percent-encoded and never quoted; a PATCH matching no row
  is a silent HTTP 200 `[]`; upsert is `403 42501` for clients; `max_rows`
  truncates without saying so.
- **`@nexus/sync-crypto` / `@nexus/sync-port`** — the three-key hierarchy
  (`DK` local, `MK` master sync key, per-profile content keys), verified against
  external RFC and reference-C vectors.
- **Cloud-off is structural, not a promise** — a four-layer packet boundary
  built *before* any network code, plus `check:egress` over a build that must be
  able to make none.
- **`apps/web`** — a shell: the desktop's own rail rendered by the same
  `@nexus/ui` components, the theme, and a typed `NexusApi` proxy that throws
  until something connects it.
- **Recovery-Code adoption, end to end** (2026-08-16) — the second computer can
  now join an account that already has a master key, which is the answer
  `enableSync` gives as `already-minted` and, until now, a sentence pointing at
  nothing the user could press. `SyncService.adopt()` over the eight-step
  protocol that already existed, channel `sync:adopt` with per-field validation,
  the Serbian copy typed `satisfies Record<SyncAdoptProblem, string>`, a second
  mode on the enable form, and a `settingsSearch` entry keyed to the words people
  actually type („oporavak", „kod", „drugi računar"). Nine new service tests run
  **two machines against one fake server** — the code the first one printed is
  what opens the second one's read of `mk_under_src`, so the round trip is
  exercised rather than asserted. Two defects fell out of writing it: the shared
  fake ignored PostgREST's `kind=` filter and handed adopt the wrong row (a fake
  that ignores a filter tests the fake, not the caller), and `enable` erased the
  master key only on the success path — a `save` that threw left MK live in the
  process, now a `finally` in both flows.
- **The apply path, and the repair it needed** (2026-08-16, `22177b2` +
  `22e8a83`) — the pull could produce a merged `RowState`; nothing could write
  one back. `SyncJournal` now does both directions, and four rules that were
  recorded here as owed are enforced in code instead: the row and its shadow
  state are one write **per object** (a savepoint each, so a row whose parent is
  a page further down the cursor does not roll back the forty that applied);
  the apply flips migration 063's own trigger flag off for the transaction, so
  it cannot echo; a journaled-but-unswept object is **refused** as `stale`
  rather than applied over the user's edit; and `changed: false` still writes the
  state, because `changed` excludes the version and the version is what the next
  push's compare-and-swap rests on. Ahead of it, `repair.ts` closed DC-14 — the
  eleven coupled CHECKs get a deterministic repair that fixes the row **written
  locally** and never the `RowState`, which is what makes it echo-free, lossless,
  and beatable by a real user fix. Fifteen apply tests are round trips between
  two real databases; the repair is proved against each CHECK's text lifted
  verbatim out of `sqlite_master`.
- **What a round survives being interrupted by** (2026-08-16, `d2f94a5` +
  `1929116`) — migration 066 and the two stores over it. `sync_cursor` is the
  pull watermark, local because it is authoritative: the server's `sync_state`
  copy is advisory by migration 001's own words, and a device that obeyed it could
  be rewound into re-downloading everything or advanced into skipping rows
  silently. The `max` that stops it going backwards lives in the SQL, not at the
  call site, because a pull deliberately starts *behind* the stored cursor and „the
  number this page produced is lower" is the normal case. `sync_outbox` closed a
  real defect rather than adding a feature: `sweep` wrote the state and dropped the
  journal entry before any push, so a failed push left an object clean locally and
  unsent that no later sweep could rediscover — an object edited once and never
  again would simply never reach the server. It is written inside `sweep`'s own
  transaction and cleared only when a server accepts, and the queue drains
  least-failed first so an unsendable row sinks instead of blocking the batch.
  `sync_quarantine` gives `applyPull`'s quarantined rows the same durability in the
  opposite direction — re-fetched by key rather than re-pushed — and its CHECK
  refuses `no-key`, which holds the cursor and is never quarantined. Twenty-five
  tests, written red first, plus two mutations to prove the arithmetic rules bite.
- **The object id, and the parent a pushed row names** (2026-08-16, `29e6493`) —
  `parentIdOf` in `@nexus/sync`. The trap it exists for: `fieldColumns` subtracts
  the identity columns from the field map, so for `note_versions` and
  `note_updates` — whose identity begins with `note_id` — the parent key is not a
  field of the state and never will be. `state.fields[key]` would have answered
  `undefined` for two of the eight parented collections every time, and the only
  symptom would be a quietly null hint. Two of its tests are the derivation's
  PRECONDITIONS: every `profileVia.parent` is a collection identified by a single
  column, and every `profileVia.key` is a column the collection really carries.
  In the same pass the object-id encoding moved to `@nexus/sync`, which owns the
  wire — it had been written in three places and owned by none, and the browser
  will have to split one with no `@nexus/db` in sight.
- **THE LOOP** (2026-08-17, `e85e283`) — `@nexus/sync-engine`. One round is
  sweep → pull → push, over an injected local store, `HttpPort` and `CryptoPort`;
  it holds no database, no `fetch` and no clock, so a build that never constructs
  the ports cannot reach the network. Sweep first because the write-back refuses
  an object whose local edit is still journalled; pull before push because
  `owed()` reads the shadow state through a JOIN, so an object owed before the
  pull is owed at its MERGED state afterwards — one row instead of a stale push,
  an NX001 and a second round. The pull walk carries **two** watermarks: where
  the next page starts, and what is written to `sync_cursor`. They differ because
  a child that arrives before its parent is refused by a foreign key and its
  parent is often further down the same log — holding both back looks right and
  deadlocks exactly that case. `SyncStore` is declared by the engine (the
  consumer names what it needs; a browser tab has no SQLite) and satisfied by
  `syncStoreFor`, which binds the profile so a round cannot name another one.
  **`syncRound.test.ts` is the first time data has crossed between two machines**:
  two real SQLite databases and one in-memory server, carrying a creation, a
  deletion, and a two-device merge of different fields of one object.
  Two defects fell out of building it, neither of them the thing being built:
  `applyPull`'s `owed: true` had nowhere to go (the apply journals nothing and the
  row then agrees with the state, so no sweep could rediscover it — now a required
  `ApplyRequest.owed`, queued inside the row's own transaction), and the round's
  own report could not distinguish a round that changed the device from one that
  re-confirmed it (DC-60).
- **The scheduler** (2026-08-17, `8697a75`) — `createSyncLoop`, in the same
  package and holding no timers of its own: `Timer` arrives in the deps, so the
  same loop runs in the main process and in a browser tab, and a week of backoff
  takes a millisecond in a test. Its whole reason to exist is that `SyncHalt`'s
  four members need four different answers. `offline` and `malformed` are delays,
  backed off with equal jitter to a ceiling that is the idle interval itself, so
  the worst case of failing is the ordinary case of being idle. `forbidden` is
  not a delay: a revoked session is not fixed by waiting, and a timer there turns
  „sign in again" into an app that quietly never syncs. **`nonce-reuse` latches**
  — the refusal sits in `arm`, the one place a round can be scheduled from, so no
  timer, no nudge and no button resumes it, and `stop` may not take the reason off
  the screen either. One choke point rather than four checks that must all stay
  correct.
  The interval is a **deadline and not a gap**, which the tests found rather than
  the design: measured as „wait an interval after whatever ran last", a user
  typing steadily keeps pulling the wake forward into hinted rounds and the full
  walk that catches what the hints missed never runs at all. Measured from the
  last COMPLETED full round, a nudge can only make a round happen sooner — and a
  round that halted does not reset it, because it stopped in the middle of the
  collection list. 51 tests, and nine mutations to show they bite.
- **The profile's content key, on the wire** (2026-08-17, `6b4fd25`) —
  `@nexus/sync-transport`'s `keys.ts`: read every generation of one profile's
  `ck_under_mk` wraps, and mint the first. The read deliberately does not filter
  on `disabled_at`, because a retired generation is still the only key that opens
  the rows sealed under it. One bad row fails the whole response, because a
  partial read of this table is indistinguishable from „this profile has no
  content key" — and the answer to that is to mint a second one. It carries three
  base64url strings rather than a `SealedKey`, so that `wrap.ts` never enters a
  package the web bundle will one day depend on.
- **The profile's content key, on the desktop** (2026-08-17) —
  `apps/desktop/src/main/sync/contentKey.ts`: open MK from the local wrap under
  DK, read every generation, mint the first if the slot is empty, adopt the
  winner when another device got there first, and hand back a `keyFor` map that
  answers for retired epochs too. **The rule it exists to make structural** is
  „never seal a row under a key whose wrap is not already durable on the server",
  because a row sealed under a key no peer can fetch is a row no peer can ever
  open and no later repair can invent the key. It is structural rather than
  remembered: the mint erases the plaintext it generated **before** the request
  goes out, so the only path in the file to a usable key is unwrapping a wrap the
  server served. A generation this device cannot open is reported rather than
  dropped (`unopenable`) — rows at that epoch quarantine, which is the designed
  answer, but the fact has to be loggable; the same condition on the LIVE
  generation is fatal instead, since there would be nothing to seal under.
  18 tests, and the erasure is proved by watching the randomness it came from,
  which is the only way to see a local that never reaches the result.
- **The desktop wiring** (2026-08-30) — four files and an IPC surface, and the
  first thing in this product that runs a sync round.
  `main/sync/round.ts` composes one round: it refuses in a fixed ORDER, because
  the three free refusals (no ports, no account, locked) must all happen before
  the access-token refresh — a refresh SPENDS the stored refresh token, and
  spending it on behalf of a machine that was never going to send anything is
  how a device ends up needing a password next launch. `session.ts` grew
  `accessTokenForRound` for the same reason from the other side: a loop is the
  first caller with no user behind it, so it is the first that must write a
  rotated refresh token back — and a FAILED refresh writes nothing, because a
  502 must not cost the user their password.
  `main/sync/scheduler.ts` owns the loop. It maps `runSyncRound`'s nine
  refusals onto three destinations rather than the engine's two — delay
  (`offline`, `malformed`, `contested`, `locked`), halt (`forbidden`,
  `signed_out`) and stop-entirely (`cloud_off`, `not_enabled`,
  `key_unavailable`) — because collapsing them into `SyncHalt` would tell a user
  with a perfectly good session to sign in again. It also holds the nonce alarm
  ACROSS a profile switch: `createSyncLoop` latches internally, but this file
  creates loop objects, so a profile switched away from and back to would have
  received a clean latch from the only code that could bypass it. 17 tests, and
  the two load-bearing rules were proved by mutation.
  `main/sync/dataKey.ts` is four lines of arithmetic lifted out of `service.ts`
  because `round.ts` needed the same conversion: `parseInt` on a bad hex pair
  yields `NaN`, a `Uint8Array` stores that as 0, and a best-effort parser
  therefore answers a full-length key that looks fine and wraps the master key
  under bytes nothing will ever reproduce. One copy, refusing rather than
  padding, 3 tests.
  `SyncActivityView` is declared in `shared/ipc.ts` and `SyncRoundBlock` is
  DERIVED from it (`Exclude<SyncProblem, "nonce_reuse">`), so the renderer's
  Serbian sentence table is complete by construction rather than by review.
  It carries FOUR of the engine's six counts: `pulled` counts rows fetched
  including the echoes this device already had (so „Preuzeto" is `applied`), and
  `conflicts` counts pushes the server refused because a peer's row was newer,
  which the next round merges by itself. Neither has a Serbian sentence, and a
  number on a contract that no surface names is a number nobody reads (DC-55).
  The main process opens the loop on unlock and on every profile switch, closes
  it on lock, and pushes `sync:activity-changed` on every phase change so
  „Stanje sinhronizacije" watches rather than polls.

---

## 3. In progress

The desktop side of sync stops at a clean line. Nothing is half-written, no dead
branches, no disabled tests — what is missing is missing entirely, which is why
each item below is a self-contained piece of work.

### The pairing subsystem's two halves implement two different protocols

A survey done before writing the pairing transport, and the answer changes what
should be built next.

**The client half is finished and the server half is for something else.**
`packages/sync-crypto/src/pairing.ts` (1 248 lines, fully tested) implements one
protocol: the DESKTOP is the provider — it holds MK, it generates the 13-digit
code — and the BROWSER is the joiner, which receives *per-profile content keys*
and never MK. Its states, transcript, SAS and single-use burn are all built.
`public.pairing` and the `pair-complete` Edge Function implement a different
one: the BROWSER inserts the row (`initiator_pub`, `sealed_payload` and
`completion_token_hash` are all `not null` at insert), and a session-less
DESKTOP finishes the handshake through a service-role endpoint to be vouched
for. The table has no columns for the nonces or the device names the tested
transcript covers, and `grant update (initiator_confirm, burned_at) … to
authenticated` means the desktop cannot write its own half over PostgREST at
all.

**Neither half is wrong on its own.** The server half solves the harder problem
— a client with NO device row cannot pass `nexus_session_is_live()`, so
something with the service role has to relay for it. The client half solves the
problem the product actually has once a desktop is enrolled. They simply do not
meet.

**And the hole they were both aimed at now has a route that needs neither.**
With `device-register` the circle a second desktop was stuck in is open, using
only endpoints that exist: sign in and step up to `aal2` (which revokes the
account's other sessions — the same unavoidable cost the mint pays); INSERT its
own `devices` row, which lands as `web` because a client cannot write
`platform`, and `devices_insert_requires_aal2` is what makes that safe; read
`mk_under_src`, which migration 010 deliberately left readable by a non-desktop
session for this flow; open it with the Sync Recovery Code to get **MK**; sign
in again for an `aal1` session and buy a real `desktop` row with
`nexus_device_register` and the MK proof; retire the temporary web row and sign
the `aal2` session out.

That is the „Recovery Kit" route `CLAUDE.md` already names, and it is now
**built end to end** (2026-08-16, `3696eda` — see §2). It needed no migration
and no Edge Function: one transport call, one crypto composition
(`deriveSyncRecoveryKey` + `unwrapKey`), a main-process flow, and a second mode
on the enable form.

**What that leaves for pairing:** when it is built, the rendezvous table must be
reshaped to the protocol that is actually implemented and tested — the two halves
above still do not meet, and adoption did not make them. **Whether
desktop→desktop pairing is still wanted at all is a founder question, and it is
in §5.**

*One stale schema comment will be fixed with that work:* `devices.platform`'s
column comment says „only pair-complete (service_role) may write ''desktop''".
There are now three writers — `nexus_mk_mint`, `nexus_device_register` and
`pair-complete` — so the sentence is false in a comment whose whole job is to
say who may write the column. Same shape as DC-22, one layer down.

### What the sync subsystem still owes, in one place

Kept here rather than scattered through the code, because each is a rule the
engine must obey and none of them is visible from the file that will need it.

**Six of the original nine are now code rather than prose** — the apply path's
four (co-located transactional state, no echo, refuse a stale object, write the
state even when the row is unchanged), the coupled-CHECK repair, and since
2026-08-17 the engine's order. That last one was the only *temptation* on the
list, kept here because the file that would fall for it did not exist yet; it
does now, and `syncOnce` sweeps before it asks the server anything. Its other
half — merge an older-versioned row field by field rather than skipping it on the
envelope — was always `applyPull`'s, and `pull.test.ts` reports `rolledBack` for
exactly that case. They are described in §2 and enforced by `round.test.ts`,
`syncApply.test.ts`, `pull.test.ts` and `collectionGuard.test.ts` rather than by
anyone remembering to read this list. What is left is four designs that are owed:

1. **Reclamation must be evidence-based, not age-based.** Hard-deleting old
   tombstones is what the removed „tombstone is terminal" rule was reaching for
   and never bought (a device that never saw the tombstone re-uploads the object
   as an INSERT, which an UPDATE rule never sees). Reclaim only below a horizon
   every non-revoked device has provably passed — derived from the device
   lifecycle window, published as `reclaimed_below_seq` so a returning device can
   tell „nothing changed" from „I am too far behind to trust an incremental
   pull" — and put attachment blobs on the SAME horizon, so bytes are never
   reaped ahead of the rows that name them. No role holds DELETE on
   `sync_objects` today, which is what keeps the absence of this design from
   being a live hazard.
2. **Three writes belong to a service-role path**, because the desktop-only
   policy on `key_wraps` refuses them from an ordinary session: minting MK and
   writing its wraps (a session that has only just signed in has no device row —
   and that is where the mint belongs anyway, since „exactly once per account" is
   an atomic-singleton problem and two devices enabling sync in the same minute
   would otherwise mint two master keys); the re-wrap that ends a recovery; and
   whatever registers the FIRST desktop of an account.
   *Related:* the three-key hierarchy (DK / MK / CK_p) has **no ADR**. Its
   reasoning is spread across `kdf.ts`'s header, migration 002's comments,
   `contentKey.ts`'s header, `supabase/README.md` §1 and this file — fine while it
   was one package, wrong now that a server enforces it. It should be written WITH
   the auth flow, not before it: the open questions are the recovery protocol and
   first-desktop registration, and an ADR that guessed them would be worse than
   none. One decision it has to carry, taken 2026-08-17 and currently recorded
   only in `contentKey.ts`: **CK_p is minted by a client INSERT, not by an Edge
   Function** — the row is CK_p wrapped under MK, the server has never held MK and
   must never hold it, so a function would be a proxy for the same insert with no
   authority the desktop lacks, and `key_wraps_one_per_slot` is a better arbiter
   of „exactly once per slot" than application code. MK's own mint is a function
   for the opposite reason: „exactly once per account" is an atomic-singleton
   problem, and a session that has just signed in has no device row.
3. **The web key-surface gate has not decided about TEST files, and it will have
   to.** `scripts/web-key-surface.test.mjs` scans whole package directories, so
   it sees `*.test.ts` alongside shipped source. Harmless today; it stops being
   harmless the day `apps/web` depends on `@nexus/sync`, whose tests
   legitimately import both the root `@nexus/sync-crypto` barrel and
   `@nexus/sync-crypto/testing`. The likely shape is a closure walk over the
   actual import GRAPH from `apps/web`'s entry points — then source files need no
   exemption and test files are excluded because nothing imports them, not
   because of their names.
4. **A sealed per-collection manifest is the standing gap.** Every row served is
   genuine and every rewrite is caught, but a server that simply OMITS a row — or
   truncates the tail of a collection — passes every check in `pull.ts`, because
   the rows it did serve are real. Detecting that needs a signed, monotonic
   manifest over `(object_id, version, ck_epoch)` per collection. Until it
   exists, withholding is the one server attack this design does not see.
5. **Nothing in the transport reads a 5xx as a 5xx.** `packages/sync-transport`
   has no retry, no backoff and no status-class handling anywhere: a cold Edge
   Function boot on hosted Supabase reaches the desktop as `refused` with
   `reason: "unknown"` and `httpStatus: 503`, and `parseSyncEnableResponse`'s
   comment describes exactly that outcome („a server that answered something
   this client was not written against") without anything acting on it. Found
   2026-09-07 while root-causing the red `database` job, whose cause was the
   same fact one layer over — see [[DC-118]]. The test suites now wait for the
   runtime; the product does not, so a user's FIRST „turn on sync" is the call
   most likely to meet a boot. Not fixed, deliberately: sync is on hold, and
   the honest finding is not „add a loop to one call site" but that
   first-contact latency was never designed for anywhere in this layer — which
   makes it a decision about the transport's error model, not a patch.

---

## 4. What remains

**The repository is public, and the first public release is 1.4.0
(2026-10-05).** Everything a stranger needs — the Apache-2.0 licence and
ADR-087, the policies (`SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`PRIVACY.md`, `TERMS.md`, `SUPPORT.md`, `ROADMAP.md`, `CHANGELOG.md`), the issue
forms, the tagged release pipeline with SBOM and build provenance, the CodeQL /
dependency review / Scorecard workflows, a file-by-file classification of this
docs tree, a hardened Electron package (fuses and asar integrity) and a closed server gap (the housekeeping
schedule is now a migration) — reached `main` through the public-release pull
request (#39), the English locale followed it, and `v1.4.0` was tagged from
the result. The narrative is in [log/2026-10.md](log/2026-10.md).

**1.5.0 followed on 2026-10-08:** Settings in categories (ADR-088) and the
opt-in update check (ADR-089), with the security fixes in `CHANGELOG.md`. Its
release is the first to sign `SHA256SUMS.txt` with the Ed25519 key the app
pins.

**What that leaves is the maintainer's, and it is one thing:** the
code-signing route (`SignPath Foundation` is free for open-source projects;
Azure Artifact Signing is the alternative). It is not blocked on anything in
this repository. The repository settings in
[ops/github-setup.md](ops/github-setup.md) were all applied on 2026-10-05.

**Order of work.** On 2026-08-31 the founder paused web and sync: *„web/sync je
za sada trajno na hold-u, dok ne završimo sve feature za desktop, lako ćemo ih
posle portovati na sajt jer je electron osnova."* Everything left on the desktop
comes first. Web, Supabase and pairing are **paused, not cancelled** — what
exists stays built, tested, green in CI and off by default, and nothing new is
added there until the desktop is complete.

### 4.1 Desktop work, in the order to take it

None of this blocks anything, and none of it is a new feature. It is the set of
loose ends recorded while the product was being finished. The order below is a
suggestion, cheapest and highest-leverage first.

1. **Most of the startup chunk is copy.** Every page is its own chunk since
   2026-09-26, but the strings table is not. Measured on the minified build the
   same day: 760 464 of the startup chunk's 1 284 233 bytes (59 %) are
   `strings.sr.ts` and `strings/*.ts`, and 606 355 of those are for the
   professional packs, the developer drawer and Elektronika — pages that load
   on demand while their words load at startup. Minification made the share
   LARGER, not smaller: it strips the code's names and comments, and a string
   literal has neither. `strings.ts` clones ONE table so a locale switch can
   rewrite its leaves in place; splitting it means per-surface subtables that
   join the table when their page loads, and that reaches `check:strings`,
   `check:copy` and the locale machinery. A design, not an edit.
   The English table (2026-10-02) roughly doubles that payload and rides in the
   same startup chunk, because `strings.ts` imports both locales eagerly — so
   the split this item proposes is worth more, not less, and a lazy per-locale
   load is the other half of the same design.
2. **A bench wire is pointer-only.** In Elektronika a part is a
   `role="button"` with a tab stop and Enter/Space; a wire is an invisible hit
   path with an `onPointerDown` and nothing else. So a keyboard user can select
   no wire, and therefore recolour or remove none. Found 2026-09-26 while making
   the wire scene deterministic. The answer is a focus model for a canvas of
   many small targets — which order, and a name for a wire (its two ends) —
   not an attribute.
3. **The sweep has no comparison mode.** Every comparison of two sweeps this
   month was a script in a scratch directory, and each one had to re-learn what
   noise looks like. Measured 2026-09-26 on two partial sweeps of one build: 157
   of 342 frames differ, every one by at most 100 pixels and, in all but one, by
   no more than 32 of 255 levels in any channel — anti-aliasing noise from
   software rendering, not content; two more differ by design (the
   placeholder-text generator, and the tool that shows the time). A
   `shots`-side comparison with that tolerance, against the previous run's
   frames, would turn „is this change visible anywhere" into one command.
4. **The sizing contract.** DC-06 closed one pane at one breakpoint; what is
   missing is the rule that would have prevented all of them — what a pane's
   floor is, and what happens below it. This is also the desktop half of the
   responsive work the web app will need.
5. **A gate for Class A: a claim about the code that is right where it is
   written and stale where it is repeated.** Five instances were found on
   2026-09-22 and fixed by hand, four more the same day. Nothing in the tree can
   check a sentence, and a figure has no type, no import and no call site. The
   owed gate is a rule over the specific shapes that have now shipped twice.
6. **Done (2026-10-09): `check:reachable`, the gate for Class C.** Every
   field of a `NexusApi` parameter type needs a renderer call site that sets
   it; the walk follows each argument back through locals, field assignments,
   conditionals and helper returns. The worked example had already been fixed
   by `0df4eae` (the panel sets `reminderOffsets` on create and edit); the
   form's payload now lives in `documentsForm.ts` with tests. The gate's
   allowlist carries 14 fields: six with a reason, and eight marked
   `TODO(reachable)`, among them three real gaps of the same shape: TASK
   cannot edit a task's description, and CAL cannot edit an event's
   description or category.
7. **`ModuleManifest.imex` is declared and nothing fills it.** The archive
   was built in `@nexus/core` from `ProfileData`, one interchange version for
   the whole profile, not from per-module handlers — so the slot ADR-008 lists
   is unreachable by anything in the product. What is open is whether the
   plugin path still needs it (a third-party module's rows cannot ride
   `ProfileData`), which is a decision about PLUG rather than a cleanup: either
   the contract states what a plugin would implement, or it goes.
8. **The duplicated Serbian numeral lexicon.** `pravo.ts` and
   `racunovodstvo.ts` each embed their own numeral lexicon (both citing
   *Pravopis srpskoga jezika*, 2010), their own `stripSeparators`, and their
   own digit-at-a-time ISO 7064 MOD 97-10 under names one character apart. This
   is a consolidation rather than a defect, and it is not urgent — it is what
   declining to retire one of each colliding tool pair costs.
9. **The shell's own settings cards are in no screenshot.** Twelve per-module
   settings scenes were added and are derived from the registry, which is why
   they cannot go stale. The shell's cards — Profili, Sigurnost, Izgled,
   Obaveštenja, Licence and the rest — have their ids written into
   `SettingsPage.tsx` in the renderer and appear in no list the main process
   can read, so the same derivation cannot reach them. Recorded rather than
   papered over with a second hand-kept list.
   The shell's two banners share the gap for a different reason: the
   restore-undo banner and the unsaved-exit banner (DC-148) appear only after a
   restore or after a write fails behind a closed page, and the harness has no
   way to produce either state, so `.app__banner` has never been photographed
   or audited. Reaching them needs a fault the sweep can cause on purpose, not a
   hook in the shipped renderer.
10. **„Dalje" sits below the fold on onboarding step 3 at 900 × 600.** Measured
    and reachable by scrolling, deliberately left: the card is the scroller, step
    3 is the only step whose actions do not fit, and a sticky action bar would
    change the first screen a user ever sees.
11. **Mixed line endings within files**, despite `core.autocrlf=true`. Every
    scripted edit has to be EOL-aware; it has already cost two redoes. A standing
    hazard rather than a defect.

**Not on the desktop list:** SEC-VER-01 (threat models), the sync transport's
error model, and the pairing redesign are all web/sync work and stay paused with
it. The questions they raise are in §5 so they are not lost.

### 4.2 On hold permanently: the web app and sync (kept for the record)

1. **A first round against the real project.** The desktop wiring is DONE
   (2026-08-30): `runSyncRound` builds everything `syncOnce` needs and erases
   the keys around one call, `createSyncScheduler` owns the loop, and main opens
   it on unlock and on every profile switch, closes it on lock, and answers
   `sync:activity` / `sync:now` behind `assertTrustedSender`. „Stanje
   sinhronizacije" in Podešavanja shows the phase, the problem, the last round's
   counts and a „Sinhronizuj sada" button, watching a pushed
   `sync:activity-changed` rather than polling.
   Every rule the pieces carried survived the wiring, and each is now a test:
   the three free refusals happen BEFORE a refresh is spent (a refresh spends
   the stored token); the content key set is opened per round and erased when
   the round ends, never in a `finally` beside the `return`; `nonce-reuse`
   latches PER PROFILE in the scheduler, because a profile switched away from
   and back to would otherwise get a brand-new loop with a clean latch; and a
   round that lands after a profile switch is discarded rather than filed under
   the profile now on screen.
   What is left is to point it at the deployed project and watch a row cross.
   Nothing here has `MAIN_VITE_SUPABASE_URL` set, so every round on this machine
   refuses `cloud_off` before making a request — which is the boundary working
   and also why no round has ever run for real. That needs the project's URL and
   anon key in the build, an account with a second factor, and one desktop
   enabling sync.
   Two known gaps in the wiring, both deliberate and both recorded here rather
   than in a TODO. **The nudge has no caller**: `SyncLoop.nudge` and the
   scheduler's pass-through exist and are tested, and nothing in the app calls
   them, so a local edit waits up to the five-minute interval rather than
   syncing at once. It was NOT exposed on `SyncService` for that reason — a
   method with no caller is the DC-62 shape — and the natural caller is either
   the journal's write path or a choke point in the IPC layer, neither of which
   exists yet. **Realtime is the other half of the same seam**: `SignalSession`
   is in `@nexus/sync-transport`, `nudge` is where it lands, and nothing owns a
   socket. The interval is what makes sync correct; both of these only make it
   instant.
2. **Pairing**, reshaped to the protocol that is built — or dropped, if §5's
   question is answered that way.
3. **Web auth and the web `NexusApi`** — `apps/web` is a shell with a typed
   proxy that throws. Everything behind it is unwritten.
4. **Deployment on Cloudflare Workers with static assets** — the target is
   chosen (not Pages: Workers can set the headers a CSP needs) and nothing is
   deployed. This is where the unsigned-build rule in §6 stops being
   theoretical: it would be the first release surface beyond the founder's own
   machines.

Two further pieces of sync work are paused with the rest and recorded in §3, so
they are not lost: **the transport's error model** (nothing in
`packages/sync-transport` reads a 5xx as a 5xx — no retry, no backoff, no
status-class handling — and a cold Edge Function boot reaches the desktop as
`refused` with `reason: "unknown"`), and the **four designs the sync subsystem
still owes** (an evidence-based reclamation horizon, the service-role writes
plus the missing three-key ADR, the test-file scope of the web key-surface
gate, and a sealed per-collection manifest against a server that simply omits
rows).

### 4.3 Not started: product breadth

Goals, time tracking, health, car, travel, inventory, shopping, read-later,
library, the password vault, entertainment, sharing, analytics, automation, the
AI assistant and the plugin system. The full catalogue and its priorities are in
[SPECIFICATION.md](SPECIFICATION.md) §4. Several depend on sync existing first.
**Breadth is not the constraint and has not been since 2026-08-02**; finish
quality is.

### 4.4 Notes for whoever picks this up

- **The 1.3.0 installer is not reproducible.** Measured 2026-09-23:
  `eceb07e` built twice produced 183 821 582 and 183 821 644 bytes. Size and
  hash identify an artifact, never a revision. That matters the day an update
  feed publishes a digest.
- **The Electron fuses are not read back by CI.** The configuration is in
  `electron-builder.yml` (RunAsNode, NODE_OPTIONS and CLI inspect off; cookie
  encryption, embedded asar integrity and only-load-from-asar on), and the 1.3.0
  executable was read back and had all six wrong. 1.4.0's read back as
  configured, on 2026-10-02 and again on 2026-10-05 from the tree the tag was
  cut from (see `log/2026-10.md`), and 1.5.0's Linux binary, taken from the
  published tarball, read back as configured on 2026-10-08. After any change to that file or to
  Electron: run `pnpm --filter @nexus/desktop dist`, then
  `npx @electron/fuses read --app apps/desktop/release/win-unpacked/Nexus.exe`,
  and launch the result.
- **`v1.4.0` is the first tag and the first release.** Every installer before
  it reports a number nothing could be verified against. The Gentoo ebuild is
  `nexus-bin-1.5.0`, its `SRC_URI` points at this repository's releases, and
  its committed `Manifest` digests the published Linux tarball (the same bytes
  as the release's `SHA256SUMS.txt`). The next bump regenerates the Manifest
  from the next published tarball, never from a local build. It has still not
  been run through portage (`apps/desktop/build/gentoo/README.md`).
- **`check:licences` fails every bump of a packaged dependency, by
  construction.** Dependabot cannot regenerate a generated artifact, so the
  third-party notices must be regenerated on the branch
  (`pnpm --filter @nexus/desktop licences`) and committed before the merge.
- **A Dependabot group bump is replaced, not rebased.** When the first fix was
  pushed, Dependabot closed that PR and opened a new one against the new
  `main` with more packages in it. Fix on the branch, push, and merge promptly;
  the window between push and merge is the window in which the branch can be
  recreated underneath the fix.
- **Nothing is unpushed and no pull request is open** as of 2026-09-26, and both
  CI and Security are green on `main`.

## 5. Open questions for the founder

None of these blocks today's work; they are collected here rather than asked one
at a time. Nothing in this section carries a deadline any more — the one item
that did (Electron 42 leaving support) was decided on 2026-09-06 and the app is
on Electron 44. Several items carry a recommendation, which is what is
implemented until the founder says otherwise.

| Question | State |
| --- | --- |
| SEC-VER-01: threat-model passes for the modules | Binding on paper, one instance, unenforced. Needs a decision: queue item or aspiration. |
| The secret scanner and our own naming | Open. Recommendation: keep naming the literals, revisit if it fires a second time. |
| The screenshot sweep cannot reach the sync forms | Open. Recommendation: (a), a placeholder project, gated on the harness refusing to run in a packaged build. |
| Two packs may still have built one computation under two names | Recorded, not urgent. Sweeping the seventeen professions' 274 tools is larger than the four fixes already done. |
| The medicine toolkit | Recommendation (b) is implemented: survivors folded into `trening` as wellness. Confirm the refusal list stands. |
| Electronics: URDF geometry | **Answered** 2026-09-01 and built (parametric chassis, ADR-085 §8). |
| Electronics: what comes next after E5 | **Answered** 2026-08-31 (E3), then superseded by the desktop-first pause. |
| Electronics: should a bench setup persist? | Open, not blocking. E5 stores nothing, so an eight-channel setup is lost on close. |
| E6 ships with two open ends | Open, not blocking. See the section below. |
| Five smaller confirmations | Open. Three items: the tier-constants doctrine, one agro domain question, desktop→desktop pairing. |
| Linux | Open. Two items: is Linux supported or a courtesy build, and code signing. The separate releases repository is settled — releases publish in this repository. |
| The developer drawer | Open. `lf8` naming, the `tf19`/`tf32` label, and `MXINT8`. |
| Version numbering and tagging | **Answered** 2026-10-05: `1.4.0` is the first public release, tagged `v1.4.0`. |
| `gitleaks-action` carries a commercial EULA | Irrelevant while the repository is personal; a licence question the day it moves under an organisation. |

### SEC-VER-01 is binding on paper and has one instance (2026-09-22)

[security/baseline.md](security/baseline.md) §18: *„Each module gets a
lightweight threat-model pass at design time (STRIDE-style, ~30 minutes,
documented in `docs/security/threat-models/`)"*. That directory holds **one**
document — the E6 external-runner threat model, written on 2026-09-22 for the
slice that has since been **built and shipped** — and **no module has had a
pass**. All sixteen registered modules, ELEC included: its document covers one
slice of one of them, and the other fifteen are untouched.
Several of the sixteen carry a real trust boundary:
the private section's blob protocol, archive import and export, the attachment
store, the sync wire.

Two readings, and only the founder can say which:

1. **It is a queue item.** Then the honest shape is a pass per SURFACE that
   crosses a trust boundary, not per module. Sixteen documents shaped like the
   module registry would spend most of their words on modules whose entire attack
   surface is a local SQLite table behind an allowlisted IPC channel; the
   candidates worth the time are the four named above, and the rest would each
   be one page saying „local data, no network, no external input".
2. **It is an aspiration.** Then the baseline should say so. A binding rule with
   one instance and no gate is the shape this repository has already paid for —
   DC-01 is a check that covers nothing and reports success — and the difference
   here is only that nobody has ever believed this one was running.

No code depends on the answer. What is not acceptable is the third reading, which
is the current state: binding on paper, one instance, unenforced, and unremarked.

### The secret scanner and our own naming (2026-08-15)

CI is green; the three colliding literals are named in `.gitleaks.toml`. What
needs a decision is whether that arrangement should stand.

`vault-service-token` matches `s.` + 24 base62 characters above an entropy
floor. Our universal `const s = strings.<module>` makes that the shape of an
ordinary property read whose key is 24 characters long — 64 such reads exist
today, three of them firing. Full measurement in DC-53.

1. **Keep naming the literals** (what is committed). Detection is untouched; the
   price is that a future 24-character key turns a *copy* change into a red
   *security* workflow. That is the shape that teaches people to ignore a red
   security badge — a failure this repo has already had once, when a real
   finding sat in a green repository for ten days.
2. **Disable `vault-service-token`.** Measured; it works. We lose detection of a
   bare HashiCorp Vault token. This project has no Vault — the stack is Supabase
   and Cloudflare — and a Vault token assigned to any sensibly-named variable is
   still caught by `generic-api-key`. What is lost is a token pasted bare.
3. **Excuse the shape with a regex.** The worst of the three, recorded so nobody
   proposes it later: it blinds the rule for roughly 42 % of genuine Vault
   tokens while leaving it looking fully armed.

**Recommendation: (1) as committed, revisited if it fires a second time.** One
collision is an accident; two is evidence that the convention and the rule
cannot share a repository, and (2) becomes the honest answer.

### The screenshot sweep cannot reach the sync forms (2026-08-16)

Found while trying to look at the adoption form, which is how it should have
been found: `shots/default/dan/settings-sync.png` shows the sync card rendering
„Ova verzija Nexusa nije povezana ni sa jednim serverom" — the `unconfigured`
branch. The scene exists and lands on one sentence.

`syncCardState` draws a form only when `configured && cloudEnabled &&
!cloudRestartRequired`. The harness redirects `userData` into a disposable
directory (no `cloud.json`, so cloud is off) and the build carries no
`MAIN_VITE_SUPABASE_*` pair (so `configured` is false). **Five surfaces —
enable, reconnect, the one-time recovery panel, adoption, and since 2026-08-30
„Stanje sinhronizacije" — have never been in a screenshot**, inside a sweep that
measures thousands of frames for clipped text and escaping boxes. Recorded as
DC-57, and the fifth is the first one that is not a FORM: the activity panel
draws a phase, a problem sentence and up to four counts, so it is also the first
of them whose layout can break on a long Serbian sentence at the narrow window
size.

Fixing it needs two knobs, and the second is the question:

1. A placeholder project baked into the shots build. Harmless — a fake origin
   and a JWT-shaped fake key, and nothing in a shots run signs in.
2. `cloud.json` with `{ "enabled": true }` written into the disposable profile.
   **This turns the packet boundary off for that run** — a boundary the harness
   currently enjoys unconditionally, and one of the four layers is a Chromium
   command-line switch fixed at launch, so it cannot be „on for the boundary and
   off for the card".

- a. **Both knobs**, so the forms get photographed like everything else, and the
  shots harness stops being a build that can make no network call.
- b. **Knob 1 only.** `configured` becomes true, the card moves from
  `unconfigured` to `cloud-off` — a different single sentence, and still no form.
  Cheap and buys almost nothing.
- c. **Leave it, and check these four surfaces by hand** when they change. What
  is committed. Honest, and it means the audit's „2 findings" is silent about a
  dozen fields.

**Recommendation: (a), gated on the harness refusing to run in a packaged
build** — which `--shots` already is, for the same reason `--demo` is.

**The other half of DC-57 is closed** (2026-08-23). Every `ShotScene` anchors to
a sidebar row, and the questionnaire *replaces* the shell — so the nine screens
ADR-086 introduced were unreachable for exactly the same reason the sync forms
are, and by exactly the same mechanism: the fixture cannot get into the state.
That one is fixable without touching the packet boundary, so it was: the sweep
now ends with a pass that opens Settings → „Kako je Nexus podešen za tebe" →
„Promeni odgovore", **answers each screen** (an unanswered flow photographs the
one state none of them is interesting in), and photographs „Priprema", the
reveal and „Napredno" before completing. It runs last because completing rewrites
the profile's flags, board and sidebar. The sync forms are still the open
question above; nothing about this pass changes them.

### Two packs may still have built one computation under two names (2026-08-21)

Name collisions are the only kind that could be found by looking, and all four
have been. Two packs that each built the same computation under two DIFFERENT
names would look exactly like two ordinary tools, and nothing in the catalogue
would say otherwise. Sweeping the 274 for duplicated arithmetic is a larger
piece of work than fixing these four was, and nothing forces it now — recorded
so that it stays a decision rather than becoming an oversight.

### The medicine toolkit (2026-08-13)

The founder's list of professions included medicine, and there is no
„Medicina i nega" pack. Not squeamishness about a disclaimer — a disclaimer does
not reach the question. What makes software a medical device under MDR-style
rules, which Serbia's *Zakon o medicinskim sredstvima* tracks, is its **intended
purpose**, and intended purpose is established by what the product says it is
for. A drawer whose audience line reads „lekari, medicinske sestre" has a
clinical intended purpose; *SNITEM* (C-329/16) held that software checking a
dose against patient data is a device even though it never touches the patient.

Under an honest refusal list the pack is *empty*: dosing, drip rates, BSA,
paediatric dosing, clinical scores, gestational age and lab interpretation are
all refused, and what survives — BMI and its relatives — is body arithmetic, not
a medical pack.

- a. **Drop it and say so.** The product never claims medicine.
- b. **Fold the survivors into `trening`** under the wellness carve-out. **This
  is what is implemented, and the recommendation.** The `who` line is „treneri,
  takmičari, rekreativci", which is a fitness audience, and the notice says
  plainly that it is not medical advice.
- c. **Register a medical device.** A real option, and a different company.

### ~~Electronics — where does a URDF's geometry come from?~~ ANSWERED (2026-09-01)

ADR-085 §8 left this open and said E4 decides. It was blocking E4c, and it was
the only part of the slice that could not start without an answer, because
**nothing in the module can derive it**. A URDF/SDF describes a *machine*: link
lengths, joint origins, masses, inertias. The catalogue knows a part number and
a pin map; a circuit knows what is wired to what. Neither knows how far the left
wheel is from the right one — and inventing a number here would put a fabricated
dimension inside a file a simulator treats as fact.

**Answered (a), and built.** The founder handed the choice back —
*„ne znam uradi kako mislis da je najbolje"* — so the reasoning below is the
decision, and it is recorded in ADR-085 §8 as well.

- a. **A small set of parametric chassis.** **Chosen and implemented.** Two
   shapes rather than the three or four this section guessed at —
   `diff-rover` and `four-wheel-rover`, because those are the two the generator
   has honest geometry for and a „fixed arm" is a joint model rather than a
   chassis. Nine dimensions in centimetres and grams, none of them pre-filled:
   Nexus cannot measure, so a field that opened holding „20" would be a
   dimension the user never took. It is honest (every number came from the
   user), it needs no file format, and it covers the machines a hobbyist
   actually builds. The cost is what it was: anything outside the set is
   unrepresentable.
- b. **A user-supplied mesh.** Rejected. Represents anything, and pushes the
   whole problem onto a user who now needs CAD — plus it is the first time this
   app would read a 3D asset from disk, and a mesh whose units or origin are
   wrong simulates fine and is silently wrong.
- c. **Both**, parametric by default with a mesh as an override. Rejected for
   now, not forever: it is the right answer only once (a) turns out too narrow
   in practice, and nothing has used it yet.

~~Related and answerable at the same time: **should the ROS 2 package be built
before E6 exists to consume it?**~~ **Answered by building it (2026-09-01, E4b),
on the recommendation this section carried:** E5's in-app simulation reads the
same derived model, and a Raspberry Pi circuit was until then the one board
family that got a refusal and nothing else. It now gets an `ament_python`
package that `colcon build` accepts.

### Electronics — one question, not blocking (2026-08-21)

**„Rebuild the installer for ELEC, or wait?" is answered and closed
(2026-08-31).** The founder ordered the rebuild in his own order — *„Baci push,
proveri testove CICD, PRove sve to sredi… i onda tek exe"* — and
`Nexus-Setup-1.2.0.exe` is the result. The old recommendation was to wait for
E3, on the reasoning that a workbench which cannot yet say „that sensor is 3.3 V
and you have wired it to 5 V" is the half an engineer tests first. That was a
recommendation about *when to spend a build*, and he spent it; the E3 argument
survives as an argument about E3, not about the installer. **A newer installer
exists — 1.3.0, built 2026-09-23; §4 has its release note.**

- **~~What comes next — E3, or the desktop sync wiring?~~ Answered by the
  founder, 2026-08-31: E3** (*„Ok nastavi to za elektroniku sto si hteo"*). It
  is built and verified. The recommendation had been the sync wiring, on the
  grounds that it was the older commitment; the founder chose the module in
  front of him, which is the call that was his to make. The sync argument
  survives intact — and was then answered too, the same day and the other way:
  *„web/sync je za sada trajno na hold-u, dok ne završimo sve feature za
  desktop."* The question this section existed to ask is closed. Everything on
  the desktop comes first; see the head of §4.

### Electronics — should a bench setup persist? (2026-09-03, not blocking)

E5 stores nothing: a run's waveforms live for as long as the dialog is open,
which is the same rule „Kod" follows and the reason neither needed a migration.
It is defensible — a bench is an instrument, and the circuit is the artefact —
but it is a guess about how the thing gets used, and there is one shape where
it is plainly wrong: a user who has set up eight channels to reproduce a fault
loses all of it the moment they close the dialog to go and move a wire, which is
the exact thing looking at the bench makes them want to do.

The cheap half is small (a `sim_wave` table keyed by circuit and board pin, one
row per configured channel, a migration and an IPC channel). The question is
whether it belongs to the circuit at all: a waveform is a fact about an
experiment rather than about the design, and a stored one would ride along in
the archive, the sync payload and every export. **Recommendation: leave it
unstored until the founder has used it once**, because the shape of the answer
is „what did you want back", and nobody has wanted anything back yet.

A smaller one alongside it: **no demo circuit produces a `volts` channel**, so
the per-tick over-logic warning — the one thing on that screen that takes a
colour — is in no frame of the screenshot sweep. It is reachable (an analogue
sensor on a 3V3 board, which is a mistake a real user makes and `rules.ts` also
reports) and it is covered by tests, but the sweep cannot see it without a
fourth demo circuit built specifically to be wrong. Adding one is a change to
the demo profile, whose three circuits are each justified in
`demo/electronics.ts` by what they let a *frame* show; a fourth would need the
same justification and it has one, so this is a „yes, when it is next in front
of us" rather than a question.

### E6 ships with two open ends, and neither blocks it (2026-09-22)

Both are consequences of choices that were made deliberately, which is why they
are questions rather than defects.

- **The Docker image is pinned by digest and therefore has no update path.**
  `RUNNER_IMAGE` is `ros:humble-ros-base@sha256:1813d3c8…`, and that is the right
  shape — a tag is mutable and this names a program the user's machine will
  download and run, so a tag would let the registry change what Nexus executes
  without a commit here. The cost is that the day that image is withdrawn from
  Docker Hub the Docker profile stops working, and the only repair is a person
  editing a constant in `packages/core/src/electronics/runner.ts` and rebuilding.
  Three readings: **leave it** (the pin is the security property, and a digest
  that stops resolving fails loudly at `docker run` with the registry's own
  words); **pin per release** (re-resolve at each version, which is a release
  chore that will be forgotten); **let the user override it in settings** (which
  hands the strongest guarantee in the slice to the person least able to check
  it, and reopens DEV-007's „the command line is never data" the moment the
  override can name an image the table did not). Engineering's recommendation is
  the first, with the failure mode named in the copy.
- **A run that outlives the app is not looked for.** `dispose()` on a clean quit
  kills the process and issues the container removal; a crash or a power loss
  takes that away, the runner holds its state in memory and nothing is on disk to
  reconcile from, so the next launch shows `idle` with no last outcome. `--rm`
  bounds it — the container removes itself when `colcon build` finishes on its
  own — so the question is only whether the app should say so. A startup sweep
  would be a probe on every launch for a container in a state almost nobody is
  in, in a build whose consent screen exists to make exactly that kind of
  unrequested process visible. Engineering's recommendation is to leave it and
  describe the container by name in the docs, but it is a real trade and the
  founder may want the sweep.

### Five smaller confirmations

- **The three-tier constants doctrine** — `physical` embeds; `published` embeds
  with its source and edition on screen; `regulated` is always a user input with
  no default. All 274 tools are written against it, so confirming it is cheap
  now and expensive later.
- **`grain-moisture-shrink` (agro)** — does a buyer's contract impurity
  percentage apply to the GROSS mass, or to whichever mass is current at that
  step? Both readings exist in real Serbian purchase contracts and they give
  different money. The tool applies each deduction to the mass remaining at its
  own step, the more common commercial reading; the alternative is one line. A
  domain question, not a code question.
- **Desktop→desktop pairing** — still wanted, now that the Recovery Kit route
  reaches the same place? See §3.

### Linux (2026-08-10)

All three artifacts exist and work without an answer.

1. **Does `lukastojiljkovic/nexus-releases` get created?** **Answered
   2026-10-02: no.** The ebuild's `SRC_URI` and `electron-builder.yml`'s
   `publish` block now both point at this repository, which is public. Until a
   `v*` tag exists the tarball is hand-placed into
   `/var/cache/distfiles/` — fine for one machine, and the thing standing
   between „an ebuild" and „an `emerge` that works on somebody else's computer".
2. **Is Linux a supported target or a courtesy build?** Supporting it
   commercially means every release gets a Linux run and the keyring requirement
   becomes a support question.
3. **Code signing.** Answered for 1.4.0 on 2026-10-02: it ships unsigned under
   [DEV-008](deviations.md), with signing paused and the source public. Still
   open is the route for a later release; the packaging config is where a
   certificate plugs in, and it is a ten-minute change.

### The developer drawer (2026-08-10)

1. **„lf8" — which one?** There is no OCP or IEEE format of that name. Either
   *logarithmic* FP8 (a real piece of work — its own encode/decode, not a
   `FloatFormat` row) or a vendor spelling of one of the two FP8s already built.
   Rather than guess, all four FP8 variants were built: `e5m2`, `e4m3` and the
   two `fnuz` forms AMD/Graphcore hardware actually uses.
2. **„tf19" was built as `tf32`.** NVIDIA's TensorFloat is 19 *significant* bits
   carried in a 32-bit register; the published name is TF32. The tool shows both
   numbers — flag it if the label should read differently.
3. **MXINT8?** The OCP MX spec defines an integer member beside the float ones.
   The block tool covers `mxfp4`, `mxfp6-e2m3`, `mxfp6-e3m2` and the scale.
   Adding it is about an hour; it was left out only because it was not asked for.

### Version numbering — the bump happened twice, the tagging question did not

**1.3.0 was cut on 2026-09-23** (`0a983ef`), one field in
`apps/desktop/package.json`, from which the installer filename,
`app.getVersion()` and the Gentoo ebuild's `${PV}` all derive — which is why the
ebuild rename carries no edit inside the file. The `imex` archive schema
versions in `packages/core/src/imex` are a separate axis describing the export
format and were deliberately left alone.

Why it was bumped rather than rebuilt as 1.2.0: 1.2.0 was cut on **2026-08-31**
(`f3e6233`) and its installer is still the one on the founder's Desktop, while
**134 commits landed on top of it, 33 of them features**. A rebuild under the
old number produces a file with the same name reporting the same version from
`app.getVersion()` — the ambiguity behind „I installed it and the module isn't
there", which 1.1.0 already cost once.

What the bumps did **not** settle: **no version has ever been tagged or
released.** There are no git tags and no GitHub releases, so „1.3.0" is a
number the installer reports and nothing a user could verify against anything.
Two consequences are already live rather than hypothetical:

- the Gentoo ebuild's `SRC_URI` now points at this repository's releases
  (`github.com/lukastojiljkovic/Nexus/releases/download/v${PV}/…`), a URL that
  resolves as soon as the first tag is cut — it pointed at the never-created
  `nexus-releases` repository until 2026-10-02;
- its `Manifest` was deleted with this bump rather than carried forward, because
  it digested `nexus-1.1.0-linux-x64.tar.gz` and no later ebuild fetches that
  file. It has to be regenerated where the Linux tarball is built —
  `dist.mjs` refuses a Linux target from a Windows host, since the native SQLite
  module is built for the host it runs on.

So the open question is no longer „should we bump" but **„should a release be
cut at all"** — the ebuild's `SRC_URI` is settled, and a `v*` tag makes the Linux
packaging work as written; leaving it means the ebuild stays a hand-installed
recipe.

### `gitleaks-action` carries a commercial EULA

For organisation accounts. Irrelevant while the repository is personal; it
becomes a licence question the day it moves under an organisation.

---

## 6. Standing constraints

These outrank everything in §3 and §4. No piece of work may trade one of them
away for being convenient.

- **Code signing is still open, and 1.4.0 ships without it under
  [DEV-008](deviations.md)** (SEC-EL-07, SEC-SC-05), confirmed by the founder on
  2026-10-02. The installer is unsigned, so Windows shows a SmartScreen warning
  on first run, and the release notes, the README and the website say so; macOS
  builds do not exist. Re-arming the update feed stays behind signing.
- **No performance claim before a harness measures it.** The budgets in
  [architecture/overview.md](architecture/overview.md) are targets nothing
  checks.
- **Cloud is OFF BY DEFAULT on the desktop and switchable off entirely.** A user
  who never turns it on must be in exactly the product 1.0.0 is: no network
  calls at all. This is structural — the local-only path must not be *able* to
  reach the network — and `check:egress` is one of the layers that holds it.
- **The pairing code must never be a bearer token for the data key.** It
  authorises one run of a key-confirmed exchange, inside which an ephemeral
  X25519 handshake carries the wrapped key and both screens show a short
  confirmation number the user compares.
- **`main` is a protected branch** (founder, 2026-08-16, after DC-59): the four
  checks — `verify`, `database`, `Secret scan (gitleaks)`, `Dependency audit` —
  are required, `strict` is on so a branch must be up to date with `main` before
  it merges, and force-pushes and deletion are refused. **Administrators are
  exempt, deliberately**, so direct pushes to `main` keep working the way both of
  us work today. That exemption means the rule does not physically stop an admin
  from merging a stale branch — what it does is make the staleness *visible*,
  because `strict` turns a stale pull request's `mergeStateStatus` from `CLEAN`
  into `BEHIND`. DC-59's whole failure was that GitHub said `CLEAN`, so the signal
  is the fix; run `gh pr list --json mergeStateStatus` before merging anything.
- **The `Dependency audit` job has two halves, and they now BOTH report.**
  „Shipped dependencies" is `pnpm audit --prod --audit-level low` with no
  exceptions of any kind; „Build toolchain" is
  `.github/scripts/audit-toolchain.mjs`, which blocks on every high and critical
  and whose allow-list is currently empty — the healthy state. They were
  consecutive steps of one job, so a failure in the first SKIPPED the second: on
  2026-09-09 a new `js-yaml` advisory ended the job and eight more on
  `@xmldom/xmldom` went unreported until both halves were run by hand
  ([[DC-123]]). The second step now carries `if: '!cancelled()'`.
  `auditConfig.ignoreGhsas` is forbidden and `pnpm audit --ignore` must never be
  run — it WRITES that key, and it would then apply to the shipped scan too. A
  transitive advisory is answered by an override in `pnpm-workspace.yaml`, each
  naming its advisory and the condition that retires it, because an override
  changes what is installed while an ignore changes only what is said about it.
- **Electron is pinned to ^44** (ABI 149) since 2026-09-06 — see §4. Dependabot
  still ignores electron majors, but the ignore now states the reason that is
  actually true: an Electron major is two Chromium majors of layout and font
  behaviour, this app is audited by photograph, and **CI cannot run `shots`** —
  so a green Dependabot check would be green on the half of the verification
  that does not decide anything here. Bump by hand, sweep, look. Support runs
  until v47 ships — two 8-week cycles past 42's 2026-10-20, so around 2027-02,
  derived from Electron's published cadence rather than from an announced date.
- **Every gate green before any commit** — `pnpm typecheck`, `pnpm lint`,
  `pnpm test`, `pnpm build`, `pnpm --filter @nexus/desktop smoke`, and all
  twenty-six static gates.
- **The screenshot sweep runs longer than ten minutes and must be backgrounded.**
  **2 839 frames** at three measured widths in both themes — measured at the end
  of the 2026-09-22 run that added the runner scene, and worth the sentence this
  replaces: that one said „2 776 at three widths **plus maximised**", and the
  second half of it was a coverage claim the sweep was not delivering. A full
  pass also tries a maximised capture, and it has been refused in four runs out
  of five (`maximize()` is a request to the window manager, not a setter); on
  refusal the sweep takes NO frame, which is the honest answer rather than a
  picture filed under a name that is not true of it, and both of that day's runs
  refused. What was wrong was the reporting: the refusal went to stderr while the
  headline still read exactly like a clean run's. `missingCoverage` now derives
  it from the frames and puts it on the headline and in `report.md`, on
  `duplicateStems`' argument — a reader who scans the last line must not have to
  infer a missing surface from a number that looks complete. And
  `NEXUS_SHOTS_SCENES` / `SIZES` / `THEMES` run a named subset in about forty
  seconds, which is how a scene's selector is now checked before a full pass
  pays for it. A partial run prunes nothing, skips the questionnaire and writes
  `report.partial.md`; a full run removes that file again. It also needs its
  two `--shots` Chromium switches to survive a machine somebody is using: without
  them Chromium stands an occluded window down, and the harness reports on the
  machine rather than on the app (2026-08-21, DC-66/DC-68). Its report is now
  written in a `finally`, so a run that dies still leaves the findings it had
  instead of the previous run's report sitting beside fresh frames.

---

*Update this file when work finishes: move the item out of §3 or §4 into §2,
put the wave entry in [log/](log/), and record any new failure shape in
[defect-classes.md](defect-classes.md). Keep it a status, not a journal.*
