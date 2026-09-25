# ADR-083 — How a local edit becomes something to push

**Status:** accepted; implemented in migration 063 (`ab2d8df`) — the two tables
and 190 triggers exist, and `sweepRow` is the pure half in `@nexus/sync`. The
APPLY direction (writing a merged row back) is still unbuilt; see the
consequences below and DC-14.
**Date:** 2026-08-08 · **Amended:** 2026-08-09
**Builds on:** ADR-082 (what syncs and as what), `@nexus/sync`'s collection map,
`@nexus/sync-crypto`'s `mergeRowState` / HLC / `sealRow`.

## Context

`mergeRowState` merges a row FIELD BY FIELD, which means every field carries its
own HLC stamp. Nothing in the database holds those stamps today: a task row has
one `updated_at` for the whole row, and that is exactly the granularity
field-level merge exists to avoid. So before anything can be pushed, two
questions have to be answered locally:

1. **Which rows changed since the last push?**
2. **Which FIELDS of those rows changed, and when?**

## Decision 1 — the journal is a DIRTY SET, not a log

`sync_journal(collection, object_id)` with those two columns as the primary key.
Writing the same row a hundred times leaves one entry. It records *that*
something changed, never *what* — the sweeper reads the row itself.

A log would be the obvious shape and it is the wrong one. A log has to be
replayed in order, kept consistent with the row it describes, and truncated
safely; a dirty set has none of those problems, and it is **self-healing**: if an
entry is lost, the next edit to that row re-queues it, and the push that follows
carries the current truth rather than a stale delta. Idempotence, which is the
only kind of delivery a sync protocol actually gets, is a property of the
representation rather than something the code has to arrange.

## Decision 2 — the journal is written by TRIGGERS, not by stores

One `AFTER INSERT` / `AFTER UPDATE` / `AFTER DELETE` trigger per participating
table. Not a call at the end of each store method.

This is DC-08 exactly — *a rule applied on one path is not applied; it is only
present.* There are dozens of store methods that write to synced tables and there
will be more; every one of them is a chance to forget. A trigger cannot be
forgotten by a method that has not been written yet. Migration 017 already
established the pattern in this schema for the search index, and this is the same
shape for the same reason.

**Join tables and ordered children write their PARENT's id.** A row of
`task_tag_links` is a field of the task (ADR-082 §2), so tagging a task marks the
TASK dirty, not the link. That is what makes "the parent's array is replaced
whole" true on the push side as well as the merge side.

Derived tables (`note_snapshots`) get no trigger at all: they are rebuilt from
something that does sync, and journaling them would push the same information
twice.

**Hard deletes are the reason this cannot be done with `updated_at` instead.** A
sweep of `WHERE updated_at > last_seen` needs no triggers and would be simpler —
but a row that was DELETED has no `updated_at` to be greater than anything, and
several tables delete for real rather than soft-delete. A delete that never
reaches the other device is the worst possible sync bug, because the user's
evidence for it is that the thing they deleted came back.

## Decision 3 — field stamps live in a shadow table, written by the sweeper

`sync_row_state(collection, object_id, state_json, updated_at)` holds the last
`RowState` this device sealed or merged for that object — the field-name → (value,
HLC) map, canonically encoded.

A trigger cannot produce one: it would have to build JSON, and more to the point
it would have to know the current HLC, which is application state and not a
column. So the split is: **the trigger records the dirt, the sweeper resolves
it.** For each journal entry the sweeper

1. reads the row (or notices it is gone),
2. projects it to a field map through the collection's identity and field rules,
3. **diffs** it against `sync_row_state`,
4. stamps only the fields that actually differ with a fresh HLC,
5. writes the new `RowState` back and hands it to the push queue,
6. deletes the journal entry in the same transaction.

Step 4 is the whole point. A row rewritten with identical values produces no new
stamps, so a save that changed nothing cannot win a merge against a real edit on
another device. Step 6 shares the transaction so a crash between them re-does the
work rather than losing it — the dirty set makes that safe by construction.

A row that is GONE becomes `deleted: true` stamped now, which is a field like any
other (`merge.ts` is explicit that a tombstone is a field). Its other fields keep
their last stamps, so „deleted here, edited there" resolves the only way that
loses nothing: still deleted, and the edit is still there for whoever restores it.

## Decision 4 — one clock, and it is monotonic across restarts

The HLC's counter has to survive a restart or two devices can mint the same stamp
after a crash. It lives beside the schema version in `meta`, is advanced under the
same transaction as the sweep, and is never read from the wall clock alone. The
existing `hlc.ts` already refuses a clock that goes backwards; this is where that
refusal gets something to hold on to.

