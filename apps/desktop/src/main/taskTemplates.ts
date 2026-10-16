import type Database from "better-sqlite3-multiple-ciphers";
import { shiftDayKey } from "@nexus/core";
import type { Task, TaskStore, TaskTagStore, TaskTemplate } from "@nexus/db";

/**
 * Creates a task from a template in one transaction, for the `task-templates:apply`
 * channel and the assistant's `tasks.template` alike: the parent, its tags
 * (get-or-created by name, which is what lets a template outlive the tags it was
 * captured with) and its subtasks are one act, and half of it would be a task the
 * user did not ask for. `TaskStore.create` owns the list, section and anchor
 * rules, so none of them is restated here.
 */
export function applyTaskTemplate(
  db: Database.Database,
  stores: { readonly tasks: TaskStore; readonly tags: TaskTagStore },
  template: TaskTemplate,
  place: { readonly listId: string; readonly sectionId: string | null },
  today: string,
  now: string,
): Task {
  const { payload } = template;
  const dueDate = payload.dueOffsetDays === null ? null : shiftDayKey(today, payload.dueOffsetDays);
  return db.transaction((): Task => {
    const parent = stores.tasks.create(
      {
        title: payload.title,
        description: payload.description,
        priority: payload.priority,
        dueDate,
        recurrence: payload.recurrence,
        reminderOffsets: payload.reminderOffsets,
        listId: place.listId,
        sectionId: place.sectionId,
      },
      now,
    );
    for (const name of payload.tagNames) {
      stores.tags.attachTag(parent.id, stores.tags.createTag(name, now).id);
    }
    for (const title of payload.subtaskTitles) {
      stores.tasks.create({ title, parentId: parent.id }, now);
    }
    return parent;
  })();
}
