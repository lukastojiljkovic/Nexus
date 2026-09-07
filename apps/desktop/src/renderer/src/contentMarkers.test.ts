import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `data-nx-content` marks the region a module IS: the notes, the tasks, the
 * subjects, the habits due today. `shots/audit.ts` measures it against the
 * window on every frame where the region RENDERS, and reports `below-fold`
 * when a landing opens without its own subject on screen.
 *
 * „Where it renders“ is not a hedge — DOKUMENTI is the live case. The sweep's
 * profile has no attachments, so neither `.doc__list` nor `.doc__grid` is ever
 * drawn and neither marker has been measured. That gap predates the marker
 * (the sweep has never photographed either surface) and is recorded in
 * `docs/STATUS.md`; the claim is placed so it starts holding the moment the
 * profile has a file in it.
 *
 * This suite exists because that rule's failure mode is SILENCE. Delete an
 * attribute and the audit stops checking the page; the sweep still runs, still
 * writes ~2 700 frames, and still prints a clean report — which is exactly what
 * a page with no defect looks like. Nothing else in the tree can tell the two
 * apart: the attribute has no type, no style, no test double, and removing it
 * typechecks, lints and photographs identically.
 *
 * So the list below is the CLAIM, written where a reviewer has to edit it on
 * purpose. It is deliberately not derived from the module registry: a module
 * whose landing has no single region to point at (FIN's three halves, the
 * dashboard's widget grid, the canvas) is a decision, not an omission, and a
 * derived list would have to carry an exemption for each one.
 */

const here = dirname(fileURLToPath(import.meta.url));

const MARKER = "data-nx-content";

/**
 * Occurrences of the marker as an ATTRIBUTE, which is not the same as
 * occurrences of the word: every site here carries a comment naming the
 * attribute and saying why it is there, and counting those would make the
 * number below a count of prose.
 *
 * Comments are stripped rather than parsed. A `//` inside a string literal
 * would take the rest of its line with it — but the only thing being counted
 * is an attribute, so the worst that costs is an UNDER-count, which this suite
 * reports as a failure. The failure direction that matters is the other one.
 */
function markersIn(source: string): number {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  return (code.match(new RegExp(`\\s${MARKER}(?=[\\s>=])`, "g")) ?? []).length;
}

/** Page → how many times the marker appears in it, and why that number. */
const MARKED: ReadonlyArray<readonly [string, number, string]> = [
  ["NotesPage.tsx", 1, "the three-pane grid"],
  ["TasksPage.tsx", 1, "`.tasks__rows`, every view of the list"],
  ["HabitsPage.tsx", 1, "„Danas“, the part a person acts on"],
  ["StudyPage.tsx", 1, "the subject cards"],
  ["FilesPage.tsx", 2, "the list and the grid are one region in two shapes"],
  ["FocusPage.tsx", 2, "the panel, running and idle — the negative control"],
];

describe("the content markers", () => {
  it.each(MARKED)("%s carries the marker %i time(s) — %s", (file, count) => {
    const source = readFileSync(join(here, file), "utf8");
    expect(markersIn(source)).toBe(count);
  });

  /**
   * The other direction, and the one a per-file test cannot give: a marker
   * added to a seventh page is a claim about that page's layout that nobody
   * decided to make, and it would arrive with no comment explaining it and no
   * eye on the frames it changes.
   */
  it("appears nowhere else in the renderer", () => {
    const expected = new Map(MARKED.map(([file, count]) => [file, count]));
    const found = new Map<string, number>();
    for (const name of readdirSync(here)) {
      if (!name.endsWith(".tsx")) continue;
      const hits = markersIn(readFileSync(join(here, name), "utf8"));
      if (hits > 0) found.set(name, hits);
    }
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(expected));
  });
});
