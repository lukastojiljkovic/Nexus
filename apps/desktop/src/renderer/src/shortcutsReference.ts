/**
 * The per-context half of the shortcuts reference (ADR-040 / SET-013): every
 * key the app answers to that is NOT part of the remappable core set.
 *
 * Declarative on purpose. The reference is documentation, and documentation
 * that is assembled by hand inside a dialog goes stale the first time a page
 * adds a key — so the rule is stated here instead: a context that adds a key
 * adds a row to this file, and `ShortcutsDialog` renders whatever it finds.
 *
 * The two live groups — Globalno (the current bindings) and Moduli (the
 * reserved Ctrl+digit family over the enabled modules) — are deliberately not
 * here: they are derived from state, and a printed copy of them is exactly the
 * staleness this ADR exists to remove.
 */

import { strings } from "./strings.js";

export interface ShortcutReferenceRow {
  /** The keys as printed, each rendered as its own chip. */
  readonly keys: readonly string[];
  readonly description: string;
}

export interface ShortcutReferenceGroup {
  readonly id: string;
  readonly title: string;
  /** When the group's keys only apply somewhere specific — say so rather than implying they are global. */
  readonly caption?: string;
  readonly rows: readonly ShortcutReferenceRow[];
}

const r = strings.shortcuts.reference;

export const SHORTCUT_REFERENCE: readonly ShortcutReferenceGroup[] = [
  {
    id: "palette",
    title: strings.shortcuts.groups.palette,
    rows: [
      { keys: ["↑", "↓"], description: r.paletteMove },
      { keys: ["Enter"], description: r.paletteOpen },
      { keys: ["Esc"], description: r.paletteClose },
    ],
  },
  {
    id: "tasks",
    title: strings.shortcuts.groups.tasks,
    rows: [
      { keys: ["Enter"], description: r.tasksSubtask },
      { keys: ["Esc"], description: r.tasksCancel },
      { keys: ["Esc"], description: r.tasksExitSelection },
    ],
  },
  {
    id: "calendar",
    title: strings.shortcuts.groups.calendar,
    caption: strings.shortcuts.captions.calendar,
    rows: [
      { keys: ["←", "→"], description: r.calendarShift },
      { keys: ["Home"], description: r.calendarToday },
    ],
  },
  {
    id: "study",
    title: strings.shortcuts.groups.study,
    caption: strings.shortcuts.captions.study,
    rows: [
      { keys: ["Space", "Enter"], description: r.studyReveal },
      { keys: ["1", "2", "3", "4"], description: r.studyGrade },
      { keys: ["U"], description: r.studyUndo },
      { keys: ["Esc"], description: r.studyExit },
    ],
  },
  {
    id: "notes",
    title: strings.shortcuts.groups.notes,
    caption: strings.shortcuts.captions.notes,
    rows: [
      { keys: ["#", "##", "###"], description: r.notesHeading },
      { keys: ["-", "*"], description: r.notesBulletList },
      { keys: ["1."], description: r.notesOrderedList },
      { keys: [">"], description: r.notesBlockquote },
      { keys: ["```"], description: r.notesCodeBlock },
      { keys: ["/"], description: r.notesSlash },
      { keys: ["[["], description: r.notesLink },
      { keys: ["Ctrl+Shift+C"], description: r.notesCloze },
      { keys: ["Ctrl+Z", "Ctrl+Y"], description: r.notesHistory },
    ],
  },
  {
    // Its own group rather than three more rows in „Beleške": that group's
    // caption promises "at the start of a line", which is true of every
    // markdown shortcut in it and of none of these.
    id: "notesFind",
    title: strings.shortcuts.groups.notesFind,
    caption: strings.shortcuts.captions.notesFind,
    rows: [
      { keys: ["Ctrl+F"], description: r.notesFindOpen },
      // One row, four chips: Enter/Shift+Enter (from the query field) and
      // F3/Shift+F3 (from anywhere in the note) are the same two actions
      // reached from two places, not four things to learn.
      { keys: ["Enter", "Shift+Enter", "F3", "Shift+F3"], description: r.notesFindStep },
      { keys: ["Esc"], description: r.notesFindClose },
    ],
  },
];
