# Nexus PRD — Overview & Module Registry

**Status:** produced and founder-reviewed 2026-07-04; decisions at the
bottom. **PRD phase complete 2026-07-05:** all 37 modules have PRD files in
this folder (M/S tiers: full 10-section template; C tier: compact; W tier:
deferred stubs) plus `glossary.md`. Research phase 1 (9 domains) lives in
`docs/research/`. Founder answered all 35 PRD open questions 2026-07-05
(decision #11 below; recorded inline in each PRD). Architecture drafted
2026-07-05 (`docs/architecture/overview.md` + ADR-001..011) and roadmap
drafted (`docs/roadmap.md`) — both pending founder sign-off; next founder
gates: approve ADRs/roadmap, design-direction session, name decision.

## Vision

See `docs/VISION.md` (binding). One line: Nexus is the IDE for your life — one
offline-first, modular workspace replacing the fifty scattered apps people use
to run their private and professional lives.

## Personas

1. **The final-year student (founder, persona #1).** Exams in six weeks, job
   hunt, bank paperwork, car maintenance, room to organize. Needs study
   planning, tasks, notes, reminders, and file previews for study materials —
   today, on desktop, without any cloud dependency.
2. **The architect.** Runs bills of quantities (predmer/predračun) and client
   projects; wants a business profile whose tools actually match the
   profession, plus deadlines for permits in one calendar.
3. **The freelance developer.** Projects, time tracking, invoices, dev
   utilities; values keyboard-driven speed, local data, and export guarantees.
4. **The organized-life professional.** Employed, tracks finances, fitness,
   subscriptions, and expiring documents; wants one dashboard instead of eight
   apps, syncs between phone and laptop.
5. **The privacy-first user.** Will only use a fully local account; encrypted
   private notes and the no-server guarantee are the reason they install Nexus
   at all.
6. **The small team / partners.** Two to five people planning together on
   shared notes and canvases; need sharing and collaborative editing, not an
   enterprise suite.

## Module registry

Prefixes are permanent; numbers are the future PRD file numbers. Priority is
the module's overall MoSCoW tag — individual requirements inside a module get
their own tags.

### Core experience

| # | Module | Prefix | Scope | Priority |
| --- | --- | --- | --- | --- |
| 01 | Onboarding & Personalization | ONB | Visual questionnaire → feature-flag mapping; re-runnable; business variant (elaborated in `docs/notes/razrade.md`) | M |
| 02 | Dashboard & Widgets | DASH | Configurable widgets: obligations, urgencies, summaries, countdowns, quick actions, recents | M |
| 03 | Tasks & Todo | TASK | Daily→yearly + custom lists; subtasks, priorities, tags, repeat, dependencies; list/kanban/calendar views | M |
| 04 | Calendar & Reminders | CAL | Events, birthdays, exams; document-expiry reminders (ID cards, passport, vehicle registration…) | M |
| 05 | Notifications | NTF | Cross-platform delivery, snooze, priorities, smart reminders, per-module settings | M |
| 06 | Accounts & Auth | AUTH | Cloud accounts (verify, reset, remember-me, sessions) + fully local PIN accounts | M |
| 07 | Profile & Settings | SET | Profile, unique nickname, themes/accents, feature flags, privacy, backup | M |
| 08 | Global Search | SRCH | One search across all modules the user has enabled | S |

### Content & knowledge

| # | Module | Prefix | Scope | Priority |
| --- | --- | --- | --- | --- |
| 09 | Notes | NOTE | Rich text + markdown, categories, tags, attachments, folder hierarchy | M |
| 10 | Private Notes | PRIV | Zero-knowledge encrypted section; re-auth gate; per `SEC-ZK` | M |
| 11 | Canvas | CANV | Milanote-class infinite canvas; draw, connect, embed; auto-visualize notes | S |
| 12 | Sharing & Collaboration | SHARE | Share notes/canvases read-only (S); real-time co-editing (C) | S |
| 13 | Documents & Preview | DOC | Preview pipeline for PDF/Office/media/code/archives; sandboxed per `SEC-FILE` | S |
| 14 | Import & Export | IMEX | Full export is a product guarantee (M); LLM-assisted import prompts (S) | M/S |

### Life hubs

| # | Module | Prefix | Scope | Priority |
| --- | --- | --- | --- | --- |
| 15 | Study Hub | STUDY | Exams, subjects, materials, flashcards + spaced repetition, Pomodoro, progress | M |
| 16 | Fitness Hub | FIT | Training + nutrition; exercise DB; food DB incl. Serbian retail chains (reference-only, user error reporting); saved meals | S |
| 17 | Finance | FIN | Income/expenses, budgets, categories, charts; subscriptions tracking | S |
| 18 | Habits | HABIT | Daily habits, streaks, statistics; mood/energy journal | C |
| 19 | Goals | GOAL | SMART goals, OKR, milestones | C |
| 20 | Time Tracking | TIME | Work/project/focus time | C |
| 21 | Health | HLTH | Medications, therapies, reminders | C |
| 22 | Car | CAR | Registration, service, tires, fuel, insurance | C |
| 23 | Travel | TRAV | Plans, itineraries, budgets | C |
| 24 | Inventory & Warranties | INV | Belongings, receipts, warranties; home maintenance reminders | C |
| 25 | Shopping & Wishlist | SHOP | Shopping lists (meal-planner fed), wishlists, gifts tracker | C |
| 26 | Read Later & Bookmarks | READ | Articles, links, PDFs; bookmark organization | C |
| 27 | Library | LIB | Books, articles, courses | C |
| 28 | Password Vault | VLT | Locally encrypted; deferred until post-v1 + external pen test (founder decision 2026-07-04) | W |

### Professional & utilities

| # | Module | Prefix | Scope | Priority |
| --- | --- | --- | --- | --- |
| 29 | Utilities | UTIL | Calculators, unit/file/media converters, subtitle editor, dev tools, Pomodoro/timers | S |
| 30 | Profession Toolkits | PRO | Per-profession packs (catalog in `docs/notes/razrade.md`): preset + mini-tools + calculators + templates | C |

### Growth & platform

| # | Module | Prefix | Scope | Priority |
| --- | --- | --- | --- | --- |
| 31 | Entertainment & Boosters | FUN | Sudoku, card games; productivity boosters in Pomodoro breaks | C |
| 32 | Feedback | FDBK | Feature requests, bug reports, impressions | S |
| 33 | Analytics & Insights | STATS | Usage stats, activity heatmap, yearly review ("Nexus Wrapped") | C |
| 34 | Automation | AUTO | Cross-module rules: trigger → action | C |
| 35 | AI Assistant | AI | In-app organization/summarization/import assistant | W (v1) |
| 36 | Plugin System | PLUG | Third-party modules without touching the core; per `SEC-EXT` | W (v1) |
| 37 | Landing Page | LAND | Marketing site: hero, features, FAQ, pricing, download, blog | S |

## Cross-cutting concerns

Each applies to every module and gets its own PRD treatment inside module files
plus architecture decisions later: **offline-first & sync semantics** (every
core feature works with no network; conflict behavior specified per module);
**security & privacy** (binding baseline in `docs/security/baseline.md`);
**modularity & feature flags** (every module hideable; data never deleted by
disabling); **design system & visual language** (founder requirement 2026-07-05: a
distinctive, non-generic design system — explicitly *not* stock-component "AI
slop"; system/dark/light + accent colors; one design language across
desktop/web/Android; **multi-view data presentation** — the same data viewable
as list / kanban / cards / calendar / charts where it makes sense, charts as
the analytics layer everywhere); **localization** (launch languages:
Serbian and English, more later; i18n from the first commit; the food DB and
profession packs are Serbia-first);
**accessibility**; **performance budgets** (fast after years of data);
**platform parity** (web app ≈ desktop; Android adapted, not reduced).

## MVP anchor (provisional)

Desktop app + local account only: ONB (lite), DASH, TASK, NOTE, CAL + NTF
(lite), STUDY, SET (lite). Success test: the founder runs his exam preparation
(Algebra, Linear Algebra & Analytic Geometry, Combinatorics & Graph Theory)
entirely in Nexus. Formalized later in `docs/roadmap.md`.

## Founder decisions (2026-07-04)

1. **Name.** "Nexus" is a codename, not the final name. The final name will be
   chosen later — trademark and domain check happen before the landing page
   ships. **Leading candidate (founder, 2026-07-05): "Vesper"** (backronym
   V.E.S.P.E.R. as an About-screen easter egg, not the brand styling).
   Gate before adoption: trademark check (a notes app "Vesper" existed until
   2016 — adjacent category) and domain availability. Docs keep the Nexus
   codename until cleared.
2. **Launch languages** (finalized 2026-07-04): Serbian and English at launch;
   further languages (French, German, Spanish, Italian, …) added later.
   Consequence: i18n architecture from the first commit — every feature ships
   with translatable strings from day one, so adding a language is content
   work, never engineering work.
3. **Login.** Nickname + password. Forgot password: account identified by
   nickname, reset link sent to the account's email. Forgot username:
   recovered via email. Anti-enumeration rules (`SEC-AUTH-02`) apply to all
   three flows.
4. **Business profile.** Business and personal are completely separate; the
   only shared surface is the calendar, with clear visual distinction between
   personal and business events. Profile is chosen via a tab at login;
   switching while logged in is allowed but requires the password on each
   switch.
5. **Collaboration in v1.** Read-only sharing first; real-time co-editing
   later (stays C).
6. **Private-notes recovery key** (delegated to Claude): generated by default
   at setup; the user must either confirm they saved it or explicitly opt out
   through an informed "I accept the risk" step. Never stored by us — that
   would break zero-knowledge. Reflected in `SEC-ZK-04`.
7. **Serbian grocery nutrition DB** (delegated to Claude, finalized
   2026-07-04): hybrid acquisition — start from open datasets (Open Food
   Facts; USDA FoodData Central for generic foods), fill Serbian retail gaps
   with LLM-assisted collection from public sources under strict
   source-citation and verification rules, and let users add and correct
   entries in-app over time. All nutrition data is **reference-only**: a clear
   in-app disclaimer (not medical or dietary advice; values may differ from
   packaging) and a "report incorrect data" action on every entry, feeding a
   moderation queue. Legal check (EU/Serbian database rights, retailer ToS)
   still precedes any mass collection.
8. **Password vault** (confirmed by founder 2026-07-04): Won't-have
   until well after v1 and an external pen test — registry updated to (W).
   Rationale: highest-stakes module possible, mature free competitors, not
   core to the life-organization vision.
9. **Android timing.** After desktop + web app.
10. **Monetization.** Subscription; early adopters get the opportunity to buy
    lifetime access. Details deferred — product first.
11. **PRD open-questions batch (2026-07-05).** All 35 founder-facing open
    questions answered in one pass; each decision is recorded inline in its
    PRD's Open-questions section. Scope-affecting highlights: multiple
    dashboards in v1, navigation sidebar groups categories with separators
    (DASH-008 → M); TASK supports both sections and nested sub-lists,
    applied adaptively (TASK-004); custom dashboard background ships in v1
    with a transparency slider (SET-006 → S); 8 curated accents, business
    profile gets a distinct default accent; "sutra ujutru" snooze default
    08:00; nickname quarantine after deletion, 14-day grace period,
    remember-me on desktop/Android and off web; PRIV ships on web with the
    documented trust caveat, auto-lock 5 min desktop / 2 min web
    (adjustable), 100 MB attachment cap with a possible premium raise to
    1 GB+; share recipient lists hidden by default with per-share owner
    option to reveal; grocery-list co-editing pulled forward as the only
    v1 realtime surface; PDF annotation confirmed for v1.x; Open Food Facts
    isolation signed off; FIN custom budget start (default the 1st); beta
    distribution direct download + auto-update only.
