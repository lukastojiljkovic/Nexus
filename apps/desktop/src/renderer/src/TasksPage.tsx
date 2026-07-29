import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

// --- Subtask tree (TASK-008) ------------------------------------------------

/** Shared empty result for a childless task, so a render never allocates one. */
const NO_CHILDREN: readonly TaskFields[] = [];

/**
 * How many steps a subtask is allowed to move right. Deeper nesting still
 * renders in full — it just stops indenting: past three steps the indent starts
 * eating the row instead of explaining it.
 */
const MAX_INDENT_DEPTH = 3;

/** Class for a row's indent spacer at `depth` (never called with depth 0 — a top-level row has no spacer). */
function indentClass(depth: number): string {
  return `tasks__indent tasks__indent--${Math.min(depth, MAX_INDENT_DEPTH)}`;
}

/**
 * Splits the flat task list into the rows that render at top level and a
 * parent → direct-children index, both keeping the order `listTasks` returned.
 *
 * A task whose `parentId` names a row that is not in the list — the usual case
 * being a deleted parent, whose children the store deliberately leaves
 * untouched — counts as top level. A subtask must never disappear because its
 * parent did; restoring the parent (the undo bar) re-nests it on the next load.
 */
function buildTaskTree(tasks: readonly TaskFields[]): {
  roots: TaskFields[];
  children: ReadonlyMap<string, TaskFields[]>;
} {
  const ids = new Set(tasks.map((task) => task.id));
  const roots: TaskFields[] = [];
  const children = new Map<string, TaskFields[]>();
  for (const task of tasks) {
    if (task.parentId === null || !ids.has(task.parentId)) {
      roots.push(task);
      continue;
    }
    const siblings = children.get(task.parentId);
    if (siblings) siblings.push(task);
    else children.set(task.parentId, [task]);
  }
  return { roots, children };
}

/**
 * The `2/5` roll-up on a task that has subtasks (TASK-008); null when it has
 * none.
 *
 * DIRECT children only. A recursive total counts a nested checklist's items
 * among this row's own, so "2/5" would stop meaning "two of the five things
 * listed under this row" — the only reading a bare number on a row can carry.
 */
function progressChip(children: readonly TaskFields[]): ReactNode {
  if (children.length === 0) return null;
  const done = children.reduce((count, child) => (child.done ? count + 1 : count), 0);
  return (
    <Chip
      key="progress"
      className={done === children.length ? "tasks__progress-done" : undefined}
      title={strings.tasks.subtaskProgressTitle}
    >
      {done}/{children.length}
    </Chip>
  );
}

