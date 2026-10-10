# ADR-090 — The module kit: a module is a folder

**Status:** Accepted
**Date:** 2026-10-09
**Supersedes:** nothing. **Amended by:** nothing yet.

## Context

Nexus ships sixteen modules and is about to grow to roughly thirty-five, built
by many runs working in parallel. Until this decision, one module was spread over
shared files that EVERY module edits:

| File | What a module added to it | Size on the day this was written |
| --- | --- | --- |
| `apps/desktop/src/shared/ipc.ts` | channels, payload types, one `NexusApi` member | 10 281 lines |
| `apps/desktop/src/main/index.ts` | validators and `ipcMain.handle` calls | 14 004 lines |
| `apps/desktop/src/preload/index.ts` | the bridge method | 944 lines |
| `apps/desktop/src/shared/modules.ts` | the manifest, its widgets, its settings card | 5 893 lines |
| `renderer/src/strings.sr.ts` / `strings.en.ts` | every word the module draws | 7 994 / 7 968 lines |
| `renderer/src/routes.tsx` | a lazy page import | 156 lines |
| `renderer/src/App.tsx` | a `shownId === "…"` branch | 1 879 lines |
| `renderer/src/moduleIcon.ts` | its mark | 50 lines |

Twenty modules arriving at once on that layout means twenty-way conflicts in the
largest files in the repository, and the files that grow fastest are the ones
everybody must edit. `main/elecRunnerIpc.ts` had already shown the alternative
for one surface: a contract readable in one place, with the process split made
explicit.

## Decision

### 1. A module is a folder, and the shell discovers it

```text
apps/desktop/src/modules/<id>/
  shared/manifest.ts    the ModuleManifest, plus the copy needed before the page loads
  shared/ipc.ts         the channels, the payload/result types, the renderer API type
  main/register.ts      validators, handlers, stores, schedulers (main process only)
  renderer/Page.tsx     the page, loaded lazily the first time it opens
  renderer/copy.sr.ts   the page copy in Serbian — the shape's source of truth
  renderer/copy.en.ts   the same shape in English
  renderer/…            the rest of the UI: `copy.ts`, `icon.ts`, `Settings.tsx`,
                        `Widgets.tsx`, `timing.ts`, `timers.css`, tests
```

Discovery is `import.meta.glob`, which electron-vite resolves in all three
processes and Vitest resolves in tests:

| What | Pattern | When it loads | Why |
| --- | --- | --- | --- |
| manifests | `../modules/*/shared/manifest.ts` (`shared/modules.ts`) | eager | the rail, the settings gallery, the onboarding list and `resolveEnabled` are all consulted before a page exists |
| main handlers | `../modules/*/main/register.ts` (`main/moduleHost.ts`) | eager | `ipcMain.handle` must be registered before the renderer can ask for anything, and a module that fails must fail at startup |
| preload contracts | `../modules/*/shared/ipc.ts` (`preload/moduleBridge.ts`) | eager | the bridge has to exist before the first call |
| pages | `../../../modules/*/renderer/Page.tsx` (`renderer/src/moduleKit/pages.ts`) | **lazy** | a module's page and its page copy must stay out of the startup chunk |
| icons | `../../../modules/*/renderer/icon.ts` | eager | it exports a NAME and imports nothing but a type; the rail needs every mark at startup |
| settings bodies | `../../../modules/*/renderer/Settings.tsx` | **lazy** | the card is drawn when the settings page is open |
| widget bodies | `../../../modules/*/renderer/Widgets.tsx` | eager | a placement's `visible` is asked synchronously, while the page decides what to draw |

**Order.** The compiled-in modules keep the order they are written in, and the
discovered ones follow, ordered by `ModuleManifest.order` and then by id, so two
parallel runs may both write `order: 100` without a conflict that cannot be
resolved. `order` is unset on every compiled-in module, which is what makes
“after the existing ones” true by construction rather than by a number.

**Layers.** `shared/` may import only what `apps/desktop/src/shared` may; `main/`
is main-process code; `renderer/` is renderer code. That is enforced by the two
tsconfig projects (`src/modules/*/shared`, `src/modules/*/main` in the node
project; `shared` and `renderer` in the web project) rather than by a gate: a
renderer file importing `@nexus/db` is a compile error, because `@nexus/db` is
Node-only. The gates that walk source by path already cover the new folder —
they walk `apps/*/src` and `packages/*/src` — and the two that had something to
learn were extended here: `check-copy` now censuses a module's own copy table,
and `check-string-capture` now also scans a module's renderer for a module-scope
read of its live `copy`.

### 2. IPC: one declaration, three readers, no generic invoke

```ts
export const contract = defineModuleContract<"timers", TimersOps>("timers", [
  "list", "createCountdown", /* … */
]);
```

* `contract.channels` is derived from the id and the op names, so “every channel
  starts with the module's own `<id>:`” is true by construction.
