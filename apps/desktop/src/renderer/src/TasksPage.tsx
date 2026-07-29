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
  TextField,
} from "@nexus/ui";
import { isValidDayKey, parseQuickAddDate } from "@nexus/core";
import type { CollectionSchema, KanbanViewConfig, ListViewConfig } from "@nexus/core";
import type {
  NewTaskFields,
  RecurrenceRule,
  Task,
  TaskFieldChanges,
  TaskPriority,
  TaskStatus,
} from "../../shared/ipc.js";
import { localTodayKey } from "./examDates.js";
import { RecurrenceMark, RecurrencePicker } from "./RecurrencePicker.js";
import { scrollRevealedIntoView, useRevealedRow } from "./reveal.js";
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

/** Membership against the closed list, narrowing the priority `<select>`'s raw string without an assertion. */
function asPriority(value: string): TaskPriority {
  for (const priority of TASK_PRIORITIES) if (priority === value) return priority;
  return "none";
}

/** Kanban column title for a status value; falls back to the raw value. */
function statusTitle(value: string): string {
  return isTaskStatus(value) ? STATUS_TITLES[value] : value;
}

/**
 * Formats a due date for the chip; degrades to the raw string on bad input. A
 * due date is a bare calendar day, so it is formatted in UTC — the same rule
 * DASH and CAL follow, and without it a negative-offset timezone would render
 * every due date a day early.
 */
function formatDue(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat("sr-Latn", { day: "2-digit", month: "short", timeZone: "UTC" }).format(
        date,
      );
}

/**
 * The date recognised in the quick-add line, with its weekday spelled out —
 * "pet, 15. avg". Same bare-day/UTC rule as `formatDue`, plus the weekday:
 * what the user typed is often a WORD ("u petak"), and the chip is only
 * checkable against it at a glance if it names the day back.
 */
function formatQuickDate(dayKey: string): string {
  const date = new Date(dayKey);
  return Number.isNaN(date.getTime())
    ? dayKey
    : new Intl.DateTimeFormat("sr-Latn", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      }).format(date);
}

