# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Students first. The founder is the first user: exams, a job hunt and ordinary
life administration in the same weeks, which is the use case the product was
built from. Then professionals who carry the same mix of personal and work
obligations, and anyone running their life across a dozen disconnected tools.

Long term, the same modular core is intended to carry profession-specific packs
for people whose work has its own recurring calculations and documents.

## Product Purpose

Nexus replaces the scattered collection of apps people use to run their private
and professional lives - task lists, notes, a calendar, a budget, flashcards, a
fitness log, file converters and a drawer of expiring documents - with one
workspace where the parts share a dashboard, a calendar, a reminder system, a
search and a design language.

The product is the integration. No single module is claimed to be unique on its
own; the value is that the parts are together and connected, and that the data
lives in one encrypted database on the user's own device.

## Positioning

An offline-first, all-in-one organizer for the desktop. It is not a social
network, not a cloud-only subscription, and not a shallow bundle: each module is
built to stand on its own before the next is started.

Three commitments distinguish it from the tools it replaces:

- Everything needed to run a day works with the network off. Cloud sync, when it
  is hosted, is an addition rather than a dependency.
- Privacy is structural. Private notes are end-to-end encrypted, the local path
  cannot reach the network unless the user turns on update checks (and then
  reaches only GitHub's release hosts), and that limit is enforced by a CI gate
  rather than promised in copy.
- The full data set can always be exported, so the product never holds the
  user's data hostage.

## Operating Context

The shipped build is a desktop application: Electron rendering a React
interface, with an encrypted SQLite database in the main process. Releases are
per-user installers for Windows 10 and 11 on x64, an AppImage and a tarball for
Linux x64. macOS is not built. On Linux the app requires a running Secret
Service keyring and refuses to create an account without one.

Accounts are local and passcode-protected; several accounts can exist on one
machine, and a person can keep a personal and a business profile apart. The
interface ships in Serbian and English, follows the system language on first
run, and remembers the choice. Two themes ship: Dan (light) and Noc (dark),
with an accent chosen from a fixed palette.

Sync is not hosted. No backend project is compiled into the distributed build,
so the sync screen reports that no server is configured and every round refuses
before making a request. Code signing is not in place, so Windows shows a
SmartScreen warning on first run.

## Capabilities and Constraints

Sixteen modules can be switched on per profile: Dashboard, Tasks, Calendar,
Notes, Private vault, Documents, Study, Finance, Habits, Fitness, Focus, Tools,
Canvas, Electronics, Professional toolkits and Settings. Data and store logic
are written test-first, migrations are forward-only, and the desktop smoke
script launches the built application and exercises the real IPC surface against
a real database before it prints `SMOKE OK`.

Constraints that are deliberate:

- There is no telemetry, no analytics and no crash reporting, and none can be
  added quietly - a static gate fails on a new network construct.
- Currencies are tracked separately and never converted.
- The Electronics workbench derives and can run a plan on the user's own
  toolchain; anything that depends on a rule that can change is typed by the
  user rather than assumed by the app.
- Updates are opt-in. On first start Nexus asks whether it may check GitHub
  for new versions, offline is the default, nothing downloads until the user
  presses Download and install, and an installer runs only after its signature and hash
  verify (ADR-089).
- Deleting a hosted sync account from inside the app is not implemented; that
  gap is recorded in the project's own status notes.

## Brand Commitments

- **The name.** Nexus is the product's name. The two themes are named after the
  time of day they belong to: Dan and Noc.
- **Plain language.** The public description of the product is written so a
  non-technical reader can follow it, and the interface copy avoids claiming
  more than the code does.
- **No dark patterns.** There is no account to buy, no service to subscribe to,
  no advertising, and no paywall between a person and the data they wrote.
- **Finish before breadth.** A module ships when it is good enough to stand
  alone; breadth never excuses a weak module.
- **Rest is part of the system.** Focus timers, forgiving streaks and break
  activities are built into the work rhythm rather than treated as distraction.

## Evidence on Hand

Real assets in this repository:

- Product screenshots used by the README and the landing page:
  `docs/images/dashboard-light.png`, `docs/images/dashboard-dark.png` and the
  task, study, finance and electronics pairs beside them.
- The landing page and its stylesheets, fonts and icon under `site/`.
- Release artefacts, each accompanied by `SHA256SUMS.txt`, a CycloneDX SBOM, the
  rendered `THIRD-PARTY-NOTICES.md` and build-provenance attestations.
- The engineering record: `docs/SPECIFICATION.md`, `docs/VISION.md`,
  `docs/OVERVIEW.md`, `docs/STATUS.md`, the ADR index, the engineering journal
  under `docs/log/`, the defect ledger in `docs/defect-classes.md` and the
  security baseline in `docs/security/baseline.md`.
- The design record: `docs/design/direction-brief.md`, the mockups beside it and
  the token set in `packages/tokens`, which is the source of truth for every
  style value the application uses.
- CI gates that run on every push and pull request: the `check:*` scripts, the
  workspace test suites and the desktop smoke check.

What does not exist, and must not be invented: user counts, download numbers,
retention or performance statistics, benchmarks, testimonials, press mentions,
dates for future releases, and any hosted sync or web service. The roadmap
states plans without dates, and nothing here should claim otherwise.

## Product Principles

1. **Offline-first, forever.** Every core feature works with no internet. Cloud
   sync is an enhancement, never a dependency, and local-only accounts exist for
   people who never want a server involved.
2. **Privacy as architecture.** Private notes are encrypted so the server cannot
   read them, the local-only path cannot reach the network, and the guarantees
   are enforced by checks rather than stated only in prose.
3. **Modular by onboarding.** A person sees the modules they chose and enables
   the rest when they want them; personal and business profiles stay apart.
4. **Depth per module.** A module is finished before the next one starts, and
   each one records the requirement IDs and tests behind it.
5. **Sustainable productivity.** Habit streaks forgive a missed day, the focus
   timer is one shared timer, and rest is designed into the day.

## Accessibility & Inclusion

- **Keyboard and focus.** Interactive controls carry visible `:focus-visible`
  outlines, and selection states key off `aria-pressed` so the state announced to
  a screen reader and the state shown on screen are the same attribute.
- **Reduced motion.** A single product-wide rule in `packages/ui/src/styles.css`
  collapses animation and transition durations to 1 ms when the operating system
  asks for reduced motion; motion that carries information switches to
  `step-end` rather than disappearing.
- **Contrast.** `scripts/check-contrast.mjs` checks the semantic palette, and the
  accent system is built so every accent and theme combination can be verified
  rather than assumed.
- **Colour is never the only channel.** Status icons carry distinct silhouettes
  and chart legends pair each tone with a distinct glyph.
- **Language.** The interface ships in Serbian (the source table) and English,
  with `Intl` collation and plural rules per locale, and no user-facing copy
  outside the typed string tables.
- **Type and numbers.** The type scale is fixed, body text is set from tokens,
  and quantities use tabular figures so columns of numbers align.
