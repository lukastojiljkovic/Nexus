# Changelog

All notable changes to this project are documented here. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Preparation for the first public release. Nothing here changes what the
application does.

### Added

- The project is licensed under **Apache-2.0** (`LICENSE`, `NOTICE`), and
  ADR-087 records the decision that supersedes ADR-080's closed-source premise.
- Community and policy documents: `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `PRIVACY.md`, `TERMS.md`, `SUPPORT.md`, `ROADMAP.md`.
- Issue templates and a release workflow that produces checksums, an SBOM,
  build provenance and the third-party notices for a tagged release.

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

[Unreleased]: https://github.com/lukastojiljkovic/Nexus/commits/main
