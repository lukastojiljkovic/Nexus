# ADR-082 — What syncs, and as what

**Status:** accepted (design), unimplemented
**Date:** 2026-08-08
**Supersedes on this point:** nothing. This is the first time the question has
been answered against the real schema.

## Context

The sync engine has to answer one question for all 71 tables at schema v61:
*is this row a sync object, a field of some other sync object, or does it never
leave the machine?* Getting it wrong in one direction syncs rubbish; in the
other it silently leaks something that was meant to stay local.

A seven-agent survey read every migration and store file and returned a full
inventory; a completeness critic then re-derived the table count independently
and reconciled it three ways (85 `CREATE TABLE` statements − 14 transient
rebuild scaffolds = 71 live tables; 75 rows in `sqlite_master` once the four
FTS5 shadow tables are counted).

## Decision 1 — the content set is DERIVED, never re-listed

`packages/db/src/imex/restoreStore.ts:94` already exports
`RESTORE_WIPE_TABLES` — "every table a restore empties for the target profile
before writing anything" — and `restoreStore.test.ts` guards it by reading
`sqlite_master` and **failing until a new table is either added to the list or
explicitly allow-listed as exempt**.

That is exactly the classification sync needs, it is exhaustive by
construction, and it is already defended against drift. So:

> **The sync content set is derived from `RESTORE_WIPE_TABLES` plus the same
> exemption allowlist. It is never written out a second time.**

Writing a parallel list would be DC-07 (a ledger nobody re-reads becomes a
rumour) and DC-08 (a rule applied on one path is only present, not applied) in
one move: a table added in six months would be caught by the restore guard and
sail straight past sync, and nothing would look wrong.

What the existing classification already says, verbatim from
`restoreStore.test.ts:1434–1470`:

- **Device-local, never syncs.** `backup_settings` (an absolute folder path and
  a passphrase wrap bound to *this* device's data key), `search_history` ("a
  fact about how the machine was USED" — its own comment calls syncing it a
  privacy leak), `meta` (schema version and auth key material).
- **Locally sealed, never syncs as plaintext.** `private_notes`,
  `private_note_versions`, `private_settings`. `private_settings` is the
  per-profile key chain; overwriting it destroys the only paths to the DEK.
- **Derived cache, rebuilt not synced.** `search_entries`, `search_fts` and its
  four FTS5 shadows — maintained solely by triggers. Also the ten VIEWS, which
  the survey partly mistook for tables: `fin_flows` and the nine
  `search_source_*` projections have no rows of their own.
- **Real user content.** The other 62 tables, plus `profiles`.

## Decision 2 — a sync object is a row a user can point at

Of the 62 content tables, not all become collections. `merge.ts` merges
FIELD-BY-FIELD inside one `RowState`, so the rule is:

> **A table is its own collection when its rows have independent identity and
> independent edit history. Otherwise its rows are a FIELD of the parent object.**

- **Own collection:** `tasks`, `notes`, `events`, `cards`, `fin_transactions`,
  `habits`, `fit_workouts`, `tracked_documents`, `people`, … — anything the
  user creates, names, opens and edits on its own.
- **Field of the parent:** pure join tables — `task_tag_links`,
  `note_tag_links`, `subject_note_links`, `task_dependencies`. A join row
  carries no data beyond the pair itself, and as its own object it becomes an
  orphan the moment two devices disagree about the parent. As an array field on
  the parent it merges with the same field-level LWW as everything else.
- **Attachments stay their own collection** (`note_attachments`,
  `task_attachments`, `subject_attachments`) because they carry bytes, and the
  bytes sync on a different path (Storage) from the metadata.

## Decision 3 — the six hazards, and what each one costs

The survey's real value is here. Each of these breaks a naive field-level LWW
merge, and each needs a decision **before** the engine is written.

