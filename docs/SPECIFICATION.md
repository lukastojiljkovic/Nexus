# Nexus — Complete Specification

> **What this document is.** The single, canonical description of *everything*
> Nexus will be: every module, every cross-cutting system, and how the whole
> thing fits together. It is written to be read by two audiences — a **product
> manager or non-technical stakeholder** (plain-language "what it does" lines) and
> an **engineer** (a "how it's built" note under each). For a purely non-technical
> tour, read [OVERVIEW.md](OVERVIEW.md). For *where we are right now*, read
> [STATUS.md](STATUS.md). The approved north star is [VISION.md](VISION.md); the
> detailed per-module requirements live in [prd/](prd/); the technical decisions in
> [architecture/](architecture/).
>
> **Naming.** "Nexus" is a working codename. The leading candidate for the final
> name is **Vesper** (pending trademark and domain checks). The two visual themes,
> **Dan** (day) and **Noć** (night), rhyme with that direction.

---

## 1. What Nexus is, in one paragraph

Nexus is an **offline-first, all-in-one life-management app** — "the IDE for your
life." It replaces the dozens of disconnected apps people use to run their private
and professional lives (todos, notes, calendar, budget, fitness, flashcards, file
tools, the drawer of expiring documents nothing reminds you about) with **one
workspace** where everything shares one dashboard, one calendar, one reminder
system, one search, and one design language. No single feature is revolutionary;
the product **is the integration**. It works with no internet, keeps private data
private by design, and never holds your data hostage.

---

## 2. Current build focus (what we are making right now)

**Plain language.** The desktop app is **done and in daily use** — fifteen
modules, everything on your own computer, working with the network off. What we
are building now is the other half of the promise: a **website and a phone-sized
web app** built from the same work, and **syncing** between them, so the same
data is on your laptop and your phone. Two rules govern all of it: the server
only ever holds material it cannot read, and a person who never turns syncing on
keeps exactly the app they have today, with no network involved at any point.

**Technical.** The Electron + React desktop client on encrypted SQLite is
complete at **1.1.0**. Since 2026-08-08 the web app and its backend are **in
scope**: the renderer on **Cloudflare Workers with static assets**, and
**Supabase** for the backend. The server side is built and executed — thirteen
migrations against a real Postgres, an RLS wall proved by pgTAP in CI, and the
wire measured against a running PostgREST — and the client side is what remains.
See [STATUS.md](STATUS.md) §3.

**Two constraints that are structural rather than aspirational.** Cloud is **off
by default and switchable off entirely** on the desktop, and the local-only path
must not be *able* to reach the network — there is a CI gate over it, not a
promise. And **content is never in the clear on the server**; metadata in the
clear is accepted, content never is.

**Not GitHub Pages, deliberately.** It cannot set HTTP response headers, so it
can send neither a CSP nor `frame-ancestors` — and a page that decrypts user
data in a browser without a CSP has had its primary defence removed. Workers
rather than Cloudflare Pages because Cloudflare's own guidance now sends new
projects to Workers.

**On breadth.** The founder installed the first real build on 2026-08-02 and
judged it *raw*; since then the constraint has been **finish quality, not
breadth**, and it still is. The professional toolkits shipped after that verdict
because he asked for them directly — not because the rule changed.

---

## 3. How the whole app works (foundations)

These are the shared systems every module plugs into. They are built once and
reused, which is what makes an "all-in-one" app coherent instead of fifty bolted-on
tools.

### 3.1 Profiles
- **Plain.** You have separate **Personal** and **Business** profiles so the two
  sides of your life never mix. You switch between them; the only shared surface is
  the calendar (with clear visual markers for which side an event belongs to).
- **Technical.** Every data row is scoped by `profile_id`; stores are constructed
  per profile so one profile's data is invisible to another's. **Built:** every
  switch *into* another profile passes the passcode gate, and the account may
  hold one business profile beside the personal one
  ([ADR-058](architecture/adr/058-business-profile.md)).

### 3.2 Offline-first storage
- **Plain.** Everything is saved on your device and works with no internet, always.
- **Technical.** One local **SQLite** database (`better-sqlite3-multiple-ciphers`),
  one forward-only migration stream, UUIDv7 keys, ISO-8601 timestamps, soft-delete
  (`deleted_at`) for undo. Encryption at rest (SQLCipher-class) is **built**, keyed
  by the local account
  ([ADR-018](architecture/adr/018-local-account-passcode.md)). **Notes** are stored
  as CRDT documents (Yjs) so they are merge-ready before sync exists; **canvas
  boards are not** — a scene is stored verbatim, because the editor owns its own
  document format ([ADR-079](architecture/adr/079-canvas-engine.md)).