* `ModuleApiOf<Ops>` derives the renderer-facing API type from the same
  declaration, and the module's own file merges it into `NexusApi` with
  `declare module "../../../shared/moduleApi.js" { interface ModuleApis { timers: TimersApi } }`
  — so `window.nexus.modules.timers.list(…)` is typed without a line in
  `shared/ipc.ts`.
* **Preload** builds `nexus.modules.<id>.<op>(payload)` from the declared ops and
  nothing else, frozen. There is no generic `invoke(channel)`: a bridge that took
  a channel would hand the renderer the whole main-process surface through one
  hole, which is what SEC-EL-02 exists to prevent. The renderer never names a
  channel.
* **Main** gives each module a `register(ctx)` whose `handle(op, handler)`
  registers one handler per DECLARED op, wraps it in `assertTrustedSender`, and
  hands the handler the shared validators (`main/ipcValidators.ts`, moved out of
  `index.ts` unchanged), the profile's database the way every store gets it, and
  the clock. Three refusals, all before a handler runs or at registration:
  1. an op the contract does not declare (thrown by `handle`);
  2. a channel outside the module's own `<id>:` prefix, or one another module
     already answers (thrown when the contract is adopted);
  3. a message from an untrusted sender (thrown inside the wrapper, before the
     handler is called at all).

Method shape is `nexus.modules.<id>.<op>(payload)` for every module: one rule, so
the bridge needs no per-module code and a payload cannot drift from its handler.

### 3. Copy: what the shell needs now, and what arrives with the page

The shell draws a module's name, its one-line description, its settings card's
title and control labels, and the labels of search kinds it owns — all BEFORE any
chunk of the module has loaded. Those are declared in the manifest as `{ sr, en }`
pairs (`ModuleCopyDeclaration`), and `LabelText` lets the same slot still take a
dotted `strings` path, which is what every compiled-in module keeps using.

Everything the module's own page draws lives in `renderer/copy.sr.ts` /
`copy.en.ts`, is registered by `defineModuleCopy(id, sr, en)` when the chunk
loads, and is rewritten IN PLACE by the same `applyLocale` walk the shell's table
goes through. **Why the identity has to be stable**: a component that took
`const c = copy.countdowns` at module scope keeps reading the section being
rewritten, where a swapped object would leave it pointing at the old language
forever — the property `strings.ts`'s own header explains, and which
`check:string-capture` enforces for both tables.

`copy.en.ts` is typed `typeof sr`, so a sentence left untranslated, a key
invented, or a nested table that does not match is one compile error each — the
same guarantee the two 8k-line shell tables have.

### 4. Page, icon, settings, widgets: one generic path each

* `App.tsx` gains ONE branch for kit modules — “the shown id is a discovered
  module” — instead of one per module, and `routes.test.ts` proves a kit page is
  reached lazily and is not in the startup import graph. That test now expands
  the non-eager `import.meta.glob` patterns the way the bundler would, because
  without it the assertion would report “nothing wrong” about a page it never
  looked at.
* `moduleIconName` falls back to the module's own `renderer/icon.ts`, which names
  a glyph in `@nexus/ui`'s set. **The drawing lives in the set** — its house rules
  (24×24 box, content inside 3…21, stroke only, one weight, round caps and joins)
  are what make fourteen module marks read as one family, and a module shipping
  its own SVG would be the first exception to them. Adding a module therefore
  adds one glyph to `packages/ui`, and that is the one shared file a module
  touches by design.
* Settings cards, search kinds, widgets, notifications and `statsContributions`
  are manifest-driven already, and a discovered manifest reaches all of them
  through the registry. The shots harness derives one scene per declared settings
  card from the registry, so a kit module is photographed without a list entry.

### 5. Import/export: the archive gains a `modules` section

The interchange (`@nexus/core`) gains `data/modules.ndjson`, one `module-data`
record per discovered module that has something to say, riding in
`ProfileData.modules` as `{ moduleId, payload: unknown }`. It is a MINOR schema
bump (`1.42.0`) and it belongs to no archive module, on `settings`' and the
private section's exact terms: a subset export cannot drop part of a module's
payload, because the payload is not a collection of rows.

* `ctx.exportData(run)` returns a VERSIONED JSON value, or `undefined` for a
  module with nothing to say — `ModuleHost.collectExports` omits it rather than
  writing `undefined`, so an archive's shape does not change the day a module is
  added.
* `ctx.importData({ parse, apply })` splits the two moments. `parse` is pure and
  total: it validates the WHOLE payload — every field, every row, the version it
  was written with — and throws on anything it will not take, so it can run
  before anything is written. `apply` writes, and is handed exactly what its own
  module's `parse` answered, or `undefined` when the section does not name it.
  The timers module's payload carries `version`, and a version it does not know
  is refused by name.
* Core carries a payload without reading it; the desktop refuses a section this
  build cannot import whole, at the PREVIEW (so the user hears it before
  confirming) and again at apply time (so a plan confirmed against one build
  cannot be applied by another). Three refusals, two problem codes: a module id
  this build did not adopt, or one it cannot restore, is `RestoreProblemCode`'s
  `unknown-module`; a payload the module's own `parse` throws on is
  `invalid-module-data`. Both carry Serbian and English copy.