1. **`tasks.position` is a sparse INTEGER, and `renumberScope` mass-rewrites a
   whole scope without bumping `updated_at`.** Two devices reordering the same
   list produce a mass UPDATE each; LWW picks one arbitrarily and the other
   user's reordering vanishes. Worse, migration `022` back-filled
   `position NOT NULL DEFAULT 0` on every pre-existing task, so the whole
   pre-22 corpus is degenerate and has no tiebreak at all.
   **Decision: ordering moves to a fractional rank string before sync ships.**
   An integer position cannot be merged; a rank string between two neighbours
   can, without touching any row but the one that moved.

   **DONE — schema 62, `packages/core/src/order/rank.ts` and migration 062.**
   All five hand-orderable scopes (`tasks`, `task_lists`, `task_sections`,
   `dashboard_sets`, `dashboard_widgets`) now carry `rank TEXT`; `position`,
   `TASK_ORDER_GAP`, `positionBetween` and every `renumberScope` are gone. The
   two child-array positions (`fit_routine_items`, `fit_workout_sets`) were
   deliberately left as integers — they are a FIELD of their parent by Decision
   2, replaced whole, so they never have two independent writers to merge.
   The archive format went to `1.39.0` with an era flag `writesOrderRanks`; an
   older archive's integer converts through `rankForInteger`, which is exact and
   row-local because a rank's integer part IS a signed base-36 number.

2. **`CHECK ((status = 'done') = (completed_at IS NOT NULL))` on `tasks`.**
   Field-level LWW merges `status` and `completed_at` independently, so a merge
   can produce `status='done'` with a null `completed_at` — and SQLite rejects
   the write. The row then cannot be applied at all.
   **Decision: `completed_at` is not a synced field. It is DERIVED from
   `status` on apply.** A pair of columns bound by a CHECK is one fact, and one
   fact must be one field.

3. **Five UNIQUE constraints that two devices can both satisfy locally.**
   `note_folders_capture_default` (one capture folder per profile),
   `cards_source_block`, `fin_transactions_import_key`,
   `fin_transactions_recurring_occurrence` (two devices generating the same
   subscription occurrence produce a **hard constraint violation**, not a
   duplicate), and `task_lists.is_inbox` — which has *no* unique index at all,
   so two devices each create an Inbox and both survive.
   **Decision: every one of these is resolved deterministically on apply, by
   the same rule on both devices — lowest object id wins, loser is soft-deleted
   or re-pointed.** A constraint violation must never reach SQLite.

4. **UUIDv7 ids leak creation time in the clear.** The ids are the `object_id`
   the server routes on, and their first 48 bits are a millisecond timestamp.
   So an untrusted server learns when every object was created even though
   every field is ciphertext.
   **Decision: accepted, and written into the residual list** — the alternative
   is a random id and a second index, and the metadata ledger already accepts
   `updated_at` and per-collection row counts. It must be *stated*, not
   discovered later.

5. **`notes` are Yjs documents (`note_updates`, `note_snapshots`,
   `note_versions`), not field maps.** Field-level LWW is wrong for them; two
   people typing in one note need the CRDT.
   **Decision: notes sync as an append-only update log, not as a `RowState`.**
   This is a second collection *shape*, and the engine must support both from
   the start rather than have it retrofitted.

6. **Migration 047 rebased every `cards.cloze_ordinal` and rewrote
   `source_block_key` in lockstep.** Its own comment says why it matters: if the
   key had not moved with the ordinal, "the very next sync of that note would
   see unfamiliar keys: every cloze card would be soft-deleted and recreated
   from scratch, taking its review history with it." Two devices straddling v47
   disagree about the reconcile key for the same logical card.
   **Decision: a device refuses to sync while its schema version differs from
   the account's recorded version.** Migrating is local and fast; merging across
   a schema boundary is how review history dies.

## Consequences

- The engine needs **two collection shapes** (field-map and update-log), decided
  now rather than discovered when notes are ported.
- ~~`tasks.position` must become a rank string **before** the first row syncs;
  afterwards it is a migration of every task on every device.~~ **Done** —
  schema 62. See Decision 3.1.
- Three tables (`backup_settings`, `search_history`, `meta`) and the whole
  `private_*` family must be provably excluded — a test that reads the derived
  set and asserts their absence, not a comment.
- The residual list gains one entry: creation timestamps are visible to the
  server through UUIDv7 object ids.
