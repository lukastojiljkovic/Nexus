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

/**
 * `title`, `caption` and every row's `description` below are getters, not
 * captured fields — this array is built once at import, so a plain field
 * would freeze the Serbian text forever; the getter re-reads `strings`
 * wherever `ShortcutsDialog` (or a test) reads it instead.
 */
export const SHORTCUT_REFERENCE: readonly ShortcutReferenceGroup[] = [
  {
    id: "palette",
    get title() {
      return strings.shortcuts.groups.palette;
    },
    rows: [
      {
        keys: ["↑", "↓"],
        get description() {
          return strings.shortcuts.reference.paletteMove;
        },
      },
      {
        keys: ["Enter"],
        get description() {
          return strings.shortcuts.reference.paletteOpen;
        },
      },
      {
        keys: ["Esc"],
        get description() {
          return strings.shortcuts.reference.paletteClose;
        },
      },
    ],
  },
  {
    id: "tasks",
    get title() {
      return strings.shortcuts.groups.tasks;
    },
    rows: [
      {
        keys: ["Enter"],
        get description() {
          return strings.shortcuts.reference.tasksSubtask;
        },
      },
      {
        keys: ["Esc"],
        get description() {
          return strings.shortcuts.reference.tasksCancel;
        },
      },
      {
        keys: ["Esc"],
        get description() {
          return strings.shortcuts.reference.tasksExitSelection;
        },
      },
    ],
  },
  {
    id: "calendar",
    get title() {
      return strings.shortcuts.groups.calendar;
    },
    get caption() {
      return strings.shortcuts.captions.calendar;
    },
    rows: [
      {
        keys: ["←", "→"],
        get description() {
          return strings.shortcuts.reference.calendarShift;
        },
      },
      {
        keys: ["Home"],
        get description() {
          return strings.shortcuts.reference.calendarToday;
        },
      },
    ],
  },
  {
    id: "study",
    get title() {
      return strings.shortcuts.groups.study;
    },
    get caption() {
      return strings.shortcuts.captions.study;
    },
    rows: [
      {
        keys: ["Space", "Enter"],
        get description() {
          return strings.shortcuts.reference.studyReveal;
        },
      },
      {
        keys: ["1", "2", "3", "4"],
        get description() {
          return strings.shortcuts.reference.studyGrade;
        },
      },
      {
        keys: ["U"],
        get description() {
          return strings.shortcuts.reference.studyUndo;
        },
      },
      {
        keys: ["Esc"],
        get description() {
          return strings.shortcuts.reference.studyExit;
        },
      },
    ],
  },
  {
    id: "notes",
    get title() {
      return strings.shortcuts.groups.notes;
    },
    get caption() {
      return strings.shortcuts.captions.notes;
    },
    rows: [
      {
        keys: ["#", "##", "###"],
        get description() {
          return strings.shortcuts.reference.notesHeading;
        },
      },
      {
        keys: ["-", "*"],
        get description() {
          return strings.shortcuts.reference.notesBulletList;
        },
      },
      {
        keys: ["1."],
        get description() {
          return strings.shortcuts.reference.notesOrderedList;
        },
      },
      {
        keys: [">"],
        get description() {
          return strings.shortcuts.reference.notesBlockquote;
        },
      },
      {
        keys: ["```"],
        get description() {
          return strings.shortcuts.reference.notesCodeBlock;
        },
      },
      {
        keys: ["/"],
        get description() {
          return strings.shortcuts.reference.notesSlash;
        },
      },
      {
        keys: ["[["],
        get description() {
          return strings.shortcuts.reference.notesLink;
        },
      },
      {
        keys: ["Ctrl+Shift+C"],
        get description() {
          return strings.shortcuts.reference.notesCloze;
        },
      },
      {
        keys: ["Ctrl+Z", "Ctrl+Y"],
        get description() {
          return strings.shortcuts.reference.notesHistory;
        },
      },
    ],
  },
  {
    // Its own group rather than three more rows in „Beleške": that group's
    // caption promises "at the start of a line", which is true of every
    // markdown shortcut in it and of none of these.
    id: "notesFind",
    get title() {
      return strings.shortcuts.groups.notesFind;
    },
    get caption() {
      return strings.shortcuts.captions.notesFind;
    },
    rows: [
      {
        keys: ["Ctrl+F"],
        get description() {
          return strings.shortcuts.reference.notesFindOpen;
        },
      },
      // One row, four chips: Enter/Shift+Enter (from the query field) and
      // F3/Shift+F3 (from anywhere in the note) are the same two actions
      // reached from two places, not four things to learn.
      {
        keys: ["Enter", "Shift+Enter", "F3", "Shift+F3"],
        get description() {
          return strings.shortcuts.reference.notesFindStep;
        },
      },
      {
        keys: ["Esc"],
        get description() {
          return strings.shortcuts.reference.notesFindClose;
        },
      },
    ],
  },
];
