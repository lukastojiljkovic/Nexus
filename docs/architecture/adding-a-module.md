# Adding a module

**This is the checklist a run follows to add a module to Nexus.** It is exact on
purpose: several parallel runs build modules at once, and the difference between
adding a file and editing a file everybody else is editing is the whole point of
the module kit ([ADR-090](adr/090-module-kit.md)). The worked example throughout
is the Timers module (`apps/desktop/src/modules/timers/`), which was built as the
kit's own proof.

Read [ADR-090](adr/090-module-kit.md) first: it says WHY each piece is where it
is. This file says what to type.

## What you create

```text
apps/desktop/src/modules/<id>/
  shared/manifest.ts      required — the manifest, and the copy the shell needs early
  shared/ipc.ts           required — the channels, the payload types, the renderer API
  main/register.ts        required — the handlers, and whatever main owns
  renderer/Page.tsx       required — the page, default-exported
  renderer/copy.sr.ts     required — the page copy in Serbian, the shape's source
  renderer/copy.en.ts     required — the same shape in English
  renderer/copy.ts        required — the live table (`defineModuleCopy`)
  renderer/icon.ts        optional — the mark the rail draws
  renderer/Settings.tsx   required if the manifest declares a settings card
  renderer/Widgets.tsx    required if the manifest declares a widget
  renderer/…              the rest: components, helpers, tests, one stylesheet
packages/db/src/migrations/NNN-<id>.ts   if the module stores anything
packages/db/src/<id>/                    its store, with tests
docs/architecture/adr/NNN-<id>.md        if the module makes a decision worth recording
```

`<id>` is the module's registry id — kebab-case, unique, and the prefix of every
channel it declares: `timers`, `timers:list`, `timers:createCountdown`.

## 1. The manifest

```ts
// shared/manifest.ts
import type { ModuleManifest } from "@nexus/core";

export const manifest: ModuleManifest = {
  id: "timers",
  prefix: "UTIL",                       // the PRD prefix — see below
  group: "plan",                        // one of `MODULE_GROUPS` (ADR-093)
  defaultEnabled: true,
  order: 100,                           // where it sorts among DISCOVERED modules
  copy: {
    name: { sr: "Tajmeri", en: "Timers" },
    description: { sr: "…", en: "…" },
  },
  widgets: TIMERS_WIDGETS,              // optional
  settings: TIMERS_SETTINGS,            // optional
};
```

* **`copy` is not optional in practice.** The rail, the settings gallery, the
  onboarding row and the page header all draw words the shell needs before your
  page chunk exists, so they live here as `{ sr, en }` pairs. Both locales, in the
  same register as the copy around them.
* **`order`** sorts the discovered modules after every compiled-in one, ties
  broken by id. Pick a round number and leave room: a tie is resolved by the
  spec, not a bug.
* **`group`** is where the navigation draws your module (ADR-093): one of
  `MODULE_GROUPS`, in the order that list states. The list itself, and the
  reasoning behind six feature groups replacing the old five categories, live in
  [ADR-093](adr/093-navigation-groups.md).
* **`prefix`** is traceability to a PRD entry. `UTIL` is deliberately shared by
  `focus`, `tools` and `timers` — one PRD section implemented three times — and
  any other duplicate fails `apps/desktop/src/renderer/src/modules.test.ts`,
  which states the sharing as an explicit map.
* **A settings card** may only declare controls from the closed vocabulary in
  `packages/core/src/contracts/settings.ts` (`choice`, `toggle`, `value`,
  `fact`), each with an ASCII key and a `labelKey` that is either a `{ sr, en }`
  pair or a `strings` path. Declare `storage`: `"profile"` when main reads the
  row (so it travels in the archive), `"device"` when it is a fact about this
  machine. A profile-stored card offers no „Vrati na podrazumevano“, by rule.
* **A widget** declares `sizes`, a `deepLink` (your own module id unless the card
  opens another module) and a `title` pair.

## 2. The contract

```ts
// shared/ipc.ts
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

export type TimersOps = {
  list: { request: { profileId: string }; response: TimersView };
  createCountdown: {
    request: { profileId: string; name: string; durationSeconds: number };
    response: TimersView;
  };
};

export type TimersApi = ModuleApiOf<TimersOps>;
export const contract = defineModuleContract<"timers", TimersOps>("timers", [
  "list",
  "createCountdown",
]);

declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    timers: TimersApi;
  }
}
```

* The op list and the `Ops` type are checked against each other in both
  directions: an op named in one and forgotten in the other is a compile error.
