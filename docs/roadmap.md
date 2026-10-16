# Nexus Roadmap

**What order things happen in, and why.** For what is *true today* read
[STATUS.md](STATUS.md); this file is only about sequence. Earlier cuts of this
file, and the 2026-07-05 slicing they replaced, are kept in
[log/superseded-status-sections.md](log/superseded-status-sections.md).

**This file carries no running figures and names no version except the current
release.** Commits, migrations, modules and gates live in [STATUS.md](STATUS.md)
§1, where they are measured; the release history is in
[CHANGELOG.md](../CHANGELOG.md).

---

## Where we are

Nexus is an offline desktop application, in daily use, and released: the current
release is **2.0.3**, tagged `v2.0.3`. Every release is unsigned for now
([DEV-008](deviations.md)).

Two decisions set the sequence:

- **Offline only.** Sync, cloud and the web app are on hold permanently
  (2026-10-08). Nexus is an offline application, and nothing about a server,
  an account sync or a web app is planned.
- **Breadth is not the constraint; finish quality is.** The modules that exist
  are finished end to end before anything new is added, and the new work below
  is the work that makes what exists easier to use and reach.

---

## Done

- **The desktop application** — the module kit, every module in the registry
  usable end to end on an encrypted local database, the professional toolkits,
  the astronomy corner, the electronics workbench, the cards, boards, puzzles
  and arcade games, and the assistant's first working version.
- **Content packs** — signed, hash-pinned packages installed from the app
  through the `downloads` network mode, with the catalogue published in the
  packs repository.
- **Network modes** — `offline` by default and unable to make a request;
  `updates` and `downloads` opt-in, each fixed for the life of a launch.
- **Releases** — tagged, built by CI from the tag, with checksums, an Ed25519
  signature over them, an SBOM and build provenance. Windows, Linux and macOS.
- **Desktop loose ends, first pass** — every package declares its side effects,
  every page is its own chunk, and each professional toolkit loads when one of
  its tools is opened.
- **Electron** — kept on a supported major, with the screenshot sweep as the
  check that a major bump needs.

---

## Ahead

The open phases of the plan, in the order they run. Each step starts on what the
previous one left in place.

### 1. The UX overhaul

A method, not a list of screens. The app is inventoried in both languages and
both themes at the two window sizes the sweep measures; each module's three most
common tasks are walked and the dead ends recorded; the shared patterns (page
header, empty state, list and detail, form, dialog and toast) are settled before
any page is restyled; navigation (groups, pinning, the launcher, search across
tools) is finished; then each group (Plan, Knowledge, Life, Make, Shell) gets one
pass with before-and-after screenshots.

### 2. Stage two of the modules, and the lazy copy

The second stage of the kit modules, and the loose ends of the first pass that
[STATUS.md](STATUS.md) §4.1 still lists. The largest of them is the copy: the
strings table is loaded at startup in full, and splitting it per surface, with
each locale loaded on demand, is the design that item asks for.

### 3. Libraries, packs and readers

- the offline reader for Kiwix libraries, and the reader for packaged books;
- the packs the app is meant to carry: survival and reference content, recipes,
  the dictionary, car help and the make-by-hand content;
- an offline map, per region, with offline search;
- DXF and, through a converter pack, DWG; the OCR scanner with its language packs;
- printing packs to PDF, so the material can be kept on paper as well.

### 4. The packs repository, as a finished public artifact

The packs repository becomes a finished public artifact: its signed catalogue
and packages documented, each package carrying its licence, source and
attribution, which the app shows on its credits screen.

### 5. The local AI agent, last

The agent comes after the knowledge packs it draws on. It runs on a local model,
answers from the user's own data and the installed libraries, and reaches every
module through the same tools the app uses. It asks before it changes anything,
treats library text as data and never as instructions, and searches the web only
when the user turns that on.

---

## On hold permanently

Sync, cloud and the web app. The code stays in the repository, hidden behind one
switch (`SYNC_ON_HOLD`), and it keeps building and passing its own checks. There
is no resume order and no date, and nothing in the public documents describes it
as coming. What exists and what it still owes are recorded in
[STATUS.md](STATUS.md) §3 and §4.2.

---

## Standing gates that outrank everything above

- **Offline first.** A network path is added only as an opt-in mode that is
  fixed for the life of a launch, and `offline` stays unable to make a request.
- **No silent unsigned download.** Releases are unsigned by founder decision
  under [DEV-008](deviations.md): the release notes say so, the macOS notes say
  the dmg is un-notarised, and updates are verified against the key compiled into
  the app. The first signed release closes the decision.
- **No performance claim before a harness measures it.** The budgets in
  [architecture/overview.md](architecture/overview.md) are targets nothing
  checks, so performance is recorded in measured numbers, not in targets.
- **An Electron major is a founder decision, and the screenshot sweep is part of
  it.** CI cannot run the sweep, so a green check on a Chromium bump covers only
  the half of the verification that does not decide anything here.

---

## Not in the sequence, and deliberately

The rest of the module catalogue in [SPECIFICATION.md](SPECIFICATION.md) §4 that
the plan does not name, among them goals, time tracking, travel, the password
vault, sharing, analytics and automation, is not scheduled. Several of them would
need sync. None of them is next.
