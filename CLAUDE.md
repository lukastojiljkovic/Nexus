# CLAUDE.md — Nexus project working agreement

Project-specific rules for Claude on **Nexus**. These sit on top of the global
`~/.claude/CLAUDE.md` (user identity, communication style, general git rules) and
add what is specific to this repository. When the two agree, follow both; when
this file is more specific, it wins.

Nexus is Luka's commercial, offline-first, all-in-one life-management platform.
The single source of truth for *what* the product is: [docs/VISION.md](docs/VISION.md)
and [docs/SPECIFICATION.md](docs/SPECIFICATION.md). For *where we are*:
[docs/STATUS.md](docs/STATUS.md). For a plain-language explanation:
[docs/OVERVIEW.md](docs/OVERVIEW.md).

## Current focus (2026-07 — binding until the founder changes it)

- **Desktop app only.** Build and polish the Electron + React desktop app. The
  web app comes later from the *same* codebase (Electron/React) — track that it
  stays web-portable, but do **not** build web hosting, a public site, a backend,
  cloud accounts, or sync right now. First we make the product and see how it
  looks; then it goes to the web.
- Everything cloud-related for functionality is **out of scope for now**: no
  backend (Go/Spring), no PowerSync, no server sessions, no cloud storage. Local,
  on-device only. Local PIN/keystore accounts, offline-first, on-disk SQLite.
- The architecture ADRs that describe cloud/sync/backend
  ([docs/architecture/](docs/architecture/)) remain the long-term design, but they
  are **future work**, not current work. Do not implement them now.

## How we work together

- **Finish things completely.** Do one thing at a time, but each thing **fully and
  properly** — no half-done features, no niche bits left "for later," no scattered
  TODOs. If we know what a feature needs, we build all of it.
- **Blocking vs non-blocking.** If something is genuinely blocked (a decision only
  the founder can make, a missing asset, an external dependency) — **stop and ask
  him**. If it is not blocking, keep going and **collect every open question for
  one batch at the end**. Do not interrupt the flow for non-blocking questions.
- **No "scope/version/it's-a-lot-for-one-day" talk.** Don't narrate limitations or
  defer work in conversation. Anything genuinely not-yet-built is recorded — with
  full context — in [docs/STATUS.md](docs/STATUS.md), so it is never lost and never
  scattered.
- **Keep [docs/STATUS.md](docs/STATUS.md) current.** It is the living record of
  what exists, what's in progress, current problems, and what remains. Update it as
  part of finishing each piece of work — that is how the founder (and a non-technical
  PM) can understand the project at any moment without reading code.
- **Who does what** (founder, 2026-08-06 — supersedes the 2026-07-08 rule that
  everything went to Sonnet):
  - **Opus does the hard part itself.** Design, diagnosis, anything with a trap
    in it, anything touching security, IPC, crypto, migrations or money, and
    every judgement call. Not delegated.
  - **Sonnet subagents do the routine typing** — mechanical implementation,
    repetitive edits, scaffolding from a spec that is already decided. One at a
    time, with a precise self-contained prompt. This is what saves usage.
  - **Fable is the adviser on the genuinely nasty questions and on
    cybersecurity.** Asked for a plan or a second opinion *before* work starts,
    not to write the code. Its answer is advice — Opus still decides and still
    verifies.
- **Verification is not a skim** (founder, 2026-08-06, restating 2026-07-08
  more strongly). Whatever produced the change, before it is committed: read
  **every changed file in full**, re-derive the arithmetic by hand rather than
  trusting a test that may have been written to match the code, run the full
  gate set, and review UI work by eye against the design rules (tokens, banned
  hues, patterns matching existing pages). A subagent's report is a claim, not
  evidence.
- **Agents never touch git** — not even read-only — and never touch `docs/`.
- **A reported bug is a sample, never an incident** (founder, 2026-08-06).
  *„necu samo da se otkloni taj bug, nego i da se proveri uzrok i sta je sve
  potencijalno zahvaceno."* Every defect — his or mine — is worked in this
  order, and the fix is not finished until all four are done:
  1. **Root cause**, not the symptom. Name the actual rule that is wrong.
  2. **Blast radius.** Find every other place that rule reaches — grep for the
     construct, not for the file. A defect in a shared component is a defect at
     every call site; a defect copied by hand is a defect wherever it was
     copied to.
  3. **Fix it once, where it belongs.** If four surfaces had four copies of the
     arithmetic, the outcome is one helper and four adoptions, never four
     patches. Prefer a fix that makes the class *unrepresentable* over one that
     makes this instance correct.
  4. **Ask whether the subsystem is sound.** If the answer to „why did this
     ship" is „nothing in this area was ever designed", say so and put the
     subsystem in `docs/STATUS.md` — the report was the symptom, the subsystem
     is the finding. One overflow bug can legitimately mean the whole layout
     layer is unfinished, and that is the more useful answer.
  Record the class in `docs/STATUS.md`'s defect-class ledger so the same shape
  is recognised the next time it appears somewhere else.
- **Concise Serbian status updates** to the founder; the code, comments, and docs
  are in **English**.

## Git (project rules; global rules also apply)

- Commits are **allowed without asking** for work that is **100% finished and
  verified** (green typecheck + tests + build + smoke, reviewed). **Never push,
  open PRs, or merge** without an explicit, one-time authorization.