* **A section that does not name a module means EMPTY, not „unchanged".** A
  restore replaces a profile whole, so every adopted module runs: the one the
  section names with its parsed payload, and every other one with `undefined`,
  which resets its archived state to empty. The whole set runs inside ONE
  transaction, so a module that refuses — at the preview, or in the middle of the
  apply — leaves the profile holding nothing of that section.

### 6. The database stays global, sequential, and shared

Schema does not become per-module. A kit module's tables are a normal migration
in `packages/db/src/migrations/` and a normal store folder in
`packages/db/src/<area>/`, tested like the existing ones. Nothing else about the
database changes.

**One consequence, stated rather than hidden.** A module's tables are NOT added
to `RESTORE_WIPE_TABLES`, and that is structural: that list is DERIVED into
`@nexus/sync`'s collection map, which `packages/db/src/sync/collectionGuard.test.ts`
holds it equal to, and a module built on the kit may not edit `@nexus/sync`. So
the kit's rule is the opposite one: **a module replaces its own rows**, in its
own `importData`, inside the same restore. `main/restore.ts` calls
`restoreModuleData` immediately after the replace has emptied every table on that
list, and every adopted module's `apply` runs there in ONE transaction — the ones
the section names with their parsed payloads, and the ones it does not name with
`undefined`, which resets them to empty. `timers_presets`, `timers_countdowns`
and `timers_settings` are named as documented exemptions in that guard test,
beside `elec_settings` and `backup_settings`, with this reasoning written next
to them.

## What remains central, on purpose

* the migration series, its numbers, and its order;
* the interchange schema version and the archive's reader/writer;
* `RESTORE_WIPE_TABLES` and the sync collection map derived from it;
* `@nexus/ui`'s icon set (a module brings a NAME, the drawing lives with the
  other drawings);
* `ESSENTIALS_MODULE_PRESET` — the questionnaire's own table, which by its own
  test must decide every selectable module.

Each is a place a module adds one line, and each is named in
`adding-a-module.md` so the line is not discovered by a failing test.

## Alternatives rejected

**A generic `invoke(channel, payload)` on the bridge.** One line instead of a
declaration per module, and it hands the renderer the whole main-process surface
through a single hole: the allowlist would be “whatever the string says”. SEC-EL-02
is the reason this application has a preload at all.

**A central list per hotspot, kept by the runs that add modules.** Every one of
the eight rows in the Context table is such a list today. Twenty modules arriving
at once means twenty-way conflicts in the files with the worst merge behaviour,
and the conflict is always in the same two lines. Discovery moves the edit from
“the file everybody edits” to “a file the module owns”.

**Declaring a module's API in `shared/ipc.ts` and its handlers in `index.ts`,
with the folder only for the UI.** This is a smaller change and buys nothing: the
two largest files in the repository would keep growing with every module, which
is the whole problem.

**A per-module database or a per-module migration series.** The restore, the
archive and the sync map are all statements about ONE schema; a module that
brought its own would have to re-derive all three.

## Consequences

* A new module is a folder: manifest, contract, handlers, page, copy, tests. The
  timer's whole main-process surface is one `register.ts`, and its whole
  renderer surface is one `Page.tsx` plus its own copy.
* The kit is proven end-to-end by a real module (Timers) rather than by the
  framework's tests alone: 10 ops, a main-owned clock that outlives the page, an
  OS announcement, an archive section that round-trips, and one dashboard card.
* `check:copy` and `check:string-capture` had to learn what a module's copy is.
  Both were extended, and the copy gate now censuses 16 104 leaves — the shell's
  plus the 45 the Timers module declares — with every one of them read. Before
  the extension those 45 were measured by nothing at all.
* A module's copy file must import its live table from `./copy.js` for the
  string-capture gate to see module-scope reads; the convention is stated in
  `adding-a-module.md` and in the gate's own header.
* A restore applies the kit's section ALL OR NOTHING, and the pair in
  `ModuleContext.importData` is what buys it. `parse` is pure and total, so the
  kit can run it twice: at the preview, where a refusal reaches the user before a
  profile is replaced, and at apply time before any module writes. `apply` then
  runs for EVERY adopted module — with what that module's own `parse` answered,
  or with `undefined` when the section does not name it — inside one transaction
  on the profile's database, where each store's own transaction nests as a
  savepoint. A refusal at the preview costs nothing, because no profile has been
  replaced yet. One residual is left. The kit's transaction runs after the core
  replace has committed, so an `apply` that fails at that point leaves every
  module's rows as they were before the restore, beside the restored core. Since
  `parse` already passed, only a database error gets there. `undefined` is not „leave it
  alone": a restore replaces a profile whole, so it is the module's instruction
  to reset its own archived state to empty, and a module that archives anything
  implements it.
