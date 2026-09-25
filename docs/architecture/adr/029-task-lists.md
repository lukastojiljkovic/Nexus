# ADR-029 — Task lists, sections, and manual ordering

**Status:** accepted · 2026-07-30
**Drives:** TASK-004 (M): user lists with manual ordering, sections, nested
sub-lists (founder 2026-07-05: **both** mechanisms, applied adaptively —
sections group within one flow, sub-lists nest genuinely separate projects),
and a per-list default view. PRD 03 §7's delete-a-list rule (explicit choice
+ undo). Smart lists / horizon filters are explicitly NOT separate data
structures per the requirement text; they are a later, view-layer feature and
are recorded in STATUS, not built here.
**Supersedes nothing.**

## Decision

### 1. Data (migration 022)

```sql
CREATE TABLE task_lists (
  id           TEXT PRIMARY KEY,
  profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES task_lists(id),   -- sub-lists; cycle-guarded in the store
  name         TEXT NOT NULL,
  is_inbox     INTEGER NOT NULL DEFAULT 0 CHECK (is_inbox IN (0, 1)),
  default_view TEXT NOT NULL DEFAULT 'list' CHECK (default_view IN ('list', 'kanban')),
  position     INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE TABLE task_sections (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE tasks ADD COLUMN list_id    TEXT REFERENCES task_lists(id);
ALTER TABLE tasks ADD COLUMN section_id TEXT REFERENCES task_sections(id);
ALTER TABLE tasks ADD COLUMN position   INTEGER NOT NULL DEFAULT 0;
```

- **Inbox is a real row**, one per profile, `is_inbox = 1`, undeletable and
  unmovable (store-refused). The migration creates it for every existing
  profile and backfills every existing task's `list_id` to it (positions
  seeded from the current creation order, spaced by the gap constant); the
  first-run seeding path creates it alongside the profile. `tasks.list_id`
  stays nullable in SQL (ALTER cannot add NOT NULL without a default worth
  lying about) but the store treats null as corruption after the backfill.
- **Sections belong to one list**, hard-delete with **promote** semantics
  (tasks drop to the list body via an explicit UPDATE in the same
  transaction — the NoteOrg folder precedent; never rely on SET NULL).
  Moving a task to another list clears its section (a section id from
  another list is refused).
- **Manual ordering** = integer `position` with gap numbering (step 1024):
  appended items take max+1024; a drop between neighbours takes the
  midpoint; when a gap closes to zero the store renumbers the affected
  scope (one transaction). Scopes: lists within a profile (per parent),
  sections within a list, tasks within (list, section-or-body). One shared
  helper in the store module owns the arithmetic.
- **Sub-lists** = `parent_id`, cycle-guarded exactly like note folders
  (walk-up check in the store); deleting a parent list promotes child lists
  to its parent (again the folder precedent). Depth is unbounded in data,
  indентation capped visually (the TASK-008 rule).

### 2. Deleting a list (PRD 03 §7)

An explicit dialog, never a default: **Premesti u Inbox** (tasks move to
Inbox, list soft-deletes) / **Obriši i zadatke** (list AND its tasks
soft-delete in one transaction) / Otkaži. Both paths are undoable through
the house undo bar: restore un-soft-deletes the list and, for the second
path, its tasks (the store records nothing extra — restore-by-timestamp is
not needed since the undo window offers only the last deletion, whose task
set is exactly "tasks of this list soft-deleted at the same instant"; the
store keeps it simple by restoring tasks whose `deleted_at` equals the
list's).

### 3. Store surface

`TaskListStore` (lists + sections, one class — they share the ordering
helper and the list-scoped invariants): `listActive()` (lists with their
sections), `createList/renameList/setDefaultView/moveList(parent,position)/
deleteList(mode)/restoreList`, `createSection/renameSection/moveSection/
deleteSection`. `TaskStore` gains `moveToList(id, listId)`,
`moveToSection(id, sectionId | null)`, `reorder(id, beforeId | null,
afterId | null)` and its rows carry `listId/sectionId/position`;
`listActive()` orders by (list, section, position) so consumers stay sorted
for free.

### 4. Interchange — 1.2.0 → 1.3.0 with era flags

New record types `task-list` and `task-section` in `data/tasks.ndjson`;
`ExportTask` gains required `listId`, `sectionId`, `position`. Era flag
`writesTaskLists` (minor ≥ 3, per ADR-028's corrected rule: **every new
required field ships with its own era flag and a bump**): older archives
default `listId`/`sectionId` to null and `position` to 0, and
`RestoreStore` maps a null `listId` to the target profile's Inbox (creating
it if the archive predates lists entirely), assigning gap positions in row
order. `countProfileModules` counts lists/sections into the `tasks` bucket.

### 5. UI (its own slice)

TasksPage gains a left list rail (the NotesPage organizer-lite pattern):
Inbox first, then the user's tree (indent-capped), per-list task filtering,
inline list CRUD + the delete dialog, section headers inside the list view
with inline section CRUD, drag to reorder tasks within/between sections and
drag onto a list to move (HTML5 day-granular drag idiom the app already
uses), and the per-list default view applied on switch. The views engine
keeps owning sort/group WITHIN what the page hands it; manual order is the
list view's default sort. Kanban stays status-columns within the selected
list. Serbian copy centralized; adaptive guidance = the list-create UI
offering "sekcija" inline where a flow grows and "podlista" from the list
rail (copywriting, not machinery).

## Consequences

- The wipe-list guard forces both tables into `RestoreStore` mechanically.
- Search: tasks already indexed; lists/sections deliberately not (names are
  navigation, not content) — revisit with SRCH operators.
- NTF/recurrence/subtasks are untouched: list membership is orthogonal to
  every existing semantic.
