import { Fragment, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ChangeEvent, DragEvent, FormEvent, ReactNode } from "react";
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
import { foldSearchText, isInlineImageMime, isValidDayKey, parseQuickAddDate } from "@nexus/core";
import type { CollectionSchema, KanbanViewConfig, ListViewConfig } from "@nexus/core";
import {
  MAX_TASK_LIST_NAME_LENGTH,
  MAX_TASK_TAG_NAME_LENGTH,
  MAX_TASK_TEMPLATE_NAME_LENGTH,
} from "../../shared/ipc.js";
import type {
  DeleteListMode,
  NewTaskFields,
  RecurrenceRule,
  Task,
  TaskAttachment,
  TaskDependencyLink,
  TaskFieldChanges,
  TaskList,
  TaskListView,
  TaskPriority,
  TaskSection,
  TaskStatus,
  TaskTag,
  TaskTagLink,
  TaskTemplate,
} from "../../shared/ipc.js";
import { localTodayKey } from "./examDates.js";
import { NotePopover } from "./notePopover.js";
import { RecurrenceMark, RecurrencePicker } from "./RecurrencePicker.js";
import { scrollRevealedIntoView, useRevealedRow } from "./reveal.js";
import { dayUnit, strings } from "./strings.js";

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

/**
 * The list view carries NO sort spec on purpose, and that absence is the
 * ordering seam (TASK-004): `applySort` returns its input untouched without one,
 * so the rows render in exactly the order `listTasks` handed over — which is the
 * store's own total order (list, body before sections, then each scope by its
 * sparse `position`). Manual order is therefore the display order, and a drag
 * only has to write a new `position` for the list to redraw in it. Adding a sort
 * here would silently make the drag a no-op on screen.
 */
const LIST_CONFIG: ListViewConfig = { type: "list" };
const KANBAN_CONFIG: KanbanViewConfig = { type: "kanban", groupBy: "status" };

const STATUS_TITLES: Record<TaskStatus, string> = strings.tasks.status;

/** sr-Latn collation for the tag chips — plain "sr" mis-tailors Latin š/č/ć, and the store orders by SQLite's binary collation. */
const collator = new Intl.Collator(["sr-Latn", "sr"]);

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

// --- Reminders (ADR-028) ----------------------------------------------------

/** The offered lead times, in whole DAYS before the rok. Anything else a task already carries gets a chip of its own beside these. */
const REMINDER_LADDER: readonly number[] = [0, 1, 3, 7];

/**
 * A lead time as its chip label: "Na dan roka", "1 dan ranije", "3 dana
 * ranije". Zero is its own wording — there is nothing "ranije" about the due
 * day itself — and every other count takes `dayUnit`, so the ladder and any
 * offset outside it (a restored archive, a longer lead set on another device)
 * are worded by the one rule rather than two.
 */
function taskReminderLabel(days: number): string {
  const s = strings.tasks.reminders;
  if (days === 0) return s.atDue;
  return `${days} ${dayUnit(days, "dan", "dana")} ${s.before}`;
}

/**
 * The chips to draw: the fixed ladder plus every offset the edited task carries
 * that the ladder cannot say, in ascending order. Without that union an edit
 * would silently drop a lead time merely because no chip could express it.
 */
function reminderChoices(selected: readonly number[]): number[] {
  const extra = selected.filter((days) => !REMINDER_LADDER.includes(days));
  return [...new Set([...REMINDER_LADDER, ...extra])].sort((a, b) => a - b);
}

// --- Prilozi (migration 024) ------------------------------------------------

/** Locale-aware one-decimal formatter for the KB/MB branches of `formatBytes` — the NOTE panel's own (`NoteEditor.tsx`). */
const BYTES_FORMATTER = new Intl.NumberFormat("sr-Latn", { maximumFractionDigits: 1 });

/**
 * Human-readable file size for the Prilozi rows: whole bytes under 1 KB,
 * otherwise KB/MB with at most one decimal — no fabricated precision beyond
 * what `Intl.NumberFormat` already rounds to. Copied from `NoteEditor.tsx`
 * rather than imported: the two panels are in different pages with no shared
 * module between them, and a formatting helper is not worth a third one.
 */
