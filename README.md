# Nexus

An offline-first, modular life-management app. One workspace for tasks,
calendar, notes, studying, files, habits, fitness, finance and a canvas — all
stored on your own device, all working with the network off.

The desktop app (Electron + React) is complete and in daily use. The web app
and sync are built out of *this* codebase rather than as a rewrite, with Supabase
behind them and end-to-end encrypted sync between the two — the server holds
ciphertext and never plaintext content. **They are paused** by the founder's
decision of 2026-08-31 until the desktop feature set is finished: everything
already built for them stays built, stays tested and stays off by default.

**Cloud is off by default and can be switched off entirely**, and that is
structural rather than a promise: the local-only path is not *able* to reach the
network, and a CI gate enforces it. A user who never turns sync on is running
exactly the offline app described above.

<p>
  <img src="docs/images/dashboard.png" width="49%" alt="Nexus dashboard: today's events, upcoming tasks, expiring documents and exams">
  <img src="docs/images/tasks.png" width="49%" alt="Task lists with sections, subtasks, tags, priorities and due dates">
  <img src="docs/images/finance.png" width="49%" alt="Finance ledger with accounts in two currencies, categories and budgets, in the dark theme">
  <img src="docs/images/electronics.png" width="49%" alt="Electronics workbench: a Raspberry Pi wired to four sensors, in the dark theme">
</p>

The UI is in Serbian (see **Language**). The screenshots show the demo profile
rendered by the screenshot harness (`pnpm --filter @nexus/desktop shots`).

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

`pnpm install` runs a postinstall step that provisions the Electron binary.
There is no ABI dance to perform: since 13.0.3 the native SQLite module is a
Node-API addon, and one prebuilt file serves both Node (what the tests run on)
and Electron (what the app runs on). See **The native module** below.

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

## The native module

`better-sqlite3-multiple-ciphers` is a native module, and since **13.0.3** it is
a Node-API one: the package ships eight prebuilt binaries keyed by platform and
arch with no ABI in the key, and its loader picks one at runtime. The same file
serves Node (what Vitest runs on) and Electron (what the app runs on), so there
is nothing to flip, nothing to restore, and `smoke`, `shots` and `demo` can run
while the tests do.

Nothing in this repo compiles it. `pnpm-workspace.yaml` denies the package a
build script for that reason — the `binding.gyp` it still ships would otherwise
make pnpm run `node-gyp rebuild` and fail the install on any machine without
Visual Studio's C++ workload, for a binary the package already carries.

## Building a release

`dist` builds for the **host platform only**. Not because of the native module
— that reason retired with 13.0.3, which carries every platform's binary — but
because an AppImage wants Linux tooling and an NSIS installer wants Windows',
and nothing here has ever produced or opened a cross-built artifact. `dist.mjs`
refuses a host it cannot package for before it builds anything.

A root [`Makefile`](Makefile) wraps this. It adds nothing the pnpm scripts do
not do; what it adds is **order** — `pnpm build` before `dist` is not optional
in a fresh tree, and skipping it fails inside Vite with „failed to resolve
entry for package" and no hint that a workspace package simply was not built
yet — and **refusal**, so the cross-build above is caught before the build
rather than after it.

```sh
make                 # the target list, and the host it detected
make linux           # AppImage + tar.gz   (refuses a non-Linux host)
make windows         # NSIS installer      (refuses a non-Windows host)
make verify          # typecheck, lint, test, build, and every static gate
make artifacts       # what is currently in apps/desktop/release/
```

`make linux` writes both Linux artifacts into `apps/desktop/release/`:

| | |
| --- | --- |
| `Nexus-<version>-x86_64.AppImage` | any glibc desktop, no packaging step |
| `nexus-<version>-linux-x64.tar.gz` | the payload the Gentoo ebuild installs |

**Building the Linux artifacts from a Windows machine: use WSL.** It is a real
Linux userspace, so what it produces are ordinary Linux artifacts — no Docker,
no VM. Run `make linux` from the WSL shell.

The Makefile needs GNU make and a POSIX shell, which on Windows means Git Bash
or WSL, not cmd.exe. Nothing depends on it: every target is one documented pnpm
script, and `pnpm --filter @nexus/desktop dist` remains the direct route.

The full Linux guide — the AppImage's sandbox and FUSE behaviour, the keyring
requirement, and installing the Gentoo overlay — is in
[apps/desktop/build/gentoo/README.md](apps/desktop/build/gentoo/README.md).

## Layout