### 3.3 Accounts & privacy
- **Plain.** You can use Nexus with a fully **local, PIN-protected account** — no
  server ever involved. Private notes are locked so thoroughly that **not even we
  could read them**. You can always export **all** of your data.
- **Technical.** Local accounts derive a key from a PIN via the OS keystore. Private
  notes are zero-knowledge encrypted (libsodium XChaCha20-Poly1305, Argon2id KDF,
  a DEK/KEK scheme with a Recovery Kit). Security is a binding baseline
  ([security/baseline.md](security/baseline.md)), designed in from the first commit.

### 3.4 Modular by onboarding
- **Plain.** Nexus has many modules, but you only ever see the ones you chose. A
  short, visual **onboarding** sets the app up for you; everything else stays hidden
  until you enable it in Settings.
- **Technical.** A module registry + per-profile feature flags gate every surface.
  Modules declare themselves through contracts (widgets, settings, search, stats,
  automation, import/export, tools) so the app — and, later, plugins — consumes them
  uniformly. Cross-module imports are lint-banned; modules talk through contracts.

### 3.5 One design language
- **Plain.** Every screen looks like it belongs to the same, carefully designed app
  — calm, distinctive, never generic. Two themes: **Dan** (light) and **Noć**
  (dark).
- **Technical.** A three-tier design-token pipeline (JSON → generated CSS variables)
  drives all styling; components are token-only (no raw colours). Deliberate
  anti-"AI-slop" rules: specific banned hues, typographic (not glow/side-bar)
  selection, a shared **views engine** (list / kanban / cards / calendar) and a
  chart mini-system so data looks consistent everywhere.

### 3.6 The shared "views engine"
- **Plain.** Lists, boards (kanban), card walls, and calendars everywhere in the app
  behave the same way, because they are the same underlying component.
- **Technical.** A headless engine (`@nexus/core`) filters, sorts (sr-Latn-correct
  collation), and groups collections; presentation components (`@nexus/ui`) render
  **list, kanban, cards and a calendar grid** — all four are built, with the kanban's
  columns and the view configuration persisted per user
  ([ADR-050](architecture/adr/050-task-views.md),
  [ADR-060](architecture/adr/060-kanban-columns.md)). Any module's data that maps
  onto a simple schema gets all view types for free.

---

## 4. The modules (the full catalogue)

Grouped by area. Each carries a **priority** — **Must** (core, ships early),
**Should** (soon after), **Could** (breadth, later waves), **Later** (long-term).
"Must/Should/Could" follow the per-module PRDs in [prd/](prd/). Which of these is
*built so far* is tracked separately in [STATUS.md](STATUS.md); this section
describes the intended product in full.

### Core experience
- **Onboarding (ONB) — Must.** *Plain:* a short, friendly setup that names your
  profile, picks a theme, and tailors which modules you see. *Technical:* four
  blocking screens + progressive in-module depth; local-account instant start is the
  primary path; pre-populates the dashboard.
- **Dashboard (DASH) — Must.** *Plain:* your home screen — one glance answers "what
  matters today?": today's agenda, upcoming tasks, documents about to expire, exam
  countdowns, quick actions, recent items. *Technical:* an arrangeable grid of
  widgets fed by every enabled module through a widget contract; per-profile layouts;
  deep-links into each module.
- **Tasks (TASK) — Must.** *Plain:* to-dos with priorities, due dates, sub-tasks and
  sub-lists, shown as a checklist **or** a kanban board. *Technical:* a single closed
  `status` enum drives both check-off and kanban columns; parent/child self-reference
  for sub-tasks; recurrence; undo.
- **Calendar & Reminders (CAL) — Must.** *Plain:* every dated thing in one place —
  events, exams, birthdays, deadlines, dated tasks — in month/week/day/agenda views,
  plus the signature **document-expiry tracker** (ID card, passport, driver's
  licence, vehicle registration, bank cards) that reminds you weeks before things
  lapse. The only surface shared between personal and business profiles. *Technical:*
  structured event rows + a tracked-documents store with per-type reminder ladders
  and a derived ok/soon/expired status; overlays from TASK/STUDY/FIN; recurrence.