## The trigger table, read off the real schema

Probed rather than assumed — the first guess at `task_dependencies` was wrong,
and the guard caught it. Forty-eight synced tables carry their own `profile_id`
and their trigger writes it directly. **Thirteen do not**, and their trigger has
to reach the profile through the parent, which is also what makes the cascade
case safe: written as `INSERT ... SELECT ... FROM parent WHERE id = ?` rather
than `VALUES (subquery, ...)`, a parent that is already gone inserts nothing at
all instead of a row with a NULL profile.

| table | reaches the profile through |
| --- | --- |
| `document_renewals` | `document_id` → `tracked_documents` |
| `subject_attachments` | `subject_id` → `subjects` |
| `subject_note_links` | `subject_id` → `subjects` |
| `task_tag_links` | `task_id` → `tasks` |
| `task_attachments` | `task_id` → `tasks` |
| `task_dependencies` | `blocked_id` → `tasks` |
| `task_sections` | `list_id` → `task_lists` |
| `note_tag_links` | `note_id` → `notes` |
| `note_links` | `source_note_id` → `notes` |
| `note_attachments` | `note_id` → `notes` |
| `note_versions` | `note_id` → `notes` |
| `note_updates` | `note_id` → `notes` |
| `habit_entries` | `habit_id` → `habits` |

`fit_routine_items` and `fit_workout_sets` are the two parent-field tables that
DO carry their own `profile_id`, so their triggers write it directly — but the
entry still names the PARENT collection (`fit_routines`, `fit_workouts`) and the
parent's id, because that is the object the array belongs to.

**The object id for a composite identity** is its columns joined by `char(31)`,
the ASCII unit separator — a character no id, module name, notification source or
date can contain, so the join is unambiguous without escaping. A per-profile
singleton's object id is the empty string, which is the honest spelling of "this
collection holds exactly one object".

**The migration spells its table list out literally rather than reading
`@nexus/sync`'s map.** A migration describes what it did at version 63 and must
keep producing that same schema for a database upgraded a year from now; one that
read a live map would change its own history every time the map changed. New
collections get their triggers in a new migration, and the guard test is what
notices that they need one.

## Consequences

- Two tables and three triggers per participating table (fifty-four collections
  plus seven parent-field tables), emitted in a loop from a list frozen inside
  the migration itself — see the section above on why it is not read from the
  live map. `collectionGuard.test.ts` is extended to assert that every table the
  CURRENT map participates in really has its three triggers, which is what turns
  "a new collection needs a new migration" from a thing to remember into a thing
  that fails.
- The sweeper is pure and lives in `@nexus/sync`: it takes a row, a previous
  `RowState` and a clock, and returns the next `RowState`. No SQLite in it, so it
  is testable without a database and reusable by the web client.
- `sync_row_state` grows one row per synced object, holding a second copy of the
  data. That is the price of field-level merge and it is paid knowingly: without
  it there is nowhere for a per-field clock to live.
- Reclaiming `sync_row_state` for hard-deleted objects is a retention decision
  and is deliberately NOT taken here — a tombstone has to outlive every device's
  last sync, and this design has no way yet to know when that is. *Amended
  2026-08-09:* the shape of the answer is now decided even though it is unbuilt —
  reclaim only below a horizon every non-revoked device has provably passed,
  publish it as `reclaimed_below_seq` so a returning device can tell "nothing
  changed" from "I am too far behind to trust an incremental pull", and put
  attachment blobs on the same horizon. Age is not evidence. See §3 of
  `docs/STATUS.md`.

### Amended 2026-08-09 — two rules the APPLY direction inherits

- **`sync_row_state` must stay transactionally co-located with the module
  tables.** It is in the same SQLite file today and that is load-bearing, not
  convenience: the merged row and the stamps that say what was merged are one
  write. Split across two stores, a crash between them leaves a device claiming
  to have merged something it did not apply — and re-applying is not idempotent
  once the field stamps have moved.
- **The apply path cannot short-circuit on the row envelope.** A pulled row whose
  `version` is BELOW the local one is still merged field by field: `mergeRows`
  takes the greater version and the newer stamp per field, so an older-versioned
  row can legitimately carry a newer field. "I already have a higher version,
  skip it" is the tempting optimisation and it silently drops edits.
  `applyPull` reports that case as `rolledBack` and merges anyway.
- **And it owes a deterministic repair for cross-field constraints** — eleven
  table-level CHECKs read two columns that both merge alone, so two honest edits
  can produce a row SQLite refuses to write. `COLLECTION_COUPLED` is the ledger;
  DC-14 is the class.
