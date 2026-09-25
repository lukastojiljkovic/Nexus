# ADR-001 — Local Storage Engine & Data Model

**Status:** accepted (draft pending founder sign-off) · 2026-07-05
**Drives:** every module's persistence; SEC-DAR-01/02, SEC-LOC-02/03,
SEC-ZK-01; PRD cross-cutting "fast after years of data".

## Context

Offline-first with local data as the source of truth (VISION pillar 1,
offline-sync research conclusion). Three client platforms need the same
relational model, full-text search, and encryption at rest for local
accounts. The sync engine choice (ADR-002) constrains this: PowerSync
requires SQLite on every client.

## Options considered

1. **SQLite everywhere** — one dialect, one schema, one migration story;
   official WASM build for web persisted via OPFS (concurrency now
   workable per 2026 testing; COOP/COEP headers required); mature native
   bindings on desktop and Android; FTS5 built in.
2. **IndexedDB (web) + SQLite (native)** — two query layers, two schema
   representations, double the migration and test surface. Rejected:
   permanent tax on a small team.
3. **Embedded document DB (PouchDB/RxDB-style)** — pushes toward
   CouchDB-style sync (revision trees, tombstone growth) that offline-sync
   research already rejected for structured data.

## Decision

**SQLite on every platform; one schema package (`packages/db`) owns DDL and
migrations.**

- **Desktop:** `better-sqlite3-multiple-ciphers` in the Electron main
  process (synchronous, fastest Node binding; SQLite3MultipleCiphers gives
  SQLCipher-compatible AES-256 encryption at rest). Renderer talks to it
  only over a typed IPC query interface (SEC-EL: no DB in renderer).
  Local accounts: DB encrypted with a key derived per ADR-004; cloud
  accounts on desktop also encrypt at rest (same mechanism, key from OS
  keystore) — SEC-DAR-01.
- **Web:** SQLite WASM persisted in OPFS via the PowerSync web SDK (its
  worker handles cross-tab access and SQLITE_BUSY). OPFS is origin-private;
  at-rest encryption on web is browser-profile-level — documented as part
  of the web trust caveat (ADR-005).
- **Android (later):** op-sqlite (JSI, supports SQLCipher) under the same
  `packages/db` schema — confirmed at the ADR-006 kickoff gate.

Data model rules:

- **Structured rows** (tasks, events, finance, fitness…): normal relational
  tables, one migration stream, UUIDv7 primary keys (sortable, no
  coordination), `updated_at` per column-group for per-field LWW (ADR-002).
- **Documents** (NOTE bodies, CANV boards): Yjs binary update log +
  periodic snapshot rows; a derived plaintext column feeds FTS5 for search
  (never for PRIV — SEC-ZK-05).
- **Attachments:** content-addressed blob store (SHA-256 key) on disk
  (desktop/Android) or OPFS (web); DB stores metadata + references only;
  garbage-collected by reference counting (offline-sync research).
- **Search:** FTS5 tables per module, populated by the SRCH indexing
  contract; PRIV indexed only in its in-memory unlocked session index.
- **Migrations:** forward-only, versioned; restoring/opening data written by
  a newer schema refuses with a clear message (SET-011 forward-compat rule).

## Consequences

- One query layer and one test matrix; sync engine integrates natively.
- Web requires COOP/COEP headers (deployment note in overview) and accepts
  the OPFS single-writer discipline the PowerSync worker provides.
- Electron main-process DB means all data access crosses IPC — the typed
  query interface must be designed once, early (it is also the future
  plugin data API surface, ADR-008).
- Encryption at rest adds ~zero read overhead at our scale
  (SQLite3MultipleCiphers page-level AES); key management is ADR-004/005's
  problem, not the schema's.

## Sources

- offline-sync research (`docs/research/offline-sync.md`) — engine-class
  conclusions and blob-store pattern.
- [SQLite WASM + OPFS state, May 2026](https://powersync.com/blog/sqlite-persistence-on-the-web) —
  concurrency and header requirements.
- [sqlite-wasm official ESM wrapper](https://github.com/sqlite/sqlite-wasm);
  [SQLite persistence docs](https://sqlite.org/wasm/doc/trunk/persistence.md).
- [better-sqlite3-multiple-ciphers](https://github.com/m4heshd/better-sqlite3-multiple-ciphers);
  [SQLite3MultipleCiphers cipher docs](https://utelle.github.io/SQLite3MultipleCiphers/docs/ciphers/cipher_sqlcipher/).
