# ADR-009 — Import/Export Formats & Versioning

**Status:** accepted (draft pending founder sign-off) · 2026-07-05
**Drives:** IMEX PRD (full export is a product guarantee), decision #11
(settings/flags in export manifest; prompt packs sr+en), AI stub
(interchange = the future assistant's contract); SEC-FILE (import parsing),
SEC-ZK (PRIV export rules).

## Context

Export is a trust feature ("your data is yours") and the interchange format
doubles as the future AI-import contract (IMEX-004 / AI stub). It must
survive schema evolution and be readable without Nexus.

## Decision

- **Container:** a single `.nexus.zip` — ZIP because users can open it with
  nothing installed (the anti-lock-in point of the feature).

  ```text
  export.nexus.zip
  ├── manifest.json          # schemaVersion (semver), appVersion, profile,
  │                          # created, module list, settings + feature
  │                          # flags (decision #11), content checksums
  ├── data/<module>.ndjson   # one NDJSON per module — rows as interchange
  │                          # records with stable IDs
  ├── notes/…                # notes ALSO as plain Markdown files mirroring
  │                          # the folder tree (+ Yjs snapshots in data/)
  ├── tables/…               # finance/fitness/time also as CSV mirrors
  └── blobs/<sha256>         # content-addressed attachments
  ```

- **Human-readable mirrors are mandatory** (Markdown, CSV): the guarantee
  is "usable without us", not "parseable by us". NDJSON + Yjs snapshots
  are the lossless layer for re-import.
- **Versioning:** `schemaVersion` is semver. Import supports current and
  two previous majors (N-2); newer-than-app imports refuse with a clear
  message (SET-011 forward-compat rule). Per-module migration functions
  live in `packages/interchange`, tested against golden fixtures of every
  released major.
- **PRIV:** excluded from standard export by default. Explicit user choice,
  while unlocked, between (a) decrypted export with a strong warning, or
  (b) encrypted bundle (ciphertext + wrapped-DEK metadata) restorable only
  with passphrase/Recovery Kit. Never silently mixed into the normal
  archive (SEC-ZK spirit).
- **Import:** validators in `packages/interchange` (schema-checked before
  any write — same rule the AI stub inherits, SEC-EXT-02); dry-run preview
  with counts; single-transaction apply with full undo immediately after
  (IMEX acceptance). Third-party imports v1: Anki `.apkg` (STUDY), ICS
  (CAL), CSV (TASK/FIN), plus the LLM prompt packs (sr + en, decision #11)
  that transform foreign exports into interchange NDJSON.
- **Scheduled local backups** (SET-011) reuse the exact same container —
  one format, one test surface, restore drills built into CI fixtures.

## Consequences

- Every module's PRD "IMEX handler" contract (ADR-008) has a concrete
  target format from day one — implementation agents don't invent shapes.
- Golden-fixture migration tests grow with each major — accepted cost of
  the N-2 promise.
- The interchange schema becomes the de-facto public API of Nexus data;
  changes get the same review weight as DB migrations.
