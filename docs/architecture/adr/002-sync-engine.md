# ADR-002 — Sync & Conflict Resolution

**Status:** **SUPERSEDED on the choice of engine and backend** (founder,
2026-08-08) · originally accepted 2026-07-05
**Drives:** every cloud-account feature; SEC-API, SEC-ZK-02/03, SEC-TLS;
PRD cross-cutting "offline-first & sync semantics"; SHARE, NOTE, CANV, PRIV.

> **What changed and what did not.** This ADR designed sync around **PowerSync
> over a self-hosted Go backend**. The backend is now **Supabase**, and the sync
> engine is written here rather than adopted, and since 2026-08-16 it exists:
> `@nexus/sync-engine` holds the round, over `@nexus/sync` (what syncs, and as
> what — [082](082-sync-collection-map.md)), `@nexus/sync-crypto` (the envelope
> and the merge), `@nexus/sync-transport` (the wire) and a local store
> ([083](083-change-journal.md) — how a local edit becomes something to push).
> `STATUS.md` §3 holds what the subsystem still owes.
>
> **What survives is the data model and the conflict reasoning**, which is why
> this file is not deleted: the CRDT-vs-row split, the per-collection
> classification, tombstones, and the conflict matrix were all right and are
> what the current engine implements. Read it for those; do not read it for the
> transport, the hosting or the auth.

## Context

Offline-sync research (2026-07-04) already narrowed the field: CouchDB-class
revision sync and Zero (no offline writes) are out; the viable shape is
**two-tier** — server-authoritative per-field LWW for structured rows, CRDT
documents for collaborative content. This ADR picks concrete engines.

## Options considered

### Row sync

1. **PowerSync (self-hosted Open Edition).** Reads Postgres logical
   replication, streams partitioned "buckets" to SQLite clients; writes go
   through *our* backend API (server-authoritative — validation per
   SEC-API-01 stays with us). Client SDKs (JS/web, React Native, Kotlin)
   are Apache-2.0/MIT; the service is FSL-1.1 with automatic conversion to
   Apache-2.0 two years per release; self-hosting is free and the
   non-compete only bars selling a competing sync service.
2. **ElectricSQL.** Apache-2.0, Postgres read-path sync only — the entire
   write path, offline queue, and conflict handling would be ours to build.
   More assembly than PowerSync for the same result.
3. **Custom sync protocol.** Full control, enormous cost; offline-sync
   research estimated it as the single largest engineering risk in the
   product. Rejected while a fair-source engine fits.

### Document sync

**Yjs** (MIT) is the de-facto CRDT standard (research conclusion): update
logs merge automatically, offline-first by nature, ecosystem for rich text
(y-prosemirror) and object maps (canvas property-LWW, Figma-style).

## Decision

**Adopt PowerSync (self-hosted) for structured rows + Yjs for documents;
private notes bypass both as opaque encrypted blobs.**

- **Rows:** clients write locally → PowerSync upload queue → our backend
  API (ADR-003) validates ownership/schema (SEC-API-01/02) → Postgres →
  replication → buckets stream to all the account's devices. Conflict
  policy: per-field LWW with the server as tiebreaker; done-state and
  soft-delete resolve conservatively (never resurrect completed/deleted
  silently — TASK edge-case rules).
- **Documents (NOTE, CANV):** Yjs updates persisted locally (ADR-001),
  shipped as append-only binary chunks through the same authenticated API,
  compacted into snapshots server-side on thresholds. Read-only SHARE v1
  serves snapshots; realtime co-edit later upgrades to a WebSocket
  awareness channel without changing storage.
- **Grocery-list co-edit (decision #11)** rides the Yjs path as a
  special-cased shared document (see PRD-friction #1 in the overview).
- **PRIV:** ciphertext blobs versioned per device; concurrent divergence =
  keep both copies visible in the section (crypto-ux research; SEC-ZK-02:
  the server never sees keys or plaintext, so no server merge is possible).
- **Local accounts:** the sync layer is compiled in but fully inert — zero
  network calls (SEC-PRIV-02 verified by traffic-capture test, ONB
  acceptance).

## Consequences

- We never build the hardest distributed-systems part ourselves; we do own
  bucket design (per-profile partitioning enforces business/personal
  separation, decision #4) and the write-validation API.
- Two sync planes to soak-test (nightly CI scenarios from the research
  conflict matrix).
- FSL dependency documented as risk #7 (overview); mitigations: SDKs are
  Apache/MIT, each service release becomes Apache-2.0 after 2 years, and
  the row protocol is replaceable behind `packages/core`'s sync interface.
- Server-authoritative writes mean cloud rows are readable by the server —
  by design (enables sharing/views); privacy-sensitive content belongs in
  PRIV, and the product copy must keep that boundary honest (SEC-PRIV).

## Sources

- `docs/research/offline-sync.md` (primary analysis + conflict matrix).
- [PowerSync Open Edition](https://powersync.com/blog/powersync-open-edition-release);
  [licensing terms](https://www.powersync.com/legal/licensing-terms);
  [FSL text](https://powersync.com/legal/fsl);
  [self-hosting docs](https://docs.powersync.com/intro/self-hosting).
- [Yjs](https://github.com/yjs/yjs) (MIT; ecosystem modules y-prosemirror,
  y-protocols/awareness).
