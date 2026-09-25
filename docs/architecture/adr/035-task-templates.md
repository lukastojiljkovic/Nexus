# ADR-035 — Task templates

**Status:** accepted · 2026-07-30
**Drives:** the "templates (S)" item of the TASK remainder (PRD 03). Wave-3
Lane G.
**Builds on:** ADR-016 (note templates — the naming-is-edit, payload-in-a-table
model), ADR-029 (lists/sections), migration 023 (tags).

## Decision

A task template is **a saved shape of one task**, captured from a real task
and applied into the currently selected list.

1. **Storage (migration 027):** `task_templates` (id, profile_id FK CASCADE,
   `name` unique per profile — the ADR-016 rule: saving under an existing name
   REPLACES it, which is the whole edit mechanism — `payload` JSON validated
   by the store on both write and read, created_at, updated_at). No soft
   delete (a template is not user data with history; deleting one is final,
   exactly as `note_templates`). The payload carries: title, description,
   priority, dueDate **offset in days from application** (null = no due date;
   an absolute date in a template would rot), reminderOffsets ladder,
   recurrence rule, tag NAMES (not ids — applied via get-or-create so a
   template survives tag deletion), and direct subtask titles (one level —
   the roll-up chip counts direct children; deeper nesting in a template is
   speculative). No listId/sectionId: a template lands where the user is.
2. **Store:** `TaskTemplateStore` mirroring `NoteTemplateStore`'s idiom —
   `list()`, `saveFromShape(name, payload, now)` (upsert-by-name),
   `get(id)`, `delete(id)`; strict payload validation with typed errors
   (caps: name ≤ 80 after trim, ≤ 30 subtasks, ladders/rules revalidated with
   the same rules `TaskStore` enforces). TDD.
3. **Applying happens in main** (one IPC `task-templates:apply` with
   { profileId, templateId, listId, sectionId | null }): main resolves the
   payload, stamps `now`, computes dueDate from the offset and ITS OWN local
   today, creates the parent through `TaskStore` (list/section validated by
   the store as any create is), get-or-creates and attaches tags, creates
   subtasks with `parentId`, all **in one transaction** via the db handle's
   transaction over store calls (the RestoreStore precedent of one txn for a
   multi-row write). Returns the created parent. Channels: `list`,
   `save-from-task` (main reads the task + its direct subtasks + tags and
   builds the payload itself — the renderer sends only ids and a name),
   `apply`, `delete`.
4. **Interchange 1.5.0 → 1.6.0:** record type `task-template` in
   `data/tasks.ndjson` (payload travels as its JSON object, revalidated by
   the parser twin field-for-field — never `unknown` passthrough). A record
   type needs no era flag. `RestoreStore` wipes/writes the table;
   `countProfileModules` → tasks bucket.
5. **UI (TasksPage):** the task row menu (the tag popover's family) gains
   "Sačuvaj kao šablon" → inline name prompt (TextField in the popover, the
   organizer's inline-create idiom; saving under an existing name says it
   replaces, the ADR-016 confirmation precedent). The toolbar gains a
   "Šabloni" button beside the view toggle → popover listing templates
   (sr-Latn collation) with apply-on-click into the CURRENT list (body, no
   section) and a per-row delete ×. Empty state: a quiet line. Serbian copy
   in strings.ts.

## Consequences

- Fourth consumer of "payload JSON in a profile-scoped table" (note
  templates, note versions, now task templates) — the idiom is established.
- A template's tag names may recreate a tag the user deleted — that is the
  point (the template still means what it said), recorded here.