/** The series marker (when the task repeats), subtask roll-up (when it has children), priority (when not 'none') and due-date (when set) chips; null when none apply. */
function taskChips(task: TaskFields, children: readonly TaskFields[]): ReactNode {
  const chips: ReactNode[] = [];
  if (task.recurrence !== null) chips.push(<RecurrenceMark key="recurrence" />);
  const rollUp = progressChip(children);
  if (rollUp !== null) chips.push(rollUp);
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

/** What "Završeno" means for a task that still has open subtasks under it. */
type SubtaskCompletion = "all" | "one";

interface SubtaskCompletionDialogProps {
  onChoose: (choice: SubtaskCompletion) => void;
  onCancel: () => void;
}

/**
 * "Zadatak ima otvorene podzadatke." (PRD 03 §4) — the same house dialog as the
 * recurrence scope question (`RecurrenceScopeDialog`), and for the same reason:
 * ticking this row off would reach records the user did not tick, so it is
 * asked rather than assumed. It shares that dialog's CSS recipe outright rather
 * than restating it; only the wording and the number of choices differ.
 *
 * Deliberately without a default: no primary button, and Enter picks nothing.
 * Escape, the backdrop and Otkaži all cancel and change nothing.
 */
function SubtaskCompletionDialog({ onChoose, onCancel }: SubtaskCompletionDialogProps) {
  const s = strings.tasks.subtasks;
  const choicesRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const questionId = useId();

  // Focus lands on the first choice, not on a default: answerable from the
  // keyboard without any key already meaning "and the subtasks too".
  useEffect(() => {
    choicesRef.current?.querySelector("button")?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return createPortal(
    <div className="tasks__dialog-overlay">
      <div className="tasks__dialog-backdrop" onClick={onCancel} />
      <div
        className="tasks__dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={questionId}
      >
        <h2 id={titleId} className="tasks__dialog-title">
          {s.title}
        </h2>
        <p id={questionId} className="tasks__dialog-question">
          {s.question}
        </p>
        <div className="tasks__dialog-choices" ref={choicesRef}>
          <Button className="tasks__dialog-choice" onClick={() => onChoose("all")}>
            {s.completeAll}
          </Button>
          <Button className="tasks__dialog-choice" onClick={() => onChoose("one")}>
            {s.completeOne}
          </Button>
        </div>
        <div className="tasks__dialog-actions">
          <Button className="tasks__dialog-cancel" onClick={onCancel}>
            {s.cancel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
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
  // The inline "new subtask" line (TASK-008): which row it hangs under, and
  // what has been typed into it. Kept apart from the add/edit form above on
  // purpose — opening a subtask line is not an edit, so it resets nothing.
  const [subtaskParentId, setSubtaskParentId] = useState<string | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  /** The task whose completion is waiting on the open-subtasks question, or null. */
  const [completePrompt, setCompletePrompt] = useState<TaskFields | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const subtaskInputRef = useRef<HTMLInputElement>(null);
  const { revealedId, reveal } = useRevealedRow();

  // Rebuilt from the flat list on every render: it is one pass over an array
  // the page already holds, so there is nothing worth memoising.
  const { roots, children } = buildTaskTree(tasks ?? []);
  const childrenOf = (taskId: string): readonly TaskFields[] =>
    children.get(taskId) ?? NO_CHILDREN;

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
      // A recurring task that ADVANCED also reopened every live subtask in the
      // same store transaction (ADR-024). Those rows are not in the reply, so
      // without a refetch the subtasks would keep rendering ticked under a task
      // that has already moved on to its next occurrence.
      if (!updated.done && childrenOf(task.id).length > 0) await reload();
    } catch (error) {
      console.error("Nexus: failed to complete task:", error);
    }
  }

  /**
   * Every not-done task below this one, deepest first.
   *
   * The whole subtree rather than just the direct children: completing a parent
   * over an open GRANDchild is the same silent reach PRD 03 §4 forbids, and
   * deepest-first is the order the cascade runs in, so a subtask is never
   * ticked off after the task it belongs to.
   */
  function openDescendants(task: TaskFields): TaskFields[] {
    const found: TaskFields[] = [];
    // `parentId` is create-only on the wire, so a fresh id can never close a
    // loop; `seen` is here so a malformed row (a hand-edited archive, say)
    // costs a skipped subtask rather than a hung renderer.
    const seen = new Set<string>([task.id]);
    const visit = (current: TaskFields): void => {
      for (const child of childrenOf(current.id)) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        visit(child);
        if (!child.done) found.push(child);
      }
    };
    visit(task);
    return found;
  }

  /**
   * The single entry point for "this is done" — the checkbox and the kanban
   * drop into Završeno alike.
   *
   * A RECURRING task is never asked about: `completeTaskOccurrence` advances it
   * to its next date instead of finishing it, and the same store transaction
   * reopens its live subtasks (ADR-024). There is nothing to cascade — the
   * subtasks are meant to come back open with the next occurrence.
   */
  async function requestComplete(task: TaskFields): Promise<void> {
    if (task.recurrence !== null || openDescendants(task).length === 0) {
      await completeTask(task);
      return;
    }
    setCompletePrompt(task);
  }

  /**
   * "Završi i podzadatke" — every open descendant, then the task itself, each
   * awaited in turn so the store applies them in that order.
   *
   * A recurring DESCENDANT goes through the same `completeTaskOccurrence` as
   * everything else, which ADVANCES it rather than ending it: this offer
   * completes one occurrence of a repeating subtask, it does not close its
   * series. Ending a series stays the recurrence scope dialog's job.
   */
  async function completeWithSubtasks(task: TaskFields): Promise<void> {
    try {
      for (const descendant of openDescendants(task)) {
        await window.nexus.completeTaskOccurrence(profileId, descendant.id);
      }
      await window.nexus.completeTaskOccurrence(profileId, task.id);
    } catch (error) {
      console.error("Nexus: failed to complete task with subtasks:", error);
    }
    // Refetch either way: the cascade moves many rows while replying only about
    // the last one, and a failure part-way through leaves the ones already done
    // — so what the page shows is whatever the store now holds.
    try {
      await reload();
      setAdvancedTo(null);
    } catch (error) {
      console.error("Nexus: failed to reload tasks:", error);
    }
  }

  async function toggleDone(task: TaskFields, done: boolean): Promise<void> {
    if (done) {
      await requestComplete(task);
      return;
    }
    // Un-ticking never cascades: reopening a parent says nothing about work
    // that was genuinely finished under it.
    try {
      replaceTask(await window.nexus.setTaskDone(profileId, task.id, false));
    } catch (error) {
      console.error("Nexus: failed to toggle task:", error);
    }
  }

  /** Opens the inline subtask line under a row. Always opens, never toggles: the click's own blur may already have closed an empty line, and a toggle would then reopen what the user meant to shut. */
  function openSubtaskInput(taskId: string): void {
    // Re-clicking the row already being typed under must not wipe the draft —
    // it only hands focus back to the line the click just blurred.
    if (subtaskParentId === taskId) {
      subtaskInputRef.current?.focus();
      return;
    }
    setSubtaskParentId(taskId);
    setSubtaskDraft("");
  }

  function closeSubtaskInput(): void {
    setSubtaskParentId(null);
    setSubtaskDraft("");
  }

  /** Appends a bare subtask under `parentId` — the inline line only ever adds, so the add/edit form above is left exactly as the user had it. */
  async function addSubtask(parentId: string): Promise<void> {
    const title = subtaskDraft.trim();
    if (title.length === 0) return;
    try {
      const created = await window.nexus.createTask(profileId, { title, parentId });
      setTasks((prev) => (prev ? [...prev, created] : [created]));
      // The line stays open on an empty draft: a checklist is written in one
      // go, and blurring it empty is what closes it.
      setSubtaskDraft("");
    } catch (error) {
      console.error("Nexus: failed to add subtask:", error);
    }
  }

  async function moveToStatus(task: TaskFields, status: TaskStatus): Promise<void> {
    // Dropping a card into "Završeno" is a completion like any other, so it
    // takes the same path — `setTaskDone`/`update` refuse a recurring task
    // precisely so the two cannot drift apart.
    if (status === "done") {
      await requestComplete(task);
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
      // Never leave the form — or the inline subtask line — bound to a task
      // that no longer exists. The children themselves are left alone: the
      // store soft-deletes this row only, so they re-render at top level by the
      // orphan rule in `buildTaskTree` and re-nest when the undo restores it.
      if (editingId === task.id) resetForm();
      if (subtaskParentId === task.id) closeSubtaskInput();
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

  /** One task's row, indented by `depth`; `children` is its direct children, already looked up by the caller. */
  function renderRow(task: TaskFields, depth: number, children: readonly TaskFields[]): ReactNode {
    return (
      <ListRow
        key={task.id}
        leading={depth > 0 ? <span className={indentClass(depth)} aria-hidden="true" /> : undefined}
        trailing={
          <span className="tasks__row-meta">
            {taskChips(task, children)}
            <Button
              size="sm"
              className="tasks__add-subtask"
              aria-label={strings.tasks.addSubtaskLabel}
              onClick={() => openSubtaskInput(task.id)}
            >
              +
            </Button>
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
    );
  }

  /** The inline "new subtask" line under a row, indented to where its result will land. */
  function renderSubtaskInput(parentId: string, depth: number): ReactNode {
    return (
      <div className="tasks__subtask-add" key={`add-${parentId}`}>
        <span className={indentClass(depth)} aria-hidden="true" />
        <input
          ref={subtaskInputRef}
          className="nx-textfield__input tasks__subtask-input"
          value={subtaskDraft}
          placeholder={strings.tasks.subtaskPlaceholder}
          aria-label={strings.tasks.addSubtaskLabel}
          autoFocus
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSubtaskDraft(event.target.value)}
          onKeyDown={(event) => {
            // Its own Enter/Escape handling — the line sits outside the
            // add/edit <form>, so neither key reaches that form from here.
            if (event.key === "Enter") {
              event.preventDefault();
              void addSubtask(parentId);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeSubtaskInput();
            }
          }}
          onBlur={() => {
            if (subtaskDraft.trim().length === 0) closeSubtaskInput();
          }}
        />
      </div>
    );
  }

  /**
   * One task row plus everything hanging off it: its inline subtask line when
   * open, then its children, recursively.
   *
   * Children are emitted as SIBLING rows inside their root's single `ListView`
   * item rather than handed to the engine as items of their own. The list
   * config sorts and groups whatever it is given, and a child sorted away from
   * its parent is an orphan on screen — so the engine keeps ordering top-level
   * rows (which is what a task list is a list of) and the page keeps every
   * subtree attached to the row it belongs to.
   */
  function renderBranch(task: TaskFields, depth: number, seen: Set<string>): ReactNode[] {
    // See `openDescendants`: a loop is unreachable through the wire, and this
    // guard is what keeps a malformed row from becoming an infinite render.
    if (seen.has(task.id)) return [];
    seen.add(task.id);
    const children = childrenOf(task.id);
    const nodes: ReactNode[] = [renderRow(task, depth, children)];
    if (subtaskParentId === task.id) nodes.push(renderSubtaskInput(task.id, depth + 1));
    for (const child of children) nodes.push(...renderBranch(child, depth + 1, seen));
    return nodes;
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
        // Only the top-level rows are handed to the engine; each one renders
        // its own subtree (see `renderBranch`).
        <ListView<TaskFields>
          items={roots}
          schema={TASK_SCHEMA}
          config={LIST_CONFIG}
          itemKey={(task) => task.id}
          renderItem={(task) => renderBranch(task, 0, new Set())}
        />
      ) : (
        // The board stays flat: a subtask is a real task with a status of its
        // own, and a card in Za rad whose parent sits in U toku belongs in Za
        // rad. Only the roll-up chip travels here, so a parent card still says
        // how much of it is actually finished.
        <KanbanView<TaskFields>
          items={tasks}
          schema={TASK_SCHEMA}
          config={KANBAN_CONFIG}
          columnTitle={statusTitle}
          itemKey={(task) => task.id}
          renderCard={(task) => (
            <KanbanCard tag={taskChips(task, childrenOf(task.id))}>
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

      {completePrompt !== null && (
        <SubtaskCompletionDialog
          onChoose={(choice) => {
            const task = completePrompt;
            setCompletePrompt(null);
            void (choice === "all" ? completeWithSubtasks(task) : completeTask(task));
          }}
          onCancel={() => setCompletePrompt(null)}
        />
      )}
    </div>
  );
}
