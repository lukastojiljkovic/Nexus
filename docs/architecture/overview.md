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

One product, four surfaces, two account modes:

- **Desktop** (Windows/macOS/Linux): Electron + React — **built**; the only
  surface today.
- **Web app**: the same React renderer — *in progress*. `apps/web` exists as a
  shell (the desktop's rail rendered by the same components, plus a typed
  `NexusApi` proxy that throws until something connects it); everything behind
  that proxy is unwritten. Target is **Cloudflare Workers with static assets**.
  See [ADR-084](adr/084-web-readiness.md) for what the renderer already
  satisfies and what it does not.
- **Android** (after desktop + web, decision #9): adapted, not reduced —
  *unbuilt*.
- **Landing/marketing site**: fully independent deployable — *unbuilt*.

Local accounts never contact a server (SEC-PRIV-02) — **built, and today still
the only account mode a user can reach**. Cloud accounts add sync, sharing and
backup as an enhancement, never a dependency; local SQLite is the source of
truth on every client, and the server is a relay and authority for sync, auth
and blob storage. Private notes cross the wire only as ciphertext (SEC-ZK).

**The server half is now built and executed** — thirteen Supabase migrations
against a real Postgres 17, an RLS wall proved by 109 pgTAP assertions in CI,
three Edge Functions, and the PostgREST wire measured rather than assumed. What
does not exist is the *client* path that would let a user switch any of it on.
**Cloud stays off by default and switchable off entirely, structurally** — the
local-only path must not be able to reach the network, and `check:egress` is one
of the four layers holding that. See `../STATUS.md` §2 and §3.

## Decision index

### Foundations (001–011)

| ADR | Decision | Choice |
| --- | --- | --- |
| [001](adr/001-local-storage-engine.md) | Local storage engine & data model | SQLite everywhere; encrypted at rest for local accounts; Yjs docs + relational rows + content-addressed blobs |
| [002](adr/002-sync-engine.md) | Sync & conflict resolution | PowerSync (self-hosted Open Edition) for rows; Yjs for documents; ciphertext blobs for PRIV — *unbuilt* |
| [003](adr/003-backend-stack.md) | Backend | Go + PostgreSQL (founder revision 2026-07-05); REST + OpenAPI-generated TS client; EU Docker hosting — *unbuilt* |
| [004](adr/004-auth.md) | Auth (cloud + local) | Argon2id, opaque server-side sessions, anti-enumeration; local PIN + OS keystore. The local half is built and **superseded in detail by [018](adr/018-local-account-passcode.md)**; the cloud half is unbuilt |
| [005](adr/005-private-notes-crypto.md) | Zero-knowledge crypto | libsodium: Argon2id KDF, XChaCha20-Poly1305, DEK/KEK + Recovery Kit. **Primitives superseded by [057](adr/057-private-notes-local.md)**, which built PRIV local-first with no libsodium dependency |
| [006](adr/006-code-sharing.md) | Code sharing across platforms | TS monorepo: shared core + React UI for desktop/web; Android = React Native (gated re-check at kickoff) |
| [007](adr/007-file-preview-pipeline.md) | File preview pipeline | Originally PDF.js / mammoth / SheetJS / zip.js. **Superseded by [064](adr/064-file-preview.md)**: tier 0 + tier 1 built with **zero new dependencies** |
| [008](adr/008-feature-flags-and-plugins.md) | Feature flags → plugin architecture | Typed module manifests + contract registry; flags per profile; sandbox deferred with PLUG |
| [009](adr/009-import-export-formats.md) | Import/export formats & versioning | ZIP container: semver manifest + NDJSON + Markdown/CSV mirrors + blobs; N-2 import support. Sealing added by [022](adr/022-export-completeness-and-encryption.md) |
| [010](adr/010-landing-page-stack.md) | Landing page stack | Astro static + islands; Plausible (EU) analytics; direct download distribution — *unbuilt, and the hosting target has since moved* (see `docs/STATUS.md`) |
| [011](adr/011-canvas-engine-spikes.md) | Canvas engine | Deferred to spikes. **Resolved by [079](adr/079-canvas-engine.md): Excalidraw, as a canvas rather than as a UI** |

### Module and feature decisions (012–082)

Every ADR from 012 on is a decision made *while building* the thing it names,
so each is the authority on its own surface. Grouped by area; the file names
carry the full titles.

- **NOTE** — [012](adr/012-note-editor-and-substrate.md) block editor & Yjs ·
  [013](adr/013-note-wiki-links.md) wiki-links & backlinks ·
  [014](adr/014-note-attachments.md) attachments & blob store ·
  [015](adr/015-note-version-history.md) version history ·
  [016](adr/016-note-templates.md) templates ·
  [017](adr/017-inline-flashcards.md) inline flashcards ·
  [036](adr/036-note-preferences.md) preferences ·
  [068](adr/068-explicit-cloze-numbering.md) explicit cloze numbering ·
  [070](adr/070-note-version-thinning.md) checkpoint thinning ·
  [072](adr/072-note-categories.md) categories
- **AUTH / PRIV** — [018](adr/018-local-account-passcode.md) the local account ·
  [019](adr/019-encrypted-blob-store.md) encrypted blob store ·
  [044](adr/044-multiple-local-accounts.md) multiple accounts on one device ·
  [048](adr/048-account-deletion.md) in-app account deletion ·
  [057](adr/057-private-notes-local.md) PRIV v1 ·
  [058](adr/058-business-profile.md) the business profile ·
  [066](adr/066-priv-refinements.md) PRIV refinements
- **CAL / NTF** — [020](adr/020-calendar-grid-views.md) grid views ·
  [024](adr/024-recurrence.md) recurrence ·
  [025](adr/025-event-reminders.md) event reminders ·
  [026](adr/026-people-lite-birthdays.md) people-lite & birthdays ·
  [033](adr/033-ntf-first-ask.md) the appetite ask ·
  [034](adr/034-time-grid-drag.md) drag & resize ·
  [054](adr/054-fixed-semester.md) semester dates ·
  [061](adr/061-ics-import.md) ICS import
- **TASK** — [027](adr/027-quick-add-dates.md) natural-language dates ·
  [028](adr/028-task-reminders.md) per-task reminders ·
  [029](adr/029-task-lists.md) lists, sections, ordering ·
  [031](adr/031-task-attachments.md) attachments ·
  [035](adr/035-task-templates.md) templates ·
  [037](adr/037-task-dependencies.md) dependencies ·
  [038](adr/038-task-batch-operations.md) batch operations ·
  [049](adr/049-task-smart-lists.md) smart lists ·
  [053](adr/053-completed-archive.md) the archive ·
  [060](adr/060-kanban-columns.md) kanban configuration
- **SRCH** — [021](adr/021-global-search.md) index, analyzer, palette ·
  [030](adr/030-search-operators.md) operators ·
  [032](adr/032-task-attachment-search.md) task attachments ·
  [039](adr/039-search-facets-page.md) the full page with facets ·
  [069](adr/069-attachment-content-search.md) attachment content
- **IMEX** — [022](adr/022-export-completeness-and-encryption.md) the archive's shape and its
  passphrase · [023](adr/023-archive-restore.md) restoring ·
  [043](adr/043-foreign-import.md) merging another account's archive ·
  [051](adr/051-import-duplicates.md) duplicate detection ·
  [062](adr/062-csv-task-import.md) CSV column mapping
- **STUDY** — [042](adr/042-cloze-cards.md) cloze cards ·
  [046](adr/046-problem-cards.md) problem cards ·
  [047](adr/047-interleaved-practice.md) interleaved practice ·
  [052](adr/052-anki-import.md) Anki `.apkg` ·
  [063](adr/063-exam-topics-planner.md) topics & the honest planner ·
  [067](adr/067-planner-refinements.md) planner refinements
- **DASH / SET** — [040](adr/040-keyboard-shortcuts.md) shortcuts & remapping ·
  [041](adr/041-dashboard-background.md) background & dim ·
  [045](adr/045-dashboard-edit-mode.md) edit mode & the widget contract ·
  [050](adr/050-task-views.md) the views-engine iteration ·
  [055](adr/055-named-dashboards.md) named dashboards ·
  [056](adr/056-scheduled-backups.md) scheduled encrypted backups ·
  [059](adr/059-widget-config.md) per-widget configuration ·
  [065](adr/065-onboarding-questionnaire.md) the four-screen onboarding ·
  [071](adr/071-module-settings-contract.md) the per-module settings contract
- **Life hubs & tools** — [073](adr/073-fin-module.md) FIN, the arc design ·
  [074](adr/074-subscription-pause.md) pausing a subscription ·
  [075](adr/075-doc-module-page.md) „Datoteke" ·
  [076](adr/076-habit-module.md) HABIT ·
  [077](adr/077-focus-timer.md) one focus timer ·
  [078](adr/078-nutrition.md) the FIT nutrition layer ·
  [081](adr/081-fitness-training.md) FIT training & measurements
- **Cross-cutting** — [064](adr/064-file-preview.md) in-app file preview ·
  [079](adr/079-canvas-engine.md) CANV's engine ·
  [080](adr/080-third-party-notices.md) third-party notices ·
  [084](adr/084-web-readiness.md) preparing for the web app

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
│   └── tokens/           # Design tokens — the only place a raw colour may appear
├── .github/workflows/    # ci.yml (verify) + security.yml (gitleaks, audit)
└── docs/                 # PRIVATE — gitignored, never committed (founder rule)
```

Directories the original draft anticipated and which **do not exist**:
`apps/web`, `apps/landing`, `packages/crypto`, `packages/interchange`,
`backend/`, `android/`, `e2e/`. Three of those were absorbed rather than
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

- **CI:** GitHub Actions, one `verify` job on `ubuntu-latest` — install with
  `--frozen-lockfile` (SEC-SC-02), then build, typecheck, lint, test. It sets
  `ELECTRON_SKIP_BINARY_DOWNLOAD` and never launches Electron, so **the smoke
  check and the colour grep are local-only gates**. A separate `security`
  workflow runs a gitleaks secret scan and a dependency audit on push and on a
  schedule. There is **no build matrix** (win/macOS/Linux) yet, and no backend
  tests, because there is no backend. `docs/` is gitignored so CI never sees it.
- **Desktop packaging:** electron-vite for dev/build, electron-builder for
  installers (`pnpm --filter @nexus/desktop dist`), electron-updater present as
  a dependency but **no update feed is configured**. SEC-SC-03/04 still stand:
  code signing on Windows and notarization on macOS are a hard gate before any
  public download, and neither is set up — **today's installers are unsigned and
  must not be distributed beyond the founder's own machines.**
- **Native ABI:** `better-sqlite3-multiple-ciphers` compiles against either
  Node's ABI (Vitest) or Electron's (the app), never both. Only
  `rebuild:node` / `rebuild:electron` / `smoke` may flip it. Electron is pinned
  to **^42** (ABI 146) because 43 (ABI 148) has no prebuild; Dependabot ignores
  Electron majors.
- **Web:** *unbuilt.* COOP/COEP headers are required for SQLite-WASM OPFS
  (ADR-001), which is a hosting constraint the target must satisfy — see
  [ADR-084](adr/084-web-readiness.md).
- **Backend:** *unbuilt.*

## Testing strategy

- **Unit:** Vitest across `core`, `db` and `desktop`. Data and store logic is
  written test-first.
- **End-to-end:** the desktop `smoke` script — build, launch Electron, exercise
  the real IPC surface against a real database, print `SMOKE OK`. It is the only
  E2E harness; Playwright was never adopted.
- **Contract (OpenAPI golden files), backend tests, sync soak tests:** *unbuilt*,
  because the surfaces they test do not exist.
- **Performance gates:** *unbuilt.* The budgets below are recorded targets, and
  **nothing measures them** — no reference dataset, no CI assertion. Treat any
  claim that the app meets them as unverified until a harness exists.

## Performance budgets (targets on record; not yet measured)

- Desktop cold start to interactive dashboard: **< 2 s** on reference
  hardware; warm start < 1 s.
- Dashboard render with 12 widgets: **< 300 ms** (DASH acceptance).
- Search-as-you-type first results: **< 100 ms** at 10k items (SRCH).
- Sync catch-up after a day offline (≤ 1k changed rows): **< 5 s** visible
  convergence.
- Base memory (desktop, idle, Essentials modules): **< 400 MB**.

One number *is* known, and it is not in this list. Measured on the 2026-08-06
build (`pnpm build`, `apps/desktop/out/renderer/assets`): the renderer's entry
chunk is **6,080,364 bytes — 5.8 MiB raw, 1.25 MiB gzipped** — beside a 532 KiB
stylesheet (103 KiB gzipped). The build emits 129 JS chunks, but that number
flatters us: every one of them comes from a *dependency's* own dynamic imports
(mermaid's diagram modules, Excalidraw, cytoscape, KaTeX). Nexus's own renderer
contains **exactly one** `import()` — the third-party licences file behind a
Settings card. Every page, every module, every dialog is in the entry chunk.
Route-level splitting is open work ([ADR-084](adr/084-web-readiness.md)) and is
the single biggest lever on first paint in a browser.

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
   plus ciphertext blobs; mitigated by soak tests, PowerSync doing the hard
   row-sync part, and keep-both conflict UX for documents.
2. **ZK crypto UX on web** (ADR-005): served-code trust caveat is real;
   mitigated by strict CSP + SRI, documented caveat (founder-approved), and
   desktop as the flagship.
3. **Canvas engine unknown** (ADR-011): decision deliberately deferred to
   spikes; risk contained by timebox and by CANV being S-tier.
4. **Android reuse bet** (ADR-006): React Native path assumed but gated;
   worst case is a native Kotlin rewrite of UI over the same backend/sync
   protocol.
5. **Electron footprint & perf discipline** (ADR-001/006): budgets in CI
   from day one; virtualized lists mandatory in views engine.
6. **Bus factor = 1 + ops load** (ADR-003): Go is new to the founder
   (founder revision, risk accepted); mitigated by the thin backend scope,
   the auth-code review discipline in ADR-003, Postgres as the boring
   core, managed-service escape hatches, and runbooks in `docs/`.
7. **PowerSync FSL dependency** (ADR-002): fair-source license, converts to
   Apache-2.0 after 2 years per release; non-compete clause irrelevant to
   Nexus (we don't sell sync). Fallback documented in the ADR.
