# Nexus — A Plain-Language Guide

> **For anyone, technical or not.** This explains what Nexus is, who it's for, how
> you use it, and why it's different — in everyday language, with no programming
> terms. For the full feature list see [SPECIFICATION.md](SPECIFICATION.md); for
> what is built and what is not yet done see [STATUS.md](STATUS.md).

---

## What is Nexus?

Most people run their lives across a dozen different apps: one for to-dos, another
for notes, a calendar, a budgeting spreadsheet, a fitness tracker, flashcards for
studying, something for opening files, and a drawer full of documents — ID cards,
passports, insurance — that nothing reminds them about until they've expired.

Everything is scattered. Each app wants its own account and stores your data on
someone else's servers. Nothing talks to anything else.

**Nexus brings all of it into one place.** It's a single app that handles your
tasks, calendar, notes, studying, finances, fitness, files, reference libraries
and games — where everything works together. One home screen. One calendar. One
reminder system. One search box. One consistent, calm look.

The idea isn't that any single piece is magical on its own — plenty of apps do
to-dos or notes. The value is that they're **finally in one place and connected**,
so you stop juggling and stop copying information from one app to another.

---

## Who is it for?

- **Students first.** The author built it for his own studies and everyday life
  admin.
- **Then professionals** — architects, developers, freelancers — and really anyone
  who feels buried under scattered obligations.
- Over time, tailored **packs** for specific trades and interests, all built on the
  same core.

---

## The three ideas that make Nexus different

**1. It works without the internet — always.**
Your data lives on your own computer, and every feature works with the internet
completely off. Nexus does not connect to a server, so there is nothing to sign up
for and nothing that stops working when the connection does. The app makes a
network request only when you turn on one of its two opt-in modes, and it cannot
make one in the default mode.

**2. Your privacy is built in, not promised.**
Private notes are locked so securely that **not even the people who make Nexus could
read them**. This isn't a policy on a website — it's how the app is built. And you
can always export **all** of your data and take it with you. Nexus never holds your
information hostage.

**3. You only see what you need.**
Nexus has many parts, but you don't get all of them dumped on you. A short setup at
the start tailors the app to you, and everything else stays tucked away: any module
can be hidden, and the sidebar's groups can be reordered. You can even keep your
**personal** and **business** lives in completely separate spaces.

---

## What you can do with it today

Nexus is a **desktop program** for Windows, Linux and macOS that you install like
any other app. It is unsigned for now, so Windows warns on first run and macOS asks
for a right-click → Open. It has been in daily use since 2 August 2026.

**Getting in.** The first time you open it, a short setup asks your name, lets you
pick a light or dark look, and asks a few questions about your life so it can
switch on only the parts you'll actually use. Your account lives on your computer
and is locked with a passcode. You can keep several accounts on one machine, and
split your life into a **personal** and a **business** profile that never see each
other's data.

Every module below is built and usable. The app registers **42 modules**, counted
from the compiled-in list and the module folders (see [STATUS.md](STATUS.md) §2),
grouped the way the sidebar groups them.

### Plan

- **Tasks** — to-dos with priorities, due dates, sub-tasks, lists, sections,
  recurrence, dependencies, templates and attachments. A checklist, a board, cards
  or a calendar view, smart lists, batch edits and undo.
- **Calendar** — month, week, day and agenda views; events you can drag and resize;
  repeating events and birthdays. It also holds the **document tracker**: you tell
  it when your ID card, passport, driver's licence or car registration expires, and
  it shows each one as green, amber or red and reminds you weeks ahead. Calendar
  files import and export.
- **Habits** — daily or weekly quotas, a calendar of what you did, and gentle
  streaks that don't punish you for one missed day.
- **Focus** — one timer for the whole app, a Pomodoro that keeps running while you
  navigate, and the same session whether you started it here or in Study.
- **Timers** — a stopwatch and named countdowns that keep running with the page
  closed.

### Knowledge

- **Notes** — rich notes with folders, tags, attachments, links between notes with
  automatic backlinks, version history, templates and flashcards written inside a
  note.
- **Files** — preview PDFs, images, text, code, spreadsheets and archives inside
  Nexus, without opening anything else.
- **Study** — subjects and exams with countdowns; flashcards with spaced-repetition
  scheduling that decides *when* to review each card; cloze and problem cards; maths
  typeset properly; and an exam planner that works backwards from the exam date and
  re-plans when you fall behind. You can import an Anki deck.
- **Reference** — Wikipedia, dictionaries and manuals you read without the internet,
  from the content packs you have installed.
- **Reader** — books from content packs: read, search and print them.
- **Maps** — the map module: search places, drop pins and measure distances. Map data
  arrives as a pack; the Serbia map pack is not built yet.
- **Translator** — a Serbian–English dictionary and travel phrases that work offline.
- **Recorder** — a voice and camera diary: record sound or video and play it back.
- **Astronomy** — the solar system in 3D, day and night on Earth, tonight's sky, and
  the Sun and Moon for a chosen place.
- **Assistant** — a conversation with a local model that knows the app and your own
  data. It runs on your computer, with no internet.

### Life

- **Private notes** — a vault whose contents are encrypted so that nobody but you —
  not even us — can read them. It has its own Recovery Kit, separate from your
  account, so losing one doesn't lose the other.
