import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import {
  Button,
  Checkbox,
  Chip,
  EmptyState,
  KanbanCard,
  KanbanView,
  ListRow,
  ListView,
} from "@nexus/ui";
import type { CollectionSchema, KanbanViewConfig, ListViewConfig } from "@nexus/core";
import type { Task, TaskPriority, TaskStatus } from "../../shared/ipc.js";
import { strings } from "./strings.js";

// --- Field orderings (renderer mirror of @nexus/db) -------------------------
//
// The renderer never imports DB/Node code (SEC-EL-02: the wire contract stays
// self-contained), so the option orders are redeclared here, matching
// TASK_STATUSES / TASK_PRIORITIES in @nexus/db. The engine groups by VALUE;
// the Serbian labels live in strings.ts and are applied at render time.
const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "done"];
const TASK_PRIORITIES: readonly TaskPriority[] = ["none", "low", "medium", "high"];

/**
 * The views engine's generic bound is `Record<string, unknown>`. A TS interface
 * (like `Task`) has no implicit index signature, so tasks reach the engine
 * through this structurally-identical mapped type, which does — same objects,
 * just a shape the bound accepts.
 */
type TaskFields = { [K in keyof Task]: Task[K] };

/** Maps the `Task` type onto engine fields (title/status/priority/dueDate/done). */
const TASK_SCHEMA: CollectionSchema = {
  fields: [
    { key: "title", type: "text", titleKey: "tasks.field.title" },
    { key: "status", type: "select", titleKey: "tasks.field.status", options: TASK_STATUSES },
    { key: "priority", type: "select", titleKey: "tasks.field.priority", options: TASK_PRIORITIES },
    { key: "dueDate", type: "date", titleKey: "tasks.field.dueDate" },
    { key: "done", type: "boolean", titleKey: "tasks.field.done" },
  ],
};

// v0 shows tasks in the store's stable creation order — no filter/sort UI yet.
const LIST_CONFIG: ListViewConfig = { type: "list" };
const KANBAN_CONFIG: KanbanViewConfig = { type: "kanban", groupBy: "status" };

// --- Per-profile view memory (interim, mirrors theme.ts) --------------------
//
// Which view (list/kanban) is a lightweight UI preference, persisted per profile
// in localStorage exactly like the theme. Per-VIEW config persistence (per-list
// view memory, filters/sort — TASK-004/005) is SET's job in a later slice.
type TaskView = "list" | "kanban";
const VIEW_KEY_PREFIX = "nexus.tasks.view.";

function readStoredView(profileId: string): TaskView {
  return localStorage.getItem(VIEW_KEY_PREFIX + profileId) === "kanban" ? "kanban" : "list";
}
function persistView(profileId: string, view: TaskView): void {
  localStorage.setItem(VIEW_KEY_PREFIX + profileId, view);
}

const STATUS_TITLES: Record<TaskStatus, string> = strings.tasks.status;

function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/** Kanban column title for a status value; falls back to the raw value. */
function statusTitle(value: string): string {
  return isTaskStatus(value) ? STATUS_TITLES[value] : value;
}

/** Formats a due date for the chip; degrades to the raw string on bad input. */
function formatDue(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat("sr-Latn", { day: "2-digit", month: "short" }).format(date);
}

/** Priority (when not 'none') + due-date (when set) chips; null when neither applies. */
function taskChips(task: TaskFields): ReactNode {
  const chips: ReactNode[] = [];
  if (task.priority !== "none") {
    chips.push(
      <Chip key="priority" variant={task.priority === "high" ? "accent" : "neutral"}>
        {strings.tasks.priority[task.priority]}
      </Chip>,
    );
  }
  if (task.dueDate) {
    chips.push(
      <Chip key="due" variant="data">
        {formatDue(task.dueDate)}
      </Chip>,
    );
  }
  return chips.length > 0 ? <span className="tasks__chips">{chips}</span> : null;
}

export interface TasksPageProps {
  profileId: string;
}

/**
 * The TASK module page (v0 basics): quick-add, a list and a kanban view over the
 * shared views engine, per-row done toggle and delete-with-undo. The engine owns
 * ordering/grouping; every write goes through the tasks:* IPC allowlist, so the
 * store stays the single source of truth (e.g. it derives completed_at).
 */
