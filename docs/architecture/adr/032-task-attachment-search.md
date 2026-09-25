# ADR-032 — Task attachments in global search (through the task's own entry)

**Status:** accepted · 2026-07-30
**Drives:** closing wave-1 Lane C's recorded gap: task attachment names are
invisible to Ctrl+K (migration 017's `attachment` kind projects
`note_attachments` only). Wave-2 Lane D.
**Builds on:** ADR-021 (search index), ADR-031 (task attachments).

## Decision

A task's attachment filenames are indexed **inside the task's own search
entry**, not as rows of a tenth kind — deliberately unlike note attachments:

- A note attachment has a destination of its own (the note's Prilozi panel, a
  dedicated reveal), so it earns an entry. A task's files live only inside the
  task edit form — **the task IS the destination** — and a separate row would
  deep-link to the same place while forcing a tenth `SearchKind` through the
  prefixes, priors, chips and group labels for no navigational gain.
- Searching a filename therefore surfaces the task that carries it, with the
  filename visible in the snippet.

Mechanics (migration 025):

1. `search_source_task` is dropped and recreated with its `body`/`body_folded`
   widened to append the task's attachment filenames (order-stable
   `group_concat` over an `ORDER BY id` subselect; folded via `nx_fold`).
   Everything else in the view is unchanged; the `tasks_search_*` triggers and
   `rebuildSearchIndex` read the view **by name** and need no change.
2. New `task_attachments` triggers (AI / AD / AU of `file_name`) refresh the
   parent task's entry — delete `kind='task'` for the task id, reinsert from
   the view — the exact refresh shape `notes_search_au` already uses for its
   children.
3. A soft-deleted task's entry is already absent, which keeps its filenames
   out of search with zero new logic; restore brings them back through the
   existing task triggers.

## Consequences

- `SEARCH_KINDS` stays nine; palette, ranking and reveal untouched.
- One asymmetry, recorded: a note's file appears under "Prilozi", a task's as
  the task itself. If the facets page ever wants uniform attachment rows, it
  can widen then — the data supports either reading.

**Accepted during implementation (2026-07-30, `0beed9b`):**

- The migration additionally **re-projects the task kind once** — a database
  that already ran 024 has attachment rows whose names the OLD view never
  indexed, and they would stay invisible until each task happened to be
  edited. (An implementation-agent catch the draft above missed.)
- The **8000-character body cap wraps the whole body**, so a description long
  enough to fill it crowds the filenames out of the index — the same trade
  every other kind already makes (an event's long description crowds out its
  location). Splitting the cap would let one task index twice any other
  kind's text; pinned by a test so it is not "fixed" casually.
- The concatenation is deliberately **untrimmed**: `TaskStore` stores
  descriptions verbatim, and an attachment-less task's indexed body must stay
  byte-for-byte what migration 017 produced.
