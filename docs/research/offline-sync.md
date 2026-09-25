# Research: Offline-first Sync & Conflict Resolution

**Domain:** sync architecture for an offline-first, multi-device app with
E2EE private notes, future real-time collaboration, and fully local accounts.
**Session:** 2026-07-04 (research phase 1, session 1).
**Nexus context:** every core feature must work with no network (cloud sync is
an enhancement); private notes sync as zero-knowledge ciphertext (`SEC-ZK`);
local accounts generate zero network traffic (`SEC-LOC-04`); v1 sharing is
read-only, real-time co-editing comes later (founder decision #5).

## 1. Conclusions

1. **Split the problem in two.** Structured row data (tasks, finance entries,
   fitness logs, settings) and collaborative documents (rich-text notes,
   canvas) have different merge semantics and different best-in-class tools.
   Using one mechanism for both is the classic mistake ([Electric's own
   alternatives page](https://electric-sql.com/docs/reference/alternatives),
   [PowerSync on Cinapse leaving CRDTs](https://powersync.com/blog/why-cinapse-moved-away-from-crdts-for-sync)).
2. **Rows: server-authoritative, per-field last-writer-wins.** Figma has run
   property-level LWW with server ordering for ~a decade without redesign —
   real conflicts on structured data are rare and field-level merge is the
   accepted semantics ([Figma blog](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/),
   [Liveblocks on Figma/Linear/Docs](https://liveblocks.io/blog/understanding-sync-engines-how-figma-linear-and-google-docs-work)).
3. **Documents: CRDT, and specifically the Yjs family.** CRDTs are the modern
   fit for offline-first collaborative editing ([OT vs CRDT](https://www.systemdesignsandbox.com/learn/ot-vs-crdt));
   Yjs is the production default (~920K weekly downloads, only library with
   mature Tiptap/CodeMirror bindings) ([2026 comparison](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026)).
   Loro is faster but ecosystem-young; Automerge trades performance for
   history. **Store notes/canvas as Yjs documents from day one**, even though
   collab ships later — retrofitting a CRDT format into existing data is a
   migration; starting with it is free.
4. **Don't put CRDTs anywhere else.** Tombstone/metadata growth is real (a
   heavily edited 1,000-character doc can carry ~50k tombstones —
   [CRDT field guide](https://www.iankduncan.com/engineering/2025-11-27-crdt-dictionary/));
   a production case saw 4–5× payload blowup from CRDT wrappers
   ([CloudKitchens](https://techblog.cloudkitchens.com/p/protocol-buffer-crdts-outperforming)).
   Compaction/GC and schema migration still need coordination.
5. **E2EE and sync compose cleanly only if the server never merges.** Since
   the server can't read ciphertext, conflicts must be handled client-side;
   Standard Notes duplicates the note on conflict rather than risk data loss
   ([their docs](https://standardnotes.com/help/33/how-do-i-clear-duplicates)),
   Obsidian Sync (AES-256-GCM, scrypt, client-side keys) merges markdown
   client-side with diff-match-patch ([DeepWiki on Obsidian Sync](https://deepwiki.com/obsidianmd/obsidian-help/2.2-security-and-encryption),
   [Ergaster analysis](https://ergaster.org/posts/2023/08/23-syncing-notes-with-obsidian/)).
   **Nexus private notes sync as opaque versioned ciphertext blobs through the
   same row-sync path; conflict = keep both copies.** Acceptable because
   private notes are single-user by definition. Encrypted real-time CRDTs
   ([secsync](https://github.com/nikgraf/secsync), [Evolu](https://kerkour.com/crdt-end-to-end-encryption-research-notes))
   exist but are experimental — not for v1.
6. **The local SQLite database is the source of truth; sync is an optional
   adapter.** This is what makes `SEC-LOC-04` (local accounts, zero network)
   an architecture property instead of an if-statement, and it matches how
   the SQLite-sync engines work anyway.
7. **Engine due diligence belongs to the architecture phase, but the field is
   already narrowed:** PowerSync (Postgres/MongoDB/MySQL → local SQLite,
   offline-first, production-focused) is the strongest managed candidate;
   ElectricSQL is Postgres-native but went through a full "Electric Next"
   rewrite (platform-churn risk, writes go through your own API)
   ([PowerSync comparison](https://powersync.com/blog/electricsql-electric-next-vs-powersync));
   **Zero/Rocicorp is disqualified — offline is explicitly out of scope for
   it** ([2026 comparison](https://trybuildpilot.com/648-electric-sql-vs-powersync-vs-zero-2026)).
   A fully custom engine is a Linear-scale multi-year effort
   ([The Hard Things About Sync](https://expertofobsolescence.substack.com/p/the-hard-things-about-sync)) — off the table.
8. **Attachments and files never travel through row/CRDT sync** — separate
   content-addressed blob store with its own upload/download queue.

## 2. Landscape

### Approaches

| Approach | Fits | Doesn't fit | Reference users |
| --- | --- | --- | --- |
| Server-authoritative + per-field LWW | Structured rows; rare conflicts; simple mental model | Character-level co-editing | Figma (10 yrs), Linear |
| OT | Centralized rich-text co-editing | True offline/multi-master | Google Docs |
| CRDT | Offline-first co-editing, P2P, multi-master | Row data (metadata overhead), server-mergeable content | Yjs ecosystem apps, Anytype |
| E2EE blob sync + client conflict handling | Zero-knowledge content | Anything needing server merge | Standard Notes, Obsidian Sync |

### Engines & libraries (verified 2026-07-04)

- **PowerSync** — syncs a server DB subset into client SQLite; full offline;
  commercial with self-host option. Strongest managed row-sync candidate.
- **ElectricSQL** — Postgres→client sync, read-path focus after the rewrite;
  writes via your own API. Watch for stability of the new platform.
- **Zero (Rocicorp)** — excellent perceived latency, **no offline support** →
  disqualified for Nexus.
- **RxDB** — JS database with replication plugins; flexible, more DIY.
- **Yjs** — CRDT default: biggest ecosystem, Tiptap/CodeMirror/ProseMirror
  bindings, mature providers (y-websocket, Hocuspocus). Our canvas and notes
  fit its shared types.
- **Automerge / Loro** — alternatives if we need git-like history (Automerge)
  or maximum performance (Loro, Fugue algorithm); both viable, smaller
  ecosystems.

### How comparable products behave

- **Obsidian Sync**: E2EE, centralized vault servers, client-side
  diff-match-patch merge for markdown.
- **Standard Notes**: E2EE items; server can't merge; conflict → duplicate
  the note (never lose data).
- **Figma**: server-authoritative property-level LWW; explicitly *not* CRDT;
  the model survived a decade of scaling.
- **Linear**: custom sync engine over a local store — great UX, famously
  expensive to build.

## 3. Conflict & sync UX patterns

- **Never lose data** is the universal rule: auto-merge where semantics are
  safe (CRDT text, per-field LWW rows); otherwise keep both (conflict copy
  named/timestamped — Obsidian community tools use `.conflict-YYYYMMDD` files).
- Users should almost never see a merge dialog; Nexus surfaces conflicts as a
  reviewable "conflict copy" item, not a blocking modal.
- Persistent, quiet sync-status indicator (synced / syncing / offline /
  error), per-device session list (ties into `AUTH`), manual "sync now",
  and a pause toggle.
- Offline is a normal state, not an error state — no nagging banners.

## 4. Expected feature checklist (table stakes)

Multi-device sync with true offline editing; background sync on reconnect;
per-field merge for records; conflict copies for opaque content; sync status
UI; selective sync scope (Nexus: personal vs business profile isolation —
business data must be excludable per device); bandwidth-sane delta sync;
E2EE for the private section; export unaffected by sync state.

## 5. Nexus-specific constraints

- **Local accounts:** the sync adapter must be absent, not dormant —
  no network stack initialization at all (`SEC-LOC-04` test asserts this).
- **Profile separation (founder decision #4):** sync scoping must support
  "personal only on this device" — engines' partial-sync/bucket features are
  an evaluation criterion for the ADR.
- **GDPR real deletion (`SEC-DAR-03`) vs CRDT history:** deleted content can
  survive in CRDT tombstones/history. Mitigations to evaluate: snapshot
  compaction on delete, or treating hard-delete as document re-creation.
  Must be resolved in the architecture ADR, not discovered in production.
- **i18n (Serbian + English at launch, more later) is unaffected** by sync,
  but conflict-copy naming and sync status strings are user-visible →
  translatable from day one.

## 6. Pitfalls

- CRDT metadata growth and GC (see Conclusions #4) — cap by using CRDTs only
  for documents and snapshotting/compacting periodically.
- Platform churn: Electric's legacy→Next rewrite shows engine risk; isolate
  the engine behind our own sync interface so it's replaceable.
- Vendor lock-in on managed sync ($ and data path) — self-host option is an
  ADR requirement.
- Underestimating custom sync ("it's just HTTP") — Linear-scale effort;
  we buy or adopt, we don't build the row-sync engine.
- Letting attachments ride the row sync — kills performance and storage.

## 7. Open questions → architecture phase (ADR inputs)

1. PowerSync vs ElectricSQL vs RxDB-style DIY for row sync — cost,
   self-hosting, partial-sync buckets, Mongo/Postgres implications for the
   backend choice.
2. Yjs vs Loro for canvas specifically (canvas is object-graph, not text —
   benchmark both) ; Yjs presumed for rich text.
3. Ciphertext blob sync for private notes: through the row-sync engine as
   opaque columns, or a minimal dedicated endpoint?
4. Compaction/GC schedule for Yjs documents and its interaction with
   `SEC-DAR-03` deletion guarantees.
5. Sync bucket design for personal/business profile isolation.
