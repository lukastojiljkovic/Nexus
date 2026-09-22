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
 * „Where it renders“ is not a hedge, and DOKUMENTI is why. The marker sat on
 * `.doc__list` and `.doc__grid`, the two shapes of the rows, so it was absent
 * exactly when the page was empty: a page whose region does not exist and a
 * page whose region is above the fold write the same clean report, and only the
 * second of those is a page that is fine. The fix is the marker's position
 * rather than a second rule: `.doc__rows` is ONE box written once in each arm,
 * so the number below did not move — two became two — while what it counts did.
 * Two row shapes in one arm left the empty page with no region at all; two arms
 * leave no state of that page uncovered. A number here is a count of WRITINGS,
 * so it is the reason beside it, and not the number, that has to stay true.
 *
 * The one landed page that is NOT in the list below is HABITS, and it is the
 * case that says what the rule is not. „Danas“ carries the marker and is drawn
 * only when there is a habit: with none, the page drops its whole middle and
 * answers in the register's own landing — a box that exists in both states and
 * is deliberately unmarked, because it is the archive and is legitimately below
 * the fold. Nothing there is left unprotected: `below-fold` has no subject to
 * measure on a page that has none, and `hollow-fixture` has no figure to
 * contradict, because the band is guarded on the very condition the marker is.
 * That is the page's design rather than a gap in it, and writing it down here
 * is what keeps the next reader from completing the census.
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
  ["StudyPage.tsx", 2, "`.study__subjects`, populated and empty — one box, two arms"],
  ["FilesPage.tsx", 2, "`.doc__rows` — the list, the grid, either empty state"],
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
