# Roadmap

This is the public, high-level plan. It deliberately carries **no dates**: the
project is maintained by one person, and a date that slips is worse than no date.
The detailed, dated working notes stay in the repository's own `docs/` tree, and
what each release changed is in [CHANGELOG.md](CHANGELOG.md).

## Where the project is

The desktop application is **finished and in daily use**, and its latest release
is published. Every module in the registry — tasks, calendar, notes, files,
study, habits, focus, fitness, finance, the professional toolkits, the reference
libraries, games, the electronics workbench and the rest — runs against a local
encrypted database. The network is off unless the user turns on one of two opt-in
modes: update checks, or content-pack downloads.

It installs like an ordinary program on Windows, Linux and macOS: an installer for
Windows, an AppImage and a tarball for Linux, and a dmg for macOS. The interface
ships in **Serbian and English**, follows the system language on first run and
remembers the choice.

## Ahead

The work that is planned, in the order it runs:

1. **A UX overhaul.** Each module's most common tasks walked and their dead ends
   fixed, shared patterns for headers, lists, forms and dialogs, navigation across
   all tools, and one pass per sidebar group.
2. **More of the libraries and readers.** More reference libraries as content
   packs, an offline map for the regions you choose, OCR language packs for the
   scanner, and printing packs to PDF.
3. **A finished packs repository.** Every content pack public and documented, with
   its licence, source and attribution shown in the app.
4. **A local AI assistant, last.** It runs on your computer, answers from your own
   data and the installed packs, reaches every module through the same tools the
   app uses, asks before it changes anything, and searches the web only when you
   turn that on.

Code signing for Windows, so the installer stops triggering a SmartScreen warning,
is open. It is the one item that depends on something outside the repository.

## On hold — sync and the web app

Nexus stays an offline application. A sync engine, its cryptography, a server
schema and a browser build of the interface were built and tested earlier; they
stay in the repository, hidden in the app, and no work on them is planned. Moving
to another computer is an export: one archive, protected with a password if you
like, imported on the other machine.

## Later — the wider catalogue

The full product ambition is larger than the modules that exist: goals, time
tracking, travel, a password vault, analytics, automation, and a plugin system,
each of them working with the network off. None of them is next.

## What will not change

- **Local-first.** Your data lives on your device, encrypted, and the app works
  with the network off.
- **No cloud.** There is no server and no account, and the default mode cannot
  reach the network at all — enforced in CI, not promised in copy.
- **Offline is the default, and the network modes are opt-in.** A user who turns
  neither on stays in the offline product, which makes no network request.
- **No telemetry, no analytics, no crash reporting.**
