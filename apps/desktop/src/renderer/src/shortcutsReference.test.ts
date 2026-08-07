import { describe, expect, it } from "vitest";

import {
  SHORTCUT_REFERENCE,
  type ShortcutReferenceGroup,
} from "./shortcutsReference.js";
import { strings } from "./strings.js";

/**
 * ADR-040's printed half. The reference is DOCUMENTATION, so what is worth
 * pinning is that it stays printable and stays honest: every group is a real
 * group, every row has something to draw and something to say, and the rows a
 * context added are actually in here.
 *
 * Every expectation reads its Serbian text back out of `strings.ts` rather than
 * re-spelling it — a re-spelled description would pass while the dialog printed
 * something else.
 */

// A function, not a module-scope alias, so a language switch is reflected in
// tests reading `r()` too — see check-string-capture.mjs.
function r(): typeof strings.shortcuts.reference {
  return strings.shortcuts.reference;
}

function groupById(id: string): ShortcutReferenceGroup {
  const group = SHORTCUT_REFERENCE.find((candidate) => candidate.id === id);
  if (!group) throw new Error(`Test setup: no reference group "${id}".`);
  return group;
}

describe("SHORTCUT_REFERENCE", () => {
  it("gives every group a unique id", () => {
    const ids = SHORTCUT_REFERENCE.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["palette", "tasks", "calendar", "study", "notes", "notesFind"]);
  });

  it("titles every group from the shared group copy", () => {
    for (const group of SHORTCUT_REFERENCE) {
      expect(Object.values(strings.shortcuts.groups), group.id).toContain(group.title);
      expect(group.title.length, group.id).toBeGreaterThan(0);
    }
  });

  it("omits the two LIVE groups — those are derived from state, never printed from here", () => {
    const titles = SHORTCUT_REFERENCE.map((group) => group.title);
    expect(titles).not.toContain(strings.shortcuts.groups.global);
    expect(titles).not.toContain(strings.shortcuts.groups.modules);
  });

  it("gives every group at least one row", () => {
    for (const group of SHORTCUT_REFERENCE) {
      expect(group.rows.length, group.id).toBeGreaterThan(0);
    }
  });

  it("gives every row at least one printable key and a non-empty description", () => {
    for (const group of SHORTCUT_REFERENCE) {
      for (const row of group.rows) {
        expect(row.keys.length, `${group.id}/${row.description}`).toBeGreaterThan(0);
        for (const key of row.keys) {
          expect(key.trim(), `${group.id}/${row.description}`).not.toBe("");
        }
        expect(row.description.trim(), group.id).not.toBe("");
      }
    }
  });

  it("captions only the groups whose keys are not global", () => {
    const captioned = SHORTCUT_REFERENCE.filter((group) => group.caption !== undefined).map(
      (group) => group.id,
    );
    expect(captioned).toEqual(["calendar", "study", "notes", "notesFind"]);
    for (const group of SHORTCUT_REFERENCE) {
      if (group.caption !== undefined) expect(group.caption.length, group.id).toBeGreaterThan(0);
    }
  });

  it("draws every description from strings.shortcuts.reference", () => {
    const known = new Set<string>(Object.values(r()));
    for (const group of SHORTCUT_REFERENCE) {
      for (const row of group.rows) {
        expect(known.has(row.description), `${group.id}: ${row.description}`).toBe(true);
      }
    }
  });

  it("prints every reference string exactly once — no copy is stranded, none is duplicated", () => {
    const printed = SHORTCUT_REFERENCE.flatMap((group) =>
      group.rows.map((row) => row.description),
    );
    expect([...printed].sort()).toEqual(Object.values(r()).sort());
  });
});

describe("the Zadaci group", () => {
  it("documents the Izbor mode exit, alongside the two other Esc/Enter rows", () => {
    const rows = groupById("tasks").rows;
    expect(rows.map((row) => row.description)).toEqual([
      r().tasksSubtask,
      r().tasksCancel,
      r().tasksExitSelection,
    ]);
    const exitSelection = rows.find((row) => row.description === r().tasksExitSelection);
    expect(exitSelection?.keys).toEqual(["Esc"]);
  });
});

describe("the Beleške group", () => {
  it("documents every markdown input rule the editor answers to", () => {
    const rows = groupById("notes").rows;
    expect(rows.map((row) => row.description)).toEqual([
      r().notesHeading,
      r().notesBulletList,
      r().notesOrderedList,
      r().notesBlockquote,
      r().notesCodeBlock,
      r().notesSlash,
      r().notesLink,
      r().notesCloze,
      r().notesHistory,
    ]);
  });

  it("documents the cloze key beside the two other real chords in the group", () => {
    // Not a markdown trigger, so it prints as a chord rather than as characters
    // the user types — and it earns a row because a number the editor assigns
    // is not something anyone can guess from the syntax alone (ADR-068).
    const rows = groupById("notes").rows;
    expect(rows.find((row) => row.description === r().notesCloze)?.keys).toEqual(["Ctrl+Shift+C"]);
  });

  it("prints the markdown triggers as the characters the user types", () => {
    const keysFor = (description: string): readonly string[] =>
      groupById("notes").rows.find((row) => row.description === description)?.keys ?? [];
    expect(keysFor(r().notesHeading)).toEqual(["#", "##", "###"]);
    expect(keysFor(r().notesBulletList)).toEqual(["-", "*"]);
    expect(keysFor(r().notesOrderedList)).toEqual(["1."]);
    expect(keysFor(r().notesBlockquote)).toEqual([">"]);
    expect(keysFor(r().notesCodeBlock)).toEqual(["```"]);
    expect(keysFor(r().notesSlash)).toEqual(["/"]);
    expect(keysFor(r().notesLink)).toEqual(["[["]);
  });

  it("says where the markdown rules apply, rather than implying they are global", () => {
    expect(groupById("notes").caption).toBe(strings.shortcuts.captions.notes);
  });
});

describe("the Pretraga u belešci group", () => {
  it("documents opening the bar, stepping through hits, and closing it", () => {
    const rows = groupById("notesFind").rows;
    expect(rows.map((row) => row.description)).toEqual([
      r().notesFindOpen,
      r().notesFindStep,
      r().notesFindClose,
    ]);
  });

  it("prints Ctrl+F for opening, and all four stepping keys on the one row that means stepping", () => {
    const rows = groupById("notesFind").rows;
    expect(rows[0]?.keys).toEqual(["Ctrl+F"]);
    expect(rows[1]?.keys).toEqual(["Enter", "Shift+Enter", "F3", "Shift+F3"]);
    expect(rows[2]?.keys).toEqual(["Esc"]);
  });

  it("keeps its own caption — its keys work anywhere in the note, unlike the markdown group's", () => {
    expect(groupById("notesFind").caption).toBe(strings.shortcuts.captions.notesFind);
    expect(groupById("notesFind").caption).not.toBe(strings.shortcuts.captions.notes);
  });
});
