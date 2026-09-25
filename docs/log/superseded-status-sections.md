# Superseded sections of STATUS.md

**Archive.** These four sections were replaced on 2026-08-16 when `STATUS.md`
was cut back to being a status document. They are kept because each contains
detail that was written once and is not recoverable from the code — and removed
because each had stopped being true in a way that was worse than being absent.

What is true now is in [../STATUS.md](../STATUS.md).

| Section | Why it was replaced |
| --- | --- |
| §1 At a glance | Duplicated [OVERVIEW.md](../OVERVIEW.md)'s job and was ~six modules behind it: it named `Nexus-Setup-0.1.0.exe`, said „Search comes next" after search shipped, listed data import as unbuilt after four importers shipped, and never mentioned Finansije, Navike, Fitnes, Ishrana, Fokus, Datoteke, Privatno or Tabla. |
| §2 What is built | Half current fact, half 2026-07 wave record. Its opening line still read „Packages: `tokens`, `core`, `db`, `ui`" after four sync packages and `apps/web` were added, and roughly a third of it was Dependabot PR management from 2026-07-14 and 07-27. |
| §4 What remains | A backlog that had become a graveyard: most entries were struck through and annotated „done", so the section that was supposed to answer „what is left" answered it by making the reader diff it. |
| §5 the 2026-08-02 install verdict | The founder's first-install feedback, three of whose four defects are fixed and the fourth root-caused. The verdict itself („deluje sirovo app baš") is the origin of the whole polish arc and is quoted where it still matters. |

---

## §1 — At a glance (plain language), as it stood

Nexus today is a **working desktop app you can actually use offline**. When you open
it the first time, it greets you with a short setup (name your profile, pick a light
or dark theme). After that you get a **home dashboard** that shows what matters
today, and three working areas:

- **Zadaci (Tasks)** — add tasks, check them off, or drag them across a board
  (To do / In progress / Done). Delete with an undo.
- **Kalendar (Calendar)** — a real calendar now: **Mesec**, **Nedelja**, **Dan**
  and **Agenda**. The month shows the whole month at a glance, with anything
  lasting several days drawn as one continuous bar across the days it covers;
  the week and day views show the hours of the day, with a thin line marking the
  current time. Everything dated shows up in one place — events, **tasks with a
  due date**, exams, and study blocks — and four switches let you turn any of
  those off. Click an empty day (or an empty hour) to start writing an event
  there; drag an event or a task onto another day to move it; click one to edit
  it. Events now have an **end time**, so a meeting takes up the hour it
  actually takes. Plus a **Dokumenta** panel that tracks documents that expire
  (ID, passport, registration, cards…) and shows, with colour, whether each is
  fine, expiring soon, or already expired — and lets you renew them (keeping
  history).
