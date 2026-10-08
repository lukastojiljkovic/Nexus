# Roadmap

This is the public, high-level plan. It deliberately carries **no dates**: the
project is maintained by one person, and a date that slips is worse than no date.
The detailed, dated working notes stay in the repository's own `docs/` tree.

## Where the project is

The desktop application is **finished and in daily use**, and its latest
release, 1.5.0, is published. Sixteen modules — tasks, calendar, notes,
documents, study, habits, focus, fitness, finance, electronics and the rest —
run against a local encrypted database with no network path; the only connection
Nexus can open is the update check, and only when the user turns it on. It
installs like an ordinary Windows program, and builds exist for Linux as an
AppImage, a tarball and a Gentoo ebuild.

The interface ships in **Serbian and English**. It follows the system language
on first run and remembers the choice.

## Now — after 1.5.0

Release 1.5.0 is published (2026-10-08): Settings in categories and sub-pages,
and the opt-in update check described below. Each release carries the Windows
installer, the Linux AppImage and the tarball, with checksums and their Ed25519
signature, an SBOM, build provenance and the third-party notices generated from
the exact released tree. The open-source paperwork (licence, security policy,
contribution rules, privacy statement, terms, changelog) and the repository's
own settings (branch protection, secret scanning, Dependabot, private
vulnerability reporting, Discussions) are in place.

Still open: Windows code signing, so the installer stops triggering a
SmartScreen warning.

## 1.5.0 — a network mode, and update checks you can turn on

1.5.0 adds one question to the product and keeps the answer a choice. On the
first start it asks whether Nexus may use the network at all: **Offline only**
(the default, and what every release so far has been) or **Offline + update
checks**, which lets Nexus contact GitHub for one purpose — checking for and
downloading a new version of itself.

Offline stays the default, and update checks are opt-in. A user who picks
**Offline only** is in exactly the 1.4.0 product: the boundary in the main
process is unchanged, and updates are installed only when they ask for one. A
user who turns the checks on gets a version, its release notes, and an
**Download and install** button — nothing downloads until they press it, and every download
is verified against a key compiled into the app. In **Offline + update checks**
mode GitHub sees the device's IP address, as any server does; your notes and
data never leave the computer. The mode is changeable at any time in Settings,
and the reader is told a restart is what applies it.

## On hold — sync and the web app

Nexus stays an offline application. A sync engine, its cryptography, a server
schema and a browser build of the renderer were built and tested earlier; they
stay in the repository, no release can reach a server with them, and no work on
them is planned. Moving to another computer is an export: one archive, protected
with a password if you like, imported on the other machine.

## Later — the wider catalogue

The full product ambition is much larger than the sixteen modules that exist:
goals, time tracking, health, car, travel, inventory, shopping, read-later,
library, a password vault, entertainment, analytics, automation, an AI assistant
and a plugin system, each of them working with the network off. None of them is
next.

## What will not change

- **Local-first.** Your data lives on your device, encrypted, and the app works
  with the network off.
- **No cloud.** There is no server and no account, and the local path cannot
  reach the network at all — enforced in CI, not promised in copy.
- **Offline is the default, and update checks are opt-in.** Every release so far
  has made no network call at all, and a user who says no to update checks stays
  in exactly that product.
- **No telemetry, no analytics, no crash reporting.**

