# Changelog

All notable changes to this project are documented here. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- A crafted CSV, Anki deck or subtitle file can no longer freeze the import
  while it is being read: the patterns that measured, trimmed and stripped that
  text re-scanned the tail of the file once for every place a match could start,
  so a small file built to repeat one prefix could spend minutes of CPU; the
  markup of a single Anki field at the reader's 256 KiB cap cost nine seconds.
  Each step now scans its input in one pass, and a file with 50 000 repetitions
  answers in well under the time a keystroke takes. The `<script>` and `<style>`
  strip removes the leftmost complete element and repeats until none is left,
  all in one walk of the field, so no arrangement of tags sends it down a slow
  path.
- A `<script>` or `<style>` element whose tags are split around another element,
  so that removing the inner one completes the outer, is now removed with its
  contents instead of surviving into the text of an Anki import, and a subtitle
  line's length no longer counts a tag left behind by nesting one inside
  another. Imported text is shown as text and never run, so both changes are
  about what is counted and displayed.
- The private-attachment, CSV, Markdown and profile-picture picks open each
  chosen file once and read it through that handle, so a file replaced between
  the size check and the read is neither read nor measured against the wrong
  file's size.
- The interface copy tables refuse `__proto__`, `constructor` and `prototype`
  when a language is folded onto them, so a table carrying one of those names
  can no longer write through to `Object.prototype`.
- The screenshot harness writes its lock file owner-only and escapes every
  value it splices into a script it evaluates in the renderer; a report cell
  escapes backslashes as well as pipes.

## [1.4.0] - 2026-10-05

The first public release. No earlier version was tagged or published; this one
carries the Apache-2.0 licence, the release pipeline and the corrections below.

### Added

- The project is licensed under **Apache-2.0** (`LICENSE`, `NOTICE`), and
  ADR-087 records the decision that supersedes ADR-080's closed-source premise.
- Community and policy documents: `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `PRIVACY.md`, `TERMS.md`, `SUPPORT.md`, `ROADMAP.md`.
- Issue templates and a release workflow that produces checksums, an SBOM,
  build provenance and the third-party notices for a tagged release.
- A project website, published with the repository by a Pages workflow.
- Every page in the renderer is its own chunk, so the canvas engine and the
  other large surfaces left the startup path. The tools drawer fetches a
  toolkit when one of its tools is opened, and it no longer ships with the
  rest of the shell.
- **The interface ships in English as well as Serbian**, and the language is a
  first-class preference: on first run the app follows the system language
  (Serbian for `sr*`, English otherwise), remembers the choice, and switches at
  runtime from Settings → Appearance — including the main process's native
  dialogs, OS notifications and the demo profile's seeded content. Dates,
  numbers, money and alphabetical order follow the same choice, and the food
  and electronics catalogues, the generated Arduino sketch and ROS package
  carry English text too.

### Fixed

- **The sync housekeeping job is scheduled by a migration** rather than by hand
  in the SQL editor, idempotently and with the `pg_cron` extension created if
  needed.
- The Supabase README no longer claims the migration forces RLS on
  `storage.objects` and `realtime.messages` — it cannot, and the migration's
  header says so.
- Row ids minted in the same millisecond sort in the order they were minted.
- Leaving a canvas board no longer writes an empty board, and the canvas
  autosave keeps one write per board on the wire.
- Every exit that closes an editor waits for the last edit to reach disk, so
  closing a note or a canvas no longer loses it.
- The harness sandbox is applied before `ready`, so renderer storage lands in
  the sandbox rather than in the developer's own profile.

### Security

- **The packaged executable is hardened with Electron fuses**: `RunAsNode`,
  `NODE_OPTIONS` and the CLI inspect arguments are off, cookie encryption is on,
  embedded asar integrity validation is on, and the app loads only from the
  asar. `GrantFileProtocolExtraPrivileges` stays on because the renderer still
  loads from `file://`.

## 1.3.0 - 2026-09-23

The first entry summarises everything up to this version, because the project
grew from its own first commit in one line rather than through a series of
announced releases. Nothing before this has ever been published: there are no
tags and no downloads.

### Added

- **The desktop application**, an offline-first life-management workspace:
  tasks, calendar, notes, documents, study, habits, focus timer, fitness and
  nutrition, finance, canvas, the professional toolkits, and Electronics — an
  Arduino and Raspberry Pi workbench that derives a wiring sketch, a ROS 2
  package and a URDF from a circuit, and can run a plan on the user's own
  toolchain.
- **Encrypted local storage** — one SQLite database under a passcode-derived
  key, with a Recovery Kit, multiple local accounts, and no network dependency.
- **The optional sync substrate** — an end-to-end encrypted design in which the
  server holds ciphertext only, with the local data key, a master sync key and
  per-profile content keys kept apart. The engine, the transport and the server
  schema are built and tested; no hosted backend has ever been deployed, and
  cloud access is off by default.
- **Generated third-party notices**, read from the shipped dependency tree and
  shown in the application, rather than written by hand.
- **Linux builds** — AppImage, tarball and a Gentoo ebuild.

[1.4.0]: https://github.com/lukastojiljkovic/Nexus/releases/tag/v1.4.0
