# Nexus Architecture — Overview

**Status:** drafted 2026-07-05; **reconciled against the built system 2026-08-02,
and again 2026-08-16** when the server half stopped being a design. Inputs: the
complete PRD set (`../prd/`, founder decisions #1–#11), research phase 1
(`../research/`), and the binding security baseline (`../security/baseline.md`).
Decisions live in `adr/NNN-*.md`; this file is the map. **Binding for
implementation**, same standing as the security baseline.

> **How to read this file.** The original draft described the *intended* system
> at a point when none of it existed. Where the built system now differs, this
> file states what is **built** and what is **designed but unbuilt**, and never
> lets the two share a sentence. Anything marked *(unbuilt)* is a decision on
> record, not a thing you can run.

## System context

One product, one surface:

- **Desktop** (Windows/macOS/Linux): Electron + React — **built**; the only
  surface the app ships.
- **Landing/marketing site**: fully independent deployable — *unbuilt*.

Accounts are local. They never contact a server (SEC-PRIV-02) — **built**, and
the only account mode. Local SQLite is the source of truth, and nothing leaves
the device unless the user turns on a network mode. The local-only path must not
be able to reach the network, and `check:egress` is one of the four layers
holding that. ADR-089 adds a device-level **network mode** on top: **Offline
only** (the default) is that path unchanged; **Offline + update checks** lets a
dedicated, non-persistent session reach three pinned GitHub hosts to update the
app; **Downloads** adds the content the user chooses to fetch from the hosts
listed in `apps/desktop/src/main/net/offline.ts`. See `../STATUS.md` §2 and §3.

## Decision index

Every decision that shapes the system is one file in [`adr/`](adr/). The index
— number, title, status and date, each read from the ADR's own status line —
is one table in [adr/README.md](adr/README.md). ADRs 001–011 are the
foundations and the earlier drafts, and several of them are superseded in
part; each file's status says where it stands, and the table repeats it.

## Monorepo layout

What exists today:

```text
nexus/
├── apps/
│   ├── desktop/          # Electron shell — main, preload, renderer; owns the database
│   └── gallery/          # Component gallery — design review only, not shipped
├── packages/
│   ├── core/             # Domain logic, module registry, contracts, views engine (platform-free)
│   ├── db/               # Schema, forward-only migrations, per-module stores (Node + SQLite)
│   ├── ui/               # Design system components (React)
│   ├── tokens/           # Design tokens — the only place a raw colour may appear
│   ├── sync/             # Collection map, change journal, merge
│   ├── sync-crypto/      # Key hierarchy, wrapping, pairing transcript
│   ├── sync-engine/      # One sync round: sweep, pull, push
│   ├── sync-port/        # The injected crypto seam, so no package hardcodes a primitive
│   └── sync-transport/   # The wire — PostgREST and Broadcast, no keys, no origin
├── .github/workflows/    # ci.yml (verify); security, codeql, scorecard, release, pages
├── site/                 # The project website, published by pages.yml
└── docs/                 # Specification, ADRs, journal, status, security, design, research, prompts
```

**The five `sync-*` packages are code kept on hold.** They were
written and tested before Nexus settled on staying offline on 2026-10-08, and
**nothing here is built into the app**: no screen reaches them, no release
carries a backend project, and no work on them is planned. They stay in the tree
because they are correct and tested, and because the data model and the conflict
reasoning behind them outlive the decision that paused them. The desktop app
still resolves `@nexus/sync` and its four siblings, so they are built and
type-checked with everything else, but the shipped product never calls one.

Directories the original draft anticipated and which **do not exist**:
`apps/landing`, `packages/crypto`, `packages/interchange`,
`backend/`, `android/`, `e2e/`. Three of them were absorbed rather than
deferred, and the reasons are worth keeping:

- **`packages/crypto`** — PRIV shipped on WebCrypto through
  [ADR-057](adr/057-private-notes-local.md), so there was no libsodium wrapper to
  package.
- **`packages/interchange`** — the IMEX schemas live in `core/src/imex` because
  they are pure domain logic and nothing outside the monorepo consumes them.
- **`e2e/`** — replaced by `apps/desktop/scripts/launch.mjs --smoke`, which
  drives the real Electron app against a real database and prints `SMOKE OK`.
  There is no Playwright dependency.

Tooling: pnpm workspaces + Turborepo. TypeScript strict everywhere
(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); ESLint.

**The raw-colour ban is enforced by the toolchain** — since 2026-08-06
(`01e1deb`). It was not before: the original draft claimed a custom ESLint rule
that was never written, and for a year the rule lived as a grep somebody had to
remember to run.

`scripts/check-colours.mjs`, run as `pnpm check:colours`, is its own CI step
before the slower ones and has its own Vitest suite. It is considerably more
precise than the grep it replaces: TS/TSX is walked as a real TypeScript AST so
only string and template literals are candidates (a comment saying „decision #11"
or quoting a git SHA is never looked at, rather than dodged); CSS strips
comments and quoted strings and then restricts matching to declaration-VALUE
position, which is the only thing that distinguishes the colour `#face` from
the perfectly ordinary id selector `#face`. Named colour keywords are
deliberately not detected — without full value parsing `red` is
indistinguishable from prose, and a keyword scan would be a false-positive
generator rather than a gate. An exception needs a line-scoped
`nx-colour-allow: <reason>` marker, which is always printed, and a marker with
no reason is itself a failure. ESLint echoes the TS/TSX half in the editor; the
script stays the authority because it alone covers CSS and HTML.

## Build, release & CI

- **CI:** GitHub Actions. `ci.yml` runs one `verify` job on `ubuntu-latest` —
  install with `--frozen-lockfile` (SEC-SC-02), then the static gates, build,
  typecheck, lint and the test suites, and last the suites of the on-hold sync
  packages. It sets `ELECTRON_SKIP_BINARY_DOWNLOAD`
  and never launches Electron, so the smoke run and the packaged-build checks
  happen on a host rather than in CI. `security.yml` adds the gitleaks secret
  scan and the dependency audit; `codeql.yml`, `scorecard.yml` and
  `dependency-review.yml` are the public-repository checks; `release.yml` builds
  and drafts a tagged release; `pages.yml` publishes `site/`.
- **Desktop packaging:** electron-vite for dev/build, electron-builder for
  installers (`pnpm --filter @nexus/desktop dist`). The updater is ADR-089's:
  a check against the GitHub release API behind the device-level network mode,
  with electron-updater gone and no update feed configured. The 1.4.0 installer
  is unsigned, so Windows shows a SmartScreen warning on first run; code signing
  (SEC-EL-07 and SEC-SC-05) is still open work, and the release notes say so.
- **Native module:** `better-sqlite3-multiple-ciphers` ships one prebuild per
  platform and architecture, with no ABI in the key, so one `.node` serves both
  Vitest and Electron and nothing has to be flipped between them. Electron is on
  **^44**.

## Testing strategy

- **Unit:** Vitest across `core`, `db` and `desktop`. Data and store logic is
  written test-first.
- **End-to-end:** the desktop `smoke` script — build, launch Electron, exercise
  the real IPC surface against a real database, print `SMOKE OK`. It is the only
  E2E harness; Playwright was never adopted.
- **Performance gates:** *unbuilt.* The budgets below are recorded targets, and
  **nothing measures them** — no reference dataset, no CI assertion. Treat any
  claim that the app meets them as unverified until a harness exists.

## Performance budgets (targets on record; not yet measured)

- Desktop cold start to interactive dashboard: **< 2 s** on reference
  hardware; warm start < 1 s.
- Dashboard render with 12 widgets: **< 300 ms** (DASH acceptance).
- Search-as-you-type first results: **< 100 ms** at 10k items (SRCH).
- Base memory (desktop, idle, Essentials modules): **< 400 MB**.

One number *is* known, and it is not in this list. Measured on the 2026-08-06
build (`pnpm build`, `apps/desktop/out/renderer/assets`): the renderer's entry
chunk is **6,080,364 bytes — 5.8 MiB raw, 1.25 MiB gzipped** — beside a 532 KiB
stylesheet (103 KiB gzipped). The build emits 129 JS chunks, but that number
flatters us: every one of them comes from a *dependency's* own dynamic imports
(mermaid's diagram modules, Excalidraw, cytoscape, KaTeX). Nexus's own renderer
contains **exactly one** `import()` — the third-party licences file behind a
Settings card. Every page, every module, every dialog is in the entry chunk.
Route-level splitting is open work and is the single biggest lever on first
paint.

## PRD friction (flagged, not silently absorbed)

1. **Grocery-list realtime co-edit pull-forward (decision #11).** Grocery
   lists are structured rows, not Yjs documents; naive LWW would eat
   concurrent item edits. Plan: model each *shared* grocery list as a small
   Yjs document (special case), reusing the NOTE sync path. Feasible, but it
   drags presence/awareness infra earlier than SHARE-010 planned — sequenced
   in the roadmap *after* core read-only SHARE ships, cost ~1 extra
   milestone. No cheaper honest alternative exists.
2. **PDF annotation v1.x (decision #11).** PDF.js supports rendering well;
   *editing* annotations is limited. Annotations will be stored as a Nexus
   overlay (our data, rendered above the page), not baked into the PDF file;
   export can flatten later. The PRD wording permits this; implementers must
   not promise in-file annotation.
3. **Custom dashboard background + transparency slider (decision #11).**
   The WCAG auto-check (SET-005) must evaluate contrast against the
   *composited* background. Solution: a token-controlled scrim layer whose
   minimum opacity is computed, not user-bypassable — the slider floor is
   dynamic. Slightly more design-token work; accepted.
4. **Real-time collaboration on zero-knowledge content** stays structurally
   excluded (PRIV cannot be shared) — reaffirmed; any future encrypted
   sharing needs its own research + ADR (PRIV future extensions).
5. **Multiple dashboards at v1 (decision #11)** widens the MVP-adjacent
   surface; absorbed by making "multiple" a thin layer over the same widget
   grid (a dashboard = named layout row), but flagged for roadmap sizing.

## Ranked technical risks

1. **Sync integration complexity** (ADR-002): two sync planes (rows + Yjs)
   plus ciphertext blobs. The engine is written here — `@nexus/sync-engine`'s
   round over `@nexus/sync`, the envelope in `@nexus/sync-crypto` and
   `@nexus/sync-transport`'s PostgREST wire (ADR-002 is superseded on the
   engine and backend) — so the row plane is ours rather than a dependency's.
   Mitigated by soak tests and keep-both conflict UX for documents.
3. **Canvas engine unknown** (ADR-011): decision deliberately deferred to
   spikes; risk contained by timebox and by CANV being S-tier.
4. **Electron footprint & perf discipline** (ADR-001/006): budgets in CI
   from day one; virtualized lists mandatory in views engine.
5. **Bus factor = 1 + ops load** (ADR-003): Go is new to the founder
   (founder revision, risk accepted); mitigated by the small scope, the
   auth-code review discipline in ADR-003, and runbooks in `docs/`.
6. **A paused subsystem nobody exercises** (ADR-002, STATUS §4.4): the
   `sync-*` packages are on hold, built and tested against a local database
   stack but unreachable in the shipped product. The cost is not the code but
   the drift: the durable parts stay green in a suite no user runs, and the
   first real connection would meet a cold server boot that nothing in the
   transport reads as a retryable failure. Accepted while the hold lasts, and
   recorded where the work is (`STATUS.md`).