function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${BYTES_FORMATTER.format(kb)} KB`;
  return `${BYTES_FORMATTER.format(kb / 1024)} MB`;
}

// --- Subtask tree (TASK-008) ------------------------------------------------

/** Shared empty result for a childless task, so a render never allocates one. */
const NO_CHILDREN: readonly TaskFields[] = [];

/** The same for an untagged task — the common case, and the one worth not allocating for. */
const NO_TAGS: readonly TaskTag[] = [];

// --- Dependencies (ADR-037) -------------------------------------------------

/**
 * How many candidates the "Dodaj zavisnost" picker offers at once. A cap rather
 * than a scroll: the field beside it is how a longer list is narrowed, and a
 * popover that grows past the window is worse than one that asks for a word.
 */
const MAX_DEPENDENCY_OPTIONS = 8;

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
 * The left spacer of anything that is NOT a top-level row: the width of the drag
 * grip column (which only top-level rows fill, see `renderRowLead`) plus this
 * row's own indent.
 *
 * One element rather than two siblings on purpose: both places it is used sit in
 * a flex row with a gap, and two siblings would take that gap between them and
 * push nested content one step further right than the row above it.
 */
function leadSpacer(depth: number): ReactNode {
  return (
    <span className="tasks__row-lead" aria-hidden="true">
      <span className="tasks__grip-spacer" />
      <span className={indentClass(depth)} />
    </span>
  );
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

// --- Lists and sections (TASK-004 / ADR-029) --------------------------------

/** How many steps a nested list is allowed to move right in the rail — the `MAX_INDENT_DEPTH` rule, one pane over: deeper lists still render, they just stop indenting. */
const MAX_RAIL_DEPTH = 3;

/** One list with its child lists, in the order the store returned them (`position`, never a name sort — a list's order is something the user sets). */
interface RailNode {
  list: TaskList;
  children: RailNode[];
}

/**
 * The flat list array as a tree keyed by `parentId`, with the Inbox first among
 * the roots — it is where a task lands when the user names none, so it leads.
 *
 * A list whose `parentId` names no fetched list would not be reachable here;
 * that state does not exist, because deleting a list PROMOTES its children to
 * the deleted list's own parent in the same transaction.
 */
function buildListTree(lists: readonly TaskList[]): RailNode[] {
  const byParent = new Map<string | null, TaskList[]>();
  for (const list of lists) {
    const siblings = byParent.get(list.parentId);
    if (siblings) siblings.push(list);
    else byParent.set(list.parentId, [list]);
  }
  const build = (parentId: string | null): RailNode[] =>
    (byParent.get(parentId) ?? []).map((list) => ({ list, children: build(list.id) }));
  const roots = build(null);
  return [...roots.filter((node) => node.list.isInbox), ...roots.filter((node) => !node.list.isInbox)];
}

/**
 * One rendering group of the list view: the list BODY (`section` null) or one
 * section, holding the top-level rows that belong to it. Sections come in their
 * own `position` order, which a task row cannot see — `TASK_ORDER` sorts rows by
 * `section_id`, i.e. by an opaque id — so the grouping is what puts the headings
 * in the order the user arranged them.
 */
interface TaskGroup {
  section: TaskSection | null;
  roots: TaskFields[];
}

/** The rail's and the list view's inline name editors: one open at a time, either a new row under a parent or a rename of an existing one. */
type RailEditing =
  | null
  | { mode: "new"; parentId: string | null }
  | { mode: "rename"; id: string };

type SectionEditing = null | { mode: "new" } | { mode: "rename"; id: string };

/** The Oznake section's own editor state, parallel to `SectionEditing` above (migration 023). */
type TagEditing = null | { mode: "new" } | { mode: "rename"; id: string };

/**
 * What a task drag is currently over: a gap between two rows of one ordering
 * scope, a section heading, or a list in the rail — one per write the drop
 * performs (`reorderTask` / `moveTaskToSection` / `moveTaskToList`).
 */
type DropTarget =
  | { kind: "gap"; beforeId: string | null; afterId: string | null }
  | { kind: "section"; id: string }
  | { kind: "list"; id: string };

/** Identity of a drop target, so a `dragover` over the one already highlighted does not re-render. */
function sameTarget(a: DropTarget | null, b: DropTarget): boolean {
  if (a === null || a.kind !== b.kind) return false;
  if (a.kind === "gap" && b.kind === "gap") {
    return a.beforeId === b.beforeId && a.afterId === b.afterId;
  }
  return "id" in a && "id" in b && a.id === b.id;
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

/**
 * The muted „N prilog/priloga“ chip on a task that carries files (migration
 * 024); null when it carries none — a zero chip would be noise on most rows.
 *
 * Outlined like the tag chip beside it and for the same reason: a file count is
 * metadata about the row, not a state of it.
 */
function attachmentChip(count: number): ReactNode {
  if (count === 0) return null;
  const s = strings.tasks.attachments;
  return (
    <Chip key="attachments" className="tasks__attachment-chip" title={s.chipTitle}>
      {count} {dayUnit(count, s.chipUnitOne, s.chipUnitMany)}
    </Chip>
  );
}

/**
 * The series marker (when the task repeats), subtask roll-up (when it has
 * children), the „Blokiran“ mark (when something it waits on is still open), tag
 * labels (when any are attached), priority (when not 'none') and due-date (when
 * set) chips; null when none apply.
 *
 * One cluster for both renderings, so a list row and a kanban card say the same
 * things about a task — which is why the tags and the blocked mark travel here
 * rather than being spliced into the list row alone.
 */
function taskChips(
  task: TaskFields,
  children: readonly TaskFields[],
  tags: readonly TaskTag[],
  attachmentCount: number,
  blocked: boolean,
): ReactNode {
  const chips: ReactNode[] = [];
  if (task.recurrence !== null) chips.push(<RecurrenceMark key="recurrence" />);
  const rollUp = progressChip(children);
  if (rollUp !== null) chips.push(rollUp);
  const attachments = attachmentChip(attachmentCount);
  if (attachments !== null) chips.push(attachments);
  // Outlined and muted, on the tag chip's recipe (see .tasks__blocked-chip):
  // waiting on something is a fact about the task, not a warning about it —
  // completing a blocked task is never refused (ADR-037) — so it must not read
  // as an alarm beside prioritet/rok.
  if (blocked) {
    chips.push(
      <Chip
        key="blocked"
        className="tasks__blocked-chip"
        title={strings.tasks.dependencies.blockedChipTitle}
      >
        {strings.tasks.dependencies.blockedChip}
      </Chip>,
    );
  }
  // Outlined rather than filled (see .tasks__tag-chip): a label is not a state,
  // and next to prioritet/rok it must not read as one.
  for (const tag of tags) {
    chips.push(
      <Chip key={`tag-${tag.id}`} className="tasks__tag-chip">
        {tag.name}
      </Chip>,
    );
  }
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

interface InlineNameFormProps {
  value: string;
  placeholder: string;
  /** Accessible name of the field — the action being performed ("Nova lista", "Preimenuj sekciju"). */
  label: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** The wire cap for what is being named; defaults to the list/section one, which four of its six homes want. */
  maxLength?: number;
  /** Extra class on the form, so a caller can size it for its own row (see the tag row's `tasks__tag-form`). */
  className?: string;
}

/**
 * The one inline "type a name" line, shared by all six naming actions (new
 * list, rename list, new section, rename section, new tag, rename tag). They
 * differ only in their wording, their cap and in what the submit calls, so they
 * share this rather than six copies of the same form. Escape cancels — the line
 * sits outside the page's add/edit form, so no key reaches that form from here —
 * and the length cap is the wire contract's own, not a UI courtesy.
 */
function InlineNameForm({
  value,
  placeholder,
  label,
  onChange,
  onSubmit,
  onCancel,
  maxLength = MAX_TASK_LIST_NAME_LENGTH,
  className,
}: InlineNameFormProps) {
  return (
    <form
      className={className ? `tasks__name-form ${className}` : "tasks__name-form"}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <TextField
        value={value}
        placeholder={placeholder}
        aria-label={label}
        maxLength={maxLength}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <Button type="submit" size="sm" variant="primary">
        {strings.tasks.lists.save}
      </Button>
      <Button type="button" size="sm" className="tasks__name-cancel" onClick={onCancel}>
        {strings.tasks.lists.cancel}
      </Button>
    </form>
  );
}

interface TaskListDeleteDialogProps {
  list: TaskList;
  /** The stored Inbox name, so the "move them there" choice says where — the Inbox is renamable. */
  inboxName: string;
  onChoose: (mode: DeleteListMode) => void;
  onCancel: () => void;
}

/**
 * "Šta sa zadacima iz ove liste?" — the two things deleting a list can mean
 * (ADR-029), asked rather than assumed, because they lose different things: one
 * keeps every task, the other takes them down with the list. The house dialog
 * recipe, shared outright with `SubtaskCompletionDialog` and the recurrence
 * scope question; only the wording differs.
 *
 * Deliberately without a default: no primary button, Enter picks nothing, and
 * Escape, the backdrop and Otkaži all cancel and change nothing.
 */
function TaskListDeleteDialog({ list, inboxName, onChoose, onCancel }: TaskListDeleteDialogProps) {
  const s = strings.tasks.lists.dialog;
  const choicesRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const questionId = useId();

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
        <p className="tasks__dialog-name">„{list.name}“</p>
        <p id={questionId} className="tasks__dialog-question">
          {s.question}
        </p>
        <div className="tasks__dialog-choices" ref={choicesRef}>
          <Button className="tasks__dialog-choice" onClick={() => onChoose("move-to-inbox")}>
            {s.moveToInboxPrefix} „{inboxName}“
          </Button>
          <Button className="tasks__dialog-choice" onClick={() => onChoose("delete-tasks")}>
            {s.deleteTasks}
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
 * The TASK module page: a list rail on the left (TASK-004 — the profile's Inbox
 * and every list under it), and beside it one form that both adds and edits (its
 * title line alone is still the quick-add), a list and a kanban view over the
 * shared views engine, per-row done toggle and delete-with-undo. The engine owns
 * grouping; every write goes through the tasks / task-lists / task-sections IPC
 * allowlist, so the store stays the single source of truth (e.g. it derives
 * completed_at, and it owns every `position`).
 *
 * Ticking a task off always goes through `completeTaskOccurrence` (ADR-024) —
 * the checkbox and the kanban drop into "Završeno" alike. A one-off completes;
 * a recurring one advances to its next due date and comes back open, which the
 * notice bar reports because the row has moved rather than been struck through.
 */
export function TasksPage({ profileId, intent, onIntentHandled }: TasksPageProps) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** Every list of the profile and every section of those lists — one fetch, see `TaskListsSnapshot`. */
  const [lists, setLists] = useState<TaskList[] | null>(null);
  const [sections, setSections] = useState<TaskSection[]>([]);
  /**
   * Which list the rail has selected — a PREFERENCE, not the answer: what the
   * page renders is derived below and falls back to the Inbox, so a selection
   * left over from another profile, or naming a list that has since been
   * deleted, resolves itself instead of blanking the page.
   */
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  /** True when the last list/section action failed — the rail says so rather than failing silently. */
  const [listFailed, setListFailed] = useState(false);
  const [railEditing, setRailEditing] = useState<RailEditing>(null);
  const [railDraft, setRailDraft] = useState("");
  const [sectionEditing, setSectionEditing] = useState<SectionEditing>(null);
  const [sectionDraft, setSectionDraft] = useState("");
  /** Oznake (migration 023): the profile's tags, every attachment of its live tasks, and the ids the filter has selected. */
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [tagLinks, setTagLinks] = useState<TaskTagLink[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [tagEditing, setTagEditing] = useState<TagEditing>(null);
  const [tagDraft, setTagDraft] = useState("");
  /** True when the last tag action failed — kept apart from `listFailed` so the two sections of the rail report their own. */
  const [tagFailed, setTagFailed] = useState(false);
  /**
   * Prilozi (migration 024): how many files each live task carries (the row/card
   * chip), the edited task's own rows (the form's panel), and that panel's own
   * transient error channel — separate from `listFailed`/`tagFailed`, since an
   * attachment failure belongs to the form, not to the rail.
   */
  const [attachmentCounts, setAttachmentCounts] = useState<Map<string, number>>(new Map());
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<"generic" | "tooLarge" | null>(null);
  /** True while the native picker is open — the button is disabled so a second dialog cannot be asked for. */
  const [attaching, setAttaching] = useState(false);
  /** Šabloni (ADR-035): the profile's saved task shapes, the row whose save prompt is open, and what has been typed into it. */
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [templateFor, setTemplateFor] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState("");
  /** One flag across save/apply/delete, the `tagFailed` arrangement: the message is generic, and every template action clears it before trying again. */
  const [templateFailed, setTemplateFailed] = useState(false);
  /** Zavisnosti (migration 029 / ADR-037): every edge of the profile whose both ends are live, plus the picker's own filter text and error line. */
  const [dependencies, setDependencies] = useState<TaskDependencyLink[]>([]);
  const [depDraft, setDepDraft] = useState("");
  const [depFailed, setDepFailed] = useState(false);
  /** The list whose delete is waiting on the "what about its tasks" question, or null. */
  const [deletePrompt, setDeletePrompt] = useState<TaskList | null>(null);
  /** The list a delete just removed, offered back — the list counterpart of `pendingUndoId`. */
  const [pendingListUndoId, setPendingListUndoId] = useState<string | null>(null);
  /** The section the add/edit form will file the task under; null is the list body. */
  const [formSectionId, setFormSectionId] = useState<string | null>(null);
  /** The task being dragged in the list view, and what the pointer is over. */
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // One form serves both modes, as on Kalendar: a non-null editingId means
  // "editing that task", and the title line alone still works as the quick-add.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([]);
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

  /**
   * The selected list, resolved rather than trusted: the stored preference if it
   * still names a list of this profile, else the Inbox, else nothing (only while
   * the first fetch is in flight — every profile has an Inbox).
   */
  const selectedList =
    lists === null
      ? null
      : (lists.find((list) => list.id === selectedListId) ??
        lists.find((list) => list.isInbox) ??
        lists[0] ??
        null);
  const selectedId = selectedList?.id ?? null;
  const inboxList = lists?.find((list) => list.isInbox) ?? null;

  /**
   * WHICH VIEW is now a per-list property (TASK-004/005): the toggle writes
   * `setTaskListView` and the list itself remembers, so switching lists switches
   * shape with them. This replaces the old per-profile localStorage memory
   * outright — the `nexus.tasks.view.<profileId>` key is simply left where it is
   * and never read again, which is the whole migration: the value it held was a
   * UI preference, and the Inbox's own `defaultView` now stands in its place.
   */
  const view: TaskListView = selectedList?.defaultView ?? "list";

  /**
   * The page shows ONE list at a time — that is what selecting in the rail
   * means. A task whose `listId` matches no fetched list would belong to a
   * soft-deleted list and be unreachable here; nothing can produce one: deleting
   * a list either moves its tasks to the Inbox or deletes them with it, and the
   * per-task undo re-places a task whose list is gone into the Inbox
   * (`TaskStore.restore`).
   */
  const listTasks =
    selectedId === null ? [] : (tasks ?? []).filter((task) => task.listId === selectedId);
  /** Already in `position` order: main returns sections grouped by list, each list's in its own order, so filtering preserves it. */
  const listSections =
    selectedId === null ? [] : sections.filter((section) => section.listId === selectedId);

  // The tag ids each task carries, from the flat link list — one pass over an
  // array the page already holds, like the tree below.
  const tagIdsByTask = new Map<string, Set<string>>();
  for (const link of tagLinks) {
    const ids = tagIdsByTask.get(link.taskId);
    if (ids) ids.add(link.tagId);
    else tagIdsByTask.set(link.taskId, new Set([link.tagId]));
  }
  const sortedTags = tags.slice().sort((a, b) => collator.compare(a.name, b.name));
  /** The store orders by SQLite's binary collation, which mis-tailors Serbian Latin — so the popover re-sorts, exactly as the tag chips do. */
  const sortedTemplates = templates.slice().sort((a, b) => collator.compare(a.name, b.name));
  const tagsOf = (taskId: string): readonly TaskTag[] => {
    const ids = tagIdsByTask.get(taskId);
    return ids === undefined ? NO_TAGS : sortedTags.filter((tag) => ids.has(tag.id));
  };

  // --- Zavisnosti (ADR-037), derived on every render ------------------------
  //
  // Two indexes over the flat edge list, plus a lookup over the PROFILE's tasks
  // rather than the selected list's: a dependency crosses lists freely, so a
  // blocker sitting in another list must still block, and must still be
  // nameable in the picker.
  const tasksById = new Map((tasks ?? []).map((task) => [task.id, task]));
  const blockersByTask = new Map<string, string[]>();
  const blockedByBlocker = new Map<string, string[]>();
  for (const edge of dependencies) {
    const blockers = blockersByTask.get(edge.blockedId);
    if (blockers) blockers.push(edge.blockerId);
    else blockersByTask.set(edge.blockedId, [edge.blockerId]);
    const blocked = blockedByBlocker.get(edge.blockerId);
    if (blocked) blocked.push(edge.blockedId);
    else blockedByBlocker.set(edge.blockerId, [edge.blockedId]);
  }

  /** The live blockers of one task, in the store's own order. */
  const blockersOf = (taskId: string): TaskFields[] => {
    const ids = blockersByTask.get(taskId);
    if (ids === undefined) return [];
    const rows: TaskFields[] = [];
    for (const id of ids) {
      const row = tasksById.get(id);
      if (row !== undefined) rows.push(row);
    }
    return rows;
  };

  /**
   * Whether a task is BLOCKED: any live blocker of it is still not done
   * (ADR-037 section 3). Derived, never stored and never enforced — completing a
   * blocked task simply works, and this only says the order the user set is not
   * finished yet.
   */
  const isBlocked = (taskId: string): boolean =>
    blockersOf(taskId).some((blocker) => !blocker.done);

  /**
   * The rows the page actually draws: the selected list first (that is what
   * selecting in the rail means), then narrowed by the tag filter with AND
   * semantics — a task must carry EVERY selected tag, the same rule NotesPage's
   * filter applies to notes.
   *
   * A matching SUBTASK whose parent does not match renders at top level, by the
   * orphan rule `buildTaskTree` already has. That is the honest reading of a
   * filter — the rows on screen are exactly the tasks carrying the tags — and it
   * is why the filter never touches what a task's subtasks ARE (see below).
   */
  const visibleTasks =
    tagFilter.length === 0
      ? listTasks
      : listTasks.filter((task) => tagFilter.every((id) => tagIdsByTask.get(task.id)?.has(id)));
  /** True when the list holds rows but the filter shows none of them — its own empty state, not "the list is empty". */
  const filterHidesEverything = tagFilter.length > 0 && visibleTasks.length === 0;

  // Rebuilt from the flat list on every render: it is one pass over an array
  // the page already holds, so there is nothing worth memoising.
  //
  // TWO trees, and the split is load-bearing: `children` answers what a task's
  // subtasks ARE (over the WHOLE list), while `visibleChildren` answers which of
  // them this render draws. Deriving the first from the filtered rows would make
  // a roll-up count only what is on screen ("1/1" on a task with five open
  // subtasks) and would let completing a parent quietly skip the subtasks the
  // filter hides — the very reach PRD 03 §4 makes this page ask about.
  const { children } = buildTaskTree(listTasks);
  const { roots, children: visibleChildren } = buildTaskTree(visibleTasks);
  const childrenOf = (taskId: string): readonly TaskFields[] =>
    children.get(taskId) ?? NO_CHILDREN;
  const visibleChildrenOf = (taskId: string): readonly TaskFields[] =>
    visibleChildren.get(taskId) ?? NO_CHILDREN;

  const knownSectionIds = new Set(listSections.map((section) => section.id));
  /** The heading a row renders under: its own section, or the body for a section this fetch does not know (only reachable between a section delete and the refetch that follows it). */
  const groupKeyOf = (task: TaskFields): string | null =>
    task.sectionId !== null && knownSectionIds.has(task.sectionId) ? task.sectionId : null;
  const groups: TaskGroup[] = [
    { section: null, roots: roots.filter((task) => groupKeyOf(task) === null) },
    ...listSections.map((section) => ({
      section,
      roots: roots.filter((task) => task.sectionId === section.id),
    })),
  ];

  const draggedTask =
    draggedTaskId === null
      ? null
      : (listTasks.find((task) => task.id === draggedTaskId) ?? null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // One round trip each, in parallel: the rail and the rows are one screen,
        // so a render that has tasks but no lists (or no tags for the chips it
        // draws, or no dependencies for the „Blokiran“ marks, or the reverse) is
        // never shown. All seven are reads of the same local database, so any one
        // of them failing is the page's one load error.
        const [snapshot, list, tagList, linkList, counts, templateList, edgeList] =
          await Promise.all([
            window.nexus.listTaskLists(profileId),
            window.nexus.listTasks(profileId),
            window.nexus.listTaskTags(profileId),
            window.nexus.listTaskTagLinks(profileId),
            window.nexus.taskAttachmentCounts(profileId),
            window.nexus.listTaskTemplates(profileId),
            window.nexus.listTaskDependencies(profileId),
          ]);
        if (!active) return;
        setLists(snapshot.lists);
        setSections(snapshot.sections);
        setTasks(list);
        setTags(tagList);
        setTagLinks(linkList);
        setAttachmentCounts(new Map(counts.map((row) => [row.taskId, row.count])));
        setTemplates(templateList);
        setDependencies(edgeList);
        // The active filter names tags of the profile it was set in, so a
        // profile switch drops it rather than filtering by ids that are gone.
        setTagFilter([]);
        // Same reasoning for the save-as-template prompt: it is bound to a task
        // id of the profile being left, and a stale one would offer to capture a
        // row this profile does not have.
        closeTemplatePrompt();
        setTemplateFailed(false);
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
  // input; "reveal" scrolls to and marks a task's row. The rail filters the
  // page to one list (TASK-004), so a reveal now has one thing to un-hide: the
  // row's own list, selected first, with the intent deliberately left standing
  // so this effect finishes the reveal on the next pass — by which time the row
  // is actually in the DOM for `scrollRevealedIntoView` to find.
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
    const target = tasks.find((task) => task.id === intent.taskId);
    if (!target) {
      onIntentHandled?.(); // deleted between indexing and clicking — do nothing else
      return;
    }
    // A tag filter can hide the very row being revealed (NotesPage resets its
    // filters on a reveal for exactly this reason), so it is cleared first and
    // the intent left standing — same deferral as the list switch below.
    if (tagFilter.length > 0) {
      setTagFilter([]);
      return;
    }
    // The "is it a list we know" half matters: without it, a row pointing at a
    // list this fetch does not have would defer forever and strand the intent.
    if (target.listId !== selectedId && (lists?.some((list) => list.id === target.listId) ?? false)) {
      selectList(target.listId);
      return;
    }
    reveal(intent.taskId);
    scrollRevealedIntoView(taskRowDomId(intent.taskId));
    onIntentHandled?.();
  }, [intent, tasks, lists, selectedId, tagFilter, reveal, onIntentHandled]);

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

  /** Remembers the shape this list opens in (TASK-005) — the store owns the memory, so it survives a restart and travels with the list. */
  async function selectView(next: TaskListView): Promise<void> {
    const list = selectedList;
    if (list === null || list.defaultView === next) return;
    try {
      await window.nexus.setTaskListView(profileId, list.id, next);
      setLists(
        (prev) => prev && prev.map((row) => (row.id === list.id ? { ...row, defaultView: next } : row)),
      );
    } catch (error) {
      console.error("Nexus: failed to remember the list view:", error);
    }
  }

  /** Switches the page to another list, closing everything that was bound to the one being left. */
  function selectList(id: string): void {
    if (id === selectedId) return;
    setSelectedListId(id);
    // The form, the inline subtask line and the section editor were all bound to
    // rows of the list being left — none of which this list shows.
    resetForm();
    closeSubtaskInput();
    setSectionEditing(null);
    setSectionDraft("");
    setListFailed(false);
  }

  function replaceTask(updated: Task): void {
    setTasks((prev) => prev && prev.map((task) => (task.id === updated.id ? updated : task)));
  }

  /**
   * Re-reads the rows AND everything derived per-task from them: the
   * attachment counts and the dependency edges. Both ride along rather than
   * being fetched only after their own writes, because a delete or an undo
   * changes which tasks the store counts (and which edges it shows) at all —
   * a chip left over from a refetch that ignored them would describe a row
   * that is no longer the row on screen.
   */
  async function reload(): Promise<void> {
    const [list, counts, edgeList] = await Promise.all([
      window.nexus.listTasks(profileId),
      window.nexus.taskAttachmentCounts(profileId),
      window.nexus.listTaskDependencies(profileId),
    ]);
    setTasks(list);
    setAttachmentCounts(new Map(counts.map((row) => [row.taskId, row.count])));
    setDependencies(edgeList);
  }

  /** How many files a task carries, for its row/card chip; absent means none (`countsByTask` reports only tasks that have any). */
  const attachmentCountOf = (taskId: string): number => attachmentCounts.get(taskId) ?? 0;

  /**
   * Re-fetches the rail AND the rows, which is what every list/section write
   * needs: deleting a list moves or deletes its tasks, deleting a section
   * promotes them, and both re-place rows the rail no longer describes. Two
   * local SQLite reads, so there is nothing to save by fetching one half.
   */
  async function reloadAll(): Promise<void> {
    const [snapshot, list, counts, edgeList] = await Promise.all([
      window.nexus.listTaskLists(profileId),
      window.nexus.listTasks(profileId),
      window.nexus.taskAttachmentCounts(profileId),
      // Deleting a list can delete its tasks, and an edge whose end is gone is
      // gone with it — see `reload`.
      window.nexus.listTaskDependencies(profileId),
    ]);
    setLists(snapshot.lists);
    setSections(snapshot.sections);
    setTasks(list);
    setAttachmentCounts(new Map(counts.map((row) => [row.taskId, row.count])));
    setDependencies(edgeList);
  }

  /**
   * Runs one list/section mutation: clears the previous failure, performs it,
   * closes whichever inline editor was open, and re-reads everything. A failure
   * leaves the editor open with what the user typed still in it — the rail's
   * error line says the action did not take.
   */
  async function runListAction(action: () => Promise<void>): Promise<void> {
    try {
      setListFailed(false);
      await action();
      closeRailEditor();
      closeSectionEditor();
      await reloadAll();
    } catch (error) {
      setListFailed(true);
      console.error("Nexus: list action failed:", error);
    }
  }

  function closeRailEditor(): void {
    setRailEditing(null);
    setRailDraft("");
  }

  function beginNewList(parentId: string | null): void {
    setListFailed(false);
    setRailDraft("");
    setRailEditing({ mode: "new", parentId });
  }

  function beginRenameList(list: TaskList): void {
    setListFailed(false);
    setRailDraft(list.name);
    setRailEditing({ mode: "rename", id: list.id });
  }

  function submitNewList(parentId: string | null): void {
    const name = railDraft.trim();
    if (name.length === 0) return;
    void runListAction(async () => {
      const created = await window.nexus.createTaskList(profileId, name, parentId);
      // A list is made to put things in, so the page follows the user there —
      // through `selectList`, so everything bound to the list being left goes
      // with it rather than lingering over rows this list does not show.
      selectList(created.id);
    });
  }

  function submitRenameList(id: string): void {
    const name = railDraft.trim();
    if (name.length === 0) return;
    void runListAction(() => window.nexus.renameTaskList(profileId, id, name));
  }

  /** Applies the answer the delete dialog collected; the undo bar then offers the list back. */
  function deleteList(list: TaskList, mode: DeleteListMode): void {
    void runListAction(async () => {
      await window.nexus.deleteTaskList(profileId, list.id, mode);
      // The selection is derived, so a deleted list falls back to the Inbox on
      // its own; what has to go is anything still bound to the list's rows.
      resetForm();
      closeSubtaskInput();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingListUndoId(list.id);
    });
  }

  function undoListDelete(): void {
    const id = pendingListUndoId;
    if (id === null) return;
    void runListAction(async () => {
      await window.nexus.restoreTaskList(profileId, id);
      setPendingListUndoId(null);
    });
  }

  function closeSectionEditor(): void {
    setSectionEditing(null);
    setSectionDraft("");
  }

  function beginNewSection(): void {
    setListFailed(false);
    setSectionDraft("");
    setSectionEditing({ mode: "new" });
  }

  function beginRenameSection(section: TaskSection): void {
    setListFailed(false);
    setSectionDraft(section.name);
    setSectionEditing({ mode: "rename", id: section.id });
  }

  function submitNewSection(listId: string): void {
    const name = sectionDraft.trim();
    if (name.length === 0) return;
    void runListAction(() =>
      window.nexus.createTaskSection(profileId, listId, name).then(() => undefined),
    );
  }

  function submitRenameSection(id: string): void {
    const name = sectionDraft.trim();
    if (name.length === 0) return;
    void runListAction(() => window.nexus.renameTaskSection(profileId, id, name));
  }

  function deleteSection(id: string): void {
    void runListAction(async () => {
      await window.nexus.deleteTaskSection(profileId, id);
      // Its tasks moved to the list body in the same transaction, so a form
      // still pointing at the deleted heading would file the next save nowhere.
      if (formSectionId === id) setFormSectionId(null);
    });
  }

  // --- Oznake (migration 023) ----------------------------------------------
  //
  // The NOTE organizer's tag section one module over: tag CRUD and the filter
  // chips in the rail, the per-task attachment in the row's own "⋯" menu. Every
  // write is await-then-refetch, never optimistic — the house style, and the
  // only way a CASCADE (deleting a tag) can be reflected at all.

  /**
   * Re-reads the tags AND the links together, then prunes the active filter of
   * ids the profile no longer has: deleting a tag can never leave a ghost filter
   * that hides every row while naming nothing.
   */
  async function reloadTags(): Promise<void> {
    const [tagList, linkList] = await Promise.all([
      window.nexus.listTaskTags(profileId),
      window.nexus.listTaskTagLinks(profileId),
    ]);
    setTags(tagList);
    setTagLinks(linkList);
    const validIds = new Set(tagList.map((tag) => tag.id));
    setTagFilter((current) => current.filter((id) => validIds.has(id)));
  }

  /**
   * Runs one tag mutation: clears the previous failure, performs it, closes the
   * inline editor and re-reads. A failure leaves the editor open with what the
   * user typed still in it — the rail's tag error line says it did not take.
   */
  async function runTagAction(action: () => Promise<void>): Promise<void> {
    try {
      setTagFailed(false);
      await action();
      closeTagEditor();
      await reloadTags();
    } catch (error) {
      setTagFailed(true);
      console.error("Nexus: tag action failed:", error);
    }
  }

  function closeTagEditor(): void {
    setTagEditing(null);
    setTagDraft("");
  }

  function beginNewTag(): void {
    setTagFailed(false);
    setTagDraft("");
    setTagEditing({ mode: "new" });
  }

  function beginRenameTag(tag: TaskTag): void {
    setTagFailed(false);
    setTagDraft(tag.name);
    setTagEditing({ mode: "rename", id: tag.id });
  }

  function submitNewTag(): void {
    const name = tagDraft.trim();
    if (name.length === 0) return;
    // Get-or-create in the store: naming a tag the profile already has selects
    // it rather than failing, so there is nothing here to report as a conflict.
    void runTagAction(() => window.nexus.createTaskTag(profileId, name).then(() => undefined));
  }

  function submitRenameTag(id: string): void {
    const name = tagDraft.trim();
    if (name.length === 0) return;
    void runTagAction(() => window.nexus.renameTaskTag(profileId, id, name));
  }

  function deleteTag(id: string): void {
    // Its attachments go with it through the schema's CASCADE, so the refetch is
    // what takes the tag's chips off every row that carried it.
    void runTagAction(() => window.nexus.deleteTaskTag(profileId, id));
  }

  /**
   * Attaches or detaches one tag on one task, then re-reads the links. Kept out
   * of `runTagAction` on purpose: a row toggle must not close a rename the user
   * has open in the rail, and it has no inline editor of its own to close.
   */
  async function toggleTaskTag(task: TaskFields, tagId: string, attached: boolean): Promise<void> {
    try {
      if (attached) {
        await window.nexus.detachTaskTag(profileId, task.id, tagId);
      } else {
        await window.nexus.attachTaskTag(profileId, task.id, tagId);
      }
      await reloadTags();
    } catch (error) {
      console.error("Nexus: failed to toggle task tag:", error);
    }
  }

  // --- Zavisnosti (migration 029 / ADR-037) ---------------------------------
  //
  // Await-then-refetch like every other write on this page: the edges decide
  // which rows wear a „Blokiran“ chip, and an optimistic patch could show one on
  // a task the store refused to block.

  /**
   * Runs one dependency mutation and re-reads the edges. `depFailed` is its own
   * line rather than the rail's: the block lives in the form, and the store can
   * still refuse an edge the picker offered (a cycle closed on another device,
   * a task completed between the fetch and the click).
   */
  async function runDependencyAction(action: () => Promise<void>): Promise<void> {
    try {
      setDepFailed(false);
      await action();
      setDependencies(await window.nexus.listTaskDependencies(profileId));
    } catch (error) {
      setDepFailed(true);
      console.error("Nexus: dependency action failed:", error);
    }
  }

  function addDependency(blockerId: string, blockedId: string): void {
    void runDependencyAction(() => window.nexus.addTaskDependency(profileId, blockerId, blockedId));
  }

  function removeDependency(blockerId: string, blockedId: string): void {
    void runDependencyAction(() =>
      window.nexus.removeTaskDependency(profileId, blockerId, blockedId),
    );
  }

  /**
   * What the picker may offer as a blocker of `taskId`, narrowed by `depDraft`.
   *
   * Three exclusions, each of them something the store would refuse or ignore,
   * so the picker never offers an affordance that can do nothing: the task
   * itself and everything DOWNSTREAM of it (adding one of those closes a cycle),
   * the blockers it already has (a no-op), and every finished task (a done
   * blocker holds nothing up, so proposing one would be proposing a chip that
   * never appears).
   *
   * Matching is folded on BOTH sides, the SRCH rule: „Đorđe“, „djordje“ and
   * „Ђорђе“ meet at the same key, so a filter typed without diacritics still
   * finds the task that has them.
   */
  function dependencyCandidates(taskId: string): TaskFields[] {
    const downstream = new Set<string>([taskId]);
    const queue: string[] = [taskId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) continue;
      for (const next of blockedByBlocker.get(current) ?? []) {
        if (downstream.has(next)) continue;
        downstream.add(next);
        queue.push(next);
      }
    }
    const attached = new Set(blockersByTask.get(taskId) ?? []);
    const term = foldSearchText(depDraft.trim());
    const matches: TaskFields[] = [];
    for (const task of tasks ?? []) {
      if (task.done || downstream.has(task.id) || attached.has(task.id)) continue;
      if (term.length > 0 && !foldSearchText(task.title).includes(term)) continue;
      matches.push(task);
      if (matches.length === MAX_DEPENDENCY_OPTIONS) break;
    }
    return matches;
  }

  /** Adds or removes one tag id from the filter; the narrowing itself is AND (see `visibleTasks`). */
  function toggleTagFilter(id: string): void {
    setTagFilter((current) =>
      current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id],
    );
  }

  // --- Prilozi (migration 024) ---------------------------------------------
  //
  // The NOTE editor's Prilozi panel, on the task form — with one difference the
  // form imposes: it exists only while EDITING an existing task. A task being
  // created has no id yet, and there is nothing to hang a file off; the note
  // editor never faces that question because it only ever opens on a note that
  // already exists.
  //
  // Every write is await-then-refetch, the house style, and main owns the file
  // dialog: the renderer never sees a path or a byte.

  // Loads the edited task's attachments; clears them the moment the form leaves
  // edit mode, so a stale list can never be shown against another task. Keyed
  // on the id, so switching straight from one task's ✎ to another's refetches.
  useEffect(() => {
    if (editingId === null) {
      setAttachments([]);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const rows = await window.nexus.listTaskAttachments(profileId, editingId);
        if (active) setAttachments(rows);
      } catch (error) {
        if (active) {
          setAttachments([]);
          setAttachmentError("generic");
        }
        console.error("Nexus: failed to load task attachments:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, editingId]);

  /** Re-reads the edited task's rows and every task's count — what each of the two writes below ends with. */
  async function reloadAttachments(taskId: string): Promise<void> {
    const [rows, counts] = await Promise.all([
      window.nexus.listTaskAttachments(profileId, taskId),
      window.nexus.taskAttachmentCounts(profileId),
    ]);
    setAttachments(rows);
    setAttachmentCounts(new Map(counts.map((row) => [row.taskId, row.count])));
  }

  /**
   * Opens the native picker and attaches whatever comes back. A canceled dialog
   * changes nothing and says nothing; files refused for size are reported, since
   * a picker that silently dropped one would look like a bug.
   */
  async function attachFiles(taskId: string): Promise<void> {
    if (attaching) return;
    setAttaching(true);
    setAttachmentError(null);
    try {
      const result = await window.nexus.attachTaskFiles(profileId, taskId);
      if (result.canceled) return;
      if (result.skippedTooLarge > 0) setAttachmentError("tooLarge");
      await reloadAttachments(taskId);
    } catch (error) {
      setAttachmentError("generic");
      console.error("Nexus: failed to attach files:", error);
    } finally {
      setAttaching(false);
    }
  }

  async function openAttachment(taskId: string, attachmentId: string): Promise<void> {
    try {
      await window.nexus.openTaskAttachment(profileId, taskId, attachmentId);
    } catch (error) {
      setAttachmentError("generic");
      console.error("Nexus: failed to open task attachment:", error);
    }
  }

  async function saveAttachmentAs(taskId: string, attachmentId: string): Promise<void> {
    try {
      await window.nexus.saveTaskAttachmentAs(profileId, taskId, attachmentId);
    } catch (error) {
      setAttachmentError("generic");
      console.error("Nexus: failed to save task attachment:", error);
    }
  }

  async function removeAttachment(taskId: string, attachmentId: string): Promise<void> {
    try {
      await window.nexus.removeTaskAttachment(profileId, taskId, attachmentId);
      await reloadAttachments(taskId);
    } catch (error) {
      setAttachmentError("generic");
      console.error("Nexus: failed to remove task attachment:", error);
    }
  }

  // --- Šabloni (ADR-035) -----------------------------------------------------
  //
  // A template is captured FROM a row and applied INTO the selected list, and
  // both halves are main's work: the renderer sends an id and a name and never a
  // task shape. What is left here is the two popovers and their refetches.

  function closeTemplatePrompt(): void {
    setTemplateFor(null);
    setTemplateDraft("");
  }

  function beginSaveTemplate(taskId: string, currentTitle: string): void {
    setTemplateFailed(false);
    // Pre-filled with the task's own title: the name a user wants is almost
    // always that, and pre-filling makes the whole action one Enter — while
    // still being a name they can replace before saving.
    setTemplateDraft(currentTitle);
    setTemplateFor(taskId);
  }

  /** Captures `taskId` under the typed name and closes the popover it was typed in. A failure leaves the prompt open with the text still in it. */
  async function submitSaveTemplate(taskId: string, close: () => void): Promise<void> {
    const name = templateDraft.trim();
    if (name.length === 0) return;
    try {
      setTemplateFailed(false);
      await window.nexus.saveTaskTemplateFromTask(profileId, taskId, name);
      setTemplates(await window.nexus.listTaskTemplates(profileId));
      closeTemplatePrompt();
      close();
    } catch (error) {
      setTemplateFailed(true);
      console.error("Nexus: failed to save a task template:", error);
    }
  }

  /**
   * Creates a task from `template` in the list the rail has selected, in its
   * body. The whole page is re-read afterwards, not just the tasks: applying can
   * create tags the profile did not have (they travel as NAMES), and the chips
   * those tags draw come from `tags`/`tagLinks`.
   */
  async function applyTemplate(template: TaskTemplate, close: () => void): Promise<void> {
    if (selectedId === null) return;
    try {
      setTemplateFailed(false);
      await window.nexus.applyTaskTemplate(profileId, template.id, selectedId, null);
      close();
      await reloadAll();
      await reloadTags();
    } catch (error) {
      setTemplateFailed(true);
      console.error("Nexus: failed to apply a task template:", error);
    }
  }

  /** Deletes a template. No task made from it is touched, so nothing but this popover needs re-reading. */
  async function deleteTemplate(id: string): Promise<void> {
    try {
      setTemplateFailed(false);
      await window.nexus.deleteTaskTemplate(profileId, id);
      setTemplates(await window.nexus.listTaskTemplates(profileId));
    } catch (error) {
      setTemplateFailed(true);
      console.error("Nexus: failed to delete a task template:", error);
    }
  }

  // --- Drag & drop (list view) ---------------------------------------------
  //
  // Native HTML5 drag, the same idiom as the kanban and the month grid: the
  // dragged row travels as renderer state (the dataTransfer payload exists only
  // because Firefox refuses to start a drag without one), and a drop target
  // signals with an accent border and a soft background — never a glow.
  //
  // Only TOP-LEVEL rows are drag sources. A subtask lives where its parent
  // lives, which every write path upholds; dragging one into another list would
  // move a subtree out from under a parent left behind in this one.

  function startTaskDrag(event: DragEvent, task: TaskFields): void {
    setDraggedTaskId(task.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
  }

  function endTaskDrag(): void {
    setDraggedTaskId(null);
    setDropTarget(null);
  }

  function dragOverTarget(event: DragEvent, target: DropTarget): void {
    if (draggedTaskId === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!sameTarget(dropTarget, target)) setDropTarget(target);
  }

  function dragLeaveTarget(event: DragEvent<HTMLElement>, target: DropTarget): void {
    // Only when the pointer really left this element — a `dragleave` fired by
    // moving onto a child would otherwise drop the highlight mid-hover.
    if (sameTarget(dropTarget, target) && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropTarget(null);
    }
  }

  /**
   * Runs one placement write and re-reads the rows. The refetch is not optional:
   * the display order IS the store's order (see `LIST_CONFIG`), and every one of
   * these writes moves a row within it — patching the moved task in place would
   * change its `position` while leaving it drawn where it was.
   */
  async function runPlacement(event: DragEvent, write: (id: string) => Promise<unknown>): Promise<void> {
    const id = draggedTaskId;
    if (id === null) return;
    event.preventDefault();
    endTaskDrag();
    try {
      await write(id);
      await reload();
    } catch (error) {
      console.error("Nexus: failed to move task:", error);
    }
  }

  /** Clears the add/edit form. `keepSection` leaves the heading the user is filing into standing — see the call in `submitForm`. */
  function resetForm(keepSection = false): void {
    setEditingId(null);
    setDraft("");
    setDueDate("");
    setPriority("none");
    setRecurrence(null);
    setReminderOffsets([]);
    setDismissedPhrase(null);
    // The rows themselves are cleared by the effect that watches `editingId`;
    // only the transient error is this function's to drop.
    setAttachmentError(null);
    // The picker's filter was typed against ONE task's candidates; carrying it
    // into the next edit would silently narrow a different list.
    setDepDraft("");
    setDepFailed(false);
    if (!keepSection) setFormSectionId(null);
  }

  /** Adds or removes one lead time; the store owns ordering, so the set is kept as picked. */
  function toggleReminder(days: number): void {
    setReminderOffsets((prev) =>
      prev.includes(days) ? prev.filter((current) => current !== days) : [...prev, days],
    );
  }

  /** Loads a task into the shared form and switches it to edit mode. */
  function startEdit(task: TaskFields): void {
    setEditingId(task.id);
    setDraft(task.title);
    setDismissedPhrase(null);
    setAttachmentError(null);
    setDepDraft("");
    setDepFailed(false);
    // The store accepts a date-time due date too, but this form only speaks in
    // whole days, so it shows (and on save keeps) the day part.
    setDueDate(task.dueDate === null ? "" : task.dueDate.slice(0, 10));
    setPriority(task.priority);
    setRecurrence(task.recurrence);
    setReminderOffsets([...task.reminderOffsets]);
    // The heading the task currently sits under, so saving without touching the
    // select leaves it exactly where it is (`groupKeyOf`, for the same reason
    // the grouping uses it: a section this fetch does not know reads as the body).
    setFormSectionId(groupKeyOf(task));
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
    // The reminder ladder counts back from the very same anchor, and the store
    // refuses a ladder without one, so it is read off the FIELD for exactly the
    // reason the rule above is — the chips are anchored to the field too.
    const ladder = isValidDayKey(dueDate) ? reminderOffsets : [];
    try {
      if (editingId != null) {
        const changes: TaskFieldChanges = {
          title,
          dueDate: due,
          priority,
          recurrence: rule,
          // An empty array is meaningful here: it clears whatever ladder the
          // task carried.
          reminderOffsets: ladder,
        };
        const edited = tasks?.find((task) => task.id === editingId) ?? null;
        replaceTask(await window.nexus.updateTask(profileId, editingId, changes));
        // A heading is a PLACEMENT, not a field: the store deliberately keeps it
        // out of the field patch, so a changed section is its own write — and it
        // appends the task at the end of the heading it lands in, which is a new
        // order, hence the refetch.
        if (edited !== null && groupKeyOf(edited) !== formSectionId) {
          await window.nexus.moveTaskToSection(profileId, editingId, formSectionId);
          await reload();
        }
      } else {
        const fields: NewTaskFields = { title };
        // Only send what is set (exactOptionalPropertyTypes).
        if (due !== null) fields.dueDate = due;
        if (priority !== "none") fields.priority = priority;
        if (rule !== null) fields.recurrence = rule;
        if (ladder.length > 0) fields.reminderOffsets = ladder;
        // A new task lands in the list the rail has selected, under the heading
        // the select names — the whole point of selecting one.
        if (selectedId !== null) fields.listId = selectedId;
        if (formSectionId !== null) fields.sectionId = formSectionId;
        const created = await window.nexus.createTask(profileId, fields);
        setTasks((prev) => (prev ? [...prev, created] : [created]));
      }
      // A create keeps the heading it filed into: writing a section is a run of
      // several tasks, and re-picking it after every Enter would be the form
      // fighting the user. Finishing an EDIT clears it, like every other field.
      resetForm(editingId == null);
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

  /**
   * A row's leading slot: the drag grip on a top-level row (TASK-004), or
   * `leadSpacer`'s grip-column-plus-indent on a nested one — which is what keeps
   * indentation MEANING something, since the grip column is exactly one indent
   * step wide and would otherwise cancel the first step out.
   *
   * The grip is deliberately `aria-hidden`: a drag is mouse-only here, as on the
   * calendar, and a control a keyboard can focus but not operate is worse than
   * none. Nothing depends on it — the section select moves a task between
   * headings without it.
   */
  function renderRowLead(task: TaskFields, depth: number): ReactNode {
    if (depth > 0) return leadSpacer(depth);
    return (
      <span
        className="tasks__grip"
        draggable
        aria-hidden="true"
        onDragStart={(event) => startTaskDrag(event, task)}
        onDragEnd={endTaskDrag}
      >
        ⠿
      </span>
    );
  }

  /** One task's row, indented by `depth`; `children` is its direct children, already looked up by the caller. */
  function renderRow(task: TaskFields, depth: number, children: readonly TaskFields[]): ReactNode {
    return (
      <ListRow
        key={task.id}
        leading={renderRowLead(task, depth)}
        trailing={
          <span className="tasks__row-meta">
            {taskChips(task, children, tagsOf(task.id), attachmentCountOf(task.id), isBlocked(task.id))}
            {/* The row's own "⋯" menu, exactly as on a note row. Attaching and
                detaching tags lives here, and only where the profile HAS a tag
                to attach — an affordance that can do nothing is one this page
                refuses to draw (see the Inbox's absent delete); making tags is
                the rail's job. „Sačuvaj kao šablon“ (ADR-035) is always there,
                which is why the menu itself no longer waits for a tag to exist. */}
            <NotePopover label={strings.tasks.rowMenuLabel} triggerClassName="tasks__row-menu">
              {(close) => (
                <>
                  {sortedTags.length > 0 && (
                    <>
                      <span className="note__menu-label">{strings.tasks.tags.label}</span>
                      {sortedTags.map((tag) => {
                        const attached = tagIdsByTask.get(task.id)?.has(tag.id) ?? false;
                        return (
                          <button
                            key={tag.id}
                            className="note__menu-item note__menu-item--check"
                            role="menuitemcheckbox"
                            type="button"
                            aria-checked={attached}
                            onClick={() => void toggleTaskTag(task, tag.id, attached)}
                          >
                            <span
                              className={`note__menu-check${attached ? "" : " note__menu-check--hidden"}`}
                              aria-hidden="true"
                            >
                              ✓
                            </span>
                            {tag.name}
                          </button>
                        );
                      })}
                      <div className="note__menu-sep" />
                    </>
                  )}
                  <span className="note__menu-label">{strings.tasks.templates.title}</span>
                  {templateFor === task.id ? (
                    <>
                      <InlineNameForm
                        className="tasks__template-form"
                        value={templateDraft}
                        placeholder={strings.tasks.templates.namePlaceholder}
                        label={strings.tasks.templates.nameLabel}
                        maxLength={MAX_TASK_TEMPLATE_NAME_LENGTH}
                        onChange={setTemplateDraft}
                        onSubmit={() => void submitSaveTemplate(task.id, close)}
                        onCancel={closeTemplatePrompt}
                      />
                      {/* Said before the fact: saving under a name that exists is
                          how a template is EDITED, not an accident to warn about
                          afterwards (the ADR-016 wording precedent). */}
                      <p className="note__menu-caption">{strings.tasks.templates.overwriteNote}</p>
                    </>
                  ) : (
                    <button
                      className="note__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => beginSaveTemplate(task.id, task.title)}
                    >
                      {strings.tasks.templates.saveAs}
                    </button>
                  )}
                  {templateFailed && (
                    <p className="note__menu-caption" role="status">
                      {strings.tasks.templates.actionError}
                    </p>
                  )}
                </>
              )}
            </NotePopover>
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

  /**
   * The edit form's "Zavisnosti" block (ADR-037): what `taskId` waits on, and
   * the picker that adds one more.
   *
   * A blocker that is already DONE stays listed, muted and marked „završeno“:
   * the edge is still real (finishing it is what unblocked this task, and
   * re-opening the blocker blocks it again), so hiding it would make the
   * relation the user set look like it had been deleted.
   */
  function renderDependencies(taskId: string): ReactNode {
    const s = strings.tasks.dependencies;
    const blockers = blockersOf(taskId);
    const candidates = dependencyCandidates(taskId);
    const searching = depDraft.trim().length > 0;

    return (
      <div className="tasks__deps">
        <span className="tasks__deps-label">{s.label}</span>
        <div className="tasks__dep-list">
          {blockers.length === 0 ? (
            <p className="tasks__deps-caption">{s.none}</p>
          ) : (
            blockers.map((blocker) => (
              <span key={blocker.id} className="tasks__dep-row">
                <span
                  className={
                    blocker.done ? "tasks__dep-title tasks__dep-title--done" : "tasks__dep-title"
                  }
                >
                  {blocker.title}
                </span>
                {blocker.done && <span className="tasks__dep-done">{s.doneHint}</span>}
                <Button
                  size="sm"
                  className="tasks__dep-remove"
                  aria-label={s.removeLabel}
                  onClick={() => removeDependency(blocker.id, taskId)}
                >
                  ×
                </Button>
              </span>
            ))
          )}
          <NotePopover
            label={s.add}
            triggerContent={s.add}
            triggerClassName="tasks__dep-add"
          >
            {(close) => (
              <>
                <TextField
                  className="tasks__dep-search"
                  value={depDraft}
                  placeholder={s.searchPlaceholder}
                  aria-label={s.searchPlaceholder}
                  autoFocus
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setDepDraft(event.target.value)}
                  onKeyDown={(event) => {
                    // A swallowed Enter: this field sits INSIDE the add/edit
                    // <form>, so an un-prevented Enter would save the task rather
                    // than do nothing. Escape is left to `NotePopover`, which
                    // closes the panel.
                    if (event.key === "Enter") event.preventDefault();
                  }}
                />
                {candidates.length === 0 ? (
                  <span className="note__menu-label">
                    {searching ? s.pickerNoMatches : s.pickerEmpty}
                  </span>
                ) : (
                  candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      className="note__menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        addDependency(candidate.id, taskId);
                        setDepDraft("");
                        close();
                      }}
                    >
                      {candidate.title}
                    </button>
                  ))
                )}
              </>
            )}
          </NotePopover>
        </div>
        {depFailed && (
          <p className="tasks__deps-caption tasks__deps-error" role="status">
            {s.actionError}
          </p>
        )}
      </div>
    );
  }

  /** The inline "new subtask" line under a row, indented to where its result will land. */
  function renderSubtaskInput(parentId: string, depth: number): ReactNode {
    return (
      <div className="tasks__subtask-add" key={`add-${parentId}`}>
        {/* The same lead as a nested row's, so the line starts exactly where the
            new subtask's checkbox will. */}
        {leadSpacer(depth)}
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
    // The row is told about ALL its subtasks (its roll-up counts them), while the
    // recursion follows only the ones this render draws — see the two trees above.
    const nodes: ReactNode[] = [renderRow(task, depth, childrenOf(task.id))];
    if (subtaskParentId === task.id) nodes.push(renderSubtaskInput(task.id, depth + 1));
    for (const child of visibleChildrenOf(task.id)) {
      nodes.push(...renderBranch(child, depth + 1, seen));
    }
    return nodes;
  }

  /**
   * A place a dragged row can land, between the two rows it names. Rendered ONLY
   * while a drag is in flight: at rest the list looks exactly as it did before
   * this slice, and during a drag it opens up the gaps that mean something.
   *
   * The gaps next to the dragged row itself are skipped — that is where it
   * already is, and the store refuses to order a task against itself.
   */
  function renderDropGap(beforeId: string | null, afterId: string | null): ReactNode {
    if (draggedTaskId === null) return null;
    if (beforeId === draggedTaskId || afterId === draggedTaskId) return null;
    const target: DropTarget = { kind: "gap", beforeId, afterId };
    const active = sameTarget(dropTarget, target);
    return (
      <div
        key={`gap-${beforeId ?? "start"}-${afterId ?? "end"}`}
        className={active ? "tasks__drop-gap tasks__drop-gap--active" : "tasks__drop-gap"}
        onDragOver={(event) => dragOverTarget(event, target)}
        onDragLeave={(event) => dragLeaveTarget(event, target)}
        onDrop={(event) =>
          void runPlacement(event, (id) => window.nexus.reorderTask(profileId, id, beforeId, afterId))
        }
      />
    );
  }

  /** One section's heading: its name, the inline ✎/× actions, and the drop target that files a dragged task under it. */
  function renderSectionHead(section: TaskSection): ReactNode {
    const s = strings.tasks.lists;
    if (sectionEditing?.mode === "rename" && sectionEditing.id === section.id) {
      return (
        <div className="tasks__section" key={`head-${section.id}`}>
          <InlineNameForm
            value={sectionDraft}
            placeholder={s.sectionNamePlaceholder}
            label={s.renameSectionLabel}
            onChange={setSectionDraft}
            onSubmit={() => submitRenameSection(section.id)}
            onCancel={closeSectionEditor}
          />
        </div>
      );
    }
    const target: DropTarget = { kind: "section", id: section.id };
    // A task already under this heading has nowhere to go — the store would only
    // re-append it — so its own heading never offers itself as a target.
    const droppable = draggedTask !== null && draggedTask.sectionId !== section.id;
    const active = droppable && sameTarget(dropTarget, target);
    return (
      <div
        key={`head-${section.id}`}
        className={active ? "tasks__section tasks__section--drop" : "tasks__section"}
        onDragOver={droppable ? (event) => dragOverTarget(event, target) : undefined}
        onDragLeave={droppable ? (event) => dragLeaveTarget(event, target) : undefined}
        onDrop={
          droppable
            ? (event) =>
                void runPlacement(event, (id) =>
                  window.nexus.moveTaskToSection(profileId, id, section.id),
                )
            : undefined
        }
      >
        <span className="tasks__section-name">{section.name}</span>
        <span className="tasks__section-actions">
          <Button
            size="sm"
            className="tasks__section-action"
            aria-label={s.renameSectionLabel}
            onClick={() => beginRenameSection(section)}
          >
            ✎
          </Button>
          <Button
            size="sm"
            className="tasks__section-action tasks__section-delete"
            aria-label={s.deleteSectionLabel}
            onClick={() => deleteSection(section.id)}
          >
            ×
          </Button>
        </span>
      </div>
    );
  }

  /**
   * One group of the list view — the list body or one section — as its heading,
   * its rows, and the drop gaps between them.
   *
   * The gaps only appear in the group the dragged row itself belongs to: a
   * neighbour from another scope describes a section move, not a reorder, and
   * those two are different writes (the heading above is the one that means the
   * former).
   */
  function renderGroup(group: TaskGroup): ReactNode {
    const dragInGroup =
      draggedTask !== null && groupKeyOf(draggedTask) === (group.section?.id ?? null);
    // Read once per group rather than an `indexOf` per row.
    const previousOf = new Map<string, string | null>();
    group.roots.forEach((task, index) => {
      previousOf.set(task.id, group.roots[index - 1]?.id ?? null);
    });
    const last = group.roots[group.roots.length - 1] ?? null;

    return (
      <div className="tasks__group" key={group.section?.id ?? "__body__"}>
        {group.section !== null && renderSectionHead(group.section)}
        {/* Only the top-level rows are handed to the engine; each one renders
            its own subtree (see `renderBranch`). */}
        <ListView<TaskFields>
          items={group.roots}
          schema={TASK_SCHEMA}
          config={LIST_CONFIG}
          itemKey={(task) => task.id}
          renderItem={(task) => [
            dragInGroup ? renderDropGap(previousOf.get(task.id) ?? null, task.id) : null,
            ...renderBranch(task, 0, new Set()),
          ]}
        />
        {/* The end of the group: the one gap that cannot live inside a row. */}
        {dragInGroup && last !== null && renderDropGap(last.id, null)}
      </div>
    );
  }

  /**
   * The Prilozi block of the edit form: the "Priloži datoteku" button, then one
   * row per file — an image thumbnail served by the `nx-blob:` protocol, the
   * name, a human-readable size, and the open/save-as/remove menu.
   *
   * The NOTE panel's recipe, adapted to a form: it takes a whole row of the
   * wrapping field row (like Podsetnik above it) rather than sitting in a
   * scrolling pane of its own, and it is rendered only for an existing task —
   * see the call site.
   */
  function renderAttachments(taskId: string): ReactNode {
    const s = strings.tasks.attachments;
    return (
      <div className="tasks__attachments">
        <div className="tasks__attachments-head">
          <span className="tasks__attachments-label">
            {s.title}
            {attachments.length > 0 ? ` (${attachments.length})` : ""}
          </span>
          <Button
            size="sm"
            className="tasks__attach"
            disabled={attaching}
            onClick={() => void attachFiles(taskId)}
          >
            {s.attach}
          </Button>
        </div>
        {attachmentError !== null && (
          <p className="tasks__attachment-error" role="status">
            {attachmentError === "tooLarge" ? s.tooLarge : s.actionError}
          </p>
        )}
        {attachments.map((attachment) => (
          <div key={attachment.id} className="tasks__attachment">
            {isInlineImageMime(attachment.mime) && (
              <img
                className="tasks__attachment-thumb"
                src={`nx-blob://${attachment.sha256}`}
                alt={attachment.fileName}
              />
            )}
            <span className="tasks__attachment-name">{attachment.fileName}</span>
            <span className="tasks__attachment-size">{formatBytes(attachment.sizeBytes)}</span>
            <NotePopover label={s.menuLabel} triggerClassName="tasks__attachment-menu">
              {(close) => (
                <>
                  <button
                    type="button"
                    className="note__menu-item"
                    role="menuitem"
                    onClick={() => {
                      void openAttachment(taskId, attachment.id);
                      close();
                    }}
                  >
                    {s.open}
                  </button>
                  <button
                    type="button"
                    className="note__menu-item"
                    role="menuitem"
                    onClick={() => {
                      void saveAttachmentAs(taskId, attachment.id);
                      close();
                    }}
                  >
                    {s.saveAs}
                  </button>
                  <div className="note__menu-sep" role="separator" />
                  <button
                    type="button"
                    className="note__menu-item note__menu-item--danger"
                    role="menuitem"
                    onClick={() => {
                      void removeAttachment(taskId, attachment.id);
                      close();
                    }}
                  >
                    {s.remove}
                  </button>
                </>
              )}
            </NotePopover>
          </div>
        ))}
      </div>
    );
  }

  /** One rail row: the list itself (a select button that is also a drop target), plus its hover actions and its children. */
  function renderRailList(node: RailNode, depth: number): ReactNode {
    const s = strings.tasks.lists;
    const { list } = node;
    const indent = { "--task-depth": Math.min(depth, MAX_RAIL_DEPTH) } as CSSProperties;
    const renaming = railEditing?.mode === "rename" && railEditing.id === list.id;
    const addingChild = railEditing?.mode === "new" && railEditing.parentId === list.id;
    const target: DropTarget = { kind: "list", id: list.id };
    // Dropping a task on the list it already lives in would only re-append it.
    const droppable = draggedTask !== null && draggedTask.listId !== list.id;
    const active = droppable && sameTarget(dropTarget, target);
    const selected = list.id === selectedId;

    return (
      <Fragment key={list.id}>
        <div
          className={active ? "tasks__rail-row tasks__rail-row--drop" : "tasks__rail-row"}
          style={indent}
          onDragOver={droppable ? (event) => dragOverTarget(event, target) : undefined}
          onDragLeave={droppable ? (event) => dragLeaveTarget(event, target) : undefined}
          onDrop={
            droppable
              ? (event) =>
                  void runPlacement(event, (id) =>
                    window.nexus.moveTaskToList(profileId, id, list.id),
                  )
              : undefined
          }
        >
          {renaming ? (
            <InlineNameForm
              value={railDraft}
              placeholder={s.listNamePlaceholder}
              label={s.renameListLabel}
              onChange={setRailDraft}
              onSubmit={() => submitRenameList(list.id)}
              onCancel={closeRailEditor}
            />
          ) : (
            <>
              <button
                type="button"
                className={selected ? "tasks__rail-list tasks__rail-list--active" : "tasks__rail-list"}
                aria-current={selected ? "true" : undefined}
                onClick={() => selectList(list.id)}
              >
                <span className="tasks__rail-name">{list.name}</span>
              </button>
              <span className="tasks__rail-actions">
                <Button
                  size="sm"
                  className="tasks__rail-action"
                  aria-label={s.renameListLabel}
                  onClick={() => beginRenameList(list)}
                >
                  ✎
                </Button>
                <Button
                  size="sm"
                  className="tasks__rail-action"
                  aria-label={s.newSubList}
                  onClick={() => beginNewList(list.id)}
                >
                  +
                </Button>
                {/* The Inbox is where "premesti u Inbox" moves things and where a
                    task lands when the user names no list, so it cannot be
                    deleted — the store refuses, and the affordance is not shown
                    at all rather than offered and then rejected. */}
                {!list.isInbox && (
                  <Button
                    size="sm"
                    className="tasks__rail-action tasks__rail-delete"
                    aria-label={s.deleteListLabel}
                    onClick={() => setDeletePrompt(list)}
                  >
                    ×
                  </Button>
                )}
              </span>
            </>
          )}
        </div>

        {addingChild && (
          <div
            className="tasks__rail-row"
            style={{ "--task-depth": Math.min(depth + 1, MAX_RAIL_DEPTH) } as CSSProperties}
          >
            <InlineNameForm
              value={railDraft}
              placeholder={s.listNamePlaceholder}
              label={s.newSubList}
              onChange={setRailDraft}
              onSubmit={() => submitNewList(list.id)}
              onCancel={closeRailEditor}
            />
          </div>
        )}

        {node.children.map((child) => renderRailList(child, depth + 1))}
      </Fragment>
    );
  }

  return (
    <div className="tasks">
      <aside className="tasks__rail" aria-label={strings.tasks.lists.railLabel}>
        <div className="tasks__rail-heading">{strings.tasks.lists.title}</div>
        {/* The Inbox's own name is rendered like every other list's: it is a
            stored, renamable row, so a hard-coded label would go stale the
            moment it is renamed. */}
        {lists !== null && buildListTree(lists).map((node) => renderRailList(node, 0))}
        {railEditing?.mode === "new" && railEditing.parentId === null ? (
          <div className="tasks__rail-row">
            <InlineNameForm
              value={railDraft}
              placeholder={strings.tasks.lists.listNamePlaceholder}
              label={strings.tasks.lists.newList}
              onChange={setRailDraft}
              onSubmit={() => submitNewList(null)}
              onCancel={closeRailEditor}
            />
          </div>
        ) : (
          <Button size="sm" className="tasks__new-list" onClick={() => beginNewList(null)}>
            {strings.tasks.lists.newList}
          </Button>
        )}
        {listFailed && (
          <p className="tasks__rail-error" role="status">
            {strings.tasks.lists.actionError}
          </p>
        )}

        {/* Oznake, below the lists (migration 023): every tag is a filter chip
            that narrows the selected list further, and carries its own rename/
            delete menu — the NOTE organizer's tag section, chip for chip.
            Selecting one is typographic (gold text + weight), never a fill. */}
        <div className="tasks__rail-heading tasks__tag-heading">
          <span>{strings.tasks.tags.label}</span>
          {tagFilter.length > 0 && (
            <button type="button" className="tasks__tag-clear" onClick={() => setTagFilter([])}>
              {strings.tasks.tags.clearFilter}
            </button>
          )}
        </div>
        <div className="tasks__tag-row" role="group" aria-label={strings.tasks.tags.filterLabel}>
          {sortedTags.map((tag) => {
            if (tagEditing?.mode === "rename" && tagEditing.id === tag.id) {
              return (
                <InlineNameForm
                  key={tag.id}
                  className="tasks__tag-form"
                  value={tagDraft}
                  placeholder={strings.tasks.tags.namePlaceholder}
                  label={strings.tasks.tags.renameLabel}
                  maxLength={MAX_TASK_TAG_NAME_LENGTH}
                  onChange={setTagDraft}
                  onSubmit={() => submitRenameTag(tag.id)}
                  onCancel={closeTagEditor}
                />
              );
            }
            const active = tagFilter.includes(tag.id);
            return (
              <div key={tag.id} className="tasks__tag-item">
                <button
                  type="button"
                  className={active ? "tasks__tag tasks__tag--active" : "tasks__tag"}
                  aria-pressed={active}
                  onClick={() => toggleTagFilter(tag.id)}
                >
                  {tag.name}
                </button>
                <NotePopover
                  label={strings.tasks.tags.menuLabel}
                  triggerClassName="tasks__tag-menu"
                >
                  {(close) => (
                    <>
                      <button
                        className="note__menu-item"
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          beginRenameTag(tag);
                          close();
                        }}
                      >
                        {strings.tasks.tags.rename}
                      </button>
                      <button
                        className="note__menu-item note__menu-item--danger"
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          deleteTag(tag.id);
                          close();
                        }}
                      >
                        {strings.tasks.tags.delete}
                      </button>
                    </>
                  )}
                </NotePopover>
              </div>
            );
          })}
          {/* Inside the chip row, so the form takes a whole wrap line of it
              rather than being stretched by the rail's column axis. */}
          {tagEditing?.mode === "new" && (
            <InlineNameForm
              className="tasks__tag-form"
              value={tagDraft}
              placeholder={strings.tasks.tags.namePlaceholder}
              label={strings.tasks.tags.newTag}
              maxLength={MAX_TASK_TAG_NAME_LENGTH}
              onChange={setTagDraft}
              onSubmit={submitNewTag}
              onCancel={closeTagEditor}
            />
          )}
        </div>
        {tagEditing?.mode !== "new" && (
          <Button size="sm" className="tasks__new-tag" onClick={beginNewTag}>
            {strings.tasks.tags.newTag}
          </Button>
        )}
        {tagFailed && (
          <p className="tasks__rail-error" role="status">
            {strings.tasks.tags.actionError}
          </p>
        )}
      </aside>

      <div className="tasks__main">
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
                <Button type="button" className="tasks__cancel" onClick={() => resetForm()}>
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
                  // A rule has to phase from a real day, and a reminder ladder has
                  // to count back from one, so clearing the due date clears both
                  // where the user can see it happen.
                  if (!isValidDayKey(next)) {
                    setRecurrence(null);
                    setReminderOffsets([]);
                  }
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
              {/* Sekcija (TASK-004) — only where there is a heading to pick: a
                  select whose one option is "Bez sekcije" says nothing, and a
                  task of the selected list can only carry a heading of that same
                  list, so this row appearing at all means there is a real choice.
                  It is also the way BACK to the list body, which the drag (whose
                  targets are the headings) deliberately does not offer. */}
              {listSections.length > 0 && (
                <select
                  className="tasks__select"
                  value={formSectionId ?? ""}
                  aria-label={strings.tasks.lists.sectionLabel}
                  onChange={(event) =>
                    setFormSectionId(event.target.value.length === 0 ? null : event.target.value)
                  }
                >
                  <option value="">{strings.tasks.lists.noSection}</option>
                  {listSections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </select>
              )}
              {/* Keyed by the record being edited: switching tasks re-derives
                  whether the rule reads as a preset or as Prilagođeno. */}
              <RecurrencePicker
                key={editingId ?? "new"}
                value={recurrence}
                onChange={setRecurrence}
                anchor={dueDate}
              />
              {/* Podsetnik (ADR-028) — bound to the rok FIELD, exactly like the
                  rule above: the ladder counts back from the date the form is
                  showing, and the store refuses one that has no date to count
                  back from, so the chips say why rather than letting the user hit
                  that error blind. A date read out of the quick-add line is not
                  that anchor yet; it becomes one once it lands in the field. */}
              <div className="tasks__reminders">
                <span className="tasks__reminders-label">{strings.tasks.reminders.label}</span>
                {isValidDayKey(dueDate) ? (
                  <div
                    className="tasks__reminder-chips"
                    role="group"
                    aria-label={strings.tasks.reminders.label}
                  >
                    {reminderChoices(reminderOffsets).map((days) => {
                      const selected = reminderOffsets.includes(days);
                      return (
                        <Button
                          key={days}
                          size="sm"
                          className={
                            selected ? "tasks__reminder tasks__reminder--active" : "tasks__reminder"
                          }
                          aria-pressed={selected}
                          onClick={() => toggleReminder(days)}
                        >
                          {taskReminderLabel(days)}
                        </Button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="tasks__reminders-caption">{strings.tasks.reminders.needsDate}</p>
                )}
              </div>

              {/* Prilozi (migration 024) — only while EDITING: an uncreated task
                  has no id to hang a file off, which is the same constraint the
                  note editor lives under (it only ever opens on a note that
                  already exists). The picker itself is native and lives in main,
                  so there is no drop zone and no file input here. */}
              {editingId !== null && renderAttachments(editingId)}
              {/* Zavisnosti (ADR-037) — EDIT ONLY, and not because it would be
                  cluttered otherwise: an edge names two task ids, and a task
                  being created has none yet. The picker offers only what the
                  store would accept (see `dependencyCandidates`), so the error
                  line below reports a race, never an ordinary refusal. */}
              {editingId !== null && renderDependencies(editingId)}
            </div>
          </form>

          <div className="tasks__toolbar-actions">
            {/* Šabloni (ADR-035). Beside the view toggle rather than on a row,
                because applying one is an action on the LIST the rail has
                selected — and it behaves identically in the kanban view, which
                shows that same list. */}
            <NotePopover
              label={strings.tasks.templates.menuLabel}
              triggerClassName="tasks__templates-trigger"
              triggerContent={strings.tasks.templates.title}
            >
              {(close) => (
                <>
                  <span className="note__menu-label">{strings.tasks.templates.title}</span>
                  {sortedTemplates.length === 0 ? (
                    <p className="note__menu-caption">{strings.tasks.templates.empty}</p>
                  ) : (
                    sortedTemplates.map((template) => (
                      <div key={template.id} className="tasks__template-row">
                        <button
                          className="note__menu-item tasks__template-apply"
                          role="menuitem"
                          type="button"
                          title={strings.tasks.templates.applyTitle}
                          onClick={() => void applyTemplate(template, close)}
                        >
                          {template.name}
                        </button>
                        <button
                          className="tasks__template-delete"
                          type="button"
                          aria-label={strings.tasks.templates.delete}
                          onClick={() => void deleteTemplate(template.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                  {templateFailed && (
                    <p className="note__menu-caption" role="status">
                      {strings.tasks.templates.actionError}
                    </p>
                  )}
                </>
              )}
            </NotePopover>

            <div className="tasks__views" role="group" aria-label={strings.tasks.viewLabel}>
              {(["list", "kanban"] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  className={
                    view === option ? "tasks__view tasks__view--active" : "tasks__view"
                  }
                  aria-pressed={view === option}
                  onClick={() => void selectView(option)}
                >
                  {option === "list" ? strings.tasks.viewList : strings.tasks.viewKanban}
                </Button>
              ))}
            </div>
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

        {pendingListUndoId != null && (
          <div className="tasks__undo" role="status">
            <span className="tasks__undo-text">{strings.tasks.lists.deletedNotice}</span>
            <Button size="sm" className="tasks__undo-action" onClick={undoListDelete}>
              {strings.tasks.undo}
            </Button>
            <Button
              size="sm"
              className="tasks__undo-dismiss"
              aria-label={strings.tasks.dismiss}
              onClick={() => setPendingListUndoId(null)}
            >
              ×
            </Button>
          </div>
        )}

        {failed ? (
          <EmptyState title={strings.tasks.emptyTitle} description={strings.tasks.loadError} />
        ) : tasks === null || lists === null ? (
          <p className="app__muted">{strings.app.loading}</p>
        ) : view === "list" ? (
          // The body first, then each section by its own position — sections are
          // what a task row cannot order itself by (see `TaskGroup`).
          <>
            {/* An empty list still shows whatever headings it has, and the way to
                add one: the empty state stands in only when there is nothing at
                all to draw. A filter that matches nothing says so instead —
                including where the list does have headings, since empty ones
                would only be noise under an answer of "no rows". */}
            {filterHidesEverything ? (
              <EmptyState
                title={strings.tasks.emptyTitle}
                description={strings.tasks.tags.filterEmptyDescription}
              />
            ) : listTasks.length === 0 && listSections.length === 0 ? (
              <EmptyState
                title={strings.tasks.emptyTitle}
                description={strings.tasks.emptyDescription}
              />
            ) : (
              groups.map((group) => renderGroup(group))
            )}
            {selectedId !== null &&
              (sectionEditing?.mode === "new" ? (
                <InlineNameForm
                  value={sectionDraft}
                  placeholder={strings.tasks.lists.sectionNamePlaceholder}
                  label={strings.tasks.lists.newSection}
                  onChange={setSectionDraft}
                  onSubmit={() => submitNewSection(selectedId)}
                  onCancel={closeSectionEditor}
                />
              ) : (
                <Button size="sm" className="tasks__new-section" onClick={beginNewSection}>
                  {strings.tasks.lists.newSection}
                </Button>
              ))}
          </>
        ) : visibleTasks.length === 0 ? (
          // The board has nothing to hold headings or an "add" affordance for, so
          // an empty list is the empty state here, as it was before TASK-004 —
          // and a filter that hides every card says which of the two it is.
          <EmptyState
            title={strings.tasks.emptyTitle}
            description={
              filterHidesEverything
                ? strings.tasks.tags.filterEmptyDescription
                : strings.tasks.emptyDescription
            }
          />
        ) : (
          // The board stays flat: a subtask is a real task with a status of its
          // own, and a card in Za rad whose parent sits in U toku belongs in Za
          // rad. Only the roll-up chip travels here, so a parent card still says
          // how much of it is actually finished. Ordering stays the engine's:
          // columns are the status field's options, and a card's place within one
          // is not something the board lets the user set.
          <KanbanView<TaskFields>
            items={visibleTasks}
            schema={TASK_SCHEMA}
            config={KANBAN_CONFIG}
            columnTitle={statusTitle}
            itemKey={(task) => task.id}
            renderCard={(task) => (
              <KanbanCard
                tag={taskChips(
                  task,
                  childrenOf(task.id),
                  tagsOf(task.id),
                  attachmentCountOf(task.id),
                  isBlocked(task.id),
                )}
              >
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

      {deletePrompt !== null && inboxList !== null && (
        <TaskListDeleteDialog
          list={deletePrompt}
          inboxName={inboxList.name}
          onChoose={(mode) => {
            const list = deletePrompt;
            setDeletePrompt(null);
            deleteList(list, mode);
          }}
          onCancel={() => setDeletePrompt(null)}
        />
      )}
    </div>
  );
}
