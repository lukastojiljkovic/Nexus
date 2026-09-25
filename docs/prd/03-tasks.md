# PRD 03 — Tasks & Todo (TASK)

**Status:** draft 2026-07-05. Inputs: raw-spec §4, founder idea 2026-07-05
(kanban views), `docs/research/design-system.md` (views engine),
`docs/research/offline-sync.md` (row sync), quick-capture idea.

## 1. Purpose

The backbone of daily organization: capture, plan, and complete obligations
across horizons (today → godina → custom). TASK is the module every persona
uses and the primary MVP surface together with STUDY and CAL.

## 2. User stories

- As a user, I want to capture a task in seconds from anywhere in the app,
  so that thoughts don't get lost (→ quick capture inbox).
- As a planner, I want daily/weekly/monthly/yearly and custom lists with
  priorities and deadlines, so that different horizons stay organized.
- As a visual worker, I want to switch a project list into a kanban board,
  so that status is spatial (founder requirement).
- As a power user, I want subtasks, dependencies, repeats, and tags, so that
  real-world work maps onto the system.

## 3. User experience & flows

Sidebar: Inbox (quick capture target), smart lists (Danas, Sledećih 7 dana,
Hitno, Overdue), user lists/projects with optional sections. Main pane uses
the **views engine**: list (default), kanban (group by status/priority/tag),
cards, calendar (due dates) — per-list view memory. Task item: checkbox,
title, priority flag, due chip, tags, subtask progress; detail panel on
click (description with markdown, subtasks, dependencies, repeat, reminders,
attachments, activity). Global "new task" hotkey opens quick-add with
natural-language date parsing ("sutra u 9" / "tomorrow 9am" — sr + en).
Completing a task with dependencies satisfies dependents; repeat spawns the
next occurrence on completion.

## 4. Functional requirements

- **TASK-001 (M)** Tasks shall have: title, description (markdown), done
  state, priority (4 levels), due date/time (optional), start date
  (optional), tags, list/project + optional section, subtasks (one level of
  full tasks + lightweight checklist items), attachments (→ blob store),
  reminders (→ NTF).
- **TASK-002 (M)** The Inbox shall receive quick captures (global hotkey in
  app and OS-level on desktop; Android share/tile later) and support fast
  triage (move to list, schedule, delete) with keyboard.
- **TASK-003 (M)** Smart lists shall include Danas, Sledećih 7 dana,
  Hitno (priority-based), Overdue, and Završeno (log); smart lists are
  queries, not copies.
- **TASK-004 (M)** User lists shall support manual ordering, sections, **and
  nested sub-lists** (founder decision 2026-07-05: both mechanisms, applied
  adaptively — sections for grouping within one flow, sub-lists for truly nested
  projects; UI must guide toward the appropriate one), and a per-list default
  view; horizons (daily/weekly/monthly/yearly planning) are covered by smart
  lists + calendar view + custom-period filters, not separate data
  structures.
- **TASK-005 (M)** Views: list, kanban (configurable grouping and columns,
  drag between columns updates the grouped field), cards, and calendar —
  through the shared views engine; per-view filters and sort persist.
- **TASK-006 (M)** Recurring tasks shall support common rules (daily,
  weekdays, weekly×n, monthly by date/ordinal, yearly, custom interval) with
  next-occurrence-on-completion semantics and an end condition (never/date/
  count).
- **TASK-007 (M)** Natural-language date parsing in quick-add shall work in
  Serbian and English, with a visible interpreted-date chip the user can
  correct before saving.
- **TASK-008 (M)** Subtask completion shall roll up to a progress indicator;
  completing a parent offers to complete open subtasks (never silently).
- **TASK-009 (S)** Task dependencies ("blocked by") should be supported;
  blocked tasks are visually distinct and excluded from Danas until
  unblocked (configurable).
- **TASK-010 (S)** Task templates (recurring structures, e.g. checkliste
  from profession packs) should be instantiable.
- **TASK-011 (S)** Batch operations (multi-select complete/move/tag/delete)
  and undo for every destructive action.
- **TASK-012 (C)** Time estimates and a "plan my day" assist (fill Danas
  respecting estimates) — pre-AI heuristic version.

## 5. Options & settings

Default list for captures; first day of week; default reminders offset for
dated tasks; blocked-task visibility; completed-task retention in views;
kanban column config per list.

## 6. Integrations

DASH (Today/Urgent/Quick-actions widgets); CAL (dated tasks appear on the
calendar; drag to reschedule — bidirectional); STUDY (exam planner emits
managed tasks, marked and pinnable per study-hub research); NTF (reminders,
overdue nudges per notification-appetite); CANV (a task list can embed on a
board — post-v1 per canvas research OQ#6); GOAL/HABIT (post-v1 links);
IMEX (import from Todoist/TickTick CSV via LLM prompts; export JSON/CSV);
SRCH (full-text over titles/descriptions/tags).

## 7. Edge cases & error states

- Repeat + dependencies interaction: recurrence copies structure, not
  completion state; dependencies within a template re-link per occurrence.
- Timezone changes: due date-times stored with timezone; all-day tasks are
  date-only and never shift.
- Sync conflict on the same task: per-field LWW (offline-sync research);
  done-state conflicts resolve to done (never resurrect a completed task
  silently); attachments never lost.
- 10k+ tasks with years of history: views stay within performance budgets
  (virtualized lists; Završeno paginated).
- Deleting a list with tasks → explicit choice (move to Inbox / delete) +
  undo window.
- NL date parser ambiguity ("u 5") → interpreted chip shows assumption;
  never blocks saving.

## 8. Acceptance criteria (key)

- Quick capture from anywhere in-app lands in Inbox in ≤ 2 keystrokes +
  typing; triage of 10 items possible in under a minute with keyboard only.
- Kanban drag between columns updates the underlying field and syncs; list
  view reflects it immediately.
- A weekly-repeat task completed today spawns the next with correct date;
  ending the series stops spawning; history preserved.
- "Sutra u 9" and "tomorrow 9am" both produce the correct due datetime with
  visible chip; correcting the chip overrides parsing.
- Completing a parent with open subtasks always asks; undo restores the
  entire prior state.
- Blocked task appears in Danas only after its blocker completes (default).

## 9. Open questions

1. ~~Sections vs sub-lists?~~ **Decided (founder 2026-07-05): both, applied
   adaptively where each fits** (TASK-004 updated).
2. Priority levels: 4 (none/low/med/high) vs 3 — design session.
3. Should Završeno auto-archive after N months to a separate store for
   performance? Architecture input needed.

## 10. Future extensions

Location-based reminders (Android); AI "plan my day"; delegated tasks in
shared/team context; Gantt view via views engine for dependent tasks.