- **Notifications (NTF) — Must.** *Plain:* timely reminders for anything — events,
  document expiry, study reviews — that you can snooze. *Technical:* a scheduling +
  delivery layer (OS notifications on desktop) with a cleanup contract so deleting a
  source removes its reminders.
- **Accounts & Auth (AUTH) — Must.** *Plain:* sign in with a nickname + password, or
  use a fully local PIN account with no server at all. *Technical:* local accounts
  are **built** (PIN + OS-keystore key wrap). Cloud accounts are **Supabase auth**,
  in progress: the server enforces MFA through aal2-restrictive RLS, and the
  desktop's own key material is never derived from the web password — a separate
  master sync key is minted and wrapped twice, so nothing about local at-rest
  protection depends on the account.
- **Settings & Profiles (SET) — Must.** *Plain:* control themes, accent colour,
  which modules are on, per-module preferences, and profile management. *Technical:*
  a settings contract each module contributes to; feature-flag toggles; theme/accent
  tokens; forward-compatible export/versioning.
- **Global Search (SRCH) — Should.** *Plain:* one search box finds anything —
  notes, tasks, events, documents. *Technical:* per-module FTS5 indices populated
  through a search indexing contract (private notes indexed only in an in-memory
  unlocked session).

### Content & knowledge
- **Notes (NOTE) — Must.** *Plain:* rich notes for every part of life, with folders,
  tags, attachments, wiki-style links between notes, inline flashcards, and "turn
  this note into a canvas." *Technical:* block-based rich text stored as CRDT
  documents (Yjs) with markdown in/out, a derived plaintext column for search,
  version history, templates, and links with backlinks.
- **Private Notes (PRIV) — Must (privacy flagship).** *Plain:* a vault of notes only
  you can ever read. *Technical:* zero-knowledge encryption; syncs only as opaque
  ciphertext; never server-readable; Recovery Kit for data recovery separate from
  account recovery.
- **Infinite Canvas (CANV) — Should.** *Plain:* a Milanote-style boundless board
  where notes become cards you arrange spatially, with links drawn as arrows —
  and it works offline (the market gap). *Technical:* **Excalidraw, used as a canvas
  and not as a UI** ([ADR-079](architecture/adr/079-canvas-engine.md)) — its chrome
  is hidden and a Serbian toolbar of ours drives it through the imperative API,
  because the editor ships 54 locales, none Serbian and none addable, and its colour
  picker offers three banned hues. Nexus objects live on a board as **embeddables
  whose link is a `nexus://kind/uuid` reference**, so arrows bind to them like any
  shape. A scene is stored verbatim, not as a CRDT.
- **File Preview (DOC) — Should.** *Plain:* preview almost any file — PDFs, Office
  documents, images, media, archives — right inside Nexus. *Technical:* per-format
  tiered viewers (PDF.js, Office previews labelled approximate, Chromium-native
  media, safe archive listing), all sandboxed per the security baseline.
- **Import / Export (IMEX) — Must.** *Plain:* bring data in and take **all** of it
  out at any time — a permanent guarantee. *Technical:* a `.nexus.zip` archive
  (versioned manifest, NDJSON + human-readable Markdown/CSV/Yjs mirrors); per-module
  import/export contract; LLM-assisted import later.

