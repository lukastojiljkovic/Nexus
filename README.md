# Nexus

An offline-first, modular life-management app. One workspace for tasks,
calendar, notes, studying, files, habits, fitness, finance and a canvas — all
stored on your own device, all working with the network off.

The desktop app (Electron + React) is what is being built now. The web app comes
later out of *this* codebase rather than a rewrite, so the renderer is kept
browser-portable; there is no backend, no sync and no cloud account today.

---

## Requirements

| | |
| --- | --- |
| Node | `>= 24` |
| pnpm | `11.10.0` (pinned via `packageManager`) |
| OS | Windows, macOS or Linux |

```sh
pnpm install
```

`pnpm install` runs a postinstall step that provisions the Electron binary. It
does **not** decide which ABI the native SQLite module is built against — see
**Native ABI** below before running the app or the tests.

## Everyday commands

Run from the repo root; each fans out over the workspace through Turborepo.

```sh
pnpm typecheck      # tsc --noEmit, strict, every package
pnpm test           # Vitest — core, db, desktop
pnpm lint           # ESLint, every package
pnpm build          # production build — tokens, desktop, gallery
```

Desktop app:

```sh
pnpm --filter @nexus/desktop dev        # electron-vite dev server
pnpm --filter @nexus/desktop smoke      # build + launch + end-to-end check → "SMOKE OK"
pnpm --filter @nexus/desktop dist       # electron-builder installer
pnpm --filter @nexus/desktop licences   # regenerate the third-party notices
```

Component gallery — the design-system review surface, not shipped to users:

```sh
pnpm --filter @nexus/gallery dev
```

## Native ABI

`better-sqlite3-multiple-ciphers` is a native module, so it is compiled against
either Node's ABI (what Vitest runs on) or Electron's (what the app runs on) —
never both at once. Two scripts flip it:

```sh
pnpm --filter @nexus/desktop rebuild:electron   # for running the app
pnpm --filter @nexus/desktop rebuild:node       # for running the tests
```

`smoke` flips to Electron and restores Node on the way out, so after any smoke
run the test suite is runnable again. Never rebuild the module by hand.

Electron is pinned to **^42** (ABI 146) because 43 (ABI 148) has no prebuild for
that native module; Dependabot is configured to ignore Electron majors.

## Layout

```text
apps/
  desktop/     Electron shell — main, preload, renderer; the database lives here
  gallery/     Component gallery (design review only)
packages/
  tokens/      Design tokens — the single source of truth for every style value
  core/        Platform-free domain: module registry, contracts, views engine
  db/          Encrypted SQLite, forward-only migrations, per-module stores
  ui/          Design-system components, token-only
```

| Package | What it may depend on |
| --- | --- |
| `tokens` | nothing |
| `core` | nothing platform-specific — no React, no DOM, no Node |
| `db` | Node + SQLite; imported only by the Electron **main** process |
| `ui` | React + `tokens` |

Feature modules never import each other; they meet through the contracts in
`core` (widgets, settings, search, import/export, tools).

## Architecture in one screen

- **The renderer is untrusted.** `contextIsolation` and `sandbox` are on,
  `nodeIntegration` is off, and navigation and window-opening are locked down.
- **The database is main-process only.** The renderer reaches it exclusively
  through a typed IPC allowlist: channel constants are shared, every payload is
  validated field by field in main, and the preload bridge exposes one method per
  channel with no generic passthrough.
- **Every SQL value is bound**, never interpolated, and every store statement is
  scoped by `profile_id`.
- **Storage** is one SQLite database (SQLCipher-class encryption at rest),
  UUIDv7 keys, ISO-8601 timestamps, soft deletes for undo, and a single
  forward-only migration stream.

## Styling rules

Every colour, space, radius and type value comes from `packages/tokens` as a
`--nx-*` CSS variable. **Raw `#hex`, `rgb()` and `hsl()` are forbidden anywhere
outside that package.** The check is a grep over `apps/*/src` and each package's
`src`, run before every commit:

```sh
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' apps/*/src packages/*/src   # must be empty
```

Two themes ship: **Dan** (light) and **Noć** (dark).

## Testing

Vitest across the workspace. Data and store logic is written test-first. The
desktop `smoke` script is the end-to-end check: it builds the app, launches
Electron, exercises the real IPC surface against a real database, and prints
`SMOKE OK`.

Serbian text is sorted and compared with `Intl.Collator(["sr-Latn", "sr"])` —
plain `"sr"` mis-tailors the Latin diacritics (š, č, ć, ž, đ).

## CI

- **CI** (`.github/workflows/ci.yml`) — a single `verify` job on `ubuntu-latest`:
  build, typecheck, lint, tests, on every push to `main` and every pull request.
  It never launches Electron, so the smoke check is a local gate.
- **Security** (`.github/workflows/security.yml`) — gitleaks secret scan plus a
  dependency audit, on every push and on a schedule.

## Language

All user-facing copy is Serbian and lives in `strings.ts`, centralized so a
later i18n extraction is mechanical. Code, comments and documentation are in
English.

## Licence

Proprietary. All rights reserved.