/** The series marker (when the task repeats), priority (when not 'none') and due-date (when set) chips; null when none apply. */
function taskChips(task: TaskFields): ReactNode {
  const chips: ReactNode[] = [];
  if (task.recurrence !== null) chips.push(<RecurrenceMark key="recurrence" />);
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

/** A pending deep-link target (021-e global search / palette commands): reveal one task, or focus the quick-add input for a fresh one. */
export type TasksIntent = { kind: "reveal"; taskId: string } | { kind: "create" };

/** DOM id for a task's row — shared by both the list and kanban renderings (only one is ever mounted at a time), so `scrollRevealedIntoView` has one stable target regardless of which view is active. */
function taskRowDomId(taskId: string): string {
  return `task-row-${taskId}`;
}

export interface TasksPageProps {
  profileId: string;
  intent?: TasksIntent | null;
  /** Reports that `intent` above has been acted on, so the caller (App.tsx) can clear it. */
  onIntentHandled?: () => void;
}

/**
 * The TASK module page (v0 basics): one form that both adds and edits (its
 * title line alone is still the quick-add), a list and a kanban view over the
 * shared views engine, per-row done toggle and delete-with-undo. The engine owns
 * ordering/grouping; every write goes through the tasks:* IPC allowlist, so the
 * store stays the single source of truth (e.g. it derives completed_at).
 *
 * Ticking a task off always goes through `completeTaskOccurrence` (ADR-024) —
 * the checkbox and the kanban drop into "Završeno" alike. A one-off completes;
 * a recurring one advances to its next due date and comes back open, which the
 * notice bar reports because the row has moved rather than been struck through.
 */
export function TasksPage({ profileId, intent, onIntentHandled }: TasksPageProps) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<TaskView>(() => readStoredView(profileId));
  // One form serves both modes, as on Kalendar: a non-null editingId means
  // "editing that task", and the title line alone still works as the quick-add.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  /** The quick-add phrase the user waved away, or null — see `activeQuickDate`. */
  const [dismissedPhrase, setDismissedPhrase] = useState<string | null>(null);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  /** Next due date of a recurring task that just advanced, or null — the row moved, so the page says where to. */
  const [advancedTo, setAdvancedTo] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { revealedId, reveal } = useRevealedRow();

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

  // Consumes a pending deep-link (021-e): "create" focuses the quick-add
  // input; "reveal" scrolls to and marks a task's row. Both the list and the
  // kanban view always render every loaded task — v0 has no filter/sort UI
  // yet (see the top-of-file comment) — so unlike CAL/STUDY there is no view
  // or filter state to adjust here; the reveal has nothing to hide from.
  // Keyed on `intent`/`tasks` rather than mount, so a search fired while
  // already on Zadaci retriggers this exactly like one that switches modules
  // here does, and so a load race (intent arrives before the list has
  // fetched) resolves itself once `tasks` changes instead of dropping it.
  useEffect(() => {
    if (!intent) return;
    if (intent.kind === "create") {
      inputRef.current?.focus();
      onIntentHandled?.();
      return;
    }
    if (tasks === null) return; // still loading — wait rather than deciding it's missing
    if (!tasks.some((task) => task.id === intent.taskId)) {
      onIntentHandled?.(); // deleted between indexing and clicking — do nothing else
      return;
    }
    reveal(intent.taskId);
    scrollRevealedIntoView(taskRowDomId(intent.taskId));
    onIntentHandled?.();
  }, [intent, tasks, reveal, onIntentHandled]);

  // A due date read straight out of the title (TASK-007). Derived plainly on
  // every render — the scan is a handful of regexes over a title-length string,
  // so there is nothing worth memoising or debouncing — and ONLY while
  // creating: editing an existing task must never start eating words out of a
  // title the user already saved.
  const quickDate = editingId === null ? parseQuickAddDate(draft, localTodayKey()) : null;
  // Dismissal is remembered by the exact phrase, not by a boolean: the chip
  // stays gone while that phrase stands, and comes back the moment the user
  // edits it into a different one.
  const activeQuickDate =
    quickDate !== null && quickDate.phrase !== dismissedPhrase ? quickDate : null;

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

  function resetForm(): void {
    setEditingId(null);
    setDraft("");
    setDueDate("");
    setPriority("none");
    setRecurrence(null);
    setDismissedPhrase(null);
  }

  /** Loads a task into the shared form and switches it to edit mode. */
  function startEdit(task: TaskFields): void {
    setEditingId(task.id);
    setDraft(task.title);
    setDismissedPhrase(null);
    // The store accepts a date-time due date too, but this form only speaks in
    // whole days, so it shows (and on save keeps) the day part.
    setDueDate(task.dueDate === null ? "" : task.dueDate.slice(0, 10));
    setPriority(task.priority);
    setRecurrence(task.recurrence);
    inputRef.current?.focus();
  }

  async function submitForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const typed = draft.trim();
    if (typed.length === 0) return;
    // A recognised date takes its phrase out of the title — unless the phrase
    // IS the whole title ("sutra"), where stripping it would save a task with
    // no name; then the raw draft stands in and only the date is taken.
    const title =
      activeQuickDate !== null && activeQuickDate.strippedTitle.length > 0
        ? activeQuickDate.strippedTitle
        : typed;
    // The date field always wins: it is the explicit correction the user makes
    // when the reading is wrong.
    const due = dueDate.length > 0 ? dueDate : (activeQuickDate?.date ?? null);
    // A rule phases from the due date, so there is no such thing as one without
    // it; the picker is already disabled in that state, and this is the guard
    // for the order the user could still reach it in (set a rule, clear the date).
    // Deliberately read off the FIELD, not off `due`: the picker is anchored to
    // the field too, and a second anchor mid-edit would let a rule phase from a
    // date the form does not show.
    const rule = isValidDayKey(dueDate) ? recurrence : null;
    try {
      if (editingId != null) {
        const changes: TaskFieldChanges = {
          title,
          dueDate: due,
          priority,
          recurrence: rule,
        };
        replaceTask(await window.nexus.updateTask(profileId, editingId, changes));
      } else {
        const fields: NewTaskFields = { title };
        // Only send what is set (exactOptionalPropertyTypes).
        if (due !== null) fields.dueDate = due;
        if (priority !== "none") fields.priority = priority;
        if (rule !== null) fields.recurrence = rule;
        const created = await window.nexus.createTask(profileId, fields);
        setTasks((prev) => (prev ? [...prev, created] : [created]));
      }
      resetForm();
      inputRef.current?.focus();
    } catch (error) {
      console.error("Nexus: failed to save task:", error);
    }
  }

  /**
   * "This occurrence is done" — the single completion path for every task
   * (ADR-024). A one-off completes; a recurring one advances in place and comes
   * back not-done at its next date, which is worth saying out loud, because the
   * row the user just ticked has moved rather than been struck through.
   */
  async function completeTask(task: TaskFields): Promise<void> {
    try {
      const updated = await window.nexus.completeTaskOccurrence(profileId, task.id);
      replaceTask(updated);
      setAdvancedTo(!updated.done && updated.dueDate !== null ? updated.dueDate : null);
    } catch (error) {
      console.error("Nexus: failed to complete task:", error);
    }
  }

  async function toggleDone(task: TaskFields, done: boolean): Promise<void> {
    if (done) {
      await completeTask(task);
      return;
    }
    try {
      replaceTask(await window.nexus.setTaskDone(profileId, task.id, false));
    } catch (error) {
      console.error("Nexus: failed to toggle task:", error);
    }
  }

  async function moveToStatus(task: TaskFields, status: TaskStatus): Promise<void> {
    // Dropping a card into "Završeno" is a completion like any other, so it
    // takes the same path — `setTaskDone`/`update` refuse a recurring task
    // precisely so the two cannot drift apart.
    if (status === "done") {
      await completeTask(task);
      return;
    }
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
      // Never leave the form bound to a task that no longer exists.
      if (editingId === task.id) resetForm();
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
        <form className="tasks__form" onSubmit={submitForm}>
          <div className="tasks__quick-add">
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
              {editingId != null ? strings.tasks.save : strings.tasks.quickAddSubmit}
            </Button>
            {editingId != null && (
              <Button type="button" className="tasks__cancel" onClick={resetForm}>
                {strings.tasks.cancel}
              </Button>
            )}
          </div>

          {activeQuickDate !== null && (
            <div
              className="tasks__quick-date"
              role="status"
              aria-label={strings.tasks.quickDate.regionLabel}
            >
              <span className="tasks__quick-date-mark" aria-hidden="true">
                →
              </span>
              <Chip variant="data" title={strings.tasks.quickDate.chipTitle}>
                {formatQuickDate(activeQuickDate.date)}
              </Chip>
              <Button
                type="button"
                size="sm"
                className="tasks__quick-date-dismiss"
                aria-label={strings.tasks.quickDate.dismissLabel}
                onClick={() => {
                  setDismissedPhrase(activeQuickDate.phrase);
                  // The button it sits on is about to unmount, so focus has to
                  // be handed somewhere deliberate — back to the line the user
                  // was typing in.
                  inputRef.current?.focus();
                }}
              >
                ×
              </Button>
            </div>
          )}

          <div className="tasks__fields">
            <TextField
              type="date"
              value={dueDate}
              aria-label={strings.tasks.dueDateLabel}
              onChange={(event) => {
                const next = event.target.value;
                setDueDate(next);
                // A rule has to phase from a real day, so clearing the due date
                // clears the rule where the user can see it happen.
                if (!isValidDayKey(next)) setRecurrence(null);
              }}
            />
            <select
              className="tasks__select"
              value={priority}
              aria-label={strings.tasks.priorityLabel}
              onChange={(event) => setPriority(asPriority(event.target.value))}
            >
              {TASK_PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {strings.tasks.priority[option]}
                </option>
              ))}
            </select>
            {/* Keyed by the record being edited: switching tasks re-derives
                whether the rule reads as a preset or as Prilagođeno. */}
            <RecurrencePicker
              key={editingId ?? "new"}
              value={recurrence}
              onChange={setRecurrence}
              anchor={dueDate}
            />
          </div>
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

      {advancedTo != null && (
        <div className="tasks__undo" role="status">
          <span className="tasks__undo-text">
            {strings.recurrence.nextOccurrence} {formatDue(advancedTo)}
          </span>
          <Button
            size="sm"
            className="tasks__undo-dismiss"
            aria-label={strings.tasks.dismiss}
            onClick={() => setAdvancedTo(null)}
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
                    className="tasks__edit"
                    aria-label={strings.tasks.editLabel}
                    onClick={() => startEdit(task)}
                  >
                    ✎
                  </Button>
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
                {/* The id/reveal mark sits on this inner span rather than on
                    `ListRow` itself: `ListRow`/`ListView` cannot take extra
                    props, and wrapping `ListRow` in an owned div would break
                    its `:last-child` border-bottom CSS (packages/ui/src/
                    styles.css — out of scope for this slice). */}
                <span
                  id={taskRowDomId(task.id)}
                  className={revealedId === task.id ? "nx-revealed" : undefined}
                >
                  {task.title}
                </span>
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
          renderCard={(task) => (
            <KanbanCard tag={taskChips(task)}>
              <span
                id={taskRowDomId(task.id)}
                className={revealedId === task.id ? "nx-revealed" : undefined}
              >
                {task.title}
              </span>
            </KanbanCard>
          )}
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