```text
apps/
  desktop/     Electron shell — main, preload, renderer; the database lives here
  web/         The same renderer on a browser runtime
  gallery/     Component gallery (design review only)
packages/
  tokens/          Design tokens — the single source of truth for every style value
  core/            Platform-free domain: module registry, contracts, views engine
  db/              Encrypted SQLite, forward-only migrations, per-module stores
  ui/              Design-system components, token-only
  sync/            The sync engine — collection map, change journal, merge
  sync-crypto/     Key hierarchy, wrapping, pairing transcript
  sync-port/       The injected crypto seam, so no package hardcodes a primitive
  sync-transport/  The wire — PostgREST and Broadcast, no keys, no origin
```

| Package | What it may depend on |
| --- | --- |
| `tokens` | nothing |
| `core` | nothing platform-specific — no React, no DOM, no Node |
| `db` | Node + SQLite; imported only by the Electron **main** process |
| `ui` | React + `tokens` |
| `sync-port` | nothing — it is the interface the others are written against |
| `sync-crypto` | `sync-port` |
| `sync-transport` | an injected `HttpPort`; it holds no `fetch`, no `WebSocket`, no origin and no key |
| `sync` | `core`, `sync-crypto`, `sync-transport` |

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
`--nx-*` CSS variable. **Raw `#hex`, `rgb()`/`hsl()` and the newer CSS colour
functions (`oklch()`, `lab()`, `lch()`, `color()`) are forbidden anywhere
outside that package.** The rule is enforced by the toolchain, not memory:
`pnpm check:colours` walks every package's `src`, runs as its own CI step on
every push and pull request, and has its own Vitest suite
(`scripts/check-colours.mjs`, `scripts/check-colours.test.mjs`). ESLint echoes
the same rule for TS/TSX string and template literals so a violation is a red
squiggle in the editor too, but the script remains the authoritative gate — it
alone also covers CSS and HTML.

```sh
pnpm check:colours   # exits non-zero and prints file:line: <text> per violation
```

A genuinely justified exception is a same-line `// nx-colour-allow: <reason>`
comment (`/* … */` in CSS, `<!-- … -->` in HTML) — never a blanket ignore, and
every use is still printed.

Two themes ship: **Dan** (light) and **Noć** (dark).

The **type scale** is `11 / 13 / 15 / 18 / 24 / 32` in whole pixels, with a
leading scale (`tight / snug / normal / loose`) beside it and a tighter tracking
value for large type. `caption` and `label` deliberately share 11px: a label is
a caption in uppercase with 0.12em of tracking, separated by treatment rather
than by size. Nothing in the app sets a font size, a line height or a letter
spacing that is not one of those tokens.

**Selection is typographic.** „Which one of these is on" — view switchers,
filter chips, reminder ladders, the weekday picker, the canvas tools — is accent
text plus weight and nothing else: no fill, no border, no glow. One class
(`.nx-segmented__option`) owns it and keys off `aria-pressed`, so the state a
screen reader is told and the state an eye is shown cannot drift apart. A filled
button therefore goes on meaning „press this" everywhere in the product.

**Layers are named, never numbered.** Stacking order is a property of the whole
app, so no surface picks its own: every `z-index` is `auto` or one
`var(--nx-layer-*)`, from a scale that runs `under` · `ground` · `figure` ·
`raised` · `docked` · `drawer-scrim` · `drawer` · `panel` · `overlay` ·
`dialog` · `menu`. Two names may share a number — a pinned header and a figure
over its ground are both 1 — because a token names an INTENT, and moving one
intent must not silently drag the other with it. `pnpm check:layers` enforces
it in CSS and in inline styles set from TS, and also checks that the scale is
still strictly increasing: every call site would go on passing if a layer were
edited to sit under the one it is meant to cover.

## Testing

Vitest across the workspace. Data and store logic is written test-first. The
desktop `smoke` script is the end-to-end check: it builds the app, launches
Electron, exercises the real IPC surface against a real database, and prints
`SMOKE OK`.

Serbian text is sorted and compared with `Intl.Collator(["sr-Latn", "sr"])` —
plain `"sr"` mis-tailors the Latin diacritics (š, č, ć, ž, đ).

## CI

- **CI** (`.github/workflows/ci.yml`) — a single `verify` job on `ubuntu-latest`:
  the raw-colour check, build, typecheck, lint, tests, on every push to `main`
  and every pull request. It never launches Electron, so the smoke check is a
  local gate.
- **Security** (`.github/workflows/security.yml`) — gitleaks secret scan plus a
  dependency audit, on every push and on a schedule.

## Language

All user-facing copy is Serbian and lives in `strings.ts`, centralized so a
later i18n extraction is mechanical. Code, comments and documentation are in
English.

## Licence

Apache License 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Third-party
notices ship inside the app (Podešavanja → Licence) and are regenerated with
`pnpm --filter @nexus/desktop licences`.
