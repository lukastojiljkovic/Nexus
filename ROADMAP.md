# Roadmap

This is the public, high-level plan. It deliberately carries **no dates**: the
project is maintained by one person, and a date that slips is worse than no date.
The detailed, dated working notes stay in the repository's own `docs/` tree.

## Where the project is

The desktop application is **finished and in daily use**, and its first public
release, 1.4.0, is published. Sixteen modules — tasks, calendar, notes,
documents, study, habits, focus, fitness, finance, electronics and the rest —
run against a local encrypted database with no network path at all. It installs
like an ordinary Windows program, and builds exist for Linux as an AppImage, a
tarball and a Gentoo ebuild.

The interface ships in **Serbian and English**. It follows the system language
on first run and remembers the choice.

## Now — 1.5.0

Release 1.4.0 is published: the Windows installer, the Linux AppImage and the
tarball, each release carrying checksums, an SBOM, build provenance and the
third-party notices generated from the exact released tree. The open-source
paperwork (licence, security policy, contribution rules, privacy statement,
terms, changelog) and the repository's own settings (branch protection, secret
scanning, Dependabot, private vulnerability reporting, Discussions) are in
place.

The next release is tracked in the
[1.5.0 milestone](https://github.com/lukastojiljkovic/Nexus/milestone/1):

- Settings reorganised into categories and sub-pages, so a setting is found
  without scrolling past twenty-odd cards;
- an opt-in update check. On first start the user chooses between offline only,
  which stays the default, and offline plus update checks, which contacts GitHub
  only to find and download new versions of Nexus.

Still open after that: Windows code signing, so the installer stops triggering
a SmartScreen warning.

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
**Install** button — nothing downloads until they press it, and every download
is verified against a key compiled into the app. In **Offline + update checks**
mode GitHub sees the device's IP address, as any server does; your notes and
data never leave the computer. The mode is changeable at any time in Settings,
and the reader is told a restart is what applies it.

## Next — optional sync, and the web app

The desktop app's sync engine, its cryptography and its server schema are built
and tested. What has never happened is a round against a real deployed backend,
because no hosted project exists and the shipped build cannot be pointed at one.

That is **paused, not cancelled**, and it resumes after the desktop's own loose
ends are done. The work already built stays built, stays tested and stays off by
default: a user who never turns sync on is running exactly the offline product.

## Later — the wider catalogue

The full product ambition is much larger than the sixteen modules that exist:
goals, time tracking, health, car, travel, inventory, shopping, read-later,
library, a password vault, entertainment, sharing, analytics, automation, an AI
assistant and a plugin system. Several of them genuinely depend on sync existing
first. None of them is next.

## What will not change

- **Local-first.** Your data lives on your device, encrypted, and the app works
  with the network off.
- **Cloud is off by default**, and off means the local path cannot reach the
  network at all — enforced in CI, not promised in copy.
- **Offline is the default, and update checks are opt-in.** Every release so far
  has made no network call at all, and a user who says no to update checks stays
  in exactly that product.
- **The server holds ciphertext.** Metadata in the clear is accepted; content
  never is.
- **No telemetry, no analytics, no crash reporting.**