### Life hubs
- **Study Hub (STUDY) — Must (founder's exam-season driver).** *Plain:* flashcards
  with smart spaced-repetition scheduling, an exam planner that works backward from
  the exam date and puts real study blocks on your calendar and re-plans when you
  slip, and problem/practice cards for maths subjects. *Technical:* an FSRS scheduler
  (not SM-2); cards created inline in notes; `.apkg` (Anki) import; interleaved
  practice; honest time stats and gentle streaks.
- **Fitness (FIT) — Should.** *Plain:* track food and training, and measure whether
  the training worked. *Technical, nutrition half — **built** as „Ishrana"
  ([ADR-078](architecture/adr/078-nutrition.md)):* a **426-entry public-domain
  catalogue** where every number carries its provenance, meal logging against
  snapshots (so editing a food never rewrites history), and daily totals.
  *Technical, training half — **built**, and with it ADR-081 closes
  ([ADR-081](architecture/adr/081-fitness-training.md)):* a **230-exercise Serbian
  catalogue** faceted by equipment, muscle and movement pattern; sessions and
  routines with „prošli put" beside every exercise; personal records, weekly hard
  sets per muscle group and an estimated-1RM trend all **derived from the sets
  themselves**, so a record and the log can never disagree; 1RM estimation bounded
  to the rep range where it is honest; and a body profile whose energy expenditure
  is **measured from the user's own weight trend and intake** rather than asserted
  from a formula. What ADR-081 records as deliberately NOT built stays that way:
  no automatic progression schemes, no exercise instruction text, no calorie burn,
  no body-fat estimation. The module is called **„Fitnes"**, not after either
  half. Serbian retail-chain food data
  and user label-photo/OCR submissions remain intended and unbuilt — both need a
  moderation queue, which needs a server. Nutrition data is reference-only, with a
  disclaimer.
- **Personal Finance (FIN) — Should.** *Plain:* budgeting and spending tracking that
  actually sticks, in dinars and euros. *Technical:* zero-based/envelope budgeting as
  an optional retention engine, tracking-only mode first-class; manual-first entry
  (no bank aggregation in Serbia); **multi-currency by keeping each currency
  separate — Nexus never converts** (founder, 2026-08-01: *„nema konverzije,
  beleži se posebno svaka valuta"*); bank sync is future work. *This line used to
  read „multi-currency with explicit NBS rates" — a capability that was never
  built and that FIN deliberately refuses, since a rate the app cannot verify
  silently misstates money. Amounts in different currencies are tracked and shown
  side by side, never summed through a rate. Reading that old phrase as an
  existing feature is what sent a UTIL lane hunting for rates that do not exist.*
- **Habits & Streaks (HABIT) — Should.** *Plain:* build habits with gentle streaks
  and progress. *Technical:* habit definitions + completion history feeding dashboard
  streak widgets and stats.

### Utility & tools
- **Utility Belt (UTIL) — Could.** *Plain:* a drawer of everyday tools — unit
  converters, calculators, and profession-specific calculators. *Technical:*
  a tool registry; each utility is a small, self-contained tool contract.
  **No currency converter** (founder, 2026-08-01: *„nema konverzije, beleži se
  posebno svaka valuta"*) — this line previously promised one, and it was that
  promise, read as an existing capability, that sent a lane looking for exchange
  rates FIN deliberately does not hold. Converting money at a rate the app cannot
  verify silently misstates money, which is why FIN refuses it and why the drawer
  does too.
- **Professional toolkits (PRO) — BUILT (2026-08-13/14).** *Plain:* a second
  drawer, off until the user asks for it, holding eighteen toolkits for the work
  people actually do; you pick yours by answering what turns up in your week.
  *Technical:* one module, and a `packs` field on the tool registration decides
  which toolkits a tool appears under — so a tool serving three trades exists
  once. **A pack is a subject, not a job title** („Gradnja i projektovanje", not
  „Arhitekta"), because a job-title list fails closed on every trade nobody
  thought of. A required `riskClass` on every registration draws the tool's
  notice, the line appended to every copied result, the long form in Settings,
  and whether the surface may render a verdict at all — so the disclaimers are a
  property of the contract and not copy somebody has to remember. Constants have
  three tiers: physical embeds, published embeds with its source on screen, and
  **regulated is never embedded and never defaulted** — the user types the rate
  or the deadline that applies to their case. 274 tools; see PRD 30 and
  [STATUS.md](STATUS.md) §2.
- **Password Vault (VLT) — Later.** *Plain:* store passwords securely. *Technical:*
  built on the same zero-knowledge crypto as private notes; deferred until later.

### Collaboration (planning together, not a social network)
- **Sharing (SHARE) — Could.** *Plain:* share a note or board (read-only first) so
  you can plan with others. *Technical:* cloud- and sync-dependent — future work.
- **Shopping / Grocery (SHOP) — Could.** *Plain:* shared shopping lists, including a
  live grocery list two people can edit together. *Technical:* the grocery co-edit
  rides the CRDT path and is the first real-time surface; cloud-dependent — future.

### Wellbeing & entertainment
- **Focus (FOCUS) — Must.** *Plain:* one timer for the whole app — a Pomodoro that
  keeps running while you move between pages, and that records the same session
  whether you started it in „Fokus" or in „Učenje". *Technical:* **built**, and it
  is deliberately **one** engine, not two
  ([ADR-077](architecture/adr/077-focus-timer.md)) — UTIL's Pomodoro **absorbed**
  STUDY's `focus_sessions` on the founder's ruling *„nećemo da imamo više
  tajmera"*. A study session and a Pomodoro phase are the same row; the running
  timer is main-process memory, never a row.
- **Sustainable productivity — Must (woven in, not a module screen).** *Plain:*
  during breaks, quick **productivity boosters** — a fast sudoku or card game,
  stretching and eye-rest prompts — so rest is part of the rhythm, not a
  distraction. *Technical:* break activities integrate with the focus timer above.
  **Unbuilt.**
- **Entertainment — Could.** *Plain:* light built-in games (sudoku, card games).
  *Technical:* self-contained mini-apps; low priority, post-core.

### Long-term
- **AI Assistant (AI) — Later.** *Plain:* an assistant that organizes, summarizes,
  and imports on your behalf. *Technical:* an assistant layer over the module
  contracts; long-term.
- **Plugins (PLUG) — Later.** *Plain:* new capabilities added without touching the
  core. *Technical:* the module contracts are explicitly designed as the future
  plugin API. **Profession packs** (architect, developer, freelancer toolkits) ride
  the same modular core.

---

## 5. Cross-cutting behaviour

- **Undo everywhere.** Deletes are soft (reversible), with an inline "undo" offer.
- **Empty states with a next action**, never a blank screen; loading skeletons.
- **Keyboard-navigable, dense but calm** reading surfaces; every widget deep-links
  to the underlying module.
- **Serbian first** (launch language), English second; all copy is centralized for a
  mechanical later i18n extraction.
- **Never fabricate data** — no invented statistics, foods, or figures anywhere.

---

## 6. Platform & technical architecture (summary)

- **Desktop:** Electron (pinned to v42 for a native-module ABI reason) + React 19 +
  Vite. A hardened shell: the renderer is sandboxed and cannot reach the database
  except through a small, validated, allow-listed IPC bridge.
- **Shared code:** a pnpm + Turborepo TypeScript monorepo, strict TypeScript.
  Packages: `tokens` (design tokens), `core` (module registry, contracts, headless
  views engine), `db` (encrypted SQLite + migrations + stores), `ui` (token-driven
  components), and the four sync packages — `sync` (the engine), `sync-crypto`,
  `sync-port` (the injected crypto seam), `sync-transport` (the wire). Apps:
  `desktop`, `web`, `gallery` (a design-review harness).
- **Web (in progress):** the same React renderer on **Cloudflare Workers with
  static assets**, produced from this codebase rather than rewritten. `apps/web`
  today is a shell: the desktop's own rail rendered by the same components, and a
  typed `NexusApi` proxy that throws until something connects it.
- **Backend (in progress): Supabase.** Thirteen migrations applied to a real
  Postgres 17, an RLS wall proved by 109 pgTAP assertions in CI, three Edge
  Functions, and the PostgREST wire measured rather than assumed. The server
  holds ciphertext; metadata in the clear is accepted, content never is.
- **Android (later):** React Native reusing `core`/`db` schema, gated by a kickoff
  re-check.
- **Quality gates:** strict typecheck, lint, unit tests (TDD for data/stores), a
  production build, an end-to-end desktop **smoke** check, and **thirteen static
  gates** — colours, contrast, CSS, strings, tokens, invisible characters, key
  material erased while it is still in use, the professional drawer's risk
  notices, its arithmetic, its result flags, the third-party licence notices,
  network egress, and the RLS wall. All green before
  anything is committed; CI runs every one of them as its own step, so a red
  check names the rule. Each gate exists because a class in
  [defect-classes.md](defect-classes.md) could not be caught by review.
- **Not yet true, and worth stating plainly:** there is no performance harness, so
  the budgets in [architecture/overview.md](architecture/overview.md) are targets
  nothing measures; installers are **unsigned**, so nothing may be distributed
  beyond the founder's own machines until code signing and notarization are set
  up; and the Electron 42 pin has a support deadline of **2026-10-20**
  ([STATUS.md](STATUS.md) §6).

---

## 7. Business direction (context, not current work)

Free, fully unlocked beta while the product matures; premium tiers later with a
large permanent discount for beta users. Native apps deliver depth; a landing page
and web app drive reach. The desktop product has proved itself — it has been in
the founder's daily use since 2026-08-02 — which is what opened the web phase.

---

*This specification describes the product in full. It changes only when the founder
changes the product. Progress against it is tracked in [STATUS.md](STATUS.md).*