* **Declare your row types here, not in `@nexus/db`.** No file under `shared/`
  may reach a Node-only package, because the renderer shares this folder. The
  wire shapes are yours; `main/register.ts` maps the store's rows onto them.
* The augmentation is what puts `window.nexus.modules.timers` on the renderer
  without a line in `shared/ipc.ts`. It must be a `declare module` naming
  `shared/moduleApi.ts` by the path relative to YOUR file.
* Every mutation answering with the whole view is a good default: the page then
  has exactly one way to update, and a wrong local guess is impossible.

## 3. The main half

```ts
// main/register.ts
import type { ModuleHostSurface } from "../../../main/moduleIpc.js";
import { TimersStore } from "@nexus/db";
import { contract } from "../shared/ipc.js";

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);
  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const timers = call.profileDb(profileId, (db, id) => new TimersStore(db, id));
    return { presets: timers.listPresets(), countdowns: timers.listCountdowns(), settings: timers.settings() };
  });
}
```

* **`register(host)` is the only export the discovery glue calls.** It adopts the
  contract — which refuses a foreign prefix and a channel another module already
  answers — and registers one handler per declared op.
* **Validate every field of every payload** with `call.as.*`, the same validators
  `main/index.ts` uses, moved to `main/ipcValidators.ts`. SEC-EL-02 says the
  renderer is untrusted, and `check:ids` says every field named `id` or `…Id` is
  bounded with `asId` rather than with the unbounded string helper.
* **The database is reachable only through `call.profileDb`** and the store you
  built for it. Do not hand-write SQL here: a store's refusal is a message, a
  migration's CHECK is the guarantee.
* **`assertTrustedSender` already wraps your handler.** You cannot forget it, and
  a second check is noise.
* **A timer or a schedule belongs in main** (`ctx.armUntil`), never in the page:
  a page-bound timer stops when the page closes, which is the one thing a
  countdown promises it will not do. Every armed timer is cancelled when the
  session ends, which is what makes „a toast about a profile whose database is
  closing“ unrepresentable.
* **`ctx.notify({ title, body }, silent?)`** is the app's one OS-notification
  path. Its copy is a `{ sr, en }` pair, resolved in whatever language main is
  writing in at that moment.
* **Session hooks**: `ctx.onSessionStart(run)` after the database is open,
  `ctx.onSessionEnd(run)` after every armed timer has been cancelled.

## 4. The page, the copy and the icon

* **`renderer/Page.tsx` default-exports the page** and takes `{ profileId }`
  (`ModulePageProps`). Nothing else is handed to it; everything else it asks
  main for through its own contract.
* **`renderer/copy.sr.ts` is the shape's source of truth** and
  **`renderer/copy.en.ts` is typed `typeof sr`** — one compile error per sentence
  left untranslated and one per key invented.
* **`renderer/copy.ts` is three lines**, and it must import the live table as
  `./copy.js`:

  ```ts
  import { defineModuleCopy } from "../../../renderer/src/strings.js";
  import { en } from "./copy.en.js";
  import { sr } from "./copy.sr.js";

  export const copy = defineModuleCopy("timers", sr, en);
  ```

  The path matters: `check:string-capture` recognises a module-scope read of a
  live table by that import, so a table handed out of another file would be
  invisible to the gate. Read copy as `copy.section.leaf` at CALL time — never
  into a module-scope constant, which freezes one language forever.
* **`renderer/icon.ts` exports `{ iconName }`**, a name from `@nexus/ui`'s set.
  A glyph that does not exist yet is drawn in
  `packages/ui/src/components/Icon.tsx`, following that file's own house rules
  (24×24 view box, content inside 3…21, stroke only, one weight, round caps and
  joins). **This is the one shared file a module edits by design.**
* **The shell surface a module reaches for is one import**
  (`renderer/src/moduleKit/moduleSurface.ts`): `activeLocale`, `declaredText` (a
  manifest pair, read in the current language), `labelClass` and
  `settingsEntryId` for a settings card that cooperates with the filter, and the
  types a page or a widget body is called with.
* **Styles go in the module's own stylesheet**, imported by its page —
  `import "./timers.css"` — so the rules arrive with the chunk. Tokens only: no
  raw colour, no `z-index` outside the layer scale, no style value in JS.

## 5. Storage

Nothing about the database changes for a kit module: a normal migration and a
normal store, tested like the existing ones (`packages/db/src/habits/` is the
model).