- **Predmeti (Study)** — add your subjects (name, colour, semester) and their exams
  (written / oral / colloquium, date, what it covers). Every upcoming exam shows a
  countdown ("za 5 dana"); exams also appear in the calendar agenda and in an
  **Ispiti** widget on the dashboard. Subjects can be archived, and everything
  deleted can be undone. Each subject can also hold flashcard decks: add cards
  (front/back, with LaTeX math like `$x^2$`), see live new/due counts per deck,
  and study them in a focused, keyboard-first review session (Space to reveal,
  1–4 to grade, U to undo, Esc to exit) that schedules each card's next
  repetition automatically (spaced repetition). For every upcoming exam you can
  also create a **study plan** (how many minutes a day, from which start date,
  optionally doubled in the final week): Nexus lays out a day-by-day schedule of
  study blocks, shows **Danas za učenje** (today's blocks with check-off) at the
  top of the study page, tracks done and missed days per plan, and shows the
  blocks in the calendar agenda alongside events and exams. And at the bottom of
  the study page, a **Statistika i fokus** section: start a focus timer on any
  subject when you sit down to study (it keeps running while you move around the
  app; stop it to save the session, or discard it), see your study streak
  ("Niz učenja: 4 dana", counted from days with any studying — reviews, focus
  time, or checked-off blocks), a last-30-days summary (minutes per subject as
  quiet proportion bars, review and block counts), and your recent focus
  sessions from the last week (each deletable, with undo).
- **Beleške (Notes)** — a notes area with a clean block editor, organized in
  three panes. On the left, **folders**: nest them freely, give each one of the
  8 accent colours, rename or delete without losing notes (children move up).
  In the middle, the note list for the chosen folder (or "Sve beleške" / "Bez
  fascikle"), with **pinned notes on top** (star a note to keep it there) and a
  per-note menu to move it between folders or delete it (with undo). On the
  right, the editor: the note names itself from its first line (no separate
  title box); format as you type with markdown shortcuts (`#` for a heading,
  `-` for a bullet, `[ ]` for a checkbox, `>` for a quote, and so on) or type
  `/` for a Serbian command menu (paragraph, headings, lists, task list, quote,
  code block, divider). Notes also carry **tags (oznake)**: create, rename, and
  delete them in the left pane, attach any of them to a note from its row menu,
  see them as small chips under each note's title, and click tag chips to
  filter the list (a note must carry every selected tag). Notes can also
  **link to each other**: type `[[` in the editor and pick a note from the
  list that pops up — the link shows the target's current name (rename a note
  and every link to it updates by itself) and clicking it jumps there. At the
  bottom of a note, **"Povratne veze"** lists every note that links *to* it.
  Notes can also carry **attachments (prilozi)**: drop any file onto the note
  (or use the "Priloži datoteku" button) and it is stored safely inside
  Nexus's own data folder — the quiet **"Prilozi"** panel under the note lists
  each one with a thumbnail (for images), its size, and a menu to open it in
  the matching Windows program, save a copy anywhere, or remove it. Dropped
  images additionally appear **right inside the note text** as pictures.
  Every note also keeps an **"Istorija verzija"**: while you write, Nexus
  automatically saves checkpoints of the note (roughly every ten minutes of
  active editing, up to 50 per note), and a quiet button above the editor
  opens a browser — pick a checkpoint on the left, read it on the right
  exactly as it looked (links and images included), and "Vrati ovu verziju"
  brings the note back to that state. Restoring is never destructive: the
  current state is saved as a version first, so nothing is ever lost.
  Notes also have **šabloni (templates)**: a second quiet button above the
  editor opens "Šabloni", where five ready-made ones — Sastanak, Dnevnik,
  Recept, Predmet, Projekat — sit beside the ones you make yourself. Pick one
  to read it on the right, then "Umetni šablon" adds it to the end of the note.
  Faster still: type `/` and the same templates appear in the command menu as
  "Šablon: …" and drop in right where the cursor is. To make your own, write a
  note the way you like it and press "Sačuvaj kao šablon" — attachments are
  left out on purpose (they belong to the original note), links are kept.
  Saving under a name you already used replaces that template, which is how
  you edit one; the app says so before it does it. Templates never replace
  what you have already written — they are always added, never overwritten.
  Finally, a note can **make flashcards for you while you write**. Type
  `Pitanje :: Odgovor` in a line and it becomes a card; wrap a word in
  `{{dvostruke zagrade}}` and that word gets hidden, making a fill-in-the-blank
  card (several hidden words in one sentence make several cards). Card lines
  are marked in green in the editor. The first time a note makes cards, a small
  bar above the editor asks which špil (deck) they belong to — a špil already
  belongs to a predmet, so that one choice is the whole decision — and from
  then on the bar just says how many cards the note has and where they go.
  Editing the text **updates the same card**, so everything Nexus knows about
  how well you remember it is kept; deleting the line removes the card, and
  undoing brings it back with its history. In Učenje, such a card shows "Iz
  beleške: …" instead of the edit/delete buttons and takes you straight to the
  note — the note is the only place its text can be changed.
  Search comes next.
- **Kontrolna tabla (Dashboard)** — a personalized home showing today's obligations,
  your next tasks, documents about to expire, upcoming exams, and a study widget
  (learning streak + today's focus minutes), each clickable straight into its area.
- **Obaveštenja (Notifications)** — Nexus reminds you as real Windows
  notifications for documents about to expire, upcoming exams, and today's
  study goal — even while you're elsewhere in the app. A bell at the bottom of
  the sidebar shows how many are waiting (no badge when there's nothing new);
  opening it lists each one with a snooze (10 min / 1 h / tonight / tomorrow
  morning) or dismiss, and clicking a reminder jumps straight to the study
  page or the calendar. A collapsed settings panel underneath lets you set
  quiet hours, the morning reminder time, and turn each reminder source
  (documents/exams/study) on or off.
- **Alatke i Stručne alatke (Tools)** — two drawers of small, self-contained
  calculators and converters that never touch your data and never touch the
  network. „Alatke" is the everyday one. **„Stručne alatke" is the professional
  one, and it is off until you ask for it**: during setup Nexus asks „Šta se sve
  nađe u tvojoj nedelji?" and you tick as many toolkits as fit — Gradnja,
  Računovodstvo, Fotografija, Pravo, Transport, Kuhinja, Muzika i zvuk, Zanat,
  Poljoprivreda, Trening, Prosveta, Dizajn i štampa, Nekretnine, Događaji,
  Inženjering, Tekst, Biznis, Softver. You can change the selection any time,
  from the drawer itself or from Settings. The same tool can belong to several
  toolkits (a QR generator is a programmer's, a caterer's and an event
  planner's), so nothing is duplicated. **Anything whose answer somebody could
  get hurt by carries a visible notice** — a quiet line above the tool that
  opens into the full explanation, and a line added automatically to every
  result you copy out, so the caveat travels with the number into the email.
  Where the number depends on a rule that can change — a tax rate, a legal
  deadline, a safety factor — **Nexus never fills it in for you**: you type the
  figure that applies to your case and the tool shows it back beside the
  answer. Tools that could hurt somebody never render a verdict: they show your
  own limit next to the computed value and leave the judgement to you.
- **Podešavanja (Settings)** — a real settings page: rename your profile;
  pick the theme (follow the system's light/dark setting, or explicitly Dan /
  Noć) and an accent colour from 8 options (Zlato/Bronza/Maslina/Šuma/Žad/
  Ruža/Bordo/Grafit — gold stays the default, so nothing changes for existing
  users; the palette was chosen by Claude per the founder's delegation
  2026-07-12, respecting the no-purple/blue/orange bans); switch whole areas
  of the app on or off (Tasks, Calendar, Study… — turning one off hides its
  page, sidebar entry and dashboard widgets, but never deletes any data, and
  turning it back on brings everything back); choose how much Nexus reminds
  you with one click (Minimalno / Normalno / Sve — shortcuts over the same
  notification switches the bell offers, which sit right below them); export
  all your data (see below); and see the app version and where your data
  lives on this computer.
- **Izvoz podataka (Rezervna kopija)** — one button in Settings exports
  everything (tasks, calendar events and tracked documents, subjects/exams/
  flashcards/study plans, focus sessions, the notification history, and your
  notes with their folders, tags, templates, history and attached files) into a
  single archive: open JSON (one file per module, plus the manifest),
  human-readable CSV tables, and a Markdown copy of every note side by side —
  readable and usable even without Nexus installed. The archive is **protected
  by a passphrase you type when exporting** (a different one from your app
  passcode, so the file opens on any computer); you can untick that and save it
  unprotected, but you have to say so explicitly. You pick where to save it; the
  confirmation shows the path, how many records were written, and whether the
  file is protected. A lost passphrase means an archive nobody can open — us
  included.

Everything is saved on the computer, works with no internet, and looks like one
cohesive, deliberately designed app in both **Dan** (light) and **Noć** (dark)
themes.

The app can now also be **installed like a regular Windows program**: one command
builds `Nexus-Setup-0.1.0.exe` (a normal installer with desktop and start-menu
shortcuts, no admin rights needed), and the installed app is ready to update itself
automatically once we publish updates (see §5 for the two decisions that unlocks).
**Uninstalling** works like any Windows program (Apps & features) and asks whether
to also delete your local data — the safe answer (keep it) is the default, and
automatic updates never touch your data at all.

**Your data is now locked and encrypted.** The first time you open Nexus it asks
you to set a **pristupni kod** (at least 8 characters, with a letter and a
digit) and then shows a **Kit za oporavak** — a one-time code you write down.
From then on every launch asks for the passcode, and everything in the database
is unreadable without it: copying the files to another computer gets an attacker
nothing, because part of the key lives in Windows' own secure storage and never
leaves this machine. Forgetting the passcode is recoverable **only** with the
Kit, which is also how you move your data to a new computer on purpose. Wrong
attempts get progressively slower waits. You can lock the app yourself from the
sidebar, it locks itself after a period of inactivity (you choose how long), and
Settings → Sigurnost lets you change the passcode or issue a new Kit. The files
you attach to notes are covered too: they are stored encrypted on disk, under a
key derived from the same passcode, and anything attached before this existed is
converted quietly in the background the first time you unlock. One honest
detail: when you open an attachment **in another program** (Word, a PDF viewer),
Nexus has to hand that program a real, readable file — that temporary copy is
deleted every time you lock the app and again at every launch.

**One search box now finds everything.** Press **Ctrl+K** anywhere and type: it
searches across tasks, events, notes, documents, subjects, exams, decks,
flashcards and attachment names at once, and typing a Serbian word finds it
however it was written — `Đorđe`, `djordje` and `Ђорђе` are the same search, and
`c` finds `č` and `ć`. Results are grouped by kind with a snippet showing the
match in context, best matches first, recent things ahead of stale ones. Press
Enter and it does not just open the module — it takes you to the exact task,
note, event, document, subject, exam, deck or card and marks the row for a
second so you can see which one it found; for a flashcard it even opens the
deck it lives in. The same box also runs commands: type `>` to see them — jump
to a module, create a new task / event / note, change the theme, lock the app,
or rebuild the search index if it ever looks wrong. Nothing about it goes
online; the index lives inside the same encrypted database as everything else.

Not yet built: cloud accounts (the local one now exists), data import
(export is done — see above), a few Study extras (Anki import, extra card
types), and the rest of the catalogue — see §4.

---

## §2 — What is built (technical), as it stood

**Foundations**
- **Monorepo & tooling** — pnpm + Turborepo, strict TypeScript 5.9, React 19, Vite 7,
  Vitest. Packages: `tokens`, `core`, `db`, `ui`. Apps: `desktop`, `gallery`.
- **Design tokens** (`packages/tokens`) — three-tier Dan/Noć token pipeline → CSS
  variables; all UI is token-only (a grep gate keeps raw colours out).
- **Encrypted SQLite layer** (`packages/db`) — `openDatabase` (SQLCipher-compatible,
  strict key validation), forward-only migrations, typed errors, UUIDv7, a
  profile-scoped feature-flag store. **28 → 94 tests** as modules landed.
- **Core** (`packages/core`) — module registry, feature flags, the seven module
  contracts (widgets/settings/search/stats/automation/import-export/tools), and the
  **headless views engine** (filter/sort/group; sr-Latn-correct collation;
  list + kanban).
- **UI** (`packages/ui`) — token-driven components: Button, Checkbox, Chip, Card,
  NavItem, TextField, EmptyState, ListRow, Kanban, BarChart, ListView, KanbanView.
- **Gallery** (`apps/gallery`) — a dual-theme design-review harness.
- **Hardened Electron shell** (`apps/desktop`) — `contextIsolation` + `sandbox` on,
  `nodeIntegration` off, navigation/window-open locked, strict prod CSP; the database
  lives only in the main process; the renderer reaches it through a frozen,
  one-method-per-channel, per-field-validated IPC bridge. First run seeds a personal
  profile; an end-to-end `--smoke` check proves the renderer→main→DB path.
- **CI / security / repo hygiene** — GitHub Actions verify workflow (install → build →
  typecheck → test), a security workflow (gitleaks history scan + two dependency
  audits, below), Dependabot (electron, vite and `@vitejs/plugin-react` majors ignored
  — the ABI pin and the electron-vite peer range), PR template, CODEOWNERS,
  `.gitattributes`. Branch-protection/remote setup is a founder-side checklist in
  [ops/github-setup.md](../ops/github-setup.md).
  **Dependency audit split in two (2026-07-27):** what ships to a user's machine is
  reachable by definition, so `pnpm audit --prod --audit-level low` blocks on *every*
  severity with no exceptions of any kind; the rest of the tree is the build toolchain,
  scanned by `.github/scripts/audit-toolchain.mjs`, which blocks on every high and
  critical except the ones its allow-list names — each entry carrying why it is not
  exploitable here and the condition that retires it, and an entry that stops matching
  fails the job too, so a spent excuse cannot linger. It is a script rather than a flag
  because `pnpm audit --ignore` does not ignore for one run: it *writes*
  `auditConfig.ignoreGhsas` into `pnpm-workspace.yaml`, and that key would then also
  cover the shipped scan. This replaced a single blanket `--audit-level high` gate that
  was simultaneously **stricter than SEC-VER-03 asks** (it blocked on advisory matches,
  not on exploitability) and **weaker where it matters** (`low`/`moderate` advisories in
  shipped code passed). Retiring it also retired deviation DEV-004, which existed only
  because the old gate could not express the distinction.
  **Dependabot backlog resolved (2026-07-27, founder-authorized):** merged
  `actions/setup-node` 6→7 (#12) and the 11-package minor/patch group (#13, incl.
  electron 42.7, katex 0.18, tiptap 3.28) after a full local gate run; closed the vite
  7→8 major (#14) — `electron-vite@5` declares `vite: ^5 || ^6 || ^7` and the release
  that adds 8 is still a beta, so vite and `@vitejs/plugin-react` joined the ignore
  list, to be lifted together. Four of the five audited advisories were cleared by
  `pnpm.overrides` (brace-expansion 1/2/5, fast-uri); the fifth is the tolerated one
  above. One PR stays **open on purpose**: #15 (tiptap 3.29.1, react 19.2.8, electron
  42.7.1, turbo 2.10.7) fails `verify` with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`
  — every package in it was published on 2026-07-27, inside pnpm's 24-hour
  supply-chain quarantine, which is the one moment a compromised release is most
  dangerous and therefore the one gate not to bypass. It goes green by itself from
  **2026-07-28 09:34 UTC**; re-run the checks after that and merge if green (the PR
  carries a comment saying so). **Dependabot backlog resolved
  (2026-07-14, founder-authorized):** merged the four verify-green GitHub-Actions
  bumps (checkout v7, gitleaks-action v3, setup-node v6, pnpm/action-setup v6);
  closed the verify-red dev-dependency majors with reasons (TS 7 beta breaks the
  `@nexus/tokens/css` side-effect import resolution; `@vitejs/plugin-react` 6 fails
  the gallery Vite config load; Vitest 4 can't resolve `node:crypto` under our TS
  setup); left `@types/node` 26 and Vite 8 open-on-hold (verify-green but majors of
  pinned tooling — take deliberately, not via bot); left the lockfile-maintenance PR
  open to self-heal past the pnpm `minimumReleaseAge` supply-chain window. The
  systemic **gitleaks 403 on every PR** was a token-permissions bug — fixed by
  granting the job `pull-requests: read` (`e613caf`, since pushed and green).
- **Packaging & auto-update (RELEASE)** — `electron-builder` NSIS x64 installer
  (per-user, no admin, `Nexus-Setup-${version}.exe`), the `dist` script (ABI-flip →
  `electron-vite build` → package → ABI-restore-on-any-outcome, mirroring `smoke`),
  a generated interim four-pointed-star app icon (`build/make-icon.ps1` →
  `build/icon.ico`, exact Noć-theme colours, wired into the installer's `win.icon`
  **and** the runtime `BrowserWindow`), and a minimal main-process-only
  `electron-updater` check (`checkForUpdatesAndNotify` on packaged builds only;
  the promise rejection and the `"error"` event are both caught and logged, never
  thrown). Publish config points at `lukastojiljkovic/nexus-releases` (documented
  plan of record — the repo doesn't exist yet, so `dist` always passes
  `--publish never`). First installer built and verified: unsigned (as expected —
  see §5), native SQLite binary correctly `asarUnpack`-ed. The **uninstaller**
  (`build/installer.nsh`, `customUnInstall` macro, UTF-8-with-BOM for the Serbian
  copy) offers optional removal of all local data (`%APPDATA%\Nexus` +
  `%LOCALAPPDATA%\Nexus-updater`): default is keep (`MB_DEFBUTTON2` + `/SD IDNO`
  for silent runs), and `${isUpdated}` skips the prompt entirely when the
  uninstall runs as part of an auto-update, so updates can never delete data.

**Modules (usable end-to-end)**
- **Onboarding (ONB, lite)** — one welcome screen: name the profile + pick the theme.
- **Navigation shell** — sidebar built from the module registry with category
  separators; state-based page switching.
- **Tasks (TASK)** — full data layer (tasks table, profile-scoped `TaskStore`,
  soft-delete, sub-task parent link, status/priority enums, completion invariant),
  validated `tasks:*` IPC, and a page with **list + kanban** views, quick-add,
  check-off, drag-between-columns, and delete-with-undo.
- **Calendar (CAL) — events** — `events` data layer + validated `events:*` IPC + a
  page with a **day-grouped agenda**, create/edit form (all-day or timed), and
  delete-with-undo.
- **Calendar (CAL) — document expiry** — `tracked_documents` + `document_renewals`
  data layer (7 document types, per-type reminder ladders, a **derived**
  ok/soon/expired status, atomic renewal that keeps history), validated `documents:*`
  IPC, and a **Dokumenta panel** (add/edit/renew/delete-with-undo, colour-coded
  status chips).
- **Dashboard (DASH)** — a personalized home: greeting + read-only widgets
  (today's agenda, upcoming tasks, expiring documents; later joined by Ispiti and
  Učenje) that deep-link into their modules. (Its shell-era recessed diagnostics
  card moved to Settings' "O aplikaciji" when SET lite landed.)
- **Study (STUDY) — subjects & exams** — `subjects` (name, colour enum, semester,
  archived flag) and `exams` (type: pismeni/usmeni/kolokvijum, date, scope;
  same-profile subject foreign key) tables with profile-scoped stores,
  soft-delete/restore, validated `subjects:*` / `exams:*` IPC, and the full UI:
  a subject-hub page (create/edit/archive/delete-with-undo subjects, per-subject
  exam management, countdown chips via shared UTC-midnight day math), exams merged
  read-only into the calendar agenda (STUDY-002), and a dashboard **Ispiti**
  countdown widget. Serbian day-count agreement (`21 → "dan"`, `22 → "dana"`) is
  centralized in `dayUnit` and used by documents + exams alike.
- **Study (STUDY) — flashcards data layer (piece 2a)** —
  `decks` (a thin subject-scoped grouping) and `cards` (front/back, basic cards
  only — no cloze/problem types yet) tables, each column of `cards` mirroring the
  installed `ts-fsrs@5.4.1` `Card` type field-for-field (due, stability,
  difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
  last_review) so a row round-trips losslessly through the library's scheduler;
  `review_log` mirrors `ts-fsrs`'s `ReviewLog` type the same way, scoped by
  profile, cascading from its card, with no soft delete (rows are removed only by
  undo). `DeckStore` mirrors `ExamStore`'s idiom exactly. `CardStore` never reads
  the clock for scheduling — every scheduling method takes an explicit `now`
  parameter — and wraps `review`/`undoLastReview` each in one transaction using
  the library's own `next`/`rollback`/`repeat` (default parameters, default
  request retention; no custom tuning). Validated `decks:*` / `cards:*` /
  `review:*` IPC (`queue`/`grade`/`undo`/`preview`); `now` is always stamped by
  the main process, never accepted from the renderer. 144 db-package tests (up
  from 94).
- **Study (STUDY) — flashcards UI (piece 2b)** — extends the subject hub with a
  **Špilovi** (decks) section per subject: inline add/edit/delete-with-undo decks
  each showing live new/due badge counts (`cardCounts`) and a subject-level
  "Uči sve" when any deck has something due; a deck drill-in ("Kartice") for card
  management (add/edit/delete-with-undo cards, a deck select to move a card
  between the subject's decks on edit, a card-state chip: Nova/Uči se/Na
  ponavljanju); and a keyboard-first review session (`reviewQueue` fetched once,
  Space/Enter to reveal, 1–4 to grade, U to undo, Esc to exit) with per-rating
  interval-preview chips (`previewReview`) and same-session re-queueing of
  lapsed Learning/Relearning cards whose next due is within 15 minutes, backed by
  a session-local undo stack that rolls the DB back via `undoReview` and drops
  any re-queued copy. A new `MathText` component (`apps/desktop/src/renderer/src/`)
  deterministically splits card text into plain segments and `$…$` inline /
  `$$…$$` display KaTeX math (rendered via `katex`, `trust: false`,
  `throwOnError: false`; unclosed/malformed math degrades to plain text or
  KaTeX's own inline error span, never a crash), used wherever card content
  appears — card rows (truncated), the card form's live preview, and the review
  session. The production CSP's `font-src` gained `data:` alongside `'self'` for
  KaTeX's bundled font assets.
- **Study (STUDY) — exam planner data layer (piece 3a)** — a pure, deterministic
  backward-planning engine (`planBlockDates`, `packages/core`): given an exam
  date, a start date, a daily-minutes budget, an exam-week-boost flag and
  "today" (all bare `YYYY-MM-DD`, UTC-midnight day math mirroring
  `examDates.ts`), it returns one study block per day from `max(start, today)`
  through the day before the exam, doubling minutes for the final 7 days when
  boosted — no clock reads, so it is exhaustively unit-tested without fake
  timers. Migration 007 adds `study_plans` (one soft-deleted plan per exam,
  `daily_minutes` 15–480, `start_date`, `exam_week_boost`, enforced to at most
  one **active** plan per exam by a partial unique index) and `study_blocks`
  (per-day sessions with `minutes` and a closed `planned/done/missed` status;
  no `deleted_at` — blocks are regenerated wholesale, not soft-deleted, and
  drop out of active queries once their plan is soft-deleted). `PlanStore`
  mirrors `ExamStore`/`CardStore`'s idiom and, like `CardStore`, never reads the
  clock: every method takes explicit `now`/`today` parameters. `createPlan`
  validates the exam is active/same-profile and strictly in the future, the
  start date strictly precedes the exam date, and the daily-minutes range,
  then inserts the plan and its engine-generated blocks in one transaction.
  `updatePlan` regenerates only future `planned` blocks, leaving past and
  `done`/`missed` rows untouched. `sync` is idempotent — marks past `planned`
  blocks `missed`, drops and regenerates future ones (skipping dates that
  already have a row), and no-ops on a repeat call with the same `today` —
  and `syncAll` runs it across every active plan whose exam is still active.
  `restore` surfaces a collision with a newer active plan (the partial unique
  index) as a `PlanValidationError`, never a raw SQLite error. Validated
  `plans:*` / `blocks:*` IPC (list/create/update/delete/restore/sync-all,
  list-by-plan/range/set-status); `now` and the local calendar `today`
  (`getFullYear/Month/Date`, never the UTC-shifting `toISOString().slice`) are
  always stamped in main, never accepted from the renderer. 35 core-package
  tests (up from 26), 191 db-package tests (up from 144).
- **Study (STUDY) — exam planner UI (piece 3b)** — extends the subject hub with
  a **Planovi učenja** section: a **Danas za učenje** strip (today's blocks
  across all plans via `listBlocksInRange`, task-style check-off through
  `setBlockStatus`, done ↔ planned — checking off a missed block counts as a
  late completion); one card per active plan (subject + exam type, the shared
  countdown chip, a "60 min/dan · duplo poslednjih 7 dana" summary, "X od Y
  urađeno" progress derived from that plan's blocks, inline **Izmeni** form and
  **Obriši** with the page's undo-toast wired to `restorePlan`); an expandable
  per-plan block list (sr-Latn day labels mirroring the calendar's headings,
  minutes, planirano/urađeno/propušteno status chips — done reads jade, missed
  is a muted row — and the same check-off); and an inline **Novi plan** form
  (a select over future exams that have no active plan, labelled "Predmet — tip
  ispita — datum"; start date defaulting to today; daily minutes 15–480,
  default 60; exam-week-boost checkbox, default on) that maps the store's
  validation failures to Serbian copy with a generic fallback. `syncAllPlans`
  runs before every plan read (page mount, profile change, after each
  create/update/delete/restore), so missed blocks are labelled before anything
  renders. The calendar agenda merges study blocks (today −31 … +365 days) as
  read-only rows — subject-colour dot, an "Učenje" tag chip, subject + exam
  type, a minutes chip, and a status chip for non-planned blocks; within a day,
  entries order events → exams → blocks deterministically. New shared
  `localTodayKey`/`shiftDayKey` helpers live beside the exam-date math in
  `examDates.ts`; all copy is in `strings.ts`; tokens-only CSS under
  `.study__` / `.cal__`.
- **Study (STUDY) — stats + focus sessions data layer (piece 4a)** — a pure,
  clock-free streak engine (`computeStreak`, `packages/core`): given a set of
  bare `YYYY-MM-DD` activity days and `today` (UTC-midnight day math mirroring
  `planBlockDates`), it returns the best (longest-ever) and current
  consecutive-day streaks, with a gentle rule for `current` — a day with no
  activity yet doesn't break the streak until it is fully over, so `current`
  falls back to the run ending yesterday when today itself is still empty.
  Migration 008 adds `focus_sessions` (completed study-timer sessions only,
  soft-deleted/undo-able, `ended_at > started_at` enforced by a CHECK); a
  *running* timer is deliberately never a row — it lives only as main-process
  runtime state (a `Map` keyed by profile id), so a crash or restart loses the
  in-progress timer honestly instead of persisting a fabricated duration, with
  no stale-open-row cleanup to get wrong. `FocusStore` mirrors `PlanStore`'s
  idiom (explicit `now`, same-profile active-subject resolution exposed as a
  public `resolveSubject` so the IPC layer can validate before recording a
  running timer); `StatsStore` is read-only and profile-scoped: `subjectMinutes`
  (SUM of active focus-session durations via `julianday`, rounded to the
  minute in TS, grouped by subject), `activityDays` (the union of `review_log`
  days, active `focus_sessions` start days, and `study_blocks` marked `done`
  joined through active plans — the last is a documented approximation:
  re-toggling a block moves its activity day), `reviewCounts` (per-day counts
  ascending, plus a total), and `blockTotals` (done/missed counts joined
  through active plans). Every range query buckets by
  `date(x, 'localtime')` so stats read as the user's own calendar days, not
  UTC ones. Validated `focus:*` / `stats:study` IPC (start/stop/status/cancel
  the in-memory timer, list-range/delete/restore persisted sessions, and the
  composed `StudyStats` read); `startedAt`/`endedAt`/`now` are always stamped
  in main, never accepted from the renderer, and a sub-millisecond stop
  (`endedAt <= startedAt`) is discarded rather than persisted as a zero/negative
  duration. 45 core-package tests (up from 35), 234 db-package tests (up
  from 191).
- **Study (STUDY) — stats + focus timer UI (piece 4b)** — a **Statistika i
  fokus** hub section after Planovi učenja. A **Tajmer fokusa** card: idle, a
  select over active (non-archived) subjects + "Pokreni fokus" (`startFocus`;
  a quiet empty line when there are no active subjects); running, the subject
  name, a live `mm:ss` / `h:mm:ss` elapsed readout ticking once a second
  (display-only, derived from main's `startedAt` against the local clock —
  restored on mount via `focusStatus`, so the timer survives navigating away
  and back), **Zaustavi** (`stopFocus` — a persisted session refreshes stats;
  a discarded sub-millisecond stop just returns to idle) and **Odbaci**
  (`cancelFocus`). A gentle streak line over `computeStreak` fed by a 365-day
  `studyStats` window (a streak longer than that caps there): "Niz učenja: N
  dana" with Serbian day agreement plus "Najduži niz: M"; at zero it shows
  neutral encouragement ("Još nema niza učenja — počni danas."), never shaming.
  A **Poslednjih 30 dana** card over a second, 30-day `studyStats` call:
  minutes per subject as token-styled proportion rows (accent→jade fill;
  archived subjects still resolve by name, unresolvable subject ids aggregate
  into one muted "Ostalo" row; "X min" / "X h Y min" labels), the review total,
  and "Blokovi: X urađeno · Y propušteno" with missed muted, not red — or one
  honest quiet line when everything is zero. A **Nedavne sesije fokusa** list
  (`listFocusRange`, last 7 days): subject, sr-Latn day + start time, a jade
  duration chip, and delete with the page's standard single-pending-undo toast
  (`restoreFocus`); stats and the list refresh together after stop/delete/
  restore. Formatting lives in a new pure helper module
  (`apps/desktop/src/renderer/src/focusFormat.ts`); all copy in `strings.ts`;
  tokens-only CSS under `.study__stats*` / `.study__focus*`. The renderer calls
  `computeStreak` directly from `@nexus/core` (dependency-free, renderer-safe)
  — its first runtime (not type-only) core import.
- **Study (STUDY) — catch-up replan (data layer, 2026-07-10)** — the founder's
  "redistribute missed minutes, no daily cap" decision (§5), built as one more
  pure function plus one store change; no schema or IPC change was needed.
  `distributeBacklog` (`packages/core`) spreads a backlog of missed minutes
  evenly across a set of blocks, earliest date first: every block gets
  `floor(backlog / n)` extra minutes, and the first `backlog % n` blocks
  (ascending date order — the caller passes `planBlockDates`'s own output)
  get one further minute each, so earlier days absorb the remainder and the
  user catches up sooner; a zero/negative backlog or an empty block list
  comes back unchanged. `PlanStore.regenerateBlocks` — the shared step behind
  both `updatePlan` and `sync` — now sums a plan's `missed` blocks' minutes
  (a new prepared statement) and runs the surviving future blocks through
  `distributeBacklog` before inserting them: a `sync` after missed days
  spreads their minutes over whatever future days remain with no daily cap,
  and a missed block later marked done (late completion) shrinks the backlog
  on the next sync since its minutes leave the missed pool. 52 core-package
  tests (up from 45), 241 db-package tests (up from 234).
- **Study (STUDY) — follow-up renderer slice (2026-07-10)** — three founder-
  approved fixes, all renderer-only (no schema/IPC/store changes): (1) a
  failed plan restore — the offer can never succeed on retry once the exam
  gained a newer active plan in the meantime — now clears the stale undo
  offer and shows a visible Serbian message in the same undo-toast slot
  (`role="alert"`, dismissible, `planRestoreErrorMessage`) instead of only
  logging to the console; (2) checking off (or un-checking) a study block
  whose previous status was `missed`, or reversing a late completion (a
  `done` block dated before today), now follows the optimistic local update
  with a `refreshPlans()` re-fetch, so the catch-up replan's redistributed
  minutes on other blocks show immediately — a plain future-block toggle
  still keeps the cheap local-only update; (3) a new **Učenje** dashboard
  widget next to Ispiti shows the study streak (`computeStreak` over a
  365-day `studyStats` window, mirroring StudyPage) and today's completed
  focus minutes (`listFocusRange` for today + `focusSessionMinutes` — a
  running timer deliberately doesn't count), deep-linking into the study
  page, with the streak's own gentle zero copy shown when both are empty.
- **Notifications (NTF) — engine + data layer (piece a1)** — the desktop-local
  reminder foundation (PRD NTF-001..005), built around one fixed design
  decision: reminders are **derived from source tables at check time**, never
  materialized ahead. A pure, clock-free engine (`deriveNotificationCandidates`,
  `packages/core`) takes plain arrays — tracked documents (expiry + reminder
  ladder), exams (date), and pre-aggregated study-day activity — plus enabled
  sources, "today", the caller's local wall-clock time, and the morning hour
  (default 08:00, founder decision 2026-07-05), and returns exactly the
  occurrences that are due right now, deterministically ordered. Documents get
  one occurrence per reminder-ladder offset (`fireDate = expiryDate - offset`,
  the smallest offset in the ladder flagged `priority: "max"`, the PRD's
  "final warning" quiet-hours exception); exams get a day-before ("d-1") and
  morning-of ("d-0") occurrence, both relevant through the exam date itself so
  a missed day-before reminder still surfaces on exam day; study days get one
  occurrence, relevant only on the day itself — a stale nudge from a prior day
  is dropped, not caught up, unlike documents/exams. An occurrence is due once
  its fire date has already passed (came due while the app was off) or it
  fires today at/after the morning hour. This design buys three things with no
  extra code: deleting a source entity simply stops it being derived (the
  PRD's cleanup contract holds with zero coupling between modules); a
  clock/timezone change self-heals on the next check, since nothing stale was
  ever written; and anything that came due while the app was closed naturally
  surfaces on the first check after launch (the later digest UX groups these).
  Migration 009 adds `notifications` (a **ledger only** — what was already
  delivered/snoozed/dismissed, with a snapshot of the exact title/body shown;
  no `deleted_at`, since dismissal is itself a terminal status; `UNIQUE
  (profile_id, source, entity_id, occurrence_key)` so an occurrence is
  recorded once, with re-fires after a snooze going through the same row), a
  profile-level `ntf_settings` (quiet hours, morning hour), and a per-source
  `ntf_source_settings` toggle (absent row = enabled, mirroring the
  `feature_flags` "absent = default" idiom). `NotificationStore` mirrors
  `PlanStore`/`FocusStore`'s idiom — explicit `now`/`until` on every mutating
  method, "HH:MM" and ISO-8601 regex validation, typed
  `NotificationValidationError`/`NotificationNotFoundError` — and exposes
  `getSettings`/`updateSettings`/`setSourceEnabled`, `recordDelivered` (the
  ledger write, its UNIQUE collision surfaced as a validation error),
  `listLedgerKeys` (what a later scheduler diffs fresh candidates against),
  `dueSnoozed`, and the `snooze` → `markRefired`/`dismiss` lifecycle
  (dismissing an already-dismissed row is a no-op, not an error). This slice
  is engine + migration + store only — no IPC, no main/preload, no renderer;
  no scheduler loop runs yet. 62 core-package tests (up from 52), 280
  db-package tests (up from 241).
- **Notifications (NTF) — main-process scheduler + IPC (piece a2)** — turns
  a1's derived candidates into real OS notifications, plus the validated
  `notifications:*` IPC surface. `startNotificationScheduler`
  (`apps/desktop/src/main/notifications.ts`) runs one check immediately on
  app-ready, then every 60 s, plus once more on `powerMonitor`'s `"resume"`
  event (a reminder due while asleep does not wait out a full interval);
  never during `--smoke` (a background check firing mid-run would make the
  deterministic exit flaky), and every check is wrapped so a failure is
  logged and simply retried next cycle, never thrown. Per profile (today
  effectively one; a code comment records the PRD's cross-profile
  discretion rule — PRD 05 §7: a non-active profile's notifications
  shouldn't render as OS toasts beyond a neutral badge — for when profile
  switching lands), each check: syncs all plans first (so today's blocks are
  current), reads active documents/exams/subjects and today's *planned*
  blocks (skipped entirely when there are none), calls
  `deriveNotificationCandidates`, and diffs the result against
  `listLedgerKeys()` so anything already in the ledger in any status is
  never re-fired. A new pure `isWithinQuietHours` helper (`packages/core`,
  same clock-free idiom as the engine; both-null/equal-bounds/plain-window/
  overnight-wrap all covered) holds every `normal`-priority new candidate
  without recording it while quiet hours are on — it simply re-derives once
  they end — while `max`-priority candidates (a document's final-warning
  offset) pass straight through, the PRD's quiet-hours exception. Survivors
  are recorded via `recordDelivered` and shown as OS notifications:
  individually when at most 3, otherwise one grouped digest ("Nexus — N
  podsetnika" plus a per-source count breakdown) — every occurrence is still
  recorded in the ledger individually regardless of how it is shown; a
  notification click focuses/restores the main window. Snoozed rows due now
  (`dueSnoozed`) are re-fired (`markRefired`) if their (source, entity,
  occurrence) is still in the freshly-derived candidate set, or silently
  `dismiss`ed if the entity behind them is gone/stale (the PRD's cleanup
  rule) — no user-visible noise either way. Any ledger change pushes one
  payload-free `notifications:changed` event over `webContents.send` — the
  app's first push channel. Serbian notification copy lives in a new
  main-only `apps/desktop/src/main/notificationStrings.ts`: the main process
  cannot import the renderer's `strings.ts` (a separate, browser-only
  bundle), so this is the single centralized main-side counterpart, kept in
  the same tone by hand; it carries the full Serbian 1/2-4/5+ plural rule for
  word forms whose paucal and plural spellings do not coincide (e.g.
  "blok"/"bloka"/"blokova", "dokument"/"dokumenta"/"dokumenata"), unlike
  "dan"/"dana" (whose two forms do coincide, so the renderer's simpler 2-way
  `dayUnit` reasoning still applies there). Six validated `notifications:*`
  IPC channels (`center-list`, `snooze`, `dismiss`, `settings-get`,
  `settings-update`, `source-toggle`) plus the `notifications:changed` push,
  mirroring the app's existing per-field-validated, closed-set-checked
  convention exactly; `notifications:snooze` resolves its `preset`
  (`10m`/`1h`/`tonight`/`tomorrow-morning`) to an absolute `until` entirely
  from main's own clock, and relies on the store's own "`until` must be
  strictly after `now`" check to reject `tonight` once evening has passed
  (the UI disables that preset then) rather than duplicating the check. The
  preload bridge gained its first push-event method, `onNotificationsChanged`
  — a subscribe/unsubscribe pair over the one fixed channel, no generic
  `on(channel, ...)` passthrough, keeping the frozen one-method-per-channel
  bridge intact. `localToday` moved out of `main/index.ts` into a small
  shared `main/clock.ts` (plus a new `localTime` "HH:MM" reader) so the
  scheduler and the rest of main agree on the same wall-clock idiom. No
  renderer changes — the bell/center UI is piece a3. 73 core-package tests
  (up from 62), 281 db-package tests (unchanged — no schema/store changes
  this slice).
- **Notifications (NTF) — bell/center UI (piece a3)** — the renderer surface
  over a1/a2, closing out the module. A new `NotificationCenter` component
  sits in the sidebar footer (`App.tsx`, pinned to the bottom of the nav
  column via a flex auto-margin): a full-width bell button, typographic like
  a nav item (open state = gold text + weight, never a fill or glow), with an
  unread count — rows whose status is `"delivered"` — shown as plain
  gold-accent text capped at "9+" and hidden entirely at zero. Clicking it
  toggles an overlay panel anchored above the bell (bordered surface +
  `--nx-shadow`, `position: absolute` off a relatively-positioned footer,
  scrolling internally past 70vh so it never outgrows the window); it closes
  on Esc, an outside click, or the bell again. The panel lists
  `"delivered"`/`"snoozed"` rows (dismissed stays in the ledger as history but
  never resurfaces) — title, muted body, a source tag chip
  (Dokument/Ispit/Učenje), the delivered time, and for snoozed rows a chip
  "odloženo do HH:MM" (date-qualified once it isn't today) — each row a
  deep-link button (exam/study-day → the study page, document → the calendar
  page) alongside snooze-preset buttons ("10 min"/"1 h"/"Večeras"/"Sutra
  ujutru", "Večeras" hidden once local time is past 18:00 since main rejects
  it then) and a dismiss ×; every action re-fetches the list rather than
  guessing the next state. A collapsed "Podešavanja obaveštenja" section at
  the panel's bottom (the same show/hide-label disclosure idiom as
  `study__archived`/the plan-block toggle) holds quiet-hours `time` inputs
  (od/do, a Save that only calls `updateNotificationSettings` when both are
  filled or both cleared — otherwise a client-side Serbian pairing error,
  never a partial call — plus a Clear action), a morning-hour `time` input
  (saved immediately on change), and three source `Checkbox` toggles
  (`setNotificationSourceEnabled`, which returns no settings, so its handler
  re-fetches via `getNotificationSettings` instead of reconstructing the
  array locally — every settings mutation stays optimistic-free). The
  document deep link lands on the calendar module plainly rather than its
  Dokumenta sub-view: that view is a `CalendarPage`-internal `useState`, not
  a prop, so it isn't reachable from outside without changing that page's
  API, which was out of scope for this slice. Two new small pure modules —
  `notificationFormat.ts` (an sr-Latn "HH:MM today, else day + HH:MM" instant
  label shared by delivered/snoozed times, mirroring `focusFormat.ts`'s
  idiom, plus the bell's count-capping helper) and `NotificationCenter.tsx`
  itself — plus a new `.ntf__*` block in `app.css` (tokens-only) and a
  `strings.notifications` block. Renderer-only: no schema/store/IPC changes,
  so core/db test counts are unchanged. **NTF is now complete (a1+a2+a3).**
- **Settings (SET, lite)** — the first real settings surface, deliberately
  renderer-only: every control drives IPC that already existed
  (`profiles:rename`, `flags:get/set`, the `notifications:*` settings
  channels, `app:info`), so no schema, store, main, or preload code changed.
  A new `SettingsPage` (routed from the sidebar's existing Podešavanja
  entry) carries five sections. **Profil**: rename the active profile (same
  1–80-chars-after-trim rule as onboarding, mapped to a friendly Serbian
  error; App's own profile state updates on success so the dashboard
  greeting follows). **Izgled**: a three-way theme preference — Sistemski /
  Dan / Noć — as a small segmented Button row; `theme.ts` grew a
  `ThemePreference` type over the *same* storage key, so a legacy stored
  "dan"/"noc" keeps working unchanged, "system" resolves through
  `prefers-color-scheme` and follows OS changes live while selected, the
  default stays Noć (the product's identity theme), and the topbar
  quick-toggle still works — it flips to the explicit opposite of the
  currently *resolved* theme, deliberately leaving system mode.
  **Moduli** (SET-007): the registry's category groups with a one-line
  Serbian description and a Checkbox per module, bound to the feature-flag
  store — `setFlag` then a `getFlags` re-fetch pushed up into App, no
  optimistic drift; `dashboard` and `settings` are locked ("Uvek uključeno" —
  you can never disable the home surface or the page you stand on). App now
  resolves `resolveEnabled(registry, flags)` on load: the sidebar renders
  only enabled modules (empty categories drop out), a route guard lands
  anything targeting a disabled module — including a notification deep
  link — on the dashboard, and the dashboard hides a disabled module's
  widgets (Predstojeći zadaci ↔ tasks, Dokumenta koja ističu ↔ calendar,
  Ispiti + Učenje ↔ study, Danas composes only from enabled sources) and
  skips their fetches entirely. Disabling never deletes data; re-enabling
  restores everything (ONB-008 semantics — flags are per-profile rows).
  **Obaveštenja**: NTF-008's appetite presets — Minimalno (dokumenti),
  Normalno (+ ispiti), Sve (+ učenje) — as shortcuts that write all three
  source toggles and re-fetch; the preset whose source set exactly equals
  the current `enabledSources` renders active, a hand-tuned combination
  simply matches none. Below them, the same quiet-hours / morning-hour /
  per-source controls the bell offers: that settings body was extracted from
  `NotificationCenter`'s disclosure into a self-contained
  `NotificationSettingsControls` component (owns its own fetch/state; keeps
  the `.ntf__settings-*` classes so the bell panel look is unchanged),
  rendered collapsed in the bell and always-expanded in Settings, with a
  `refreshToken` prop so a preset click refreshes the controls' displayed
  checkboxes. **O aplikaciji**: read-only app name/version, Electron/
  Chromium/Node versions, and the data location (`userDataPath`) in muted
  monospace — this replaces the dashboard's shell-era recessed diagnostics
  card, which is removed along with its `info` prop plumbing. Deliberate
  boundary: module flags gate the *renderer* (pages, sidebar, widgets)
  only — the main-process NTF scheduler keeps deriving from its per-source
  toggles, untouched by module flags, so "which reminders exist" is governed
  by the Obaveštenja switches, not by hiding a module. All copy in
  `strings.ts` (`strings.settings`); tokens-only CSS under `.set__*`.
  Renderer-only: core/db test counts unchanged (73/281).
  **Accent palette** (2026-07-12, added after SET lite shipped): 8
  user-selectable accent colours — Zlato (default, zero visual change),
  Bronza, Maslina, Šuma, Žad, Ruža, Bordo, Grafit — chosen by Claude within
  the founder's delegation and the standing no-purple/blue/orange bans.
  `packages/tokens` grew per-theme `accents` sections (`dan.json`/`noc.json`,
  each mapping an accent id to `accent`/`accentSoft`/`accentStrong` token
  refs) plus six new colour families and two new jade steps (200/700) in
  `global.json`; `build.mjs` now validates both themes declare identical
  accent id sets and that `zlato`'s resolved values equal the theme's own
  semantic accent triad exactly (throws otherwise — the default accent can
  never drift), emits a `--nx-swatch-<id>` var per accent in each theme's CSS
  block (so the picker can show all 8 dots regardless of the active accent),
  emits one `[data-theme][data-accent]` override block per accent (16 total),
  and exports `ACCENT_IDS`/`AccentId` from `gen/index.ts`. Renderer: a new
  `accent.ts` mirrors `theme.ts` exactly (`nexus.accent` in localStorage,
  `data-accent` on `<html>`, applied in `main.tsx` beside
  `applyStoredThemePreference`); the Izgled card gained a row of 8 round
  swatch buttons (`.set__accent-*`, tokens-only, inline `var(--nx-swatch-*)`
  backgrounds) below the theme segmented control, with the active accent's
  Serbian name shown as a caption and selection marked by a 2px `--nx-text`
  border — no glow, matching the app's no-AI-slop selection rule.
- **Import/Export (IMEX) — full export (slice a1)** — the product's first
  data-freedom guarantee (PRD 14 IMEX-001): a single `.nexus.zip` archive
  (ADR-009's container) holding `manifest.json` (`schemaVersion: "1.0.0"`,
  `appVersion`, `createdAt`, `profile`, `settings` — flags + NTF settings,
  founder decision #11 — per-module record counts, and sha256 checksums over
  each `data/*.ndjson` file), `data/{tasks,calendar,study,notifications}.ndjson`
  (one type-discriminated JSON record per line — `{"type":"task",...}`,
  `{"type":"event"|"document"|"renewal"}`,
  `{"type":"subject"|"exam"|"deck"|"card"|"review"|"plan"|"block"|"focus-session"}`,
  `{"type":"notification"}` — the interchange record shapes ARE the public
  contract, reviewed with the same weight as a DB migration, per ADR-009), and
  `tables/*.csv` mandatory human-readable mirrors (tasks/events/documents/
  subjects/exams/cards/study-plans/study-blocks/focus-sessions — `cards.csv`
  deliberately excludes FSRS internals: id/deckId/front/back/state/due/
  timestamps only, the NDJSON keeps everything). A new pure `buildExportArchive`
  (`packages/core/src/imex/exportArchive.ts`, plus a TDD'd `toCsv`
  RFC-4180 helper in the same folder) takes plain data arrays and an injected
  `hash`/`createdAt` and returns the archive's files in memory — no clock
  reads, no file IO, no `@nexus/db` dependency (row shapes are minimal
  structural interfaces declared locally, not imported, so `@nexus/core` stays
  platform-neutral; TS structural typing lets the real store rows satisfy them
  unmodified). This is the seam the main process closes:
  `apps/desktop/src/main/imex.ts`'s `handleExport` gathers one profile's rows
  through the stores main already owns, stamps `appVersion`/`createdAt`,
  injects a real `node:crypto` sha256, and streams the result into a
  `.nexus.zip` via `yazl` (pure-JS zip writer, no native module, no packaging
  changes) at a path the user picks through a native save dialog — the
  renderer never supplies a filesystem path (SEC-EL). Three small store read
  additions feed it: `CardStore.listReviewLog` (the full `review_log`,
  already profile-scoped by its own column — no join through cards/decks/
  subjects needed), `FocusStore.listActive` (every non-deleted session, no
  date bounds — unlike the date-ranged `listRange`), and
  `NotificationStore.listAll` (the full ledger, every status, uncapped —
  unlike `listCenter`'s capped feed); `SubjectStore.listActive` was verified to
  already include archived (non-deleted) subjects, so no store change was
  needed there. One IPC channel (`imex:export`) + `NexusApi.exportData
  (profileId)` + a one-method preload bridge entry, validated the same way as
  every other channel — `assertTrustedSender` first, the profile resolved
  server-side (the renderer only ever supplies its id). The Settings page
  gained a sixth **Rezervna kopija** card: an honest two-line description
  (what the archive is, plus the plaintext state) and an "Izvezi sve
  podatke…" button over `exportData`, with a quiet
  `Sačuvano: {path} ({N} zapis/zapisa)` confirmation line reusing the
  `app__path` monospace style, or a `.set__error` line on failure. The archive ships
  **unencrypted**: encryption-at-rest itself is founder-deferred to AUTH
  (2026-07-07), so there is no key yet to wrap it with — recorded as a
  deviation (`docs/deviations.md`, IMEX-001/SEC-DAR-02) pending founder
  sign-off. This slice is **export only** — import/restore is a later slice.
  95 core-package tests (up from 73), 291 db-package tests (up from 281).
- **Import/Export (IMEX) — export completeness (slice b)** — the repair of the
  above ([architecture/adr/022](../architecture/adr/022-export-completeness-and-encryption.md)).
  Slice a1 shipped in July and never moved while NOTE, AUTH, the calendar grids
  and SRCH all landed after it, so the archive contained **no notes at all** and
  reported a record count computed only over what it did export — an archive that
  looked complete. The export now carries the whole NOTE module: notes, folders,
  tags, tag links, templates, attachments and version history as
  `data/notes.ndjson` rows; every note's merged Yjs state as `data/notes/<id>.ydoc`
  and each checkpoint as `data/note-versions/<id>/<seq>.ydoc` (lossless); every
  note again as a **readable Markdown mirror** at `notes/<folder path>/<title>.md`;
  and every attachment's **decrypted** bytes at `blobs/<sha256>`, content-addressed
  and deduplicated, with a `blobs` inventory in the manifest. Derived data is
  excluded on purpose: the search index and `note_links` are rebuilt, never
  restored, and `note_updates` is the pending op log the merged state replaces.
  Three decisions worth keeping: (1) the seven note arrays are **required** on
  `ExportArchiveInput`, because this bug existed precisely because a whole module
  could go missing without a compiler complaint — a caller that forgets one is now
  a type error; (2) the Markdown mirror carries **no title heading**, since a
  note's title is derived from its first non-empty block and the body already
  opens with it, so the file name is where the title belongs; (3)
  `buildExportArchive` stays pure and IO-free by **declaring** binary entries
  rather than carrying them — an attachment is capped at 50 MB, and main resolves
  each declared blob one at a time through a yazl read stream, because
  `addBuffer` deflates immediately and holds both copies until the entry's turn,
  which would pile every attachment in memory however carefully the caller read
  them. File names come from user text and are treated as hostile: Windows-illegal
  and control characters, `.`/`..`, the reserved device names (suffixed on the
  *stem* — `CON.txt` is still the console), a length cap, and collisions resolved
  **case-insensitively**, since extraction targets are. A blob missing from the
  store is skipped and counted rather than failing the whole export — the user is
  getting their data out — and the count surfaces in the Settings confirmation
  (`missingAttachments` on `ExportResult`). 388 core-package tests (up from 321).
- **Import/Export (IMEX) — encrypted export (slice c)** — the archive is now
  sealed under a passphrase, which **closes DEV-002**, the last deviation that
  was still open
  ([architecture/adr/022](../architecture/adr/022-export-completeness-and-encryption.md)
  §4–§5). The founder's decision was a passphrase typed at export time: not the
  local data key (an archive must open on a machine with no Nexus account) and
  not the Recovery Kit (that key exists to unwrap the data key, so regenerating
  the Kit would silently strand every archive ever written). Encryption is
  **on by default**; plaintext survives as PRD 14 §3's explicitly confirmed
  choice, behind its own unticked checkbox with the export button disabled until
  it is ticked — and the confirmation is consumed with the export rather than
  left standing to arm the next one.

  The container is `NXA1`: a cleartext header (`format`, `version`, `cipher`,
  the Argon2id parameters, the salt, a random nonce prefix, the chunk size)
  followed by AES-256-GCM frames, because one `crypto.subtle.encrypt` over a
  multi-gigabyte archive would demand it all in memory — the very property
  slice b's writer was rebuilt to avoid. The encrypted file is **not a zip**, so
  it is an `.nexus` and the save dialog stops claiming otherwise.

  The design decision that matters most is the 37-byte AAD,
  `sha256(headerJson) ‖ frameIndex ‖ finalFlag`. Framed AEAD is otherwise
  **truncation-friendly**: chop off the trailing frames and every surviving one
  still authenticates perfectly, so a reader has no way to tell "reached the
  end" from "ran out of bytes". The final flag closes that; the index closes
  reordering; the header hash closes both splicing frames between archives and
  editing the cleartext header — which is what makes it safe to publish KDF
  parameters a reader must trust *before* it can authenticate anything. There is
  always exactly one final frame, even for an empty payload, so the check is
  unconditional. Both untrusted-input boundaries bound what they read before
  anything allocates or derives: the header's Argon2id parameters (an unbounded
  `memoryKiB` would be a memory-exhaustion attack on whoever opens the file) and
  a frame prefix's declared body length (31 bits would otherwise let four edited
  bytes request a 2 GiB allocation).

  `deriveArchiveKey` is deliberately **not** device-bound, unlike the passcode's
  KEK — there is nothing to bind it to on a machine that has never seen this
  installation's OS keystore. That also makes it the one secret an attacker can
  grind offline forever, so its work factor is heavier than the local passcode's
  (128 MiB, t=4 vs 64 MiB, t=3). Main re-validates the passphrase (the
  renderer's form is UX, never a trust boundary), it is cleared from component
  state the moment the export settles, it appears in no log line or error, and
  the key is derived after the dialog so a cancelled export never pays for it.
  Accepted and stated plainly in the UI copy: a lost passphrase is an
  unrecoverable archive, and we cannot open it either. 445 core-package tests
  (up from 388). `apps/desktop` has no test harness, so the stream plumbing was
  proven with a throwaway probe against real yazl: the decrypted output is
  **byte-identical** to the plaintext zip built from the same input, 9 frames at
  1 MiB, and an exactly-2-MiB payload yields 2 full frames plus the empty final
  one.
- **Notes (NOTE) — Yjs substrate (slice a1)** — the document storage layer
  under the coming block editor
  ([architecture/adr/012](../architecture/adr/012-note-editor-and-substrate.md);
  ADR-001's "Yjs from day one" plan of record), deliberately **dark: no UI and
  no module registration** — `notes` stays hidden until a2 ships its page (the
  "hidden until built" rule). Notes are CRDT documents, not row-shaped
  records: migration 010 adds `notes` (metadata only — a denormalized `title`
  so listing never decodes a document, house timestamps + soft delete, and the
  `notes_profile_active` partial index for "this profile's active notes,
  newest updated first"), `note_updates` (the append-only binary Yjs update
  log, `PRIMARY KEY (note_id, seq)` with a per-note monotonic `seq` the store
  assigns — never the renderer), and `note_snapshots` (at most one merged
  snapshot per note, plus the plaintext derived from it for future SRCH and
  `covered_seq` — the highest update seq the snapshot already contains).
  `NoteStore` mirrors the house idiom (prepared/bound statements, explicit
  `now` on every mutating method, typed `NoteValidationError`/
  `NoteNotFoundError`) and stays deliberately **CRDT-agnostic** — opaque blobs
  with transactional guarantees: `appendUpdate` (update 1–256 KB, validated in
  main AND re-checked in the store; inserts the update and bumps
  title/updated_at in one transaction; seq generation falls back to
  `covered_seq` when compaction has emptied the log, so a reused seq can never
  become invisible to `load`), `load` (snapshot + only the updates past
  `covered_seq`, in order), `countPendingUpdates`/`readForCompaction`, the
  atomic `compact` (snapshot upsert + covered-update delete in one
  transaction; a regressing `coveredSeq` is rejected), and
  soft-delete/restore. Every update/snapshot access is gated through
  `requireActive` (the `document_renewals` pattern — the child tables carry no
  `profile_id` of their own). What the bytes *mean* lives in the new pure
  `mergeNoteState` (`packages/core/src/notes/yjsMerge.ts`): applies snapshot +
  updates to a fresh `Y.Doc` and returns the re-encoded state plus plaintext
  derived by walking the TipTap `"default"` XML fragment (top-level blocks
  newline-separated; a fixed contract per ADR-012) — order-independent for
  concurrent edits, TDD'd including a two-peer convergence test. The desktop
  main process closes the seam in `main/notes.ts` (the same pure-logic/storage
  split IMEX uses): `compactIfNeeded` folds a note's pending updates into a
  new snapshot once they reach 32, stamping the clock itself. Six validated
  `notes:*` IPC channels (`list`/`create`/`load`/`append-update`/`delete`/
  `restore`) + the frozen one-method-per-channel preload entries; binary
  crosses the boundary as `Uint8Array` over structured clone (a new
  `asUint8Array` main-side validator enforces non-empty ≤ 256 KB), and the
  renderer never controls seq, compaction, or timestamps (SEC-EL-02). New
  dependency: `yjs` (pure JS, in `@nexus/core` and `@nexus/desktop`) — no
  native-ABI interaction with the Electron 42 pin. 103 core-package tests (up
  from 95), 316 db-package tests (up from 291).

- **Notes (NOTE) — block-editor UI (slice a2)** — the renderer page on top of
  a1's substrate; **this is the slice where `notes` becomes visible** — the
  manifest registers in `V0_MODULES` (id `notes`, prefix `NOTE`, category
  *Content & knowledge*, between SET and STUDY per PRD numbering) with an honest
  Serbian gallery description, and `App.tsx` routes it. `NotesPage` is a
  two-pane workspace: a ~280 px left list of notes (straight from the store,
  newest-updated first; title with a *"Bez naslova"* fallback + a compact
  sr-Latn date; selection is typographic gold + weight, **no highlight bar**;
  per-row delete → the house single-pending-undo via `restoreNote`) and, on the
  right, the TipTap editor at a ~70 ch reading measure. There is **no title
  field** — the title is derived from the document (Notion-style: first
  non-empty top-level block, trimmed ≤ 200) at flush time, so the list refreshes
  itself after each save. The editor (`NoteEditor`) is **TipTap v3** over
  ProseMirror: **StarterKit** trimmed to the v1 block set (paragraph, headings
  1–3, bullet/ordered lists, blockquote, horizontal rule, plain code block;
  marks bold/italic/inline-code/link with `openOnClick:false` + autolink/paste
  only — clicking never navigates in Electron), with the kit's own
  **`undoRedo` disabled** because Yjs owns undo through
  `@tiptap/extension-collaboration` (its Mod-Z / Mod-Y keymap), and
  strike/underline disabled as out-of-set. **TaskList + TaskItem**
  (`@tiptap/extension-list`) add visual checkboxes only — deliberately **not**
  TASK items (PRD 09 §6). **Placeholder** (`@tiptap/extensions`) shows Serbian
  muted prompt text. Input is **markdown shortcuts** (`#`/`##`/`###`, `-`, `1.`,
  `[ ]`, `>`, ```` ``` ````, `---`, `**`, `*`, `` ` ``) **plus a Serbian slash
  menu** and nothing else — no toolbar, no drag handles. The slash menu is a
  custom `@tiptap/suggestion` plugin (`/` at block start or after a space) with
  a **hand-rolled, tokens-styled React portal** (no tippy.js / floating-ui):
  ten commands (Paragraf, Naslov 1–3, Lista, Numerisana lista, Lista zadataka,
  Citat, Blok koda, Razdvajač), sr-Latn case-insensitive filtering, ↑/↓/Enter/
  Escape + click, positioned at the caret via the suggestion `clientRect`.
  **Persistence lifecycle** (the load-bearing part): on select →
  `loadNote` → fresh `Y.Doc` → apply snapshot then updates in order → **only
  then** attach the `doc.on("update")` listener → bind the editor to the
  `"default"` fragment, so hydration replay never re-sends stored updates. Local
  updates are collected, **debounced ~800 ms**, `Y.mergeUpdates`'d, and sent via
  `appendNoteUpdate`; a flush also fires on note-switch, unmount, and
  `beforeunload`, guarded by an in-flight flag (updates arriving mid-flush are
  re-queued and re-sent). A shared wire constant `NOTE_UPDATE_MAX_BYTES`
  (`shared/ipc.ts`, = `@nexus/db`'s `MAX_NOTE_UPDATE_BYTES`, 262 144) drives a
  pre-flight check: an oversize merged batch is sent as its individual updates
  instead, and a single update that alone exceeds the cap surfaces an honest
  Serbian error rather than dropping content. All copy is centralized in
  `strings.ts`; the editor content is token-styled scoped under the editor
  container (no glows, no raw colours). New renderer-only deps (all pure JS, no
  Electron-42 ABI interaction): `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`,
  `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/suggestion`,
  `@tiptap/extension-list`, `@tiptap/extensions` (a single deduped `yjs`
  resolves across `@nexus/core` and the editor). No new tests (the desktop app
  has no renderer test setup); core/db counts unchanged at 103 / 316. **Not yet
  visually smoke-verified by the author** — the coordinator runs the smoke pass.

- **Notes (NOTE) — organization data layer (slice a3a)** — the storage half of
  NOTE-002 (folders/tags/pinning), done TDD-first and committed (`519b645`).
  **Migration 011** adds a self-referential `note_folders` tree (`parent_id`
  CASCADE, nullable `color` token key validated in the store not the schema),
  per-profile `note_tags` (UNIQUE by name, get-or-create), the `note_tag_links`
  many-to-many join (both sides CASCADE), and two columns on `notes`:
  `folder_id` (SET NULL when its folder row is deleted directly) and `pinned`
  (0/1 CHECK). **`NoteOrgStore`** (new, mirrors `NoteStore`'s per-profile,
  prepared-statement, `now`-injected idiom) owns folders — `create`/`update`
  (explicit `color:null` clears via `"key" in fields`, never `??`, for
  `exactOptionalPropertyTypes`)/`move` (a **recursive-CTE cycle guard** rejects
  self- and descendant-moves)/`delete` (one transaction that **promotes child
  folders and notes to the deleted folder's parent, then removes the row**, so
  the UI delete never orphans a subtree via the schema cascade) — plus
  get-or-create tags, rename with a domain-level uniqueness check, and the tag
  links (`attach` idempotent + guarded on active note & in-profile tag, `detach`
  a silent profile-scoped no-op, `listTagLinks` excludes soft-deleted notes).
  **`NoteStore`** gains `folderId`/`pinned` on `NoteMeta`, a `list(filter?)`
  overload (all / unfiled / by-folder) ordered **pinned-first** then
  `updated_at`, and `setFolder`/`setPinned` that **never bump `updated_at`**
  (foldering/pinning are organizational, not content edits). Four new error
  types (`NoteFolder*`/`NoteTag*`). **db tests 316 → 366** (+31 `NoteOrgStore`,
  +19 extended `NoteStore`/migration). All gates green (typecheck 7/7, 366 tests,
  build 3/3, `SMOKE OK`, node-ABI restored, raw-colour grep empty).

- **Notes (NOTE) — organization IPC surface (slice a3a-IPC)** — the typed
  allowlist half of NOTE-002, committed (`01b575b`). **14 new channels** —
  `note-folders:list/create/update/move/delete`, `note-tags:list/create/rename/
  delete/attach/detach`, `note-tag-links:list`, `notes:set-folder`,
  `notes:set-pinned` — plus an optional `folderId` filter on the existing
  `notes:list`. Each `ipcMain.handle` is **`assertTrustedSender`-first**, then
  `asRecord` + per-field validators (new `asNoteFolderColor`/`asNullable­
  NoteFolderColor`/`asNoteFolderCreateInput`/`asNoteFolderFieldChanges` — the
  last uses `"key" in rec` presence checks so an explicit `color:null` clears
  the colour over the wire), with **`now` stamped in main** and the store
  owning semantic revalidation (SEC-EL-02). The **frozen preload bridge** gains
  one method per channel (no generic passthrough); `NoteMeta` grows
  `folderId`/`pinned` and `NoteFolder`/`NoteTag`/`NoteTagLink`/`NoteFolderColor`
  are **redeclared renderer-side** so it never imports `@nexus/db`. No new
  tests (main has no IPC test harness — typecheck proves NexusApi↔preload↔
  handlers align); gates green (typecheck 7/7, build 3/3, `SMOKE OK`, node-ABI
  restored, grep empty).

- **Notes (NOTE) — organizer UI, folders + pinning (slice a3b-1)** — the first
  renderer consumer of the organization IPC, committed (`a9c96bc`). `NotesPage`
  becomes a **three-pane workspace** (`grid` 220 / 280 / `1fr`): the folder
  organizer (left), the folder-filtered, pinned-first note list (middle), and
  the block editor (right). **`NoteOrganizer`** renders "Sve beleške" / "Bez
  fascikle" plus the **nested folder tree** (built from the flat list by
  `parentId`, sr-Latn `Intl.Collator` sort, depth via a `--note-depth` custom
  property), with **inline create/rename**, an **accent-swatch recolour picker**
  mirroring the Settings accent row (8 swatches + a "no colour" that sends an
  explicit `null`), and **delete** (the store promotes children, so the pane
  just re-fetches — nothing lost; deleting the selected folder resets to "Sve
  beleške"). Each **note row** gains a **★/☆ pin toggle** (`setNotePinned`) and a
  **"⋯" menu** — "Premesti u fasciklu" (every folder + "Bez fascikle",
  `setNoteFolder`) and delete-with-undo. A new tokens-only **`NotePopover`**
  anchors its panel `position: fixed` to the trigger's rect so it escapes the
  `overflow:auto` list/tree instead of being clipped (the slash-menu trick).
  Selection is typographic (gold + weight), no glows; all copy in `strings.ts`.
  Writes are await-then-refetch. No new tests (no renderer harness); gates green
  (typecheck 7/7, build 3/3, `SMOKE OK`, node-ABI restored, grep empty).
  Runtime visuals were flagged for the founder's visual pass (headless smoke
  can't render them); **the founder installed the packaged build and approved
  the look (2026-07-17, "super je app za sada")**.

- **Notes (NOTE) — organizer UI, tags (slice a3b-2) — NOTE-002 complete** —
  committed (`63c94f1`), Sonnet-built + strictly verified (two defects found
  and fixed in review, see below). The organizer's left pane gains an **Oznake
  section**: every tag as a **filter chip** (multi-select, **AND semantics** —
  a note must carry *every* selected tag; folder scoping still narrows via IPC
  first, tags narrow client-side over a `Map(noteId → Set(tagId))` built from
  `note-tag-links:list`), active chip styled **typographically** (gold text +
  weight + accent border — no fill, no glow), a "Poništi" clear affordance
  that appears only while filtering, and **inline tag CRUD** (create via
  "Nova oznaka", rename/delete via the same "⋯" popover pattern as folders;
  the store's create is get-or-create by name, so duplicates are impossible).
  Note rows show their tags as **muted metadata chips** under the title, and
  the row's "⋯" menu gains an **Oznake block of `menuitemcheckbox` toggles**
  (attach/detach without closing the menu, so several tags go on in one
  visit). Deleting a tag prunes it from the active filter automatically (the
  page prunes the filter against the fresh tag list on every refetch). The
  empty state distinguishes "no notes here" from "no notes match the tag
  filter". **Review fixes by the supervisor:** (1) the new-tag inline form
  rendered as a direct child of the column-flex pane, inheriting row-axis flex
  sizing that stretched it vertically — wrapped in a row (the same class of
  bug as a3b-1's root-row fix); (2) `NotePopover` measured its fixed-position
  panel only on open, so attaching a note's *first* tag (which adds a chip
  line and reflows the row) left the open menu misanchored — it now re-measures
  on every render while open, with a same-value bail-out so it can't loop.
  Gates all green, run by the supervisor with `--force`: typecheck 7/7, core
  103 + db 366, build 3/3, `SMOKE OK`, post-smoke db 366 on node ABI,
  raw-colour grep empty. Runtime visuals again await the founder's next
  packaged build (headless smoke can't render them).
- **Notes (NOTE) — wiki-link index, data + IPC (slice 004-a)** — committed
  (`f1db53c` db, `05348e9` desktop), Sonnet-built + strictly verified (one
  review fix: two doc comments misattributed the design to ADR-012 — corrected
  to [architecture/adr/013](../architecture/adr/013-note-wiki-links.md), the
  wiki-links ADR written before any code). The design in one line: a wiki-link
  in the document stores **only the target note's id**; titles resolve at
  render time, so renaming a note updates every link label with zero document
  rewrites, and the renderer reports each note's outbound id set at flush time
  into a derived index table. This slice is that index: **migration 012**
  (`note_links` edge table, `(source, target)` primary key, both sides
  cascading with their note, a reverse index for backlinks — mirroring
  migration 011's style), `NoteStore.setOutboundLinks` (TDD; replace-set in
  one transaction; dedupes; silently drops self-links, unknown ids, and
  cross-profile ids; cap 500 via `NoteValidationError`; deliberately keeps a
  link whose target is only *soft*-deleted so undo/restore heals the graph;
  never bumps `updated_at`) and `NoteStore.listBacklinks` (active sources
  only, house list order pinned→newest), db tests 366 → **386** (14 store +
  6 migration tests, red before green), and the IPC surface: the
  `notes:set-links` and `notes:backlinks` channels (`assertTrustedSender`-first,
  a new
  `asStringArray` structural validator, the store re-validating semantics per
  SEC-EL-02), the shared `NOTE_LINKS_MAX_COUNT` wire cap, and two frozen
  preload bridge methods. Gates all green, run by the supervisor with
  `--force`: typecheck 7/7, tests 3/3 packages (db 386), build 3/3,
  `SMOKE OK`, post-smoke db 386 on node ABI, raw-colour grep empty. The
  editor-facing half (the `[[` autocomplete, the `noteLink` node + live-title
  NodeView, flush-time extraction, and the "Povratne veze" panel) is slice
  004-b — see the next entry.
- **Notes (NOTE) — wiki-links editor UI (slice 004-b) — NOTE-004 complete** —
  committed (`e18a2b8` core, `c3f07bc` desktop), Sonnet-built + strictly
  verified (two review fixes, see below). Typing **`[[`** in the editor opens
  a note autocomplete (the slash-menu machinery, generalized: the shared
  panel is now a generic `SuggestionMenu` both menus delegate to — same
  portal/keyboard/styling, and the `[[` plugin carries its own ProseMirror
  `PluginKey` so the two suggestion plugins cannot collide); results are the
  profile's active notes minus the current one, sr-Latn substring-matched,
  capped at 8, fetched fresh on every keystroke. Picking one inserts a
  **`noteLink` inline atom whose only durable attribute is the target's id**
  (ADR-013): a React NodeView resolves the displayed title live from an
  id→title map, so renaming a note updates every link label with **zero
  document rewrites**; a `label` snapshot attribute serves only as fallback
  for unresolvable targets (shown muted as "Nedostupna beleška" — inert until
  a restore heals it, at which point the live title returns). Clicking a link
  (or Enter on it) navigates to the target note; the current folder/tag
  filters are deliberately left untouched. At flush time the editor extracts
  the outbound id set (`collectNoteLinkIds`, a pure TDD'd helper in
  `@nexus/core` beside `mergeNoteState`) and reports it over
  `notes:set-links` only when the set changed since the last successful send;
  a link-index failure is never a save error (the content itself already
  persisted) and retries on the next flush. Below the editor, **"Povratne
  veze"** lists every active note linking here (house order), refreshed on
  load and after each flush; hidden when empty. **Review fixes by the
  supervisor:** (1) link extraction ran *after* `await sendBatch`, but the
  unmount cleanup flush destroys the doc before that await resolves — a link
  inserted and then immediately navigated away from would never be indexed
  until the note's next edit; extraction moved into the flush's sync
  prologue beside the title derivation. (2) A missing-target link still
  navigated on click — landing on the editor's load-error state while its
  CSS reads inert (`cursor: default`); navigation is now a no-op for missing
  targets (`aria-disabled` set). Core tests 103 → **110** (7 TDD tests for
  `collectNoteLinkIds`). Gates all green, run by the supervisor with
  `--force`: typecheck 7/7, tests core 110 + db 386, build 3/3, `SMOKE OK`,
  post-smoke db 386 on node ABI, raw-colour grep empty. Runtime visuals (the
  `[[` panel at the caret, link chips, backlinks section, Dan/Noć) await the
  founder's next packaged build — headless smoke can't render them.
- **Notes (NOTE) — attachments: data + blob store + IPC (slice 003-a)** —
  committed (`28a6188` core, `cc04cc2` db, `5e402d1` desktop), Sonnet-built +
  strictly verified (one review hardening, see below), per
  [architecture/adr/014](../architecture/adr/014-note-attachments.md). Attachment
  **bytes never enter SQLite**: they live content-addressed on disk under
  `userData/attachments/<aa>/<sha256>` (atomic temp-then-rename,
  write-if-absent — identical files share one blob) — *since ADR-019 the store
  is `userData/blobs`, encrypted and HMAC-named; see the ADR-019 entry below* —
  owned by the new
  `main/attachments.ts`. Rows live in **migration 013's `note_attachments`**
  (note-FK cascade, `size_bytes > 0` CHECK, indexes for the per-note list and
  the per-hash refcount) via the new **`NoteAttachmentStore`** (TDD;
  add/list/remove gated on an active note in the profile; every field
  revalidated — trimmed ≤255 file name with no path separators, MIME shape,
  positive size ≤ the 50 MB cap, 64-hex sha256; `refCount`/`mimeForHash`
  deliberately profile-agnostic for the content-addressed GC and serve gate,
  documented in place). **No renderer path ever crosses IPC**: attach sends
  bytes (≤ `NOTE_ATTACHMENT_MAX_BYTES`, checked on both sides), main sniffs
  the real type from **magic bytes** (`sniffMime` + `isInlineImageMime`, pure
  TDD helpers in `@nexus/core` — SEC-FILE-02), save-as goes through main's
  native dialog, open-externally copies to a main-owned temp file with a
  sanitized name. The **`nx-blob:` protocol** (privileged-registered before
  app-ready) serves a blob only when its hash matches a registered attachment
  row, always with the stored sniffed `Content-Type` + `nosniff`, never HTML;
  the prod CSP's `img-src` now allows it. Blob GC runs on detach (last
  reference deletes the file) and on a failed add (no orphan files). Five new
  channels (`note-attachments:list/add/remove/open/save-as`,
  `assertTrustedSender`-first) + five frozen preload methods. **Review
  hardening by the supervisor:** `sanitizeFileName` let `"."`/`".."` through
  (harmless — the copy would fail on a directory target — but wrong); both now
  fall back to `"prilog"`. Core tests 110 → **122**, db 386 → **408**. Gates
  all green, run by the supervisor with `--force`: typecheck 7/7, build 3/3,
  `SMOKE OK`, post-smoke db 408 on node ABI, raw-colour grep empty. The
  editor-facing half (the "Prilozi" panel, drag-drop, chips + image previews,
  the `attachmentImage` document block) is slice 003-b — the next entry.
- **Notes (NOTE) — attachments editor UI (slice 003-b) — NOTE-003 complete** —
  committed (`fac8f46`, renderer-only), Sonnet-built + strictly verified (two
  review fixes, see below). Under every open note, an always-present quiet
  **"Prilozi"** section (same reading measure and heading recipe as "Povratne
  veze"): a "Priloži datoteku" text button (hidden multi-file input), plus one
  row per attachment — an image thumbnail where the sniffed type allows it,
  the display name (ellipsized), a locale-formatted size (`formatBytes`,
  sr-Latn, one decimal), and the house `NotePopover` "⋯" menu with
  Otvori / Sačuvaj kao… / Ukloni prilog (danger). **Drag-drop works anywhere
  on the editor body**: a wrapper `note__editor-body` div accepts `Files`
  drags with the exact kanban drop recipe (accent border + `--nx-accent-soft`
  background on a transparent-border default, so nothing shifts; no glow).
  Attaching reads the file's **bytes** in the renderer (never a path), size
  pre-flight against the 50 MB cap, then sends them over `attachNoteFile`;
  an attached **image** additionally inserts an **`attachmentImage` block
  atom** at the caret whose only durable attribute is the attachment row's id
  (ADR-014's identity pattern, same as `noteLink`): a React NodeView resolves
  the live row from context and renders the image via `nx-blob://<sha256>`;
  a removed attachment leaves a muted "Prilog je uklonjen." placeholder.
  Deleting the block never detaches — the panel is the source of truth.
  Attachment errors ride their own transient channel (`attachmentError`, its
  own `role="status"` line styled like the save error) and never touch the
  content-save channel. **Review fixes by the supervisor:** (1) the agent's
  bare `onDragLeave` cleared the drop state on every child hover — the
  wrapper is all children, so the highlight would flicker throughout a drag;
  now guarded with the house `!currentTarget.contains(relatedTarget)` check
  (KanbanView's recipe). (2) A just-inserted image block rendered the
  removed-attachment placeholder until the attach round's final refetch
  (seconds, for multi-file drops of large files); the created row is now
  appended to state optimistically before the block insert. Nine new Serbian
  strings; tokens-only CSS copying the backlinks/tag-clear/save-error
  recipes; selected image block = 2px accent outline (no glow). Gates all
  green, run by the supervisor with `--force`: typecheck 7/7, tests core
  122 and db 408, build 3/3, `SMOKE OK`, post-smoke db 408 on node ABI,
  raw-colour grep empty. Runtime visuals (Prilozi rows, drop highlight, inline images,
  Dan/Noć) await the founder's next packaged build — headless smoke can't
  render them.
- **Notes (NOTE) — version history (NOTE-008 complete, slices 008-a + 008-b)** —
  committed (`bf679f0` core + `0141475` db + `d9cffdc` desktop main/IPC, then
  `f48f223` UI), designed in
  [architecture/adr/015](../architecture/adr/015-note-version-history.md) and
  Sonnet-built + strictly verified (zero defects found in either slice — a
  first). **Substrate (008-a):** a sibling `note_versions` table (migration
  014, PK `(note_id, covered_seq)` doubling as browse index and dedupe guard)
  keeps immutable full-snapshot checkpoints while the `note_snapshots` cache
  stays untouched; capture policy lives in `main/notes.ts` — a checkpoint at
  compaction time when the newest one is older than 10 minutes, plus an
  explicit pre-restore safety checkpoint (`notes:version-capture`, merges
  only *stored* state — no renderer bytes); retention prunes to 50 per note
  in the capture transaction. `replaceNoteContent` (`@nexus/core`) implements
  restore as a **forward edit** (Yjs state is monotone — old snapshots can
  never be "loaded back"): one transaction deletes the live fragment's
  children and inserts deep clones of the version's; the existing flush
  pipeline persists it as a regular update, so title/wiki-links/plaintext all
  re-derive unchanged — restore is never destructive, exactly as PRD 09
  demands. Tests: core 122 → **127**, db 408 → **424** (store TDD; migration
  tests incl. two-level cascade). **UI (008-b):** since the app deliberately
  has no modal primitive, "Istorija verzija" is an **in-pane mode** of the
  editor — a quiet right-aligned toolbar button above the canvas toggles it
  (label swaps to "Nazad na uređivanje"); the body becomes a two-column
  browser: version list (sr-Latn timestamp + title per row, selection
  typographic-only via the `.note__folder--active` recipe — `accent-strong` +
  semibold, no fill/glow) and a hairline-bordered **read-only TipTap preview**
  of the selected checkpoint (same extensions, live wiki-link titles, live
  attachment resolution incl. the honest removed-placeholder), remounted
  per selection with a throwaway `Y.Doc`. "Vrati ovu verziju" runs
  flush → safety checkpoint → forward rewrite → back to edit mode; file-drop
  is guarded off in history mode; restore failures ride their own transient
  `role="status"` channel. Seven new Serbian strings; tokens-only CSS. Gates
  all green, run by the supervisor with `--force`: typecheck 7/7, tests core
  127 and db 424, build 3/3, `SMOKE OK`, post-smoke db 424 on node ABI,
  raw-colour grep empty. Runtime visuals await the founder's next packaged
  build.
- **NOTE-009 — templates (šabloni), COMPLETE** (2026-07-25, `d778778`,
  `62b7c77`, `21dfc49`, `581e81e`), per **[ADR-016](../architecture/adr/016-note-templates.md)**;
  Sonnet-built across three slices + strictly verified (five defects found and
  fixed in review, listed below). The design decision the rest follows from:
  **a template is not a note.** Modelling it as one (`is_template` flag) would
  have forced an exclusion filter into every existing `notes` query — list,
  folder scoping, wiki-link autocomplete, the backlink index, IMEX — turning a
  new feature into a pervasive edit of the shipped live path where one missed
  call site silently leaks templates into search or the link graph.
  **Substrate (009-a):** migration 015's `note_templates` stores `content` as
  a **JSON-encoded ProseMirror document**, not a Yjs snapshot — a template is
  never concurrently edited, so CRDT machinery would only buy a conversion at
  both ends, while PM JSON makes apply and capture one TipTap call each.
  `NoteTemplateStore.save` is an upsert on the UNIQUE `(profile_id, name)`
  index inside one transaction (naming *is* the edit mechanism — there is no
  template editor); `rename` copies `renameTag`'s collision handling exactly;
  content validation parses the JSON and requires `{ type: "doc" }`, so a
  `SyntaxError` never escapes the store. Four IPC channels with a new
  `asCappedString` validator. Tests: db 424 → **445** (18 TDD store tests +
  a migration-015 block). **UI (009-b):** a third editor mode beside Istorija
  verzija — a grouped picker (Ugrađeni / Moji šabloni), a read-only TipTap
  preview, insert, plus save-as/rename/delete. Five built-ins (Sastanak,
  Dnevnik, Recept, Predmet, Projekat) are **code constants, not seeded rows**,
  so they ship and evolve with the app and are the exact shape a profession
  pack (PRD 30) would later contribute. Insertion is a hand-off: the pane
  unmounts the live canvas, so the chosen blocks are applied by `EditorCanvas`
  once it remounts, **appended at the end** — a template never replaces or
  displaces existing content (PRD 09 §7). "Sačuvaj kao šablon" captures the
  note in the toolbar click handler, while the canvas is still mounted, and
  strips `attachmentImage` nodes (their ids belong to the source note); wiki-links
  are kept deliberately. **Slash menu (009-c):** every insertable template is
  appended to the `/` menu as "Šablon: …", inserting **at the caret** — the
  caret-precise counterpart to the pane's append-at-end. The live list reaches
  the extension through a ref, since `useEditor` keys off `[doc]` alone;
  `NoteEditor` refetches on every entry into edit mode, which is what makes
  returning from the pane refresh the menu. `TemplateEntry` + the parse/sort/
  merge of stored rows and built-ins were extracted into `noteTemplates.ts`,
  shared by both consumers. **Defects caught in supervisor review** (Sonnet
  built, all fixed before commit): missing `*Request` wire interfaces (the
  house has one per channel, 100 of them); a stale "too large" error surviving
  cancel and unrelated successful actions; a broken ellipsis recipe (`display:
  block` parent, so `overflow: hidden` had no effect on the inline name span —
  the recurring "recipe moved into a different flex/block context" class); a
  preview that kept rendering pre-save content when the *selected* template was
  overwritten (same id, so remount-by-key never fired); and a missing `margin: 0`
  where there is no global `<p>` reset. The supervisor additionally fixed a
  latent bug this slice made reachable: `SuggestionMenu` never scrolled its
  keyboard-active row into the panel's 320px window, which only mattered once
  templates pushed the list past ten rows. Gates all green, run by the
  supervisor with `--force` on every slice: typecheck 7/7, tests core 127 and
  db 445, build 3/3, `SMOKE OK`, post-smoke db 445 on node ABI, raw-colour grep
  empty. Runtime visuals await the founder's next packaged build.
- **NOTE-006 — inline flashcards (NOTE ↔ STUDY), COMPLETE** (2026-07-25,
  `e491999`, `df5a51d`, `b425685`, `0ea6730`, `539de76`), per
  **[ADR-017](../architecture/adr/017-inline-flashcards.md)**; Sonnet-built across
  four slices + strictly verified (four defects found and fixed in review,
  listed below). The requirement everything follows from: *editing the note's
  text **updates** the card, never replaces it* — so a generated card needs an
  identity that outlives every edit to its own text. **Identity lives in the
  document:** a card-bearing block carries an opaque `cardKey` attribute
  (`crypto.randomUUID`, persisted into the Yjs doc like any block attribute),
  and the reconcile key is `(profile_id, source_note_id, source_block_key)` —
  the renderer names a *slot* inside a note it already owns, never a row's
  primary key (SEC-EL-02). Content-hash identity was rejected (editing the
  front would discard the card's FSRS history — the exact behaviour this
  feature exists to prevent), as was positional identity (a paragraph inserted
  above silently re-points every card below it).
  **Parser (006-a, `e491999`):** one pure `parseCardBlock` in `@nexus/core`
  drives *both* the editor's highlighting and the persisted card set, so the
  two cannot drift. `::` requires whitespace on both sides — that single rule
  is what keeps `std::vector` and `Foo::bar` out of the card table; `{{…}}`
  yields one card per deletion (front hides only the target, back unwraps
  everything); `codeBlock` is never scanned; an over-cap side means the block
  yields *no* card, so the user sees it is not a card instead of watching a
  save fail. Core tests 127 → **147**. **Data layer (006-a, `df5a51d`):**
  migration 016 adds nullable `source_note_id`/`source_block_key` to `cards`
  under a **partial** UNIQUE index (hand-made cards keep `source_note_id
  IS NULL` and must not collide on `(profile, NULL, NULL)`) plus
  `notes.card_deck_id`; a note-sourced card is an ordinary card, so every
  existing query keeps working. `CardStore.syncFromNote` reconciles in one
  transaction: new key creates, changed key rewrites front/back/deck without
  touching FSRS state, a **returning key restores** the soft-deleted row with
  its review history (this is what makes editor undo work), a vanished key
  soft-deletes while `review_log` survives. db 445 → **472**. **IPC (006-b,
  `b425685`):** `notes:cards-sync` + `notes:card-deck-set`, built to the
  `notes:set-links` trust model. **Editor (006-c, `0ea6730`):** an
  `appendTransaction` plugin assigns keys and re-keys duplicates after a paste,
  and **never clears** one — clearing would destroy a card's history on a
  transient edit; "is currently a card" is answered by decorations over the
  same parser. The deck bar appears with the first card, offers the profile's
  decks grouped by subject, and syncs immediately on choice. Card sync joined
  the flush's **synchronous prologue** beside the title and link report (the
  doc is destroyed before the awaits resolve on unmount) and can never surface
  as a content-save error. **STUDY (006-d, `539de76`):** a note-sourced card
  withdraws edit/delete — its text is owned by the note, and the next sync
  would overwrite an edit or resurrect a delete — and offers a link back
  instead (STUDY-008), which is the app's **first cross-module deep link**.
  **Defects caught in supervisor review** (all fixed before commit): the key
  plugin selected blocks by `isTextblock` while `cardKey` exists only on
  paragraph/heading, so any future textblock (NOTE-011's callouts) would have
  made `appendTransaction` loop forever; a deck **soft-deleted** in STUDY left
  the note mapped to a deck that no longer exists (the FK's `ON DELETE SET
  NULL` fires only on a hard delete), blanking the bar and failing every sync;
  "Promeni špil" was a trap — it showed the "no deck yet" copy for a mapped
  note and could only be left by picking a deck; and note titles were fetched
  *after* the card rows rendered, flashing "(nedostupna)" on every deck open.
  The supervisor also added the two new `CardStore` types to `@nexus/db`'s
  public exports, which the slice's file allowlist had excluded. Gates all
  green, run by the supervisor with `--force` on every slice: typecheck 7/7,
  tests core 147 and db 472, build 3/3, `SMOKE OK`, post-smoke db 472 on node
  ABI, raw-colour grep empty. Runtime visuals await the founder's next
  packaged build.
- **AUTH — the local account, COMPLETE** (2026-07-26, `53ecc8d`, `b5cda31`,
  `e7cf8a2`, `e2690a5`), per
  **[ADR-018](../architecture/adr/018-local-account-passcode.md)** and the founder's
  two decisions of the same day (Recovery Kit instead of an OS-credential
  bypass — logged as **DEV-003**; and a minimum **8-character alphanumeric
  passcode**, amending AUTH-004's "minimum 4 digits"). Sonnet-built across three
  slices + strictly verified (two design gaps found in review, below).
  **The key chain (018-a, `53ecc8d`):** a random 256-bit data key encrypts the
  database; it is wrapped twice. The passcode wrap is Argon2id (64 MiB, t=3)
  followed by HKDF-SHA256 **salted with a device secret held in the OS keystore**
  — mixed in, never offered as a second route, which is what makes a stolen
  database file unattackable: without the user's Windows account there is no
  HKDF salt to even begin guessing the passcode against. The recovery wrap is
  Argon2id over the Kit code alone, deliberately **not** device-bound, because
  160 random bits need no device binding and keeping it portable is what lets
  the Kit double as the device-migration path. Argon2id comes from `hash-wasm`
  (WebAssembly, embedded base64) rather than a native module — this repo already
  flips one single-ABI binary between Node and Electron on every test run, and a
  second would double that ceremony; it sits on a separate `@nexus/core/auth`
  subpath, and the renderer bundle came out **byte-identical**. Core 147 → **193**.
  **Storage (018-a, `b5cda31`):** `encryptDatabaseInPlace` converts an install
  that predates encryption via SQLCipher rekey, and refuses any file that is not
  currently plaintext (rekeying an encrypted file does not fail loudly — it
  silently produces an unreadable one). db 472 → **480**.
  **The locked main process (018-b, `e7cf8a2`):** nothing opens at startup; `db`
  stays null until a passcode verifies, so every data channel's existing
  `requireDb()` is the single gate. `keychain.json` is written atomically
  (tmp + rename), and the **attempt counter lives inside the OS-encrypted guard
  blob** (SEC-LOC-02) rather than beside it in plain JSON. First open backs up
  the full WAL triplet, rekeys, reopens to prove the rekey took, then discards
  the backup — and a rekey interrupted by a crash is detected on the next launch
  and redone from that backup, once. Seven channels; the smoke run moved to its
  own `userData` and now rehearses create → lock → unlock → wrong passcode →
  **full device migration** against real DPAPI.
  **The lock screen (018-c, `e2690a5`):** four screens on Onboarding's shell
  (create → Recovery Kit → unlock → recover), a Kit screen gated by a confirm
  checkbox because the code is shown exactly once, a live throttle countdown
  that re-enables itself without a round-trip, manual **Zaključaj**, a
  configurable idle auto-lock, and a Sigurnost section in Settings.
  **Gaps found in supervisor review** (both in the *design*, not the agent's
  code, and both fixed): the ADR promised the Recovery Kit works on a new
  machine while every path decrypted the DPAPI-bound guard first, so recovery
  would have failed exactly where it was needed — a guard this machine cannot
  read is now treated as the migration case, the passcode refuses with a reason
  that says so instead of lying "wrong passcode", and recovery mints a fresh
  device secret to re-bind the account; and `changePasscode` verified the
  current passcode with no throttle at all, an unlimited oracle for the one
  secret an attacker at an unlocked session does not already have. The agent
  itself caught a third during verification: an idempotency shortcut that
  returned success for a *wrong* passcode once already unlocked. Copy fixes:
  the Rezervna kopija notice no longer promises encryption that has now
  arrived, and two gendered Serbian participles were made neutral. Gates all
  green, run by the supervisor with `--force` on every slice: typecheck 7/7,
  tests core 193 and db 480, build 3/3, `SMOKE OK`, post-smoke db 480 on node
  ABI, raw-colour grep empty. The founder's real database was verified
  untouched by every smoke run.
- **AUTH — encrypted attachment blobs, COMPLETE** (2026-07-26, `9c82473`,
  `f6f2406`), per
  **[ADR-019](../architecture/adr/019-encrypted-blob-store.md)**. This closes the
  one gap ADR-018 left open and recorded: attachment bytes live on disk
  *outside* the database (ADR-014 deliberately keeps them out of SQLite), so a
  stolen laptop still yielded every image and PDF a user had attached, while
  the notes around them stayed encrypted.
  **The crypto (019-a, `9c82473`):** two subkeys are derived from the same data
  key with HKDF-SHA256 under versioned `info` strings — a `contentKey` for
  AES-256-GCM and a `nameKey` for HMAC-SHA256. A blob is an **`NXB1` container**
  (magic + 12-byte nonce + ciphertext/tag) whose **additional authenticated data
  is the plaintext SHA-256**, so a file swapped between names fails the tag
  check instead of quietly serving the wrong bytes. Its **file name is the HMAC**
  of that hash, not the hash itself: still deterministic, so one file attached
  to five notes is still one file on disk, but no longer an offline
  *confirmation oracle* — before this, anyone holding the disk could hash a
  candidate document and learn whether this machine stored it. WebCrypto only,
  no new dependency. Core 193 → **215**.
  **The wiring (019-b, `f6f2406`):** encrypted blobs live in a new
  `<userData>/blobs`; the old `<userData>/attachments` becomes read-only, and
  **its mere existence is the "migration pending" signal** — a fresh install
  never has one. After an unlock, a **background** pass drains it (encrypt,
  write, then unlink — never the reverse), covered by a dual read so old
  attachments stay viewable meanwhile; it is idempotent, resumable, and stops
  the moment the app locks. A passcode change re-encrypts nothing, because the
  data key itself never changes. Nothing on the IPC wire moved: the renderer
  still asks for `nx-blob://<plaintext sha256>` and never learns a storage name.
  **Fixed in supervisor review:** the temp-copy wipe could throw and *block the
  lock itself* when a file was still open in Word (`rmSync`'s `force` forgives a
  missing path, not a busy one) — now best-effort; a background migration kept
  running past a lock, holding key material the lock was supposed to have
  dropped, and could race the pass a later unlock starts — now cancelled by
  session identity; a legacy file whose content did not hash to its own name
  would have been deleted after being stored under a name the database can never
  ask for — now left in place; and the smoke rehearsal could race the unlock's
  own background pass, which would have made the gate flaky.
  **Residual, stated rather than hidden:** opening an attachment in an external
  program must hand Windows a real plaintext file, so a decrypted copy exists
  under `<userData>/tmp-open` for the life of the session — wiped on every lock
  and at every launch. Gates all green with `--force` on both slices: typecheck
  7/7, tests core 215 and db 480, build 3/3, `SMOKE OK` — the smoke now plants a
  legacy plaintext blob, migrates it, and **verifies the on-disk bytes are an
  `NXB1` container and not the plaintext** — post-smoke db 480 on node ABI,
  raw-colour grep empty.
- **CAL — the grid views (month / week / day), COMPLETE** (2026-07-26,
  `5a0be8d`, `eb2dac0`, `4f2621a`), per
  **[ADR-020](../architecture/adr/020-calendar-grid-views.md)**. The module had a
  working agenda but no calendar — the surface that answers "how does August
  look", which is the question a student with exams in mid-August actually asks.
  **The engine (020-a, `5a0be8d`):** a new `packages/core/src/calendar` holds
  every calculation a test can check without a DOM — month grids in whole weeks
  (28/35/42 days, never a hardcoded 6 rows), week keys, day spans, **lane
  assignment for multi-day bars**, and **overlap columns for timed items** —
  all in UTC, and all generic over plain span records, so core never learns
  what an exam is. TDD, core 215 → **255**.
  **The month view (020-b, `eb2dac0`):** a shared four-source merge
  (`calendarItems.ts`) that every view including the agenda now reads, adding
  **dated tasks** as a fourth source with four toggle chips that mean the same
  thing everywhere. Multi-day items render as **one continuous bar** across the
  days they cover, lane-stacked per week row and flattened at the edge where
  they continue — not as a repeated chip per day, which is the difference
  between a calendar that reads as designed and one that reads as a prototype.
  Overflow expands the whole week row (a cell cannot grow alone without breaking
  the bars passing through it). Click an empty day to start an event there, click
  an event to edit it, **drag an event or a task to another day** — PRD 04 §8's
  acceptance criterion — with the geometry from percentages only, never a
  measured pixel.
  **Week and day (020-c, `4f2621a`):** one time grid parameterized by day count,
  with an all-day band reusing the month's own bar classes, 24 hour rows, timed
  events positioned from the engine's clamped output, a **current-time line**
  refreshed each minute, click-an-hour-to-create snapped to 30 minutes, and the
  **event end time** in the form — the field that makes a duration real, guarded
  so a bad pair never reaches the store (which throws on it).
  **Fixed in supervisor review:** an expanded week row had no way back (the
  "+N još" button that opened it disappears once open); a drop aimed at a day
  that already held something died on the bar drawn over it; the layout engine
  accepted a non-consecutive week row and would have drawn bars past the last
  column instead of failing; a cluster's column bookkeeping could desynchronize;
  the source toggles could not persist "all off"; and the slice boundary had
  left five display helpers copied into two components — now imported.
  Gates all green with `--force` on every slice: typecheck 7/7, core 255 and db
  480, build 3/3, `SMOKE OK`, post-smoke db 480, raw-colour grep empty. **The
  visuals await the founder's eye** — a headless smoke run cannot see a grid.
- **SRCH — global search, COMPLETE** (2026-07-27, `d4d8306`, `88fdc7f`,
  `65fae55`, `d822cb4`, `498a46c`, `06349bb`), per
  **[ADR-021](../architecture/adr/021-global-search.md)**. Nine kinds of entity
  (task, event, note, document, subject, exam, deck, card, attachment) in one
  index, one palette, one ranking.
  **Where the index lives (021-b1, `88fdc7f`):** an FTS5 table *inside* the
  encrypted SQLite file, so it inherits encryption at rest — an index in a
  separate file would have reopened exactly the hole ADR-019 closed. It is
  maintained by **SQL triggers on the source tables**, never by application
  code, so no import path, no future feature and no code not yet written can
  forget to index something. Migration 017 adds `search_entries` (display text
  plus folded text plus `parent_id`, `context_date`, `updated_at`) and a
  contentless `search_fts`, **one projection VIEW per kind** read by both the
  triggers and the backfill — so "what a live edit indexes" and "what a rebuild
  produces" cannot drift — and nine trigger sets including the refreshes that
  keep derived titles honest (renaming a subject re-titles its exams).
  **The Serbian analyzer (021-a, `d4d8306`):** probed against the shipped
  SQLite 3.53.2, `remove_diacritics 2` folds `č ć š ž` but **not `đ`** (a letter
  with a stroke, not a combining mark) and nothing for Cyrillic. So folding is
  ours: lowercase → NFD → strip combining marks → an explicit table for `đ→dj`,
  the digraphs, and the whole Serbian Cyrillic alphabet. Index and query both
  pass through it, so `Đorđe`, `djordje` and `Ђорђе` meet at `djordje`. Folding
  is **for matching only, never storage** (it is lossy — `č` and `ć` both become
  `c`), and a parallel offset map lets highlights be drawn over the *unfolded*
  text. Plus the query parser (everything typed is FTS5 *syntax* until proven
  otherwise), Serbian kind prefixes (`z:` zadaci, `b:` beleška, …), and ranking.
  **Ranking (021-a/021-b2, `65fae55`):** `bm25()` is corpus-dependent — about
  −2e-6 with one document, about −1 with a real corpus — so it is normalized
  *within* the returned set and then combined with an exponential recency decay,
  a per-kind prior, and title exact/prefix boosts. `SearchStore` also owns
  `recent` (no query typed yet) and `rebuildSearchIndex`.
  **Plumbing (021-c, `d822cb4`):** three validated IPC channels behind the
  frozen preload bridge. It also fixed a freshness bug the design surfaced: a
  note's searchable body comes from its snapshot plaintext, which was only
  written every 32 Yjs updates — a 2 s idle debounce now compacts too (cancelled
  on lock and quit), so an edit is searchable within a second.
  **The palette (021-d, `498a46c`):** Ctrl+K opens a Spotlight-style overlay —
  debounced search, kind chips, grouped results with snippets, full
  combobox/listbox keyboard semantics, and commands behind a leading `>`. That
  `>` is a **documented deviation** from PRD 08 §3's "letter plus space" prefix,
  because a bare letter plus a space is indistinguishable from a real search
  ("u sredu").
  **The reveal (021-e, `06349bb`):** every page now takes **one intent prop**
  plus an `onIntentHandled` callback instead of a prop per kind, so a result
  lands on the exact row, not merely the module — and STUDY routes into a card's
  deck drill-in and opens the archived section for an archived subject before
  marking it. NotesPage's old `targetNoteId`/`onTargetOpened` pair (the ADR-017
  STUDY → note link) migrated onto the same mechanism, so the shell has **one**
  idiom. Adds three quick-create commands, gated on their module being enabled.
  **Fixed in supervisor review:** a decay constant whose name promised a
  half-life the formula does not compute; `Math.min(...array)` that throws on a
  large result set; a prototype-chain lookup that let `__proto__:` be read as a
  kind filter; a catch so broad that a locked database told the user their
  *query* was malformed; an idle-compaction timer whose throw would have taken
  the whole main process down (edit a note, delete it within two seconds); a
  kind-filtered query with no matchable terms that answered "only my tasks" with
  everything; a palette panel that rendered 70vh tall no matter how little was
  in it; a stale-response race when `>` was typed in front of a query already in
  flight; a reveal mark that could only ever fade *in*, and whose background lost
  the specificity tie on a subject card; and a focus restore that yanked focus
  straight back off the input a "Novi zadatak" command had just focused.
  Gates all green with `--force` on every slice: typecheck 7/7, core 309 and db
  516, build 3/3, `SMOKE OK`, post-smoke db 516 on node ABI, raw-colour grep
  empty. **The palette's visuals await the founder's eye**, like the calendar's.
- **Note text derivation, fixed** (2026-07-27, `8723dbb`, `8f6ae3b`, `ed06d2c`)
  — found while surveying the export for the IMEX slice, and worth recording
  because it had been shipped for a while. `Y.XmlText.toString()`, which both
  note walks used to read a run of text, serializes **marks as pseudo-XML**:
  bolded text comes back as `<bold>text</bold>`, a link as
  `<link href="…">text</link>`. So both walks were deriving markup and storing
  it as text. Two victims: **search** (that string is `note_snapshots.plaintext`
  → migration 017's note projection → the FTS body and the palette's snippet, so
  a bolded phrase could not be matched across the mark boundary and the tags
  were visible in results) and, worse because it is *visible content*,
  **flashcards** (the same leak lands verbatim on the front/back a user then
  studies — a code-marked answer stored as `<code>std::vector&lt;int&gt; v;</code>`).
  The plaintext walk was wrong in two further ways: only *top-level* blocks were
  newline-joined, so a bulleted list fused into one unsearchable token
  (mleko/hleb/jaja → `mlekohlebjaja`), and a `hardBreak` vanished, fusing the
  words on either side. It now walks blocks recursively — one line per non-empty
  block, with an explicit *inline* allow-list (`noteLink` contributes its label,
  `hardBreak` a newline) chosen in that direction on purpose: forgetting a future
  block node there would silently fuse text, forgetting an inline one merely
  breaks a line early. The card parser keeps its own separate walk — it has to
  mirror ProseMirror's `textContent`, because the editor's decorations parse that
  and ADR-017 promises the two agree on the same string — but both now read a
  text run through one shared helper, since that part is a fact about Yjs rather
  than a policy either caller gets an opinion about. **Existing data heals
  itself:** neither derivation is recomputed unless a note is edited again, so a
  `healNotes` sweep runs once per unlock over every note of every profile
  (unawaited, session-identity-guarded so a lock stops it, yielding between
  notes), merges each note's persisted state once and repairs both derivations
  from it — writing only on a real difference, so a healed note never touches the
  FTS triggers again. Its card half deliberately **never syncs an empty parse**:
  `syncFromNote` soft-deletes cards whose keys the specs no longer carry, which
  is right from the editor and catastrophic from a background re-read that failed
  to parse. Gates: typecheck 7/7, core **321**, db **518**, build 3/3,
  `SMOKE OK`, post-smoke db 518 on node ABI, raw-colour grep empty.
- **Settings search + first-day-of-week (SET-014 / PRD 04 §5, wave-1 Lane B,
  2026-07-30, `5046045`)** — a search field atop Podešavanja filters the
  section cards through a declarative index (`settingsSearch.ts`: one entry per
  control with modest Serbian synonyms, plus one per registered module so
  "učenje" lands on the gallery row that toggles it), folding-aware on both
  sides via the same `foldSearchText` the palette uses; matched labels
  highlight typographically (accent + weight). Filtered-out sections hide with
  CSS but stay **mounted** — unmounting would discard a restore preview's open
  archive, a half-typed passcode, or unsaved quiet-hours edits on a keystroke
  (a supervisor correction to the agent's honest self-report). Izgled gained a
  "Tema" caption (two segmented rows need naming) and **"Prvi dan nedelje"**
  (Ponedeljak/Nedelja, `weekStart.ts` on the theme/accent localStorage idiom);
  the calendar reads it on mount — page switching remounts — and threads it
  into `monthGridDays`/`weekDayKeys`, whose first returned week already drives
  the weekday header row.
- **Search operators `#oznaka` and `rok:`/`due:` (wave-1 Lane A, 2026-07-30,
  `7eaa05e`, ADR-030)** — the Ctrl+K grammar carries tag filters (AND across
  tokens, prefix over folded space-stripped names, so `#moj` reaches "moj
  posao") and a closed date-filter set (`danas|sutra|nedelja|YYYY-MM-DD`,
  sr + en, leap-aware; unknown/unreal values stay plain search text, last
  filter wins). Core parses structure only; a new pure `searchOperators.ts`
  resolves presets against a passed-in today and post-filters candidates —
  tags are deliberately NOT in the FTS index, so main joins per-token id sets
  from the two tag stores at query time (tag renames need no reindex) and
  reduces ISO context dates to their LOCAL day so `rok:danas` agrees with the
  calendar. Operator queries widen the candidate ask to the store's cap of
  200; an operator-only query keeps `recent`'s recency order per contract.
  The palette suggests tags (both modules' vocabularies merged, sr-Latn
  collation) while a `#` token is typed — picking completes the token via the
  shared `foldSearchTag`, so a suggestion can never complete into a token that
  matches nothing — and the footer names the whole grammar. No schema,
  trigger, or IPC change. Gates: typecheck 7/7, core **832** / db 701 /
  desktop 40, build 3/3, `SMOKE OK`, post-smoke db 701 node ABI, grep 0.

- **Task attachment names in search (wave-2 Lane D, 2026-07-30, `0beed9b`,
  ADR-032)** — searching a filename surfaces the TASK carrying it, deliberately
  not a tenth search kind (a note's file has a destination of its own — the
  Prilozi panel — while a task's files live only inside the edit form, so the
  task IS the destination). Migration 025 swaps `search_source_task` in place
  (order-stable filename concat, untrimmed so an attachment-less body stays
  byte-for-byte 017's, one 8000 cap over the whole body), adds three
  `task_attachments` triggers refreshing the parent task's entry, and
  re-projects the task kind once so databases that already ran 024 index their
  existing filenames. Tests pin the cascade/soft-delete resurrection classes,
  the ordering, the cap, the stopped-one-short upgrade path, and rebuild
  parity.
- **Time-grid drag & resize (wave-2 Lane F, 2026-07-30, `8b1a709`, ADR-034)** —
  timed events in Nedelja/Dan move by pointer (15-min snap, duration
  preserved, cross-day via a translateX ghost in the block's own column
  units — the overlap layout is never recomputed mid-drag) and resize from a
  bottom-edge handle (minimum 15 min; a point event gains an `endAt`); Escape
  cancels while keeping the pointer capture so the trailing click cannot
  create an event under the hand; a 4 px threshold keeps plain clicks opening
  the editor. The drag maths is pure core (`timeGridDrag`, 33 tests; a day
  deliberately ends at 23:59 — the wall-clock format cannot write 24:00). A
  dragged occurrence asks the existing scope dialog, whose move variant now
  carries minutes ("Svi" adopts the new time of day); create-before-except
  preserved. `78c7c5d` additionally fixed a pre-existing specificity bug the
  lane's agent reported: today's grid header rendered bold-but-muted because
  `button.cal__grid-header` outweighed `.cal__grid-header--today`. Gestures
  await the founder's visual pass. Gates: typecheck 7/7, core **881** / db
  **742** / desktop 40, build 3/3, `SMOKE OK`, grep 0.

- **NTF-008's one-time appetite ask (wave-2 Lane E, 2026-07-30, `4c96924`,
  ADR-033)** — the first time the scheduler is genuinely about to remind a
  profile whose question is unanswered, and only while the window is visible,
  it holds the whole cycle (nothing recorded — holding is free for the
  quiet-hours reason, everything re-derives) and pushes one payload-free ask;
  a hidden window gets its reminder instead and the ask waits for the next
  visible moment. "Deliverable survivors" includes due snoozed re-fires,
  computed before anything is written. The dialog answers on every path and
  an immediate post-answer check fires the held reminders under the chosen
  appetite. `NOTIFICATION_PRESETS` moved beside `ALL_NOTIFICATION_SOURCES`
  (one source of truth for both surfaces); main's stale respelled source list
  replaced by `@nexus/db`'s export. Migration 026; the flag deliberately does
  not travel in archives. Gates: typecheck 7/7, core 881 / db **752** /
  desktop 40, build 3/3, `SMOKE OK`, grep 0. The dialog itself awaits the
  founder's eye — note it can only be seen once per profile, so any copy
  change must land before he triggers it.
- **DEVTOOLS — „Programerske alatke", 48 tools (2026-08-09/10)** — a second tool
  host beside „Alatke", registered as its own module and **off unless the user
  says they write software**. Logic in `packages/core/src/devtools/*` (13 pure,
  exhaustively tested modules, exported as `@nexus/core/devtools/*`); 48 surfaces
  in nine files under `renderer/src/devtools/`, every one of them assembled from
  the primitives in `shared.tsx`; Serbian copy split per group into
  `renderer/src/strings/devtools.*.ts`. Groups: **numbers** (bases, integer
  inspector, bitwise, data units, floating point across the **13** formats
  `fp64`, `fp32`, `tf32`, `bf16`, `fp16`, `fp8-e5m2`, `fp8-e4m3`,
  `fp8-e5m2fnuz`, `fp8-e4m3fnuz`, `mxfp6-e3m2`, `mxfp6-e2m3`, `mxfp4` and the
  `e8m0` scale, plus microscaled blocks), **RISC-V** (assemble and disassemble RV32/RV64 including
  the C extension, the register file, CSR names), **encode/decode** (base64, URL
  escaping and parsing, the four byte views, Unicode inspection, HTML entities,
  hexdump both ways), **text** (diff, case, slug, regex with a nested-quantifier
  guard, lorem, markdown tables, line tools), **data** (JSON/YAML/TOML/CSV
  conversion, JSONPath, XML, JSON→types, UUID/ULID), **design** (colour
  conversion and palettes, gradients, cubic-bézier, WCAG contrast, mixing),
  **time** (epoch, cron, duration, time zones), **system** (CIDR, semver, QR,
  path and mail helpers), **cryptography** (tokens, passwords and passphrases,
  JWT, hashing, AES, RSA/EC keygen, RSA-OAEP, signatures). No tool reaches the
  network, none writes to the database, so the drawer needs no migration and
  travels in no archive.
- **PRO — „Stručne alatke", 18 toolkits (2026-08-13/14)** — the drawer above
  generalised: `devtools` became the `pro` module, a tool reaches the drawer
  through `packs` rather than through its category, `riskClass` is a required
  field that draws its own notice and its own copy suffix, and migration 65
  carries existing profiles across. The contract, the questionnaire screen, the
  pack picker and the disclaimer wall are **committed and green**. The
  arithmetic for the seventeen new toolkits — **274 tools, ~43 000 lines against
  1 991 hand-derived assertions**, plus the shared `pro/result.ts` kit and the
  `check:pro-math` gate — is **committed** (`e977094`, `29ee1e4`, `b90b991`,
  local). The renderer surfaces and Serbian copy are **written but not wired**;
  see §3 for exactly what is left.

---


---

## §4 — What remains, as it stood

This is the honest, centralized list of everything not yet built, so it is never
scattered across the code. Each is a **whole** piece of work to be done completely
when its turn comes — not a half-feature left dangling.

**Finishing the Calendar (CAL)** — the **grid views are done** (2026-07-26,
[architecture/adr/020](../architecture/adr/020-calendar-grid-views.md); month, week
and day, the four-source overlay with toggles, drag-to-move, the event end time
— see §2). What is left, with context:

- **Subscription renewals (FIN) in the overlay** — the FIN module does not exist;
  the merge is written so a fifth source is one more branch.
- ~~Birthday/anniversary yearly recurrence (CAL-007)~~ — **done 2026-07-30**
  per [architecture/adr/026](../architecture/adr/026-people-lite-birthdays.md)
  (`a5497f4` + `5a524f8`): the people-lite store the founder decided on
  (migration 020 — a yearless (month, day) pair plus an optional year, never a
  fake date string), a pure birthday expansion that CLAMPS Feb 29 to Feb 28 in
  non-leap years (deliberately not the event engine's skip rule — a person born
  on the 29th has a birthday every year), a fifth calendar source with the age
  turned on each bar, the sixth Calendar view **Ljudi** (add/edit form, Serbian
  collation, delete + undo; a row shows the CURRENT age, read off the most
  recent celebration), Dashboard's Danas, and the interchange's first minor
  bump (1.1.0 — the `person` record type; an old archive still restores, a 1.0
  reader refuses ours rather than silently dropping people). ~~Recurring events
  (CAL-001)~~ — **done 2026-07-29** per ADR-024 (see the TASK section).
- ~~The shared personal↔business overlay with origin markers (CAL-005)~~ —
  **done 2026-07-31** with the business profile itself (ADR-058 slice c,
  `b98165c`): `calendarOverlayStore` is the cross-profile read, the overlay
  obeys the active-profile rule, and search is gated the same way. **This entry
  was stale** — it still said "there is no business-profile creation UI yet",
  which stopped being true when ADR-058 landed.
- ~~Wiring document/event reminders into NTF (CAL-006)~~ — **done 2026-07-29**
  per [architecture/adr/025](../architecture/adr/025-event-reminders.md)
  (`af8bf6c` + `7eba834`): events carry a reminder ladder in minutes
  (`reminder_offsets`, store-gated caps), the notification engine gained a
  minute-granular due model beside its morning-hour one (a timed reminder fires
  at start − offset and stays relevant until the start — missed-while-closed
  still fires, started never does; all-day degrades to the morning-hour model),
  migration 019 rebuilt the two `source` CHECKs for the fourth source
  `"event"`, the scheduler expands recurring masters one row per occurrence
  over exactly the window the longest lead time can reach, and the event form
  grew the "Podsetnici" chip row whose ladder rides through every series flow.
  Appetite presets now put event reminders in every tier.
- ~~Drag and resize *inside* the time grid~~ — **done 2026-07-30** (`8b1a709`,
  wave-2 Lane F, [architecture/adr/034](../architecture/adr/034-time-grid-drag.md)):
  timed events move (15-min snap, duration preserved, cross-day in the week
  view) and resize (bottom-edge handle; a point event gains an `endAt`) by
  pointer, with a ghost preview, Escape cancel, a 4 px click threshold, and the
  drag maths as a pure core module (`timeGridDrag`, 33 tests). A dragged
  occurrence asks the existing Samo ovaj / Ovaj i budući / Svi dialog, whose
  move now carries minutes; create-before-except ordering preserved. Pointer
  gestures await the founder's visual pass; keyboard rescheduling remains the
  edit form (recorded in ADR-034).
- ~~A first-day-of-week setting (PRD 04 §5)~~ — **done 2026-07-30** (`5046045`,
  wave-1 Lane B): "Prvi dan nedelje" (Ponedeljak/Nedelja) in Settings → Izgled,
  stored in `weekStart.ts` on the theme/accent localStorage idiom; the month
  grid and week view thread it into the layout engine's existing parameter, and
  the weekday header row is read off the first returned week so header and rows
  cannot disagree.

**Finishing Tasks (TASK)** — **recurrence is in progress** per
[architecture/adr/024](../architecture/adr/024-recurrence.md) (2026-07-29): the
pure rule engine — daily/weekdays/weekly-by-days/monthly-date/monthly-ordinal/
yearly, interval + never/until/count ends, skip-never-clamp semantics, 100
table tests — landed in `packages/core/src/recurrence` (`4c106a8`), and
migration 018 + the store semantics landed in `@nexus/db` (`90b7d71`): tasks
advance **in place** on `completeOccurrence` (the Todoist model — due date
moves, a count ticks down, the task and every live subtask reset to open;
`setDone(true)` and `update({status:"done"})` both refuse on a recurring task
so no legacy path can silently end a series), events are series masters with
`addRecurrenceExdate` and the this-and-future `splitRecurrence` primitive, and
the interchange/restore carry the new fields as required members. **Slices c and d are done too, completing TASK-006 and CAL-001's
recurrence clause** (`528b152` + `f7f9884`): three allowlisted channels
(`tasks:complete-occurrence` as the single completion path for every task,
event exdate/split), the shared "Ponavljanje" picker in both forms (the task
page grew the house create/edit form around its quick-add — it had no due
date/priority/edit surface at all), virtual expansion of series masters in
`calendarItems.ts` over exactly the visible range (all four views + agenda +
Dashboard's Danas inherit it from the one merge), the explicit Samo ovaj /
Ovaj i budući / Svi dialog on edit/delete/drag of an occurrence (create-
before-except ordering so an interruption duplicates recoverably instead of
vanishing an occurrence), the ↻ marker, and the "Sledeći put" advance
notice. Visuals await the founder's eye. Beyond recurrence, the module has since
gained tags, lists/sections, per-task reminders — and **file attachments,
done 2026-07-30** (`16cefe4`, wave-1 Lane C, [architecture/adr/031](../architecture/adr/031-task-attachments.md)):
migration 024 mirrors `note_attachments` verbatim, one shared encrypted blob
store with the reference-count union hoisted into a single main-side
`blobRefCount` (a desktop test proves a blob referenced only by a task
attachment survives a restore undo), `task-attachments:*` channels whose
`add` carries no bytes and no path (main owns the native picker, stats
before it reads, sniffs the mime, stamps the clock), interchange 1.4.0 →
1.5.0 with one `blobs/` namespace deduped across both modules, and the
"Prilozi" section on the task edit form plus the muted count chip on rows
and kanban cards. **Templates are done 2026-07-30** (`d6c28a2`, wave-3 Lane G,
[architecture/adr/035](../architecture/adr/035-task-templates.md)): a template is
a saved SHAPE of one task — migration 027's `task_templates` holds one
validated JSON payload per name (naming IS the edit mechanism, the ADR-016
rule), deliberately relative and by-name where an absolute value would rot
(`dueOffsetDays` from the apply day, tag NAMES re-resolved through
get-or-create, one level of direct subtask titles); capture and apply both
live in main (the renderer sends only ids and a name), apply is one
transaction; interchange 1.5.0 → 1.6.0 with a nested-payload parser twin;
UI = "Sačuvaj kao šablon" in the row's ⋯ menu (which now always renders) and
a toolbar "Šabloni" popover applying into the current list. **Dependencies are done
2026-07-30** (`72c94e2`, wave-4 Lane I,
[architecture/adr/037](../architecture/adr/037-task-dependencies.md)): directed
edges in migration 029's pair-keyed join table (links survive soft delete so
undo restores a task still blocked and still blocking), self-edges and cycles
refused by a recursive-CTE walk that deliberately includes soft-deleted edges
(a loop must not be assemblable while one link is hidden by the undo bar);
"Blokiran" is derived, drawn as a muted outlined chip on rows and cards, and
never enforced — completing a blocked task simply works; the archive parser
carries a DFS twin of the cycle guard (one error per loop, with a line);
edit-form "Zavisnosti" block whose picker never offers what the store would
refuse. Interchange 1.7.0 → 1.8.0. **Batch operations are done
2026-07-30** (`29af419`, wave-5 Lane K,
[architecture/adr/038](../architecture/adr/038-task-batch-operations.md)): an
explicit "Izbor" mode over the list view (row click toggles; edit/drag/
checkbox suspended; drop-target-recipe selection), an action bar with
Premesti…/Prioritet…/Rok…/Obriši — no bulk complete by design (per-task
dialogs cannot be answered once for N) — five one-transaction TaskStore bulk
methods over the existing single-row primitives, atomic refuse-on-any-error
naming the offending id, bulk delete under one shared `deleted_at` feeding a
widened single-pending-undo, and a Premesti guard that refuses to tear a
picked subtask from an unpicked parent. The store also supports bulk move
into a *section*, which the UI deliberately does not offer yet (recorded).
**Every S item of TASK is now done.** The 2026-07-31 audit reopened three **M**
items previously misrecorded as done-or-C; **two of the three landed the same
day (wave 16):** ~~TASK-003 smart lists~~ — **done** (`419ecf0`, ADR-049; see
the header) · ~~TASK-002's OS-level global hotkey~~ — **done** (`1a2eb6c`) ·
~~TASK-001's missing `startDate` input~~ — **done** (rode with ADR-049;
Danas/Sledećih-7-dana exclude not-yet-started tasks). ~~TASK-005's other
views~~ — **done across two ADRs**: ADR-050 (2026-07-31, migration 038,
interchange 1.16.0) brought kanban groupBy status/priority/section, the cards
view, the task calendar and persisted per-list `view_config`; and its last
clause — **configurable columns** — landed 2026-07-31 (`72b86da`, ADR-060,
interchange **1.24.0**): per-list `hiddenColumns`/`columnOrder` in the
grouping's own key vocabulary, the „Kolone" popover + „Sakrij kolonu" ⋯ menu,
the „Skrivene kolone: N" chip (hiding is a view fact — rows keep counting
everywhere else), stale section ids pruned page-side so a deleted heading
cannot sink an unrelated write. **TASK-005 is whole**; only the C items remain.
*Context:* the core task model and every TASK view are done.

**Notes (NOTE) — the remainder** — the **storage substrate (slice a1), the
block-editor UI (slice a2), the organization layer's data + IPC (slice a3a),
and the full organizer UI — folders/pinning (a3b-1) and tags (a3b-2; NOTE-002's
folder/tag/pin core — **correction 2026-07-31:** NOTE-002 also names a note
*category* and a *per-folder default view* (list/cards), neither in the schema
at the time; **the view half has since landed** — migration 039's
`note_folders.default_view` (an `ALTER TABLE ADD COLUMN` with a CHECK, since
this table is a parent three times over and a rebuild would fire foreign-key
actions inside the migration transaction), `NoteOrgStore.setFolderView` as the
gate above that floor, the middle pane opening in the views engine's `CardsView`
(ADR-050) when a folder says so, and the column travelling in the archive; the
ROOT selections ("Sve beleške" / "Bez fascikle") deliberately get no storage —
a folder's view travels with the profile because the folder does, while the root
is a place in the UI, so its view is a device pref. ~~Only the note **category**
half stays open~~ — **the category shipped 2026-08-01** (`208c628`,
[architecture/adr/072](../architecture/adr/072-note-categories.md), migration 049,
interchange 1.27.0), so **NOTE-002 is now whole**: exactly one optional flat
category per note — what KIND of thing it is, against the folder's *where* and
the tag's *what about* — with that three-axis definition written into the store
so it is not later "simplified" into tags. Delete follows the folder
(`SET NULL`), name uniqueness follows the tag (folders turn out to have none,
correcting our own brief), creation REFUSES a taken name instead of
get-or-creating (a tag serves a free-text input where re-typing means „that
one"; a category comes from an explicit form where silently returning somebody
else's row shows no new row and no error), and foreign import ABSORBS by name
because a category carries no payload to overwrite while every note that named
it points at it. The filter ORs across categories and ANDs with tags — ANDing
two categories over a one-per-note column could only ever return nothing)
complete) — are done** (a1: migration
010's `notes`/`note_updates`/`note_snapshots`, `NoteStore`, `mergeNoteState`,
the `notes:*` IPC surface, main-side compaction; a2: the `NotesPage` +
`NoteEditor` TipTap page, Serbian slash menu, markdown shortcuts, token-styled
blocks, and the debounced Yjs write path — the module is now registered and
visible; a3a: migration 011's `note_folders`/`note_tags`/`note_tag_links` +
`notes.folder_id`/`pinned`, `NoteOrgStore` beside a folder/pin-aware
`NoteStore`, and the 14-channel organization IPC surface + frozen preload
bridge; a3b-1: the three-pane `NotesPage` with the `NoteOrganizer` folder tree
(inline CRUD + swatch recolour), per-note pin + move-to-folder, and the
fixed-position `NotePopover`; a3b-2: the Oznake filter-chip section with tag
CRUD, per-row tag chips, and the per-note attach/detach menu; see §2), against
the design fixed in
[architecture/adr/012](../architecture/adr/012-note-editor-and-substrate.md)
(TipTap v3 + Collaboration, a deliberately small v1 block set); **wiki-links +
backlinks (NOTE-004) are also done** per
[architecture/adr/013](../architecture/adr/013-note-wiki-links.md), and
**attachments (NOTE-003) are done** per
[architecture/adr/014](../architecture/adr/014-note-attachments.md) (see §2/§3;
PDF/Office *inline preview* is deliberately deferred to the DOC pipeline —
non-image attachments open externally for now). **Version history
(NOTE-008) is done** per
[architecture/adr/015](../architecture/adr/015-note-version-history.md) (see
§2/§3). ~~Tiered age *thinning* of old checkpoints beyond the 50-row window~~ —
**done 2026-07-31** (`7eafe8b`,
[architecture/adr/070](../architecture/adr/070-note-version-thinning.md)): the flat
window failed in both directions on ordinary use (one hard afternoon evicted
months; a note edited twice a year kept two checkpoints two years apart), so
retention is now every checkpoint from the last 24 h, one per hour for a week,
one per day for a month, one per week beyond — newest-in-bucket wins, and a
note's OLDEST surviving checkpoint is never dropped. The schedule is a pure
clock-parameterized function in `@nexus/core`, applied in the same transaction
as the insert (the `PrivateNoteStore.writeVersion` shape). The 50-row cap stays
a backstop and, when it binds, COARSENS the schedule a rung at a time (spans
halved, buckets doubled) rather than truncating the tail — which would have
restored the very defect being fixed; each rung is a strict coarsening, so the
answer stays idempotent, and it deliberately overshoots (lands under the cap,
not on it). Thinning lives strictly inside `captureVersion`, so a restore —
which INSERTs version rows directly — returns a history in exactly its exported
shape (pinned by a 164-row three-year fixture), and a row whose `created_at`
will not parse is never offered to the schedule and so never deleted. The
private note store keeps its own fixed seq-ordered keep-count **on purpose**:
`created_at` is one of only two cleartext facts a sealed version row has, so
thinning it by age would turn retention itself into a timing side-channel. **Templates (NOTE-009) are
done** per [architecture/adr/016](../architecture/adr/016-note-templates.md) (see
§2/§3). Two things ADR-016 deliberately left out of v1, recorded here so they
are not lost:

- ~~Default new-note template per folder (PRD 09 §5)~~ — **done 2026-07-30 as
  the whole NOTE-preferences pass** (`bd14282`, wave-3 Lane H,
  [architecture/adr/036](../architecture/adr/036-note-preferences.md)): migration
  028 puts `default_template_id` (deliberately no foreign key — the id may
  name a built-in code constant, now shared via `@nexus/core`'s
  `BUILTIN_NOTE_TEMPLATE_IDS`; a dangling id quietly means "no template") and
  the `is_capture_default` singleton (store transaction + a partial unique
  index guarding the restore path; the parser names a double claim by line) on
  `note_folders`; create-then-apply rides the Šabloni pane's exact insert
  path, keyed to the created note's id; the palette's "Nova beleška" files
  into the capture folder (read fresh over IPC) and the two features compose.
  Editor width (one `--note-measure` variable now feeds every pane that
  hard-coded 70ch) and the markdown-shortcut toggle (TipTap `enableInputRules`
  — the slash and `[[` menus are Suggestion plugins and keep working) are
  device-local localStorage prefs in a new Settings "Beleške" card, wired into
  settings search. The capture folder's row mark is a muted dot, not ✦ — the
  brand glyph means "active nav" (supervisor design fix). Interchange 1.6.0 →
  1.7.0 with era flag `writesNoteFolderPrefs`.
- **Template folders/categories.** The picker's two groups (Ugrađeni / Moji
  šabloni) carry v1's handful without hierarchy; PRD 30's profession packs
  contribute built-ins through the same constant shape when that module lands.

**Inline flashcards (NOTE-006) are done** per
[architecture/adr/017](../architecture/adr/017-inline-flashcards.md) (see §2/§3).
Three things ADR-017 deliberately left out of v1:

- ~~**Explicit cloze numbering (`{{c1::…}}`).**~~ — **done 2026-07-31**
  (`88d330a`, [architecture/adr/068](../architecture/adr/068-explicit-cloze-numbering.md),
  migration **047**, interchange **1.26.0**). The exclusion's own condition
  („until STUDY has a real cloze card type there is nothing to number for")
  expired with ADR-042. A deletion is now identified by a NUMBER under one
  closed rule — its `{{cN::…}}` label when it has one, else `position + 1` —
  chosen so the implicit reading and the explicit spelling are the *same*
  numbering, which is why materializing labels into an existing text can never
  move a card onto another card's history. Repeated numbers are one card with
  two blanks (Anki's behaviour, and forced anyway by the (text, number) key).
  Migration 047 rebases every row by +1 with three `UPDATE`s and **never a
  rebuild** — ADR-042 proved a rebuild of `cards` cascade-deletes the entire
  `review_log` — and moves the note-derived reconcile key in LOCKSTEP with the
  ordinal, off the SUFFIX rather than the ordinal so it also catches the
  pre-031 row that is still `kind='basic'` with a NULL ordinal and a `#0` key;
  three statements because `cards_source_block` is UNIQUE and SQLite checks it
  per row mid-statement, so the keys park in a `#~N` namespace first. Era flag
  `writesClozeNumbers` is the first one about a field's *meaning* rather than
  its absence. Mod-Shift-C / the slash menu / „Dodaj prazninu" assign max+1,
  never the lowest unused (reusing a freed number is the exact swap this
  prevents), and `.apkg` now keeps Anki's own `cN` instead of flattening to
  position — which retires the `cloze-ordinal-reused` refusal as unreachable
  vocabulary. An unlabelled text behaves exactly as before, pinned by a
  compatibility block that re-derives every card independently.
- **A cards panel inside the editor.** The note already shows which blocks are
  cards through their styling, and the deck bar names the deck and the count; a
  per-note list with due dates would duplicate STUDY's deck view inside NOTE.
- **Generation beyond the two markers** — cards from headings/sections, or
  "turn this checklist into cards". Structure-derived generation belongs with
  NOTE-007 (note → canvas), not here.

~~Remaining in PRD 09: **"Vizuelizuj na canvas" (NOTE-007)**, which pairs with
CANV and is blocked on it.~~ — **done 2026-08-01** (`90d2695`, CANV slice c,
[ADR-079 §13](../architecture/adr/079-canvas-engine.md)). It landed from the CANV
side rather than the NOTE side, and that turned out to be the right shape: a
card is an Excalidraw embeddable whose `link` is a `nexus://note/<id>`
reference, so one mechanism serves notes, tasks and events alike instead of NOTE
growing a canvas exporter of its own. „Dodaj karticu" on the board is the
surface; nothing was added to the note page. **PRD 09 is whole.** Notes also join the IMEX export interchange in a
later slice — a document-shaped record type beside the row-shaped ones; whether
`note_versions` and `note_templates` ride along or are deliberately excluded
gets decided there (ADR-015/ADR-016).

**Study Hub (STUDY) — later extras** — Anki `.apkg` import (lands with IMEX);
problem/practice card type. ~~Cloze card type~~ — **done 2026-07-30**
(`ebc80ad`, wave-8 Lane O,
[architecture/adr/042](../architecture/adr/042-cloze-cards.md)): migration 031's
`kind`/`cloze_text`/`cloze_ordinal` (the template is the SOURCE; rendered
front/back are kept and re-derived by the store on every write, so search,
palette, deck rows and exports needed no change), the `{{…}}` grammar
extracted into one pure core module shared by the editor decorations, the
note generator, the store and the reviewer; the reviewer shows the blank in
context and, on reveal, the answer in the same place; the deck editor's
Osnovna/Cloze toggle creates all siblings atomically (independent rows
afterwards — a recorded divergence from Anki's linked siblings); note-derived
`{{…}}` cards upgrade in place, lazily, on their note's next sync with FSRS
history intact; interchange 1.10.0 carries the kind with no era flag. The
`.apkg` shape is now faithful (template + ordinal per sibling). *Merge-time
finds worth knowing:* the 021 table-rebuild pattern would have **deleted all
FSRS review history** (`review_log`'s `ON DELETE CASCADE` fires inside the
migration transaction where `PRAGMA foreign_keys` is a no-op) — the lane
proved it and used `ALTER TABLE`, pinning both hazards with tests; and
same-millisecond sibling creation used to list in random order (uuidv7's
sub-millisecond bits are random), fixed for both manual and note-derived
cards.
*Context:* the module itself is **whole** — subjects/exams, FSRS flashcards
(data + UI), the exam planner (engine, data layer, UI, calendar-agenda block
merge), stats/focus/streaks (data + UI), and the catch-up replan are all done
(see §2). `PlanStore.sync` relabels overdue blocks `missed` and regenerates
future ones; a missed block later marked done (late completion) returns its
minutes to the pool on the next sync (§5 records the founder's decision).
**The 2026-07-31 planner recon reopened STUDY-003/004/005's unmet clauses,
and ADR-063 closed them the same day in two slices** (`9b08017` data +
`ee5f853` UI — see the header): topics with rank/confidence/deck links,
per-weekday hours, spaced revision passes, capacity-capped redistribution
whose overflow is a REPORTED number (the old no-cap behaviour survives only
for zero-topic plans), explicit scope-cut proposals the machine never
applies on its own, and a recall-over-weakest-topics exam week with its own
visual mode. ~~Remaining planner refinements: an un-cut store path and a stale
deck link surfaced~~ — **both done 2026-07-31** (`2f42c4b`, ADR-067):
`PlanStore.restoreScopeCut` as the exact mirror of `acceptScopeCut` (so `cut`
has one writer per direction and `TopicStore` still has none), the
`topics:restore-to-plan` wire deliberately chosen over a `plans:*` sibling
because a cut topic outlives its plan, and one batched liveness query stamping
`deckMissing` on the record the UI already receives. The lane disproved two
assumptions in the process, both now pinned by test: a **soft-deleted deck keeps
feeding derived confidence** (`DeckStore.softDelete` does not cascade to `cards`,
and the census filters on the card's own `deleted_at`) — so the defect was a
picker silently offering a deck that no longer exists, not a signal going quiet;
and **`overflowMinutes` is invariant to scope cuts**, because the engine consumes
100% of every day's capacity with recall absorbing the leftovers, so a cut
redistributes *which* topics get the time and never reduces the unabsorbable
missed backlog. Still deliberately out: per-topic estimated minutes (refused in
v1 — weight derives from confidence). ~~**Open for the founder:** whether a
soft-deleted deck should keep feeding confidence at all~~ — **answered
2026-08-01: it should not** (`cbfbf07`, ADR-067 amendment). A topic whose link
no longer resolves to an active deck derives nothing and falls back to its
manual confidence, else null — the same answer a topic with no link gives — so
„Nedostupan špil" and the weakness column can no longer say opposite things
about one row. The gate reuses the liveness set already resolved per exam, so
nothing became an N+1; `deriveDeckConfidence` stays a raw per-deck blend,
documented and test-pinned as liveness-agnostic so a future caller must decide
consciously. The stored link is untouched (a read rule), and since the deck
delete is soft, restoring the deck restores the number with no further action.
Carried consequence: such a topic now reaches the plan engine as **unknown**
confidence rather than as a dead deck's number.

**Notifications (NTF) — later extras** — private-note and security
notification sources (NTF-006/007; their source tables land with PRIV/AUTH).
Per-task reminders are **done** (ADR-028 — see "Finishing Tasks"), and
~~NTF-008's "ask at first notification moment" prompt~~ is **done 2026-07-30**
(`4c96924`, wave-2 Lane E, [architecture/adr/033](../architecture/adr/033-ntf-first-ask.md)):
migration 026's `appetite_asked` flag, ask-and-hold in the scheduler only
while the window is visible (a hidden window gets its reminder instead and
the ask waits for the next visible moment), a house-recipe dialog whose every
path — presets, "Zadrži podrazumevano", Escape, backdrop — answers the
once-ever question, and one immediate post-answer check so the held reminders
fire under the chosen appetite. The flag deliberately does not travel in an
archive; a restored profile re-asks. *Context:* the module
itself is **whole** — engine, migration, store, the main-process scheduler
that delivers OS notifications, the validated `notifications:*` IPC, and the
bell/center/settings UI are all done (pieces a1/a2/a3; see §2). The cleanup
contract holds with zero extra code, since a deleted source entity simply
stops being derived.

**Settings (SET) — beyond lite** — the genuine remainders now that the lite
page ships (see §2; the **accent palette picker**, SET-004, shipped
2026-07-12 and is no longer in this list): **density comfortable/compact**
(SET-004 — needs a token-level design pass with the founder's direction,
since density touches every spacing token, not one page); ~~custom
dashboard background + dim slider (SET-006)~~ — **done 2026-07-30**
(`ae76310`, wave-7 Lane N,
[architecture/adr/041](../architecture/adr/041-dashboard-background.md)): the
image lives in the **existing encrypted blob store** (a personal photo gets
SEC-DAR's at-rest guarantees; a background byte-identical to an attachment is
one file on disk, guarded by the blob unions' new third member), migration
030's `dashboard_settings` row holds the choice (hash + sniffed mime + size +
dim 0–90), main owns the pick flow end to end (stat-before-read, 20 MiB cap,
inline-image formats only, refusals named), the scrim is the theme's own
surface at the chosen opacity so both themes dim correctly with zero new
colour values, and the background travels in the archive as interchange
1.9.0's `dashboard-settings` record (no era flag; a lost blob costs the
picture, never the archive); ~~settings search (SET-014)~~ —
**done 2026-07-30** (`5046045`, wave-1 Lane B): a folding-aware filter over a
declarative entry index (one entry per control plus one per registered module),
typographic hit highlighting, and sections that hide with CSS but stay
**mounted** so a restore preview, a half-typed passcode or unsaved quiet-hours
edits survive typing in the filter box; ~~keyboard shortcuts reference + remapping (SET-013)~~ —
**done 2026-07-30** (`96473fb`, wave-6 Lane M,
[architecture/adr/040](../architecture/adr/040-keyboard-shortcuts.md)): the
remappable core set (paleta Ctrl+K, novi unos Ctrl+N, zaključavanje Ctrl+L,
podešavanja Ctrl+,, referenca F1 — F1 deliberately, since Serbian QWERTZ puts
`/` on Shift+7), the reserved Ctrl+1–9 sidebar-order family, a pure core chord
module (`event.key` so chords name what the layout prints; bindable = Ctrl/Alt
held or an F-key, which is why the handler needs no input-focus guard),
overrides-only device-level storage, a capture UI that refuses taken chords by
naming their holder, and the F1 reference overlay whose Globalno/Moduli groups
render the LIVE bindings — as do the sidebar badge and the search page's hint,
so no printed chord can go stale;
the **language switch** (SET-009 — lands with the i18n extraction that lifts
`strings.ts` into a real i18n layer); **account, backup and privacy panels**
(SET-002/010/011 — they land with AUTH and IMEX, which own the behavior these
panels surface); ~~NTF-008's "ask at first notification moment" onboarding ask~~ (**done
2026-07-30** — see the NTF paragraph above); and ~~**per-module
settings contract subsections**~~ — **done 2026-08-01** (`efee787`,
[architecture/adr/071](../architecture/adr/071-module-settings-contract.md)),
**commissioned by the founder** („refaktoriši tako da nam bude lakše nadalje").
A module now declares a `SettingsPanel` on its manifest and the page COMPOSES
its card from the registry — ADR-045's widget contract applied to settings
rather than a second invention. Four control kinds and no fifth (choice, whose
option labels fold into the search keywords automatically; toggle; `value`, the
deliberate bottom that declares a label and where the value lives but nothing
about rendering; and read-only `fact`), because an open escape hatch becomes
„render arbitrary JSX" within two modules. Every value-bearing control declares
`storage: device | profile`, which is load-bearing: „Vrati na podrazumevano" is
offered only on a card whose every value is this machine's. `settingsSearch.ts`
now DERIVES its module entries from the same declaration instead of a
hand-written twin. **The boundary is the design and is written into the
contract's doc comment:** shell settings — appearance, account/passcode,
notifications, backup/import, shortcuts, the module gallery — stay
hand-composed, and „finishing" the refactor by dragging them through it is
explicitly forbidden. The page went 5563 → 4903 lines, and the proof is a test
that registers a fake module and asserts the page and the filter both pick it
up **with no edit to `SettingsPage.tsx`**. Two deliberate visible deltas, both
forced by composing in registry order: module cards are now one contiguous block
after „Izgled" (Kontrolna tabla / Učenje / Kalendar used to sit after „Prečice"),
and a switched-off module now renders no settings card where previously only
PRIV was gated. Not moved, deliberately: CAL's two controls that live inside the
shell's „Izgled" card and are cleared by its reset, and week start (read by
`TaskMonthGrid` too).

**Accounts (AUTH) — the remainder.** The **local account is done** (2026-07-26)
per [architecture/adr/018](../architecture/adr/018-local-account-passcode.md): a
passcode-gated launch, the database encrypted at rest, a Recovery Kit, and
throttled unlock attempts — see §2. What is left, with context:

- **Cloud accounts** (nickname + password, sessions, email flows, 2FA) — out of
  scope by the founder's standing desktop-first decision, not by oversight.
- ~~Multiple local accounts on one device (AUTH-006, S-tier)~~ — **done
  2026-07-31** (`443609a`,
  [architecture/adr/044](../architecture/adr/044-multiple-local-accounts.md)):
  one directory per account under `accounts/<id>/`, a plaintext registry whose
  lock-screen label the user chooses knowingly (the UI says it is visible while
  locked), a crash-resumable rename-only migration of the existing flat
  install, an account picker ahead of the lock screen with rename-while-locked,
  and „Promeni nalog" in the sidebar (= lock, with a truer label). Switching is
  exactly lock + pick + unlock — no concurrent unlocked accounts; a locked
  account fires no reminders (recorded). The smoke run carries a multi-account
  rehearsal. ~~Not built: in-app account deletion~~ — **done 2026-07-31**
  (`1479cd2`, [architecture/adr/048](../architecture/adr/048-account-deletion.md)):
  picker-only, typed-label confirmation (deliberately **no PIN re-auth** — a
  `requiresRecovery` account can produce no passcode proof on this device, and
  wrong attempts would burn the unlock throttle; flagged to the founder),
  tombstone-first crash-resumable destruction (`<id>.deleting` rename as the
  atomic commit point, registry write, best-effort erase + boot sweep), the
  last account's deletion returning the app to first-run, and a smoke delete
  leg that locks and re-unlocks the survivor.
- ~~Passcode on profile switch (AUTH-024)~~ — **done 2026-07-31** with the
  profile switcher (ADR-058): every switch goes through the gate, including
  „Prebaci profil" from the sidebar, and an unopenable profile is named as
  such rather than silently skipped. **This entry was stale** — like CAL-005
  above, it was waiting on a business-profile UI that has since shipped.
- **Windows Hello / biometric unlock** — Electron exposes no way to prompt for
  the OS credential, which is exactly why recovery is a Recovery Kit instead
  (DEV-003). It needs a native module; PRD 06 §10 already lists it as a future
  extension.
- ~~Encrypting the attachment blob store.~~ **Done 2026-07-26** per
  [architecture/adr/019](../architecture/adr/019-encrypted-blob-store.md) — see §2.

**Import/Export (IMEX) — the remainder** — **restore is done** (ADR-023,
2026-07-29 — see §2/§3), and ~~foreign import~~ is **done 2026-07-31**
(`d26dcfb` + `6222d86` + `9ed28a0`,
[architecture/adr/043](../architecture/adr/043-foreign-import.md), three slices):
merging somebody else's archive — or your other account's — into a profile
that already has data. Every imported row gets a minted id, every reference is
remapped (including inside a note's Yjs state), only certain identity dedups
(tags by exact name; the source's default list collapses into yours; a task
template whose name you hold is skipped — additive-only forbids overwriting),
per-row damage is salvaged with every drop named, and the whole import is
undoable through the same one-slot snapshot as a restore. The Settings card
states the contract: uvoz DODAJE, vraćanje ZAMENJUJE. Direct importers (Anki
`.apkg`, ICS, CSV, markdown) are now translators into this planner's input —
the merge semantics are decided once. Since then: ~~scheduled local backups
(SET-011)~~ — **done 2026-07-31** (`8ad69a7`, ADR-056, migration 044:
device-local `backup_settings` excluded from archive and wipe, the shared
`writeProfileArchive` extracted from export, HKDF-derived backup passphrase,
`.partial`+rename scheduler, strict prefix+timestamp retention); ~~the LLM
prompt pack~~ — **done 2026-07-31** (`5280c4e` IMEX-005 + `4610539` v2:
sr prompt pack, `llmImportPrefs`, „Novi špil"/seeded-subject planning, replan
keeping parsed records, never the raw paste); ~~Anki `.apkg` → STUDY~~ —
**done 2026-07-31** (`17a8a53` basic+cloze + `b66633b` schema-18/`.anki21b`:
protoWalk wire walker in core, zstd via `node:zlib`, refusal tiers; DEV-005
records the in-main parsing); ~~markdown files/folder → NOTE~~ — **done**
(`imex:import-markdown` + core `markdownImport.ts`, the lossless-tree inverse
of `noteMarkdown.ts`, wired through Settings); ~~ICS → CAL~~ — **done
2026-07-31** (`d3ae61b`, ADR-061 — see the header); ~~CSV column-mapping →
TASK~~ — **done 2026-07-31** (`42f6c7b`, ADR-062 — see the header; FIN's CSV
half still lands with FIN). **Every direct importer is now built.** The one
remainder: N-2 major-version migration support per ADR-009's semver policy
(nothing to migrate yet — `1.x` is the only major ever released).
*Context:* export (slices a1 + 1 + 2) and restore (slice 3) are both done —
see §2/§3; this list is everything still needed to close out the module.

**Global Search (SRCH) — the remainder.** The module is built (ADR-021, see
§2); five deliberate exclusions were left. ~~**SRCH-008 attachment *content*
search**~~ — **the buildable half is done 2026-07-31** (`f5d2b06`,
[architecture/adr/069](../architecture/adr/069-attachment-content-search.md),
migration **048**). Its own condition expired: the per-format extraction it was
waiting on is exactly what File Preview built (ADR-064), for exactly the formats
that need no dependency. Text and markdown attachment contents now ride the
owning row's *matchable* body — never the displayed one, so a snippet still
shows the record rather than a paragraph lifted out of a file it carries, and a
result that matched inside an attachment says so instead of appearing to match
nothing. Main extracts once on the add path (no trigger can — the bytes are
encrypted outside the database), a nullable column doubles as the pending queue,
and a bounded backfill covers pre-existing and restored rows at unlock and after
every restore/import. The text deliberately does not travel in an archive: it is
derived from bytes that already do. **Still out, and now by explicit decision
rather than by „not designed yet":** PDF/DOCX/XLSX contents (a parser is a
dependency, and this repo adds none — a partial, wrong extraction is worse than
an honest absence) and `subject_attachments` (whose file *names* are not
projected either, migration 035, deliberately; indexing its contents would be a
wider feature riding this one). Private notes stay excluded by construction. ~~Richer operators~~ — **done 2026-07-30**
(`7eaa05e`, wave-1 Lane A, [architecture/adr/030](../architecture/adr/030-search-operators.md)):
`#oznaka` (AND, prefix over folded space-stripped names) and `rok:`/`due:`
`danas|sutra|nedelja|YYYY-MM-DD`. One correction to this list's old claim: tags
were **not** in the index — the operators are query-time post-filters (id sets
joined from the two tag stores in main, an ISO context date reduced to its
LOCAL day), which is why a tag rename needs no reindex; an operator-only query
is bounded at the 200 freshest eligible entries (recorded in the ADR — the
facets page is the browse-everything surface). The palette suggests tags while
`#` is typed and names the grammar in its footer. ~~Task attachments are not
yet in the index~~ — **closed** by wave-2 Lane D (migration 025 / ADR-032:
filenames ride the task row's own indexed body). ~~A full search page with facets~~ — **done
2026-07-30** (`b7e73c5`, wave-6 Lane L,
[architecture/adr/039](../architecture/adr/039-search-facets-page.md)): a shell
surface (deliberately NOT a module — never in the gallery, no flag), reached
from the sidebar's Pretraga item and from the palette's "Prikaži sve rezultate"
row (which carries the palette's chips as their typed tokens); one source of
truth is the query string — kind chips splice the palette's own shortest-alias
prefix tokens, tag facets append/remove `#token` in `foldSearchTag` form, no
due chips by design; one `search:page` channel whose kind/tag counts are
computed over the post-operator PRE-narrowing set, candidates bounded at
`MAX_SEARCH_BROWSE_LIMIT` 500 (the palette keeps its recorded 200) with
truncation reported honestly as "N+" floors; empty query is browse mode over
recents, kept in recency order. **SRCH-009 search history** — recent *queries*,
as opposed to the recent *entities* the palette already shows on an empty box.
Its blocker was a persistence decision, since a query log is a privacy surface;
**the founder answered on 2026-08-01 — „čuvaj" — and it shipped the same day**
(`b120190`, migration **050**, no interchange change). **Where it lives is the
load-bearing part:** a per-profile table in the encrypted database that is
deliberately excluded from the archive AND from the restore wipe — the
`backup_settings` shape. A history is a fact about how you used this machine,
and an archive is something you can hand to somebody else; but it is not
renderer storage either, because it belongs to a PROFILE (one person's searches
must not surface in another profile on the same install) and deserves the same
encryption at rest as the notes it searched. Three claims, three proofs,
including the one that would catch it silently starting to travel. Dedup is the
primary key, so a duplicate row is unrepresentable; insert and eviction share
one transaction; re-use bumps an entry before the cap applies, so re-using a
query rescues it from eviction. A query is recorded only when the user
COMMITTED to it (a result opened, or carried to the full page) — recording „it
ran and returned something" is identical to recording every keystroke on a
debounced box — and the EFFECTIVE query is stored, chips spliced in as typable
tokens, so replaying a row reproduces the same search. **Correction to an
earlier plan recorded here:** this was going to be the first consumer of
ADR-071's per-module settings contract. It cannot be — search is NOT a module
(the facets page is deliberately a shell surface with no manifest, gallery row
or flag) — so the clearing control is hand-composed into „Podaci i privatnost",
which is exactly what the contract's boundary requires, and a test pins its
section to the shell half. **Fuzzy matching** — typo tolerance, deliberately excluded
because prefix matching plus Serbian folding covers the common miss and
trigram fuzz on a small corpus produces noise. Also unbounded on purpose: the
index has no size cap or eviction, on the reasoning that a personal corpus
stays small — revisit if a real profile's index grows disproportionate.
**File Preview (DOC)** — **this entry was stale and is corrected 2026-08-01.**
The *capability* shipped 2026-07-31 (`cb0be8a`,
[architecture/adr/064](../architecture/adr/064-file-preview.md)): tier 0 (images,
text, markdown) in a house preview dialog reached from all three attachment
surfaces, and tier 1 (PDF) in a **dedicated hardened preview window** — no
preload at all, navigation locked to the one `nx-blob://<hash>` it was opened
with, closed on every lock — with zero dependencies and no migration. DOCX/
XLSX/PPTX stay out **by name** (they sniff as `application/zip`; a
dependency-free renderer would be a product, not a feature) and keep
external-open only. ~~What ADR-064 deliberately left for a later slice is the
DOC *module page*~~ — **that shipped 2026-08-01** (`62ddd74`,
[architecture/adr/075](../architecture/adr/075-doc-module-page.md)), so **DOC is
now a whole module**: „Datoteke", a union READ over the three attachment tables
(no migration, no new table — a materialised index would be a fourth copy of
facts already held in three places, and the first module to forget to write it
would make the page lie), filter chips for owner and mime family, a folded
Serbian query over filename *and* owner title, list and grid presentations, and
per-row „Pregledaj" / „Otvori" / „Idi na…" all calling the mechanisms that
already existed. Deliberate: no delete (removal belongs to the surface that owns
the file, where its undo lives), no `searchIndexers` (filenames are already
indexed once, under their owner), no widget, and one ADR-071 settings panel with
a single device-scoped view choice. What stays out is unchanged and now stated
twice: DOCX/XLSX/PPTX previewing (a parser is a dependency), and PRIV — whose
exclusion is *structural*, since a sealed note's attachments live inside its
envelope and there is no table for the union to skip. **Private
Notes (PRIV)** — **COMPLETE 2026-07-31** (ADR-057, four slices: `50bd9df`
crypto, `e14836e` store + migration 045, `2bef3cd` UI + the two doors,
`c7acf93` interchange 1.23.0): zero-knowledge sealed notes under a per-profile
DEK, invisible to FTS *by construction* (the sealed tables get no projection
views — the recon's central inversion), account-passcode or own-passcode
unlock with the shared throttle, Recovery-Kit integration, move-in/move-out
doors ordered so a crash leaves both copies never neither, and archive travel
only while unlocked + encrypted. ~~Remaining PRIV refinements: version-history
read/restore UI, explicit-close version capture, an unlock-time cached search
index, and GC for orphaned sealed blob files~~ — **all four done 2026-07-31**
(`a004826`, ADR-066): three unlock-gated channels give the sealed history a
surface (metadata as the two cleartext facts a version row has; one version
unsealed at its own bound sequence as cleartext for display; a restore that
checkpoints the live state first, because a destructive restore would be the
one operation in a zero-knowledge store with no recovery); the close capture
seals on every way out — note switch, section lock, app lock, account switch,
window close, idle timer, minimize — keyed on „written since the last
capture", which is what makes it idempotent, with the cadence capture
deliberately NOT clearing the mark (it captures what a write replaced, not
what it left); the search index is built once at unlock, dropped at lock,
marked stale by restore/undo, answers ids only and is registered with nothing
— the invisibility stays structural; and the orphan sweep runs only once the
one-slot undo can no longer bring rows back, aborts wholesale on any container
that will not open, and deletes only files this session's blob key
authenticates, since `private-blobs` is per ACCOUNT and another profile's
bytes are unknowable from here. **Flagged:** a `close` deferral means a macOS
Cmd+Q issued while a capture is owed cancels that first quit (the window then
closes; a second quits) — accepted on a Windows-first product to guarantee the
capture. Crashed-write `.tmp-…` leftovers are deliberately not swept. The one
PRIV item still out by decision: private attachments are excluded from the DOC
preview window (ADR-064's recorded v1 limit).

**Personal Finance (FIN) — done, and the arc is closed.** The whole module
landed 2026-08-01 across five slices ([architecture/adr/073](../architecture/adr/073-fin-module.md)):
`f9374ca` data (migration 051, interchange 1.28.0) · `b536b47` the page and the
module registration · `4fb958a` budgets and the monthly report · `dd99a1f`
bank-statement CSV import (migration 052, 1.29.0) · `029cc18` subscriptions plus
the calendar/NTF/dashboard wires (migration 053, 1.30.0). Five decisions were
locked before the first line and are worth keeping: money is an INTEGER of minor
units and that is a fact of the FILE (`typeof(x)='integer'` on every money
column, since plain INTEGER affinity quietly accepts 12.5); currency is per
ACCOUNT with **no rates** (totals per currency; a cross-currency transfer is
refused by name); balances are DERIVED (a stored balance misses one write and
lies forever); a transfer is ONE row and its exclusion is STRUCTURAL (the
`fin_flows` view does not project `counter_account_id`, and the aggregate reads
only that view — it cannot filter wrongly, cannot forget, cannot even ask); and
categories are flat, unique per (profile, kind, name). ~~Remaining: subscription
pause~~ — **done 2026-08-01** (`91e68c9`, ADR-074, migration 054, interchange
1.31.0), the founder's own call. Still open by decision: charges are generated
only for the ACTIVE profile, so a background profile carries a stale state until
you enter it — **the founder confirmed that reading on 2026-08-01**, and nothing
is lost, since generation is a catch-up from a cursor. There is no `warning`
token, so an overspent budget uses danger; **the founder decided 2026-08-01 that
none is needed**.

**Habits & Streaks (HABIT) — DONE, all three slices, 2026-08-01**
([architecture/adr/076](../architecture/adr/076-habit-module.md)). **Slice a —
the data layer — done 2026-08-01** (`1711ece`, migration **055**, interchange
**1.32.0**): `habits` + `habit_entries`, `HabitStore`, and the two pure core
modules. The decision the module turns on is that a habit carries **no
recurrence rule**: ADR-024 answers „when does this next occur" while a habit
needs „was this period satisfied", and the rule language can express schedules
over which a streak is undefinable (`until`, `count`, „every 3rd Tuesday"). Two
schedule kinds and no third — `days` (a weekday set) and `quota` (N per week) —
because neither expresses the other. The streak is gentle in exactly STUDY's
sense, restated for two period kinds through one shared function: the CURRENT
period is skipped rather than counted as a miss, because it is not over. No
freeze, no repair, no streak insurance. One nullable `target` makes „teretana"
and „8 čaša vode" one model; `archived_at` and `deleted_at` are independent
(the ADR-074 shape); `UNIQUE (habit_id, entry_date)` makes a double tap
unrepresentable. **Slice b — the page and the IPC surface — done 2026-08-01**
(`9addecb`): ten validated channels (including a schedule validator that runs
core's own on the wire payload), the module registration, and „Navike" —
„Danas" plus twelve weeks of history, the streak pair and a 30-day figure
stated as a fraction of what the schedule actually EXPECTED. The grid gained a
FOURTH state the brief had not asked for and needed: `unjudged`, drawn as
nothing, for days before the habit existed, days after today, and today while
it is still running — without it a habit created yesterday shows eleven weeks
of red and an untouched morning accuses you at 09:00. **Slice c — done
2026-08-01** (`33ae92c`, migration **056**, interchange **1.33.0**): reminders
as a real NTF source over ADR-025's minute-granular model, decided by one pure
filter (only on a day the schedule EXPECTS — a quota habit until its week is
met and no day after — and never when today is already satisfied); the „Navike
danas" dashboard widget, which is the only widget on the dashboard that
**writes**, argued in its own doc comment (a card that could only say „nisi
popio vodu" while sending you elsewhere to admit it is a card that nags); an
ADR-071 settings card with exactly one honest control (the hour the form fills
in when a reminder is switched on — it does not turn reminders on, and habits
still ship silent); and **past-day correction**, the gap slice b left: its tick
channels carried no day at all, so a user who forgot to tick yesterday could
not fix it while the grid sat there showing the miss. Both channels now carry a
validated day, with the distinction written into the type — main stamping the
clock exists so the renderer cannot lie about *now*, while a day the user
deliberately names is DATA, exactly as a FIN transaction's `tx_date` is; the
protection is the refusal (nothing after today, nothing before the habit's own
`createdAt`, since a tick there would invent history for a period the habit did
not exist in). The grid's `satisfied` and `missed` cells became real buttons;
`unexpected` and `unjudged` stay inert. **HABIT is whole.** Nothing of the
module is deferred; what it deliberately does not have is recorded in ADR-076
§5 (no calendar source — a daily habit would put 365 bars a year in a calendar
built for appointments; no „skip today" third state; no habit→task generation;
no negative habits in v1, whose streak semantics invert so that every „no data"
day becomes a silent lie in the user's favour).

**Later hubs & tools** — Fitness (FIT, with the Serbian food database),
Infinite Canvas (CANV), Utility belt (UTIL), Password vault
(VLT), Sharing (SHARE), Grocery co-edit (SHOP), Entertainment, productivity boosters,
and the long-term AI assistant and Plugin system. *Context:* several of these
(SHARE, SHOP co-edit, cloud FIN sync) depend on cloud, which is out of scope now.
**Both blockers here were cleared by the founder on 2026-08-01** (see §5):
CANV's engine question is answered — **Excalidraw, conditional on the spike** —
and FIT is **no longer blocked on licensing**, because we licence nothing and
build the catalogue ourselves from public-domain sources with per-entry
provenance, with user-added foods as a first-class part of the design rather
than a workaround. **Three of these are no longer „later": FIT, UTIL and CANV
all have shipped data layers and pages as of 2026-08-01.**

- **FIT** — the nutrition layer, the 426-food public-domain catalogue and the
  „Ishrana" page (migration 058, interchange 1.35.0; ADR-078). What FIT still
  owes beyond food: training, measurements and the rest of PRD's fitness hub.
- **UTIL** — one unified focus timer (migration 057, interchange 1.34.0;
  ADR-077) and the „Alatke" drawer of eleven tools, which is also the host that
  finally reads `ModuleManifest.tools`. Both register under the `UTIL` prefix as
  two deliberately separate app modules.
- **CANV — the module is whole** (migration 059, interchange 1.36.0; ADR-079
  with its observed §11–§13). Slice a: boards, persistence, mermaid as a
  deliberate action. Slice b: **our own Serbian toolbar** replacing Excalidraw's
  chrome (the editor ships 54 locales, none Serbian, and one cannot be added),
  plus the `nexus://` reference and the batch read behind a card. Slice c:
  **notes, tasks and events as cards on the board**, with arrows binding to them
  — which also closes **NOTE-007**. What CANV deliberately does not have is in
  ADR-079 §13.6: cards do not appear in a PNG/SVG export (they are DOM overlays),
  their text is invisible to Excalidraw's own canvas search, and a card whose
  object was deleted is never auto-pruned — it says so and offers removal.

**Dashboard depth (DASH)** — ~~edit mode with drag/resize, a widget gallery~~ —
**done 2026-07-31** (`2d5810a` + `31cf1ca`, ADR-045 a+b, migration **032**,
interchange **1.11.0**): the layout is an ordered list of sized placements
(S=2/M=3/L=6 spans on an authored 6-column grid), zero rows *is* the default
five-widget arrangement (so removing the last card is also the reset, announced
in place), and „Uredi" gives ⋯ menus (move/resize/remove), drag-to-reorder, and
the „Dodaj vidžet" gallery over the enabled modules' registered widgets (v1
single-instance). Every widget owns its reads behind its own skeleton and
isolated retry — the page-wide loading gate is gone. The widget contract is now
real (manifests publish widgets; the registry resolves `moduleId:widgetId`), and
the **data-query DSL was deliberately rejected** in ADR-045: per-widget fetch
boundaries give the isolation without a query language crossing IPC. The two
ideas ADR-045 §7 deferred have both since shipped: **multiple named dashboards
(DASH-008)** — done 2026-07-31 (`916bdf7`, ADR-055, migration 043, interchange
1.21.0: `dashboard_sets` + per-set layouts, NULL set = Početna) — and
**per-widget configuration (DASH-004)** — done 2026-07-31 (`ed1aa7c`, ADR-059:
`WidgetContract.configFields` as a closed three-kind vocabulary (count/choice/
taskLists), one strict writer + one lenient total reader pair in core, every
default pinned by test as the shipped behaviour, the generic „Podesi…" form in
the ⋯ edit-mode menu, one `dashboard:widgets-set-config` channel revalidating
against the shared declaration; no migration, no interchange change — the
`config` column had been carried verbatim since 1.11.0). DASH is whole.

---

---

## §5 — the founder's first real install (2026-08-02)

**FROM THE FOUNDER'S FIRST REAL INSTALL (2026-08-02) — the most valuable
feedback of the project so far, and it is a verdict on craft rather than a bug
list.** He installed `Nexus-Setup-0.1.0.exe` and reported, verbatim:

> *„malo puca boja kad se skroluje app"* · *„ako izađe padajući meni koji ne
> staje zbog visine, to se ne vidi lepo"* · *„kad je dan tabla treba da bude
> bela, kad je noć da bude tamna"* · *„treba opcija za čuvanje table i da mogu da
> učitavam table koje sam već koristio"* · **„generalno je ceo UI dosta
> jednostavan i bazičan, samo su nabačani dugmići i sve, deluje sirovo app baš"**

That last sentence is the headline and it is correct. The app has enormous
functional depth — 14 registered modules, 59 migrations, an interchange format,
encrypted storage — and very little visual craft on top of it. What shipped reads
as *under-designed* rather than as the intended discipline.

Four concrete defects, one of them visible in his screenshot:

1. ~~**The sidebar overflows at short window heights.**~~ — **fixed 2026-08-02**
   (`6864f1b`, WAVE 49). `.app__sidebar` is a stretched flex item of a
   definite-height row, so per Flexbox 9.4 its border box was pinned to
   `100vh − 44px` however tall its content was: ~677 px of content against the
   ~637 px a 720 px OUTER window leaves after a Windows frame. The „colour
   tearing" was Chromium's white canvas showing through — `html`/`body` carried
   no background, and per CSS Backgrounds 2.11.2 the canvas propagates from the
   root or `body`.
2. ~~**Popovers taller than the space below their trigger are not handled.**~~ —
   **fixed 2026-08-06** (`6a9d2ec`, WAVE 50). It did not flip, did not clamp and
   did not measure itself; the founder then hit the same defect a second time on
   „Profil: Luka". One shared helper now owns placement for all four floating
   surfaces — see the wave note at the top of this file.
3. **ROOT-CAUSED 2026-08-06, and it is the whole canvas colour layer, not the
   background.** The founder reported one symptom — *„kad je dan tabla treba da
   bude bela, kad je noć da bude tamna"*. Working it per his own rule (a bug is
   a sample, not an incident) turned up the actual mechanism, which nothing in
   the code had accounted for:

   **Excalidraw owns the dark transform.** Its stylesheet carries
   `.excalidraw.theme--dark canvas { filter: invert(93%) hue-rotate(180deg) }`
   — verified in `@excalidraw/excalidraw@0.18`'s `dist/prod/index.css`. We pass
   `theme={theme === "noc" ? "dark" : "light"}` (`CanvasPage.tsx:795`), so under
   Noć **the entire canvas is inverted after we paint it.** Every colour we hand
   in is therefore being fed through an inversion nobody wrote code for, and we
   read all of them from the *live* theme. Under Noć that means we hand
   Excalidraw the dark value and it inverts it to a light one:

   | Site | Reads | Noć value handed in | What the user sees in Noć |
   |---|---|---|---|
   | `CanvasPage.tsx:186` | `--nx-bg` | `#0c0e17` | a near-**white** board |
   | `CanvasPage.tsx:184` | `--nx-text` | `#e8e9f0` | ink inverted to dark — **invisible** |
   | `CanvasPage.tsx:534-535` | `--nx-border`, `--nx-surface` | dark | cards inverted to light-on-dark |
   | `CanvasToolbar.tsx:109` | 9 swatch tokens | dark | every colour paints as its inverse |
   | `CanvasToolbar.tsx:216` | `var(--nx-swatch-…)` | — | the swatch **preview is outside the canvas**, so it is NOT inverted: the button shows one colour and draws another |

   Dan is correct throughout, which is why only Noć was reported. **The rule the
   subsystem never had:** *every colour handed into the canvas must be expressed
   in **Dan's** terms, in both themes* — Excalidraw does the dark conversion
   itself, and doing it twice is the bug. `packages/tokens`' generated
   `themes.dan` gives those values typed, at build time, with no raw hex in app
   source and no `getComputedStyle` guessing.
   The founder's decision above (**theme always wins, no per-board background**)
   makes this safe to apply outright: `changeViewBackgroundColor: false`
   (`CanvasPage.tsx:827`) means a stored background was **never a user choice**
   in the first place, so nothing deliberate is being overwritten. The stored
   value stops being merged (`CanvasPage.tsx:345` currently lets `stored.appState`
   win over the defaults — that line *is* the reported bug) and the swatch
   preview takes the same `--theme-filter` treatment Excalidraw gives its own.

   *(Original entry, kept for the record:)* `viewBackgroundColor` is
   a SCENE value stored inside the saved board and seeded once from `--nx-bg` at
   `elementDefaults()`, so a board made under one theme keeps that background
   under the other. The fix has a real tension in it — the background must follow
   the theme without silently rewriting a colour the user deliberately chose.
4. ~~**Board save/load does not read as save/load.**~~ — **ROOT-CAUSED AND
   FIXED 2026-08-07** (`9cd3267`), and the root cause is not about the canvas.

   Boards have autosaved since the day the page shipped. The autosave SAID its
   failures — „Crtež nije sačuvan" — and **never once said its successes.** So
   from the user's side the page was silent either way, and silence about your
   own drawing does not read as „this is fine"; it reads as „nothing is being
   kept". He was not asking for a missing feature. He was asking for evidence,
   and there was none to have.

   **The blast radius is every surface that writes without being asked.** The
   note editor has a `saveError` and no counterpart; the dashboard persists a
   layout the same way. `SaveIndicator` in `@nexus/ui` is that rule stated once
   — idle / saving / saved / error — and its saved line carries a CLOCK, because
   a bare „Sačuvano" is still on screen an hour after the last write and
   therefore proves nothing. The canvas adopts it here; the note editor is the
   next adoption and is still open.

   The failure moved OUT of the dismissible `actionError` deliberately: a failed
   autosave must not be dismissible, because dismissing it would leave the page
   claiming nothing at all while the drawing is still only on screen. It clears
   on a board switch along with the saved time, since „Sačuvano u 14:32" carried
   across a switch is a statement about the board you just left.

   **The second half — „da mogu da učitavam table koje sam već koristio" — was
   asking for a list.** What was there was a row of TABS with an unlabelled
   „Table" caption beside it: tabs read as what is currently open, a list reads
   as what you have. It is the house popover now, with the count on the trigger,
   and it stops growing sideways past the window edge one board at a time.
   Recorded as DC-04 in the defect-class ledger below.

---

## §5 — the polish plan, and the two code sweeps (all closed 2026-08-07)

### The polish plan (P1 in the roadmap) — ordered by what a user feels first

A survey of the renderer (2026-08-06) returned **54 findings: 6 that break, 38
rough, 10 nits**, across twelve categories. The two biggest categories are not
aesthetic — `error-state` (12) and `empty-state` (10) — which is worth saying
plainly: *„deluje sirovo"* is only half a look problem. The other half is that
the app frequently does not tell the user what happened.

The order below is deliberate. It is not cheapest-first and not
category-by-category; it is **what a user notices, weighted by what it costs
them.** Anything that loses work or lies about it comes before anything that
merely looks unfinished.

**A. It lies or it loses work.** *(the whole `breaks` set plus the honest half of
`error-state`)*

1. ~~**A failed save is invisible on three of the four main write paths.**~~ —
   **done 2026-08-06** (`30e7b5b`). `CalendarPage` and `TasksPage` both caught
   the rejection, logged it to the console and closed the form as if it had
   worked; `StudyPage` swallowed five deletes and their undos, so „Vrati" became
   a button that did nothing, forever — and so did the plan delete, which this
   survey had missed.

   **Correction to this entry as first written:** it claimed `setFormError` was
   called from nowhere in `CalendarPage`, i.e. that the error surface was built
   and never wired. That was wrong — verified against `6864f1b`, the file had
   four `setFormError` calls, two clears and one real use (the client-side
   „end before start" check). The accurate defect is narrower and still real:
   the slot existed and was wired for exactly one client-side validation, and
   the **store's own refusal never reached it**. Recorded rather than quietly
   edited, because the ledger is only worth having if its misses are in it too.
2. ~~**„Odbaci" destroys a running focus phase**~~ — **done 2026-08-06**
   (`30e7b5b`): it asks first through a shared dialog and is marked as the
   destructive one; STUDY's own focus widget had the identical pair with the
   identical defect and shares that dialog.
3. ~~**Folders, tags and categories delete straight from the menu**~~ —
   **done 2026-08-06** (`30e7b5b`): none of the three has a restore endpoint, so
   they take the typed-name confirmation the app already uses for its other
   unrecoverable deletes.
4. ~~**Submit buttons stay live through the round trip**~~ — **done
   2026-08-06** (`30e7b5b`): every submit is disabled for the span of its own
   write.
5. ~~**Six failures that read as emptiness**~~ — **all six done**, verified
   against the code on 2026-08-07 rather than assumed: the palette carries a
   `searchFailed` flag whose branch is tested before the empty one; the
   notification centre has an `actionError` line for snooze and dismiss and
   renders loading / failed / empty as three distinct states; the food picker
   (now `FitNutrition.tsx`) and the list picker both report a failed fetch; and
   an empty-title submit sets `strings.calendar.invalidTitle`.
   **The verification found a seventh, which is the interesting part** —
   **done 2026-08-07** (`29001f9`). The sweep fixed `SearchPalette` and left
   `SearchPage` — the full „Pretraga" page behind the same grammar — with the
   original shape: catch, log, `setData(EMPTY_RESULT)`, render „Nema
   rezultata". *One surface of a pair was fixed and the pair was not looked at.*
   The page now shares the palette's flag shape, its sentence
   (`strings.search.searchError`, not a copy) and its CSS rule, and reports the
   failure in browse mode too, since the recent list comes from the same call.
6. ~~**Two dialogs discard state on Escape mid-write**~~ — **done**, verified
   2026-08-07. `FinCsvImport` and `TypedConfirmDialog` both hold their state
   through a write, and the morning-hour field is a `morningHourDraft`
   committed on blur rather than a database write per keystroke.

**B. It breaks at the size the app ships at.** *(`layout-overflow`)*

7. ~~**The notes editor column collapses.**~~ — **done 2026-08-07** (`ebcf3ec`),
   in two halves five commits apart. `f1fa51a` fixed the arithmetic: 500 px of
   fixed rails plus two gaps left the editor 295 px at the shipped width and
   **75 px** at the enforced `minWidth: 900`, so the editor took a floor derived
   from `--note-measure` and the rails yielded instead. That left one question
   the commit recorded rather than guessed at, and the founder answered it on
   2026-08-07: **below roughly 1200 px the rails have to leave, not shrink.**
   `ebcf3ec` is that answer. A pane is full width or it is not there: the rails
   are fixed tracks, the editor is the slack, and 1345 px — the width at which
   all three panes fit with the writing column at its default measure — is where
   the organizer leaves and becomes a drawer opened from the page header. Two
   panes give the editor 552 px at the shipped 1120 px window and 332 px at the
   900 px minimum, which is the shape `.priv__body` had drawn all along.
   Recorded as DC-06 in the defect-class ledger below.
8. ~~**Kanban columns divide by N forever**~~ — **done** in `f1fa51a`, verified
   2026-08-07: `grid-auto-columns: minmax(var(--nx-layout-col-min), 1fr)` plus
   `overflow-x: auto`, so a column has a width below which it stops being a
   column and the board scrolls sideways past it.
9. ~~**The calendar's default view does not fit the window**~~ — **done** in
   `f1fa51a`, verified 2026-08-07: the chrome is `flex: none`, each of the three
   views claims the remainder and scrolls inside it, and the fourteen-hour pixel
   cap is gone.
10. **Settings body text has no maximum measure** — *mostly done, verified
    2026-08-07.* The card and section bodies took a measure with the rest of
    `f1fa51a`. **Still open:** the sub-section description paragraphs render
    through the shared `.app__muted`, which has no cap, at 14 `SettingsPage.tsx`
    call sites. The fix is one dedicated description class rather than a cap on
    `.app__muted` itself — that class is shared with `App`, `StudyPage`,
    `PrivPage`, `FinCsvImport`, `noteTemplatePane`, `attachmentPreview` and
    `moduleSettingsPanels`, where it mostly carries short status lines, so
    capping it there would be a blast radius nobody asked for.

> **The subsystem verdict, per the founder's rule that a bug is a sample and not
> an incident** (2026-08-06): items 7–10 are not four layout bugs. They are the
> same absence, four times. **There is no layout system**, and the measurements
> say so precisely (verified 2026-08-06):
>
> - **12,139 lines of CSS contain five `@media` rules.** Three of them are
>   `prefers-reduced-motion`. The **entire** responsive surface of the product
>   is `max-width: 900px` (`app.css:3316`) and `max-width: 720px` (`:11073`).
> - **Zero `@container` queries. Zero `clamp()`.** Not one width in the app is
>   expressed as a range.
> - **Every width breakpoint is `max-width`, and there is not one height-aware
>   rule anywhere.** That is the finding. *Every defect the founder has
>   reported has been a height problem* — the sidebar spilling past the bottom
>   edge (WAVE 49), the profile menu opening below the screen (WAVE 50) — and
>   the stylesheet has never once been asked what happens when the window is
>   short. The app looks right on his machine because it was built on his
>   machine.
>
> So B is not „fix four selectors". It is **give the shell, the page frame and
> the module panes a real sizing contract**: minimums that refuse to collapse, a
> measure for prose, and one place that states what a page's chrome may consume
> of the height it was given. The four instances then fall out of it, and the
> next one never ships. That contract is also precisely what P3's responsive
> pass needs, so none of this work is spent twice.
>
> **Where that verdict stands on 2026-08-07.** All four instances are closed
> (`f1fa51a`, `ebcf3ec`), and the measurement has moved by exactly one line:
> 12,763 lines of CSS now carry **seven** `@media` rules, three still
> `prefers-reduced-motion`, so the width breakpoints went from three to four.
> The new one is the only one that fires at a size the app actually ships at —
> the other three are 900 / 900 / 720, below the window minimum or close to it,
> which is to say they have never once run on the founder's machine. The verdict
> is NOT closed. Three page rails are still hand-written numbers — `.tasks` 200
> px, `.fin` 230 px, `.priv__body` 280 px (a token since `ebcf3ec`; it was 300)
> — against `--nx-layout-rail`'s 220. They are not defects: each is a FIXED
> track beside a `minmax(0, 1fr)`, so the rail never becomes a sliver and the
> content column absorbs the loss, which at the 900 px minimum leaves 412 / 382
> / 332 px of content. That is narrow, and for a kanban board that scrolls
> sideways and a ledger of rows it is survivable in a way a 119 px folder tree
> was not. Held for the overhaul with the arithmetic already done, and **still
> not one height-aware rule anywhere** — that half of the finding is untouched.

**C. The verdict itself: nothing has rank.** *(`hierarchy`, `typography`,
`spacing`, `consistency`)*

11. ~~**The type scale has four steps inside a 3 px band**~~ — **done
    2026-08-07** (`9b10342`). The ladder is now 11 / 13 / 15 / 18 / 24 / 32 in
    whole pixels, `caption` and `label` deliberately sharing 11 because a label
    is separated by TREATMENT (uppercase + 0.12em) rather than by half a pixel.
    Two absences were found while fixing it and are fixed with it: there was no
    **line-height scale at all** — every line box in the product was Chromium's
    `normal`, a value derived from the FONT's metrics, so the vertical rhythm
    changed with whatever the OS resolved — and no tracking value for large
    type. **And the Space Grotesk question resolved itself:** the repo has never
    contained it, so the app has been rendering in **Bahnschrift, a condensed
    signage face**, at 10.5–13.5 px, on the founder's machine, for its whole
    life. The stack is now deterministic with a `display` slot beside `ui`, so
    swapping in a licensed family is a one-line token change. See the open
    question at the end of this section.
12. ~~**Nine of fifteen pages have no title at all**~~ — **done 2026-08-07**
    (`70dab4f`). `PageHeader` owns the treatment; fourteen pages adopt it and the
    dashboard keeps its greeting, which is its heading by design. The title is
    always `moduleName(id)`, the string the sidebar renders — STUDY's own heading
    had said „Predmeti" while the rail said „Učenje". Eleven private copies of
    `moduleName` are gone with it, and twelve dead CSS rules.
13. ~~**The sidebar throws away its own category names**~~ — **done
    2026-08-07** (`9b10342`). The category name IS the separator now; the hairline
    that used to sit above each group is gone, because saying it twice is how a
    rail starts to look busy. The app also gained its own 27-icon drawn set,
    which is the other half of what makes a rail legible.
14. ~~**Tasks' capture form is always expanded**~~ — **done 2026-08-07**
    (`f88179c`+). Rok, prioritet, lista, sekcija, oznake and the reminder ladder
    are a DISCLOSURE now; a capture is a title and Enter, which is what most of
    them are. Editing an existing task opens them regardless, because that IS
    the details. ~~**Still open:** the four bare unlabelled selects in the view
    controls row.~~ — **done** in `1613b46`, verified 2026-08-07: all four use
    `Select`. The composer's own two — priority (`TasksPage.tsx:4085`) and
    section (`:4104`) — are still raw `<select>` named only by `aria-label`, and
    belong to DC-05's enumerated remainder rather than to this item.
15. ~~**Four surfaces with no hierarchy in their controls**~~ — **done
    2026-08-07** (`9cd3267`, `f88179c`), and the last of them turned out to be
    thirteen. Fokus no longer shows two filled primaries side by side. The
    canvas board bar became the page header with its destructive button marked
    as one. Kalendar's two stacked switchers have visible labels, so „which
    view" and „which calendars" stop reading as one control that wrapped.
    And Datoteke's two contradictory selection idioms were the visible end of a
    much larger fact: **thirteen surfaces had written „which one is on" out
    separately**, in thirteen byte-identical copies of the same three CSS rules,
    and Datoteke's view toggle had drifted off them into a filled primary —
    the treatment this product uses for „press this". `.nx-segmented__option`
    is the app's one answer now, keyed off `aria-pressed` so the state a screen
    reader is told and the state an eye is shown cannot disagree. 170 lines of
    `app.css` went with it.
16. **Spacing has no system** — *half done 2026-08-07.*
    ~~Comparable pages use four different values for the same „space between
    page sections" role.~~ Measured: thirteen page roots across FOUR values —
    `space-3` (Tabla), `space-4` (Kalendar, Datoteke, Alatke, Pretraga,
    Privatno), `space-5` (Zadaci, Beleške, Finansije, Podešavanja, Kontrolna
    tabla), `space-6` (Navike, Fokus, Ishrana). All thirteen are `space-5` now,
    with Tabla the one documented exception: every pixel between its header and
    its board is taken from an infinite surface, and the comment says so where
    somebody would otherwise „fix" it.
    **Still open, and it needs markup rather than CSS** (re-verified
    2026-08-07): Settings cards use one uniform 12 px gap, so „Tema" sits
    exactly as far from its own segmented row as that row sits from the
    unrelated „Akcenat" label — „Izgled" reads as one undifferentiated
    ten-item stack instead of five preferences. The fix is a label-plus-control
    grouping wrapper with a tight inner gap and a wider gap between groups,
    adopted at every caption-followed-by-a-control site in `SettingsPage.tsx`
    and `moduleSettingsPanels.tsx`. (The caption half of this item was the
    overstated claim corrected below.)

**D. Nothing is happening, or nothing is here.** *(`empty-state`,
`loading-state`)*

17. **The shared `EmptyState` renders two different shapes** — *the component is
    fixed, the adoption is not.* `variant="page" | "inline"` shipped in
    `d3751fe` with fifteen adoptions (see DC-05). **Still open, counted
    2026-08-07:** sixteen surfaces still hand-write the shape they need —
    **twelve in `StudyPage.tsx`** (:2622, :2737, :2763, :2839, :3087, :3212,
    :3364, :3421, :3677, :3895, :3943, :3991, :4060) and four in the note panes
    (`noteTemplatePane.tsx:263`, `noteVersionHistory.tsx:110`,
    `privVersionHistory.tsx:136`, `noteTableOfContents.tsx:108`). The visible
    cost is inside one module: „Studije" draws the same sentence — *there is
    nothing in this list* — at three different paddings depending on which card
    it lands in, and at a fourth size in the Teme list. Two of the sixteen sit
    inside menus (`study__linked-picker-empty`, `note__templates-empty`) and
    need a decision on whether menu padding is a legitimate third shape, which
    is why this is an adoption pass with a judgement in it rather than a sweep.
18. ~~**Almost every loading state is one line of grey text**~~ — **done
    2026-08-07** (`abea9c4`). Fourteen surfaces rendered „Učitavanje…" in the
    corner of a blank pane; the canvas rendered LITERALLY NOTHING for its whole
    initial read; and exactly two places had a real skeleton, in two
    byte-identical copies of the same six rules. `LoadingState` is one skeleton
    for the app — deliberately still, because a shimmer would be the loudest
    thing on a page whose whole point is calm. The dashboard board had neither
    state, and an empty board and a loading board looked identical, which is to
    say like a product that failed to start; it has three branches now. The note
    editor adopted `SaveIndicator` in the same pass — it had a `saveError` and
    no counterpart, DC-04 one surface over from where it was found.

**E. Keyboard and focus.** *(`keyboard`, `focus-management`)*

19. ~~**No modal in the app traps Tab**~~ — **done 2026-08-07** (`a4ec079`).
    Twenty-one `role="dialog"` surfaces across seventeen files, one hook
    (`useFocusTrap`) and one pure arithmetic module (`focusOrder.ts`, 22 tests)
    — the index math is the only part a DOM-free Vitest can pin, and reviewing
    the lane found a real defect in it that its own green suite had not: moving
    BACKWARD from „nothing focused" landed one short of the end, and with two
    candidates the wrong answer is a valid index that looks right.
20. ~~**`role="menu"` is claimed and not honoured**~~ — **done 2026-08-07**
    (`a4ec079`). The shared popover does the WAI-ARIA APG properly (focus in on
    open, Arrow keys with wrap, Home/End, roving `tabIndex`, Tab closes because
    a menu is not a modal); Kalendar's two panels, which hold rows with a delete
    button beside each action, are `role="group"` with a label instead. Claiming
    a role you do not implement is worse than claiming none, because a screen
    reader then tells its user to press keys that do nothing.
21. ~~**Sidebar navigation does not answer Space**~~ — **done 2026-08-07**
    (`a4ec079`). Fixed in `NavItem` once, so it holds at every call site — the
    fourteen module rows plus the search and profile rows — without turning the
    row into a `<button>`.

**F. Standing, not optional.**

22. ~~**The raw-colour gate gets machine enforcement.**~~ — **done 2026-08-06**
    (`01e1deb`). `pnpm check:colours` is its own CI step with its own Vitest
    suite; ESLint echoes the TS/TSX half in the editor. Details in
    `architecture/overview.md`. Three defects were found by *exercising* the new
    gate rather than reading it, and all three are the kind that would have made
    it worthless: the escape hatch **failed open** (a marker with no reason was
    accepted whenever any source followed it on the line, which is how anybody
    would actually write it in CSS); the module's `#!` shebang made it
    unimportable by its own test suite under Vite; and a root-level `vitest run`
    globbed `.claude/worktrees/`, collecting the same suites from a checkout at
    another commit and reporting failures belonging to neither.
23. The 10 nits are recorded in the survey output and are picked up opportunis-
    tically while their file is already open — they never justify a pass of
    their own.

### F. What a code sweep found that no document contained — **all closed 2026-08-07**

The same question that produced DC-07 was also asked of the CODE, on the
principle that the ledger can only list what somebody thought to write down. Four
lenses ran over `apps/*/src` and `packages/*/src` — explicit TODO markers, tests
that do not assert, stubs and no-op handlers, and declared-but-unreachable
wires — each finding then verified by an agent instructed to refute it. **The
first three lenses came back essentially clean**, which is itself the useful
result: there are no forgotten TODOs, no skipped tests, and no stub handlers in
this codebase. **Everything below came from the fourth lens and from a follow-up
that walked the layers in the other direction, store → channel.** All of it is
verified by hand, not taken on the sweep's word.

**F1. A folder tree can be built and never rearranged.** *(user-visible)*
`note-folders:move` is complete at every layer — the channel (`shared/ipc.ts:269`),
a fully guarded `ipcMain.handle` (`main/index.ts:8368`), the preload bridge
(`preload/index.ts:373`), the typed `NexusApi` entry (`shared/ipc.ts:8104`) and
`NoteOrgStore.moveFolder`, which validates self-moves and descendant cycles and
has four tests. **No renderer file calls it.** The folder popover offers rename,
recolour, „Nova podfascikla", template, capture-default and delete — no move —
and `NoteOrganizer.tsx` contains no drag handler at all. So nesting is decided
once, at creation, and the only recourse for a misplaced folder is delete +
recreate, which promotes its children to the grandparent and flattens the
subtree. **TASK solved this exact problem** (`TasksPage.tsx:1895`: *„re-parenting
stays the drag's job"*), so this is an omission rather than a position — but
which affordance NOTE gets, a menu item or a drop target, is the founder's call.

**F2. Deleting a logged set asks nothing, on the one surface where it is the
likely place to do it.** *(user-visible, and a ruled class)* `FitTraining.tsx:673`
wires „Obriši seriju" straight to `fitRemoveSet`; the row is gone with no
question and there is no undo. The **dashboard** deletes the same row through
`DashboardSetDeleteDialog` (`DashboardPage.tsx:430`) and asks first. The string
written for the missing warning already exists and is rendered nowhere —
`strings.ts:3822`, `removeNote: „Obrisana serija se ne vraća."`, whose own
comment says *„Said where removing is possible."* This is WAVE 51 item 3's class
exactly (a destructive action with no restore endpoint gets a confirmation), one
module over, and the fix belongs in one shared dialog rather than a second
hand-written one.

**F3. Five store capabilities the app has no channel for.** *(three
user-visible)* Each was written for a surface that was then built a different
way, and each names its own purpose in its doc comment:
- `FocusStore.statsByKind` (`focusStore.ts:306`) — *„what a Pomodoro history
  reads instead of walking `listRange` and summing in the renderer."* There is
  no such channel, and **five renderer sites do precisely what it replaces**
  (`FocusPage.tsx:105`, `StudyPage.tsx:734` and `:1736`, `dashboardWidgets.tsx:711`
  and `:963`).
- `SubjectAttachmentStore.countsBySubject` (`subjectAttachmentStore.ts:204`) — its
  twin `countsByTask` is wired end to end and draws the file-count chip on a task
  row; the subject side has no channel, so „Materijali" cannot show a count.
- `SubjectNoteLinkStore.listSubjectsOfNote` (`subjectNoteLinkStore.ts:165`) — the
  reverse lookup. A note tells you which notes point at it (`notes:backlinks`)
  and never which subject it is filed under.
- `FitWorkoutStore.listByDay`, `FitMeasurementStore.latest` — the app reads only
  the range variants. Internal.

**F4. One write-only ledger and one dangling read.** *(internal)*
`listDocumentRenewals` has a channel, a handler, a bridge and an API entry, and
**zero callers**; no UI shows a document's renewal history. The DATA is not
orphaned — `profileData.ts:285` exports it, restore re-inserts it, and migration
004 documents it as a designed append-only log — so nothing is broken. What is
unfinished is the three-layer wire, which is either a history view somebody
meant to build or a surface that should be deleted; under SEC-EL an unused
renderer-reachable channel is not free.

**F5. Eight orphan strings, and the census that matters more than they do.**
*(cosmetic, with two exceptions)* Every leaf key in `strings.ts` was checked
against the whole source. Exactly eight are never rendered, and **the largest
adjacent group is two** — so there is no screen's worth of written-but-unbuilt
copy anywhere in this app, which is the reassuring half of the finding. The two
that are real gaps rather than dead keys: `tools.clearSearch` („Poništi
pretragu") — the tools search has no clear control, so its no-results line names
nothing to do; and `fitness.…trend.noTrendTitle` („Trenda još nema") — the weight
trend draws one of its two empty states with a title and the other as a bare
line. The rest are a label the control never got (`unitPriceLabel`,
`study.cardDueLabel`, `focus.…minutesLabel`), a third range option no control
offers (`rangeAll`), and one whose comment describes a menu that was folded into
the generic row menu (`tasks.tags.taskMenuLabel` — a stale record, not a gap).

**F6. One settings control that SET-014 reveals and does not point at.**
*(cosmetic)* `dashboard:background` is declared with keywords in
`shared/modules.ts:283` but renders without `labelClass(...)`
(`moduleSettingsPanels.tsx:310`), unlike its own sibling `dim` and the sixteen
other highlighted controls. Searching „pozadina" in Settings opens the right
section and emphasises nothing. `moduleSettings.test.ts` pins declaration ↔
renderer pairing at panel level only, which is why it passes.

**Every F item is fixed** (`321c2fb`, `a0e3fdc`, `7f3ee15`) — except one, which
was refuted by reading the render rather than the sweep: F3's `countsBySubject`
is NOT a missing count. „Materijali" already shows one (`StudyPage.tsx:2613`),
because the hub fetches each open subject's materials for the panel and the
count falls out of the rows. The channel for it was written, typechecked and
then **reverted**: shipping a channel for a figure the page already holds is the
same dead-wire class F4 is about. `statsByKind`, `listByDay`, `latest` and
`listEntries` were left alone on the same reading — a store is a library, and a
complete query surface is not dead code just because today's UI does not need
every member of it.

### G. The seven relational lenses (2026-08-07) — **all closed**

F's four lenses each read one file and asked „is this referenced?". Seven more
asked a RELATIONAL question — two artifacts that should agree, and do not — which
no single-file lens can pose. 19 findings survived adversarial verification, and
every one is fixed; the whole set is in the commits below with the reasoning.

**The two that mattered most were in the notification scheduler** (`7f3ee15`).
Quiet hours were checked for fresh candidates and **not for snoozed ones**, so
„Odloži do sutra" landing at 03:00 rang an OS toast in the middle of the night;
the same loop skipped the appetite gate, so a source switched off re-fired
anyway. And **SET-007 never reached notifications at all**: switching a module
off takes it out of the sidebar, off the dashboard and out of search, and the
scheduler went on deriving from every source whose NTF toggle happened to be on
— a business profile with STUDY off still got exam reminders. *A third defect
fell out of writing the first test*, and was the worst of the three: derivation
was filtered by enabled sources, so a switched-off source stopped deriving,
which meant `dueSnoozed` could not tell „the passport was deleted" from „the
user turned document reminders off" and **dismissed the snooze for both** —
permanently, since the ledger key survives a dismiss. 14 tests.

**Six destructive actions never asked** (`b4af4f5`). Three of them delete a file
off disk: removing an attachment hard-deletes the row and `deleteBlobIfOrphaned`
erases the encrypted copy, and all three panels — notes, tasks, materials — fired
it on one click of a „⋯" item. Three are hard deletes of user-named containers
with no restore endpoint: a FIN category (on a bare „×"), a TASK tag whose links
CASCADE, and a TASK section. Every one of these is the note rail's own dialog,
one module over; the defect was never the wording, it was that six surfaces
performing one class of act had been maintained as if unrelated. `ConfirmDialog`
exists now because the house confirmation had been re-typed by hand in four
files, each with its own focus trap, Escape listener, portal and six class names.

**Five refusals a user could act on were reported as „Pokušaj ponovo"**
(`dc722fa`) — the one action that fails identically forever against a UNIQUE
index. Three STUDY save paths reported to the console and nowhere else.

**Three surfaces a keyboard could not operate** (`f485720`), each beside a twin
that could. **Two dashboard contracts disagreed with their renders**
(`6cc386b`). **Two design-system treatments the gallery could not show**
(`825d5a8`) — including `.nx-segmented__option`, a fourth Button treatment that
thirteen surfaces depend on and one had already drifted off.

**One item is deliberately half-done, and named as such.** `TopicStore` soft-
deletes an exam topic and has no `restore`; the delete now asks (`dc722fa`) so a
mis-click cannot cost the row, but the undo is not built. The restore is
tractable — clear `deleted_at`, re-append at the exam's bottom rank, re-attach
the promoted blocks by their shared stamp — and it was NOT written blind: this
arc could not exercise it by hand, and a stamp-matched re-attach against
`study_blocks_plan_date_topic_kind` is exactly the kind of change that ships a
worse bug than the one it fixes. **A second finding came out of reading it:**
`promoteBlocksTopicNull` can itself violate that unique index, because promoting
a topic's blocks to `topic_id = NULL` collides with any unbound block already on
the same (plan, date, kind) — so deleting a topic can fail outright. Neither has
been reproduced; both want a session that can run the app.


---

# The original MVP slicing (2026-07-05), and what became of it

Moved out of [../roadmap.md](../roadmap.md) on 2026-08-16. Preserved as written:
the timeline anchors were honest targets at the time and the forcing function
named in them was the founder's exams (~mid-August 2026). Read it for the
reasoning, not for the schedule — and note that the product overshot it, which
is the reason a plan you overshot is worth keeping rather than deleting.

### M0 — Foundations (gates everything; ~2–3 weeks) — **done**

Not a release; the platform every release stands on.

- Monorepo skeleton per architecture overview; CI green from commit one
  (typecheck, lint, tests, build matrix, dependency audit — SEC-SC).
- ADR-001 storage layer: schema/migrations package, typed IPC query
  interface, encrypted-at-rest local DB, blob store.
- ADR-008 module registry + contracts (widgets, views, settings, IMEX,
  SRCH indexers) — stubs are fine, shapes are not negotiable later.
- **Design-direction session with the founder** (typography/hue/density/
  motion candidates → his taste call) → design tokens → component gallery →
  views engine core (list + kanban first). No feature UI before the
  gallery is approved (design-system research mandate — this is the
  anti-generic gate).
- Perf harness with the reference dataset; budgets asserted from day one.

Riskiest assumption validated: *the token/component approach can produce a
distinctive UI quickly enough for one person to build 7 modules on top.*

### v0 — Founder Build (desktop, local account, no cloud)

**Goal:** the founder runs his entire exam preparation (Algebra, Linear
Algebra & Analytic Geometry, Combinatorics & Graph Theory) in Nexus daily.
Success test straight from `docs/prd/00-overview.md`. Target: usable by
early August 2026.

**Included requirement IDs:**

- **AUTH (local only):** AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005.
- **ONB (lite):** ONB-001..010 with cloud paths hidden; ONB-012
  (empty-state pattern — it carries the onboarding).
- **DASH:** DASH-001..007 (single dashboard).
- **TASK:** TASK-001..008 + TASK-011 (undo/batch is daily-use quality, not
  a luxury).
- **NOTE:** NOTE-001..009.
- **CAL:** CAL-001..007 (document-expiry ladders included — founder's own
  bank/registration paperwork is a v0 user story).
- **NTF:** NTF-001..006 (fully local scheduling).
- **STUDY:** STUDY-001..009 + STUDY-013 (FSRS, problem cards, backward
  planner with auto-replan, Pomodoro) — the reason v0 exists.
- **SET (lite):** SET-004..009, SET-011 (scheduled local backup),
  SET-012.
- **IMEX (minimal but real):** IMEX-001, IMEX-002 — full export/backup
  works before the founder trusts exam data to the app. No importers yet.
- **DOC (PDF tier only):** DOC-001, DOC-002 (PDF via PDF.js only),
  DOC-003, DOC-007 — study materials are PDFs; other formats wait.

**Explicit exclusions (pushback, in writing):** DASH-008 multiple
dashboards (founder decision keeps it M, but it is a thin layer we add in
Beta without rework — the exam deadline outranks it); SRCH (folders +
smart lists suffice at one-user scale; search debt is repaid in Beta);
PRIV (no cloud yet = its main risk surface absent; crypto deserves
unhurried implementation); Anki import (STUDY-011 — founder starts fresh);
kanban beyond TASK (views engine ships list+kanban, other modules' views
land with them).

**Dependencies:** M0 complete. **Validates:** storage/IPC perf budgets,
FSRS + planner genuinely useful (founder dogfood), design system under
real module load, offline-first honesty (zero network, traffic-captured).

### v0.x — Beta (cloud, sync, web) — free, early adopters get the future lifetime-purchase option

**Goal:** multi-device daily drivers for a small cohort; the beta program
from the raw-spec notes. Rough target: autumn 2026.

**Included:**

- **Backend + cloud AUTH:** ADR-003 stack live (EU VPS, TLS, backups);
  AUTH-006..015, AUTH-017..026 (verification, reset, sessions, business
  profiles, per-profile flags); NTF-007; SET-001..003, SET-010.
- **Sync (ADR-002):** PowerSync rows + Yjs documents + blob sync; soak
  tests nightly; sync status UX (SET-011 cloud surface).
- **Web app:** same renderer, COOP/COEP deployment, PWA; in-app-only
  notifications (decision #11).
- **PRIV (complete):** PRIV-001..010 + PRIV-011, PRIV-012 (ADR-005;
  Recovery Kit UX with verified-save; web trust caveat copy).
- **SRCH:** SRCH-001..006 (attachment indexing off by default,
  decision #11).
- **DASH:** DASH-008 (multiple dashboards + sidebar category separators),
  DASH-009.
- **DOC (full tiers):** DOC-002 all formats, DOC-004..009.
- **IMEX (full):** IMEX-003..009 (importers, sr+en prompt packs, dry-run
  preview, scheduled backups on the same container).
- **TASK/STUDY completions:** TASK-009, TASK-010; STUDY-011 (Anki import),
  STUDY-010, STUDY-014; NTF-008, NTF-009.
- **FIN:** FIN-001..008 (first life-hub beyond study; organized-life
  persona is the beta recruiter).
- **HABIT:** HABIT-001..004 — deliberately first C-tier module, to prove
  the compact-module pipeline end to end.
- **FDBK:** FDBK-001..004 (curated statuses per decision #11) — the beta
  loop itself.
- **LAND (v1 scope):** LAND-001..006 under the codename until the name
  clears (decision #1); direct downloads + auto-update; **code signing +
  notarization are a hard gate before any public download** (SEC-SC).

**Exclusions:** sharing/collaboration (nothing to share into yet), canvas,
fitness, utilities, PRO packs, monetization. **Validates:** sync
correctness under real multi-device use, ZK recovery-kit comprehension
(save-rate metric), onboarding completion (4-screen bet), ops load on one
person, update pipeline.

### v1 — Commercial launch

**Goal:** the product the landing page promises, paid. Target: H1 2027,
scope-managed rather than date-managed.

**Included:**

- **SHARE:** SHARE-001..006 (read-only + public links; recipient-list
  visibility per decision #11), then **grocery co-edit** (SHOP-003 special
  case over the Yjs path — PRD-friction #1) as the only realtime surface.
- **CANV:** ADR-011 spikes → engine decision → CANV-001..010; note
  mirrors + "vizuelizuj" (NOTE-011 pairing).
- **FIT:** FIT-001..013 — curated food DB with provenance + report flow
  (decision #7), label-OCR pipeline per ADR pending (FIT OQ#2), IMR/
  CAPNUTRA licensing outcome incorporated (founder action).
- **UTIL:** UTIL-001..005, UTIL-011 + converters trimmed to
  image+documents first (UTIL OQ#2 resolved here: media encoders wait for
  the ffmpeg licensing ADR).
- **PRO pack #1 — Arhitekta (predmer i predračun):** PRO-001..003,
  PRO-010; validated with the founder's architect contact as beta user
  (PRO OQ#1). — **Overtaken 2026-08-13/14.** Eighteen toolkits shipped instead
  of one, packs became subjects rather than job titles (so „Arhitekta" is now
  „Gradnja i projektovanje"), and PRO-002/003 shipped in a changed shape. What
  did NOT ship is exactly `PRO-010`: predmer i predračun is a document with a
  data model, not a calculator, and OQ#1 (the norms dataset) still blocks it.
  See PRD 30's status box.
- **STATS lite:** STATS-001, STATS-002 (mood × focus first correlation,
  decision #11). **AUTO lite:** AUTO-001..003 (~10 triggers / ~8 actions,
  decision #11).
- **AUTH-015 (2FA)** if not already landed in beta hardening.
- **DOC-011** PDF annotation (decision #11: confirmed v1.x — first minor
  after launch if it misses the cut).
- **Monetization groundwork:** subscription entitlements as feature-flag
  data (ADR-008 manifests already carry them), payment provider selection
  (merchant-of-record class, EU-friendly) as its own small ADR,
  early-adopter lifetime offer honored from the beta cohort list
  (decision #10).

**v1.x waves (explicitly after v1.0, so 14 C-tier modules cannot sink the
launch):** GOAL, TIME, HLTH, CAR, TRAV, INV, SHOP (rest), READ, LIB, FUN,
STATS-003+, AUTO-004+, PRIV premium cap raise (1 GB+, decision #11),
remaining S-tier polish. **Android kickoff** opens after v1.0 per decision
#9 through the ADR-006 gate. W-tier (VLT, AI, PLUG) stays behind its
revival gates — nothing W enters before v1, per the rules.

### Standing pushback

1. The founder's bias is scope growth; every "just one more module in v0"
   trades directly against having the app for his own exams. v0's cut
   list above is the deal.
2. C-tier breadth is Nexus's long-term moat but v1.0's enemy — waves,
   never a big bang.
3. Any new idea lands in `docs/notes/raw-spec.md` and waits for the next
   release boundary; mid-release scope changes need a written founder
   decision.


---

# The roadmap as cut on 2026-08-16, and why it was re-cut

Moved out of [../roadmap.md](../roadmap.md) on 2026-09-26, whole and verbatim
(headings demoted one level, links re-rooted to this directory). It was replaced
because five of its statements had stopped being true while it went on saying
them: the desktop was at 1.3.0, not 1.1.0; W3 — the desktop sync wiring — had
closed on 2026-08-30; electronics E3–E6 had all shipped by 2026-09-22; the
„W3 or E3 first" question it sent to the founder had been overtaken by his
2026-08-31 pause of all web and sync work; and the Electron 42 deadline it listed
as the one item arriving whether or not anyone worked on it had been met on
2026-09-06 by moving to 44. Its opening line was the pattern that let that
happen — commit, migration and version counts copied from the status file on
the day it was cut — so the re-cut carries none.

**What order things happen in, and why.** For what is *true today* read
[STATUS.md](../STATUS.md); this file is only about sequence. Re-cut **2026-08-16**
against what actually shipped — the previous cut was made on 2026-08-02 and had
gone stale on the one question that matters most, still saying the cloud half
was untouched after thirteen server migrations and four sync packages had
landed.

The original 2026-07-05 slicing (M0 / v0 / v0.x / v1) is preserved in
[log/superseded-status-sections.md](../log/superseded-status-sections.md). It is
worth reading for the reasoning, and it was overshot in almost every direction:
everything v0 cut shipped, and so did most of what v0 explicitly excluded.

---

### Where we are

**497 commits, 67 local migrations + 13 server ones, 16 registered modules,
desktop at 1.1.0.** The
desktop app is a finished product in daily use and has been since 2026-08-02.
Nothing is released — no tags, no downloads, no signature.

Two founder sentences set the current sequence, and the second supersedes the
first on scope while leaving it in force on quality:

> *„generalno je ceo UI dosta jednostavan i bazican, samo su nabacani dugmici i
> sve, deluje sirovo app bas."* (2026-08-02, after the first real install)

Then, six days later:

> *„resi sve sto je ostalo… da bude clean slate potpuno, i onda da pripremis
> back i front za sajt… supabase za backend… da se pripremi sync desktop app i
> webapp, da bude ful usluga."* (2026-08-08)

So: **breadth is not the constraint and has not been since 2026-08-02** — finish
quality is — and **the web app and its backend are in scope** since 2026-08-08.

---

### Done

- **P1 — the polish arc.** Closed 2026-08-07. Every item in it was a failure
  against design rules already written down, which is why none of it needed a
  decision. Two code sweeps on the same day closed with it.
- **P2 — FIT training.** Closed 2026-08-07, and with it ADR-081. Slices b–d:
  the seven tables and five stores, „Trening" as the page's second section,
  „Napredak" derived from the sets themselves, and „Merenja" with measured
  energy expenditure.
- **P2.5 — the UI overhaul.** Three waves, ending in **v1.0.0** (2026-08-08).
  Wave 1's drawn-data layer was rejected by the founder (*„ovo nije ni 3%
  koliko dobro mora da bude"*) and rebuilt; the instruction that changed the
  method was *„nadji nacin da ti sam vidis screenshotove apsolutno svega u
  app"*, which is why `pnpm --filter @nexus/desktop shots` exists and why
  looking at the app is now a command rather than a favour. What P2.5 still owes
  is small and is listed in [STATUS.md](../STATUS.md) §4.
- **PRO — the professional drawer.** Out of band, 2026-08-13/15, because the
  founder asked for it directly after seeing the developer drawer. 18 toolkits,
  274 tools, 1 991 hand-derived assertions, and disclaimers made a property of
  the contract rather than copy somebody has to remember. Core, surfaces and
  wiring all shipped — including `cents-ratio`, whose screen was the one open
  question here and was built on 2026-08-14.
- **The server side.** Thirteen Supabase migrations executed against a real
  Postgres 17, an RLS wall proved by 109 pgTAP assertions running in CI, three
  Edge Functions, and `@nexus/sync-transport` measured against a live PostgREST
  rather than written from the documentation.
- **Linux.** An AppImage, a tarball and a real Gentoo ebuild, all built and
  verified.
- **v1.1.0**, built 2026-08-16 after the pushes were green.
- **W1 — Recovery-Code adoption, end to end.** Closed 2026-08-16. The protocol
  layer had been finished for a week and no screen reached it; now the desktop
  can be recovered from the Recovery Kit, proved by nine tests that run two
  machines against one fake server.
- **W2 — the sync engine.** Closed 2026-08-16, and it went further than the
  slice this file scheduled. The apply path landed with its four rules
  (transactionally co-located state, no echo, refuse a stale object, write the
  state even when the row is unchanged) and DC-14's deterministic repair; then
  the loop itself landed on top of it, so **`@nexus/sync-engine` now carries a
  row between two real databases**.
- **The scheduler.** Closed 2026-08-17 (`8697a75`) — the first half of what W3
  was scheduled to be. What the second half turned into is W3 as it now stands.
- **The profile's content key.** Closed 2026-08-17, both halves: the wire
  (`6b4fd25`) and the desktop's fetch-or-mint (`3f5f65b`). Found while
  wiring the scheduler — `syncOnce` wanted `contentKey`, `ckEpoch` and `keyFor`
  and nothing in the product produced any of them. **The server needed nothing**:
  the „missing insert grant" was a false finding from a line-grep against a
  two-line statement (DC-62), and the wall now carries a rule that would have
  answered it. The rule the module makes structural is that the only path to a
  usable key is unwrapping a wrap the server already holds, so a row can never be
  sealed under a key no peer can fetch.
- **ELEC E1 and E2 — the electronics workbench.** Closed 2026-08-21
  (`8fa6b25` … `4e20e26`). **Not part of the sequence above**: the founder asked
  for an Arduino/Raspberry module on its own terms, and it was built on its own
  terms — the model and its 153-part catalogue, then the bench, the drawer and
  the inspector. Slices E3–E6 (electrical rules, sketch generation, simulation,
  the external ROS 2 runner) are **not** started and are sequenced below.

---

### Now

#### W3 — the desktop wiring

Every piece a round needs now exists — the engine, the scheduler, the wire, the
content key — and **nothing constructs any of them.** What is left is mechanical
and it is the whole of the distance between the mechanism and a user having sync:
`syncStoreFor` and an `HttpPort` in the main process, the content key opened per
round and closed when it ends, `createSyncLoop` driving them, a round and its
report over IPC, all behind the cloud-off boundary — a build with sync off
constructs no ports.

The Realtime signal lands on `SyncLoop.nudge` afterwards; it makes sync instant,
the interval is what makes it correct.

#### W4 — pairing, or the decision not to build it

The two halves of the pairing subsystem implement two different protocols, and
the hole they were both aimed at now has a route that needs neither. Whether
desktop→desktop pairing is still wanted is a founder question and it is in
[STATUS.md](../STATUS.md) §5. If it is, the rendezvous table gets reshaped to the
protocol that is actually implemented and tested.

#### W5 — web auth and the web `NexusApi`

`apps/web` is a shell with a typed proxy that throws. Everything behind it is
unwritten, and it is the first work in this sequence that a user could see.

#### W6 — deployment on Cloudflare Workers

The target is chosen and nothing is deployed. **This is where the unsigned-build
rule stops being theoretical**: it is the first release surface beyond the
founder's own machines.

#### E3–E6 — the rest of the electronics module

Sequenced after W3 rather than beside it, because ELEC was an insertion into a
phase the founder opened first and W3 is the older commitment. The order inside
it is fixed by dependency: **E3** electrical rules (the catalogue already carries
`supply`, `current`, `logicVolts` and per-pin `volts` and nothing reads them),
then **E4** sketch generation, then **E5** in-app simulation, then **E6** the
external ROS 2 runner.

**E6 is the one slice that needs a design decision before any of it is written.**
A runner spawns a process and talks to it; the product's standing guarantee is
that a build with cloud off can reach neither. DEV-007 admits the spawn in
principle, and the boundary that admits it has to be built the way the cloud-off
packet boundary was — before the feature, not around it — with its own gate
(`check:runner`).

Which of W3 and E3 goes first is a founder question, in
[STATUS.md](../STATUS.md) §5. The recommendation there is W3.

---

### Standing gates that outrank everything above

- **No public download before code signing and notarization** (SEC-SC-03/04).
  Today's installers are unsigned.
- **No performance claim before a harness measures it.** The budgets in
  [architecture/overview.md](../architecture/overview.md) are targets nothing
  checks.
- **The Electron 42 pin has a deadline** — support ends 2026-10-20. Not started;
  it is the one item here that arrives whether or not anyone works on it.

---

### Not in the sequence, and deliberately

Route-level code splitting, the layer scale and the sizing contract are real
work that serves both the desktop app and the web build — they are in
[STATUS.md](../STATUS.md) §4 rather than here because they are debts, not phases,
and they get paid inside whichever wave next opens the files they live in.

The rest of the module catalogue — goals, time tracking, health, car, travel,
inventory, shopping, read-later, library, the password vault, entertainment,
sharing, analytics, automation, the AI assistant, plugins — is in
[SPECIFICATION.md](../SPECIFICATION.md) §4 with its priorities. Several genuinely
depend on sync existing first. None of them is next.
