import { collectChecklistItems, mergeNoteState } from "@nexus/core";
import type { ChecklistItem } from "@nexus/core";
import { TaskValidationError } from "@nexus/db";
import type { NoteStore, TaskListStore, TaskStore } from "@nexus/db";
import type { NoteChecklistTasksResult } from "../shared/ipc.js";

/**
 * „Pretvori u zadatke" (NOTE §6), whole: the note's checklist read out by
 * `@nexus/core`'s pure `collectChecklistItems`, and one task written per row
 * through `TaskStore` in ONE transaction — so a crash can never leave half a
 * checklist standing as tasks.
 *
 * **The note is not modified.** The checklist stays exactly where it is; this
 * action COPIES it out. A destructive variant — the rows disappearing from the
 * note as they become tasks — would surprise anyone who ran it to get a
 * reminder out of a page they still wanted to keep reading, and it is not
 * undoable by anything the note editor offers. Running it twice therefore makes
 * the tasks twice, which is honest: nothing here reconciles, unlike the note's
 * flashcards (ADR-017), because a task the user has since edited, moved,
 * scheduled or completed is not a projection of a line in a note any more.
 *
 * WHAT CARRIES ACROSS, and what deliberately does not:
 *
 * - **The ticked state.** An unticked row becomes an open task; a ticked one
 *   becomes a task that is already done, with its completion stamped — the
 *   honest carry, because the alternative (every row arriving open) would hand
 *   the user a list of work they have already finished. `TaskStore.create`
 *   stamps `completed_at` itself from the status it is given, so this is one
 *   write per row rather than a create followed by a check-off.
 * - **Document order**, through the store's own append semantics: every task
 *   lands at the end of its scope, and the rows are created in the order they
 *   are read.
 * - **One level of nesting.** A row indented under another becomes that task's
 *   subtask. `TaskStore` models exactly one level (a subtask lives where its
 *   parent lives), so a row indented deeper FLATTENS onto the nearest top-level
 *   row's task rather than being dropped: the text is what the user wrote, and
 *   losing it to keep a shape the store cannot hold would be the worse trade.
 * - **NOT the due dates, priorities or tags** a line might read as. Parsing
 *   „do petka" out of a checklist row is quick-add's job (a surface the user
 *   opts into), and guessing it here would put dates on tasks nobody typed a
 *   date for.
 */

/** Everything this module needs: three stores and a transaction runner. */
export interface NoteChecklistTasksDeps {
  notes: NoteStore;
  tasks: TaskStore;
  lists: TaskListStore;
  /** Runs `write` in one database transaction — every task lands or none of them does. */
  runInTransaction<T>(write: () => T): T;
}

/**
 * How many tasks the action would make out of `noteId` — rows with no text are
 * not counted, because they are exactly the rows it would skip. Throws
 * `NoteNotFoundError` when the note is unknown, soft-deleted, or another
 * profile's, like every other note read.
 */
export function countNoteChecklistItems(notes: NoteStore, noteId: string): number {
  return readChecklist(notes, noteId).filter((item) => item.text.length > 0).length;
}

/**
 * Writes `noteId`'s checklist into `listId` as tasks. Throws
 * `NoteNotFoundError` for a note this profile cannot see and
 * `TaskValidationError` for a list it cannot write to — both before anything is
 * created, both taking the whole call with them.
 */
export function checklistToTasks(
  deps: NoteChecklistTasksDeps,
  noteId: string,
  listId: string,
): NoteChecklistTasksResult {
  return deps.runInTransaction(() => {
    // The list is checked here rather than left to `TaskStore.create`'s own
    // `requireList`: a checklist with nothing in it would otherwise "succeed"
    // against a list this profile does not have, and the caller would learn
    // nothing about the id it sent.
    if (!deps.lists.listActive().some((list) => list.id === listId)) {
      throw new TaskValidationError(
        `listId "${listId}" does not reference an active list in this profile.`,
      );
    }

    let created = 0;
    let completed = 0;
    let skipped = 0;
    // The task the next indented row hangs under: the most recent TOP-LEVEL row
    // to have produced one. A row indented deeper than one level therefore
    // lands on the same parent as the level above it — the flattening rule.
    let parentId: string | null = null;

    for (const item of readChecklist(deps.notes, noteId)) {
      if (item.text.length === 0) {
        skipped += 1;
        // A blank top-level row makes no task, so the rows indented under it
        // have no parent to hang on and become top-level tasks of their own —
        // rather than silently joining whichever task came before it.
        if (item.depth === 0) parentId = null;
        continue;
      }

      // A subtask inherits its parent's list, so `listId` is only ever given to
      // a top-level task — `TaskStore.create` ignores it otherwise anyway, and
      // `exactOptionalPropertyTypes` makes the two shapes distinct.
      const placement = item.depth > 0 && parentId !== null ? { parentId } : { listId };
      const task = deps.tasks.create({
        // Passed as written: `TaskStore` trims a title and refuses an empty one,
        // and every row that would trip that refusal was skipped above.
        title: item.text,
        status: item.checked ? "done" : "todo",
        ...placement,
      });

      created += 1;
      if (item.checked) completed += 1;
      if (item.depth === 0) parentId = task.id;
    }

    return { created, completed, skipped };
  });
}

/**
 * One note's checklist as the app itself reads the note: the stored snapshot
 * merged with every update past it (ADR-012), then walked. `readForCompaction`
 * is the gate as well as the read — it refuses anything that is not an active
 * note of this profile — which is why nothing above re-checks the note.
 */
function readChecklist(notes: NoteStore, noteId: string): ChecklistItem[] {
  const read = notes.readForCompaction(noteId);
  const merged = mergeNoteState(
    read.snapshot,
    read.updates.map((update) => update.bytes),
  );
  return collectChecklistItems(merged.snapshot);
}