1. `packages/db/src/migrations/NNN-<id>.ts`, added to `MIGRATIONS` in
   `packages/db/src/migrations/migrations.ts` — the next free number.
2. `packages/db/src/<id>/<name>Store.ts` plus its `.test.ts`, exported from
   `packages/db/src/index.ts`.
3. `packages/db/src/migrations/migrations.test.ts` pins the highest migration
   number; its own message says so.
4. **Do not add your tables to `RESTORE_WIPE_TABLES`.** That list is derived into
   `@nexus/sync`'s collection map, which lives in a package a module may not edit.
   Replace your own rows in your `importData` instead, and name your tables in
   the documented exemption list in `packages/db/src/imex/restoreStore.test.ts`.
   [ADR-090](adr/090-module-kit.md) §6 explains the trade in full.

## 6. Import and export

The archive carries your data if you register both hooks:

```ts
ctx.exportData((session) => buildTimersExport(presets, settings)); // versioned JSON, or undefined
ctx.importData({
  parse: parseTimersExport,                                        // pure: the WHOLE payload, or it throws
  apply: (payload, session) => {                                   // writes; `undefined` = reset to empty
    for (const profileId of session.profileIds) replace(profileId, payload);
  },
});
```

* Version the payload and refuse a version you do not know, by name.
* **`parse` is pure and total.** It reads the whole payload and throws on
  anything it will not take, and it writes nothing: the kit runs it at the
  preview (so the user hears a refusal before confirming) and again before any
  module writes. That is what makes a refused archive cost nothing.
* **`apply` is handed what your own `parse` answered**, or `undefined` when the
  section does not name your module. For a restore, `undefined` means empty, not
  "unchanged": reset the state you archive, and leave state you do not (a running
  clock belongs to the machine, not the archive).
* **Every adopted module is applied in ONE transaction.** A module that refuses
  in its own `apply` rolls back what the modules ahead of it wrote.
* An archive naming a module id this build does not know, or carrying a payload
  your `parse` refuses, is refused before you are ever asked to apply it — at the
  preview and again at apply time.
* Do not export live state — a running countdown, a session in progress. Export
  what the user AUTHORED.
* A session handed to `exportData` names exactly one profile (an archive is
  written one profile at a time). Answer `undefined` rather than guessing if it
  ever names more.

## 7. Tests

Write them where the code is: the folders are in the app's Vitest include list,
and a test under a folder nobody named is collected by nothing.

| Where | What it pins |
| --- | --- |
| `modules/<id>/main/register.test.ts` | your ops through the real `ModuleHost`: a fake platform, a real database, a clock the test moves |
| `modules/<id>/renderer/*.test.ts` | the pure maths and formatting your page does (there is no DOM library here) |
| `packages/db/src/<id>/*.test.ts` | the store, against a real database |
| `packages/core/src/…` | anything shared: the archive's shape, a rule another module also needs |

The app-level tests that ENUMERATE the registry will fail the day your manifest
exists, and that is what they are for. Each fix is one line, and each one is a
statement that your module belongs where it says: `renderer/src/modules.test.ts`
(registry order, the prefix map, the group blocks, the settings-card list, the
widget pairing), `renderer/src/moduleSettings.test.ts`,
`renderer/src/settingsSearch.test.ts`, `renderer/src/onboardingPresets.test.ts`
and `shared/onboardingPresets.ts` — the questionnaire's own table must decide
every selectable module.

## 8. The gates

Run what your change can affect; every one of these must be clean.

```bash
node node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.node.json --noEmit
node node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.web.json --noEmit
node node_modules/eslint/bin/eslint.js <the files and folders you changed>
node node_modules/vitest/vitest.mjs run --maxWorkers=2 apps/desktop/src packages/<yours>/src
node scripts/check-layers.mjs        # and every other check:* in package.json
```

The kit adds no gate of its own; it makes the existing ones cover a new folder.
Two are worth knowing about by name:

* `check:copy` censuses your `renderer/copy.sr.ts` and reports every sentence no
  screen reads. A green run means all of them are on screen somewhere.
* `check:string-capture` fails on a module-scope read of your live copy table
  (`copy.foo.bar` evaluated at import) — move it into the function that uses it.

## The one-paragraph summary

A module is a folder. The shell finds it with `import.meta.glob`; main gets one
handler per declared op, wrapped in the sender check; the preload builds the
bridge from the same declaration; the page and its copy load lazily; and the
shell needs only the manifest's own words before that. You touch three shared
files, each by one line: the migration list, the database package's index, and
(only if you bring a new glyph) `packages/ui`'s icon set.