export function TasksPage({ profileId }: TasksPageProps) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<TaskView>(() => readStoredView(profileId));
  const [draft, setDraft] = useState("");
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await window.nexus.listTasks(profileId);
        if (active) setTasks(list);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load tasks:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  function selectView(next: TaskView): void {
    setView(next);
    persistView(profileId, next);
  }

  function replaceTask(updated: Task): void {
    setTasks((prev) => prev && prev.map((task) => (task.id === updated.id ? updated : task)));
  }

  async function reload(): Promise<void> {
    setTasks(await window.nexus.listTasks(profileId));
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const title = draft.trim();
    if (title.length === 0) return;
    try {
      const created = await window.nexus.createTask(profileId, { title });
      setTasks((prev) => (prev ? [...prev, created] : [created]));
      setDraft("");
      inputRef.current?.focus();
    } catch (error) {
      console.error("Nexus: failed to create task:", error);
    }
  }

  async function toggleDone(task: TaskFields, done: boolean): Promise<void> {
    try {
      replaceTask(await window.nexus.setTaskDone(profileId, task.id, done));
    } catch (error) {
      console.error("Nexus: failed to toggle task:", error);
    }
  }

  async function moveToStatus(task: TaskFields, status: TaskStatus): Promise<void> {
    try {
      replaceTask(await window.nexus.updateTask(profileId, task.id, { status }));
    } catch (error) {
      console.error("Nexus: failed to move task:", error);
    }
  }

  async function remove(task: TaskFields): Promise<void> {
    try {
      await window.nexus.deleteTask(profileId, task.id);
      setTasks((prev) => prev && prev.filter((current) => current.id !== task.id));
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoId(task.id);
    } catch (error) {
      console.error("Nexus: failed to delete task:", error);
    }
  }

  async function undo(): Promise<void> {
    if (!pendingUndoId) return;
    try {
      await window.nexus.restoreTask(profileId, pendingUndoId);
      setPendingUndoId(null);
      // Re-fetch so the restored task lands back in stable creation order.
      await reload();
    } catch (error) {
      console.error("Nexus: failed to restore task:", error);
    }
  }

  return (
    <div className="tasks">
      <div className="tasks__toolbar">
        <form className="tasks__quick-add" onSubmit={submitDraft}>
          <input
            ref={inputRef}
            className="nx-textfield__input"
            value={draft}
            placeholder={strings.tasks.quickAddPlaceholder}
            aria-label={strings.tasks.quickAddLabel}
            autoFocus
            onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
          />
          <Button type="submit" variant="primary">
            {strings.tasks.quickAddSubmit}
          </Button>
        </form>

        <div className="tasks__views" role="group" aria-label={strings.tasks.viewLabel}>
          {(["list", "kanban"] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              className={
                view === option ? "tasks__view tasks__view--active" : "tasks__view"
              }
              aria-pressed={view === option}
              onClick={() => selectView(option)}
            >
              {option === "list" ? strings.tasks.viewList : strings.tasks.viewKanban}
            </Button>
          ))}
        </div>
      </div>

      {pendingUndoId != null && (
        <div className="tasks__undo" role="status">
          <span className="tasks__undo-text">{strings.tasks.deletedNotice}</span>
          <Button size="sm" className="tasks__undo-action" onClick={() => void undo()}>
            {strings.tasks.undo}
          </Button>
          <Button
            size="sm"
            className="tasks__undo-dismiss"
            aria-label={strings.tasks.dismiss}
            onClick={() => setPendingUndoId(null)}
          >
            ×
          </Button>
        </div>
      )}

      {failed ? (
        <EmptyState title={strings.tasks.emptyTitle} description={strings.tasks.loadError} />
      ) : tasks === null ? (
        <p className="app__muted">{strings.app.loading}</p>
      ) : tasks.length === 0 ? (
        <EmptyState
          title={strings.tasks.emptyTitle}
          description={strings.tasks.emptyDescription}
        />
      ) : view === "list" ? (
        <ListView<TaskFields>
          items={tasks}
          schema={TASK_SCHEMA}
          config={LIST_CONFIG}
          itemKey={(task) => task.id}
          renderItem={(task) => (
            <ListRow
              trailing={
                <span className="tasks__row-meta">
                  {taskChips(task)}
                  <Button
                    size="sm"
                    className="tasks__delete"
                    aria-label={strings.tasks.deleteLabel}
                    onClick={() => void remove(task)}
                  >
                    ×
                  </Button>
                </span>
              }
            >
              <Checkbox
                checked={task.done}
                done={task.done}
                onChange={(event) => void toggleDone(task, event.target.checked)}
              >
                {task.title}
              </Checkbox>
            </ListRow>
          )}
        />
      ) : (
        <KanbanView<TaskFields>
          items={tasks}
          schema={TASK_SCHEMA}
          config={KANBAN_CONFIG}
          columnTitle={statusTitle}
          itemKey={(task) => task.id}
          renderCard={(task) => <KanbanCard tag={taskChips(task)}>{task.title}</KanbanCard>}
          onMove={(task, patch) => {
            const next = patch.status;
            // Ungrouped drops never occur — every task has a valid status — so
            // the patch is always a real status; main revalidates regardless.
            if (next != null && isTaskStatus(next)) void moveToStatus(task, next);
          }}
        />
      )}
    </div>
  );
}