- **Finance** — accounts, transactions, categories, budgets and subscriptions,
  including pausing one. Each currency is tracked **separately** and never
  converted, because a rate the app can't verify would silently misstate money.
- **Fitness** — a food catalogue of 426 public-domain entries with the source of
  every number recorded, meal logging and daily totals; 230 exercises you can filter
  by equipment, muscle or movement; sessions and routines; personal records; and body
  measurements whose energy figure is worked out from your own weight trend and what
  you ate, not guessed from a formula.
- **Car** — a service book: vehicles, services, intervals, fuel and faults. No
  advice of its own.
- **Pantry** — what is in the house, what runs out, and what expires.
- **Cookbook** — your recipes and recipes from packs, with ingredients, steps and
  nutrition.
- **Emergency card** — the facts a stranger or a medic can read when you cannot
  speak.

### Culture

- **Library** — the books, films and series you read and watch: what is on the wish
  list, what is in progress, and what is finished.
- **Culture** — museums, theatre, concerts and cinema: a visits log, notes per venue,
  an arts guide, and your own music.

### Make

- **Tools** — a drawer of everyday converters and calculators. Units, percentages,
  VAT, a loan calculator and unit prices.
- **Professional tools** — a drawer of **353 tools in 32 packs**, each tool declaring
  who it is for. Packs are fetched the first time one of their tools is opened. A
  tool whose answer somebody could be hurt by carries a visible notice that travels
  with the number when you copy it out, and a rule that can change — a tax rate, a
  deadline, a safety factor — is typed by you rather than assumed by us.
- **Calculator** — one-line calculation with variables, units, history and a
  scientific keypad.
- **Signals** — Morse, an ASCII table, a tuner and a sound meter. The microphone
  opens only when one of them is started.
- **Mini apps** — a metronome, dice, counters, a scoreboard, typing practice, dates,
  a world clock, a screen light and a QR reader.
- **Scanner** — reads text off an image or the camera and hands it to a note.
- **Drawings** — open AutoCAD drawings: layers, measurements and print to PDF. DXF
  works right away; DWG needs a pack.
- **Workshop** — view STL models, G-code toolpaths and Gerber boards.
- **The Lab** — serial, battery, tone and light: what the laptop can do beyond its
  job.
- **Canvas** — an infinite board for drawing, diagramming and arranging ideas, with
  your notes, tasks and events placed on it as live cards.
- **Electronics** — a workbench for circuits: a 153-component catalogue, wiring with
  checks that catch electrical faults, generated Arduino and ROS 2 code, a simulation
  of the board's pins, and an optional run in a real toolchain that needs your consent.

### Play

- **Arcade** — five quick games for a break: Minesweeper, Blocks, Snake, Bricks and
  2048.
- **Cards** — nine card games: six solitaires and three against the computer.
- **Chess** — against the engine or another person, with clocks, saved games and PGN.
- **Board games** — six games against the computer or on one machine.
- **Puzzles** — Sudoku, nonograms, mahjong and Numbers. Every game is saved and picks
  up where it stopped.

### Shell

- **Dashboard** — a home screen of cards you arrange yourself: today's agenda,
  upcoming tasks, documents about to expire, exam countdowns, habit streaks, study
  minutes. Several named dashboards, a background image, and a click on anything to
  jump to it.
- **Settings** — themes, accent colour, which modules are on, per-module preferences,
  keyboard shortcuts you can remap, notification appetite and quiet hours, profiles,
  scheduled encrypted backups, the network modes and the third-party notices.

**Across all of it.** One search box that finds anything anywhere. Reminders you can
snooze. Undo on deletes. And a full export of **everything** into a single sealed
archive you can carry away or restore — including someone else's archive merged into
yours.

**Content packs** are signed packages you install from a file, a USB stick or the
app's download screen, with the network mode switched on. Each one carries its own
licence and source. They include offline encyclopedias and survival and reference
guides from public, openly licensed sources.

---

## What's still to come

Nexus is still being finished, in this order:

- **A UX overhaul.** A pass over how the app works, not only how it looks: the most
  common tasks of every module walked and their dead ends fixed, shared patterns for
  headers, lists, forms and dialogs, and one pass per sidebar group.
- **More of the libraries and readers.** More reference libraries as packs, an
  offline map for the regions you choose, OCR language packs for the scanner, and
  printing packs to PDF so the material can be kept on paper.
- **A finished packs repository.** Every pack public, documented, with its licence and
  attribution.
- **The local AI assistant, reaching every module.** The assistant comes last. It
  answers from your notes, the installed packs and the app's own manual, asks before
  it changes anything, and searches the web only when you turn that on.

The full list is in [SPECIFICATION.md](SPECIFICATION.md), and exactly what is finished
and what is not is kept up to date in [STATUS.md](STATUS.md).

---

## How it's being built (in plain terms)

- **Offline first.** Nexus is an application on your computer. Sync, a cloud service
  and a web app are on hold permanently, so there is no website or online account to
  use, and none is planned.
- **One piece at a time, finished properly.** Rather than leaving lots of
  half-finished features around, each part is built completely before moving on.
- **Careful about quality and security.** Every change is checked automatically
  (does it build, does it pass its tests, does it still run end-to-end, does it match
  the design rules) before it's saved. Security is taken seriously from the very
  first line.
- **A consistent, deliberate look.** A lot of care goes into making Nexus *not* look
  like a generic, templated app — it has its own calm, distinctive style in both its
  light and dark themes.