- Always Luka's identity (`Luka Stojiljkovic` / `luka.d.stojiljkovic@gmail.com`),
  plain `git commit -m` — never `-c user.email`/`--author` overrides. **Never** add
  `Co-Authored-By` trailers or "Generated with Claude Code" footers.
- **Stage explicit paths only** — never `git add .`. English conventional-commit
  messages, one scoped concern per commit (e.g. `feat(db): …`, `feat(desktop): …`).
- **`docs/` is private and gitignored — never commit or push anything under it.**
  This includes SPECIFICATION/STATUS/OVERVIEW. `CLAUDE.md` (this file) lives at the
  repo root and may be committed.

## Design rules (binding — the app must never read as "AI slop")

- **Tokens only.** Every colour/space/radius/type value comes from
  `packages/tokens` as a `--nx-*` CSS variable. **Zero raw hex/rgb/hsl** anywhere
  outside `packages/tokens` (there is a grep gate: `#hex|rgb(|hsl(` over
  `apps/*/src` and package `src` must be empty).
- **Banned system hues:** no purple/violet, no blue, no orange (especially not
  "Claude orange"). Data/chart secondary is jade green. The 8-accent palette must
  respect these bans (re-check with the founder before finalizing accents).
- **No AI-slop selection.** No inset side-bar highlight, no glows. Active nav =
  typographic (gold text + weight) + the ✦ brand glyph. Drop targets = accent
  border + soft background, never a glow.
- Two themes: **Dan** (light, warm paper + bronze) and **Noć** (dark, vesper
  blue-black + star-gold, Space Grotesk). Discipline of Linear, not its aesthetic.
- All user-facing copy is **Serbian**, centralized in `strings.ts` (i18n comes
  later as a mechanical extraction). Never fabricate data, stats, or copy.

## Security (binding — the app must be airtight)

- [docs/security/baseline.md](docs/security/baseline.md) (`SEC-*` rules) is binding
  for all code. Deviations need founder sign-off in
  [docs/deviations.md](docs/deviations.md).
- **Electron IPC (SEC-EL):** the renderer is untrusted. Channel constants in
  `shared/ipc.ts`; in main, `assertTrustedSender` + `asRecord` + per-field
  validators on every payload; a frozen, one-method-per-channel preload bridge with
  no generic passthrough; the store re-validates semantics. `contextIsolation` +
  `sandbox` on, `nodeIntegration` off, navigation/window-open locked.
- The database lives **only** in the main process; the renderer reaches it solely
  through the typed IPC allowlist. Every SQL value is bound, never interpolated;
  every store statement is scoped by `profile_id`.

## Tech / build essentials

- Monorepo: pnpm 11 + Turborepo, TS 5.9 strict (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), React 19, Vite 7, electron-vite, Vitest.
  Packages: `tokens`, `core` (registry, contracts, headless views engine), `db`
  (encrypted SQLite), `ui`. Apps: `desktop`, `gallery`.
- **Electron is pinned to ^42** (ABI 146): 43/ABI 148 has no prebuild for
  `better-sqlite3-multiple-ciphers`. Dependabot ignores electron majors. Do not bump.
- **Shell quirk (Windows):** pnpm is under `%APPDATA%\npm` and not on the tool PATH.
  Prefix every command: `$env:Path += ";$env:APPDATA\npm"; pnpm …`.
- **Native ABI dance:** the SQLite binary is either node-ABI (for Vitest) or
  electron-ABI (for the app). Use only the repo scripts — `pnpm --filter
  @nexus/desktop smoke` (flips to electron, runs, restores) and `… rebuild:node`
  (restores node). Never flip it by hand. After a smoke run, restore node ABI and
  re-run the db tests.
- **Verification gates before any commit:** `pnpm typecheck` (7/7), `pnpm test`
  (all green), `pnpm build` (3/3), `pnpm --filter @nexus/desktop smoke` prints
  `SMOKE OK`, and the four static gates pass — `check:colours` (no raw hex/rgb/
  hsl outside `packages/tokens`), `check:contrast` (every token pair clears
  WCAG AA, marks clear 3:1, hairlines sit inside the 1.2–2.4:1 band),
  `check:strings` (no module-scope reads of the strings table) and
  **`check:tokens`** (every `var(--nx-*)` resolves to a real token or a
  declaration in source — CSS drops an undefined custom property silently, so
  „uses a token" and „uses nothing" are otherwise indistinguishable).
- **Looking at the app is a command, not a chore.**
  `pnpm --filter @nexus/desktop shots` seeds a demo profile, drives the real
  renderer through every module and sub-view in both themes at three window
  sizes plus maximised, types into each create form, and writes ~350 PNGs to
  `apps/desktop/shots/` with `report.md` — a geometric audit of clipped text,
  boxes escaping their parent, overlapping text and sub-24px targets, grouped
  as classes. `pnpm --filter @nexus/desktop demo` adds a populated „Demo"
  account to this device (passcode `demo-nexus-2026`). Both flip the native ABI
  through `launch.mjs`, so **never run either while agents are running tests.** New store logic is **TDD** (tests
  red before green). Serbian sr-Latn sorting/formatting uses
  `Intl.Collator(["sr-Latn","sr"])` — plain `"sr"` mis-tailors Latin š/č/ć.
