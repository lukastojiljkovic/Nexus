import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  findings,
  pathsOf,
  readsIn,
  repoCopyLeaves,
  scanRepo,
  tableIndex,
  tableLeaves,
  unjudged,
} from "./check-copy.mjs";

/**
 * `check:copy` makes „a leaf of the copy table is read by something" structural.
 *
 * The class it enforces is invisible to every other instrument in the tree. An
 * unread leaf type-checks, lints, passes `check:strings`, carries no colour and
 * no token, and photographs as nothing at all — because it is not on screen.
 * `waveValuesHint` is what it costs: the only sentence anywhere saying that a
 * list of readings is separated by semicolons, in a dialog that never drew it, so
 * `0, 1,5` was one reading and no error.
 *
 * The rule is not „does any file mention this name". That scan names ~15 900 of
 * this tree's 15 927 leaves, and its path-spelling variant names 782 and misses
 * all twenty-four real ones; the mechanisms it has no answer for are the computed
 * key (`s.reasons[row.reason]`), the dotted literal a registry resolves, the type
 * a subtree is passed under, and the handoff. So this suite's job is to hold each
 * of those to a fixture in BOTH directions — the wrong ones are expensive in
 * opposite ways: a clause that over-clears hides a dead hint, and one that
 * under-clears buries the report.
 */

/** The table a unit case is written against: every shape a leaf can arrive in. */
const TABLE = [
  "export const sr = {",
  '  greeting: "Zdravo",',
  "  panel: {",
  '    title: "Panel",',
  '    hint: "…",',
  "  },",
  "  tools: {",
  '    a: "A",',
  '    b: "B",',
  "  },",
  '  weekdayShort: ["pon", "uto"],',
  "} as const;",
].join("\n");

/** `TABLE`'s leaves, read the way the gate reads a real table. */
function leavesOf(text = TABLE, exported = "sr") {
  const index = tableIndex(new Map([["fixture.ts", text]]));
  const entry = index.get(exported);
  return entry === undefined ? [] : tableLeaves(entry, index);
}

/** The same table's path space, so `readsIn` is asked about a real one. */
const PATHS = pathsOf(leavesOf());

describe("tableLeaves", () => {
  it("names every leaf by its dotted path, on its own line", () => {
    expect(leavesOf().map((leaf) => `${leaf.line}:${leaf.path}`)).toEqual([
      "2:greeting",
      "4:panel.title",
      "5:panel.hint",
      "8:tools.a",
      "9:tools.b",
      "11:weekdayShort",
    ]);
  });

  /**
   * A leaf is what a translator writes and what a screen reads, and an array is
   * one of those — an indexed element is not separately addressable copy.
   */
  it("takes an array as one leaf, not as its elements", () => {
    expect(leavesOf().find((leaf) => leaf.path === "weekdayShort")).toBeDefined();
  });

  /**
   * The table is an INDEX of modules (`devtools: devtoolsSr`), and a finding has
   * to name the file the sentence is written in rather than the one that
   * references it — the line a reader opens.
   */
  it("follows a module composed by reference, naming the module's own file", () => {
    const index = tableIndex(
      new Map([
        ["root.ts", 'export const sr = { panel: panelSr } as const;'],
        ["panel.ts", 'export const panelSr = { title: "Panel" } as const;'],
      ]),
    );
    const entry = index.get("sr");
    expect(tableLeaves(entry, index)).toEqual([
      { file: "panel.ts", line: 1, path: "panel.title" },
    ]);
  });
});

describe("readsIn", () => {
  /**
   * The import is part of every snippet, and it is not scenery: `sr` is followed
   * because it is a name IMPORTED FROM A COPY TABLE, so a snippet without this
   * line records nothing at all and would pass every negative case here for the
   * wrong reason. It is the same trap as a fixture whose files were never
   * written.
   */
  const IMPORT = 'import { sr } from "./strings.sr.js";';
  const source = (text, paths = PATHS) => readsIn(`${IMPORT}\n${text}`, "x.tsx", paths);

  /**
   * EVERY NODE OF A CHAIN IS RECORDED, which is why the object above the leaf is
   * in the set too — the walk visits each access expression, not only the last
   * one. It cannot clear a leaf (the verdict asks about the leaf's own path and
   * about its ANCESTORS only through the index clauses), and the alternative —
   * recording only the longest match — would lose `panel` from a file that reads
   * `sr.panel.title` and `sr.panel.hint` on two lines.
   */
  it("(a) records a chain that spells the path", () => {
    expect([...source("const a = sr.panel.title;").named]).toEqual(["panel.title", "panel"]);
  });

  /** `s.counts.length` reads `counts`; a trail that ran on would miss the leaf. */
  it("(a) records the longest prefix that is a real path", () => {
    expect([...source("const a = sr.tools.a.length;").named]).toEqual(["tools.a", "tools"]);
  });

  /** The app's own idiom: `const s = strings.dashboard.focus;` then `s.empty`. */
  it("(a) follows a scope alias to the subtree it stands for", () => {
    expect([...source(["const s = sr.panel;", "const a = s.title;"].join("\n")).named]).toEqual([
      "panel",
      "panel.title",
    ]);
  });

  /**
   * A literal index spells the leaf, and this is how the agro calculator's
   * hyphenated keys are read: `strings.pro.agro["bale-count-storage"]`.
   */
  it("(a) records a literal element access", () => {
    expect([...source('const a = sr.tools["a"];').named]).toEqual(["tools.a", "tools"]);
  });

  /** A path written as DATA — the module registry's `titleKey`, resolved at runtime. */
  it("(a) records a dotted path written as a string literal", () => {
    expect([...source('const key = "panel.title";').keyed]).toEqual(["panel.title"]);
  });

  /**
   * The clause the whole rule turns on: `s.reasons[row.reason]` reads the
   * SUBTREE. The code that wrote the index knows where the subtree ends and
   * cannot know the keys, so every leaf under it is read.
   */
  it("(b) clears a subtree that is indexed with a computed key", () => {
    expect([...source("const a = sr.tools[id];").indexed]).toEqual(["tools"]);
  });

  it("(b) clears a subtree handed to `lookup`", () => {
    expect([...source("const a = lookup(sr.tools, id);").indexed]).toEqual(["tools"]);
  });

  /** `` `panel.title.${x}` `` computes a key inside `panel.title`, so it is read. */
  it("(b) clears the subtree a template's head names", () => {
    expect([...source("const a = `panel.title.${x}`;").indexed]).toEqual(["panel.title"]);
  });

  /**
   * AND THE ONE-SEGMENT HEAD DOES NOT, which is the shape that would clear a
   * subtree on a namespace rather than on a read. `packages/core`'s
   * `plan.test.ts` builds a manifest title as `` `dashboard.${id}.title` ``, and
   * the whole `dashboard` subtree sits under `dashboard` — with the head relaxed
   * to a bare trailing dot, that fixture cleared it and the verdict silently lost
   * `dashboard.fitnessToday.todayLabel`. Same evidence standard as the literal
   * clause: two segments and a path that exists.
   */
  it("(b) does not read a one-segment head as a subtree", () => {
    expect([...source("const a = `panel.${field}`;").indexed]).toEqual([]);
    expect([...source("const a = `Danas ${count} serija`;").indexed]).toEqual([]);
    expect([...source("`panel ${count}`;").indexed]).toEqual([]);
  });

  /**
   * THE ROOT EXCEPTION, pinned because it is the one place the rule is narrower
   * than its own wording: honouring `lookup(strings, key)` literally would clear
   * every leaf in the app, and a gate that is silent by construction is not a
   * gate. An index at the root says nothing about any subtree.
   */
  it("(b) does NOT clear anything when the ROOT is indexed", () => {
    expect([...source("const a = lookupString(sr, key);").indexed]).toEqual([]);
    expect([...source("const a = Object.keys(sr);").enumerated]).toEqual([]);
  });

  it("(b) clears a subtree enumerated by Object.keys/values/entries", () => {
    expect([...source("const a = Object.keys(sr.tools);").enumerated]).toEqual(["tools"]);
    expect([...source("const a = Object.entries(sr.panel);").enumerated]).toEqual(["panel"]);
  });

  /** `myMap.keys()` walks someone else's keys, and must not clear a copy table. */
  it("(b) does not read `myMap.keys()` as an enumeration", () => {
    expect([...source("const a = myMap.keys(sr.tools);").enumerated]).toEqual([]);
  });

  /**
   * (c) THE HANDOFF, and the reason it is a second tier rather than a finding.
   * `formatStructuredError(s.errors, …)` is how a whole table is read: the
   * parameter is typed as a generic record because the helper serves several
   * tables, so the path exists only at the call site.
   */
  it("(c) records an argument, a return and a prop as handed", () => {
    expect([...source("consume(sr.tools);").handed]).toEqual(["tools"]);
    expect([...source("function f() { return sr.panel; }").handed]).toEqual(["panel"]);
    expect([...source("const x = <View s={sr.tools} />;").handed]).toEqual(["tools"]);
  });

  /** A concise arrow IS a return: `chrome: () => strings.pro`. */
  it("(c) records a concise arrow's body as handed", () => {
    expect([...source("const drawers = { pro: { chrome: () => sr.tools } };").handed]).toEqual([
      "tools",
    ]);
  });

  /**
   * A name bound to something that is NOT the table stops the walk rather than
   * being skipped over — otherwise a file's own `s` would be read through an
   * outer alias and would clear a subtree it never touches, which is the
   * over-clearing direction and the one that hides a dead hint.
   */
  it("does not resolve a name that is bound to something else", () => {
    const shadowed = ["const s = makeThing();", "const a = s.title;"].join("\n");
    expect([...source(shadowed).named]).toEqual([]);
  });

  /**
   * The gate's documentation and this suite are written in the shape it reads —
   * `sr.panel.title` appears in a comment and in a string here. A rule set off by
   * prose about itself teaches people to stop writing the prose.
   */
  it("is not set off by prose about a path", () => {
    expect([...source("// reads sr.panel.title after the form is saved").named]).toEqual([]);
  });
});

/**
 * The verdict on its own — the clause the composition is made of, asked in both
 * directions without a tree.
 *
 * It exists as a named export for this gate's own reason: the census is not
 * empty, `scanRepo()` returning rows is the answer a broken walk gives as well as
 * the answer this tree gives, and only this pins what a finding IS.
 */
describe("findings", () => {
  const leaf = (read) => ({ file: "x.ts", line: 1, path: "a.b", read });

  it("is a finding only for a leaf no clause read", () => {
    expect(findings([leaf(null)])).toHaveLength(1);
    for (const clause of ["named", "keyed", "indexed", "enumerated", "handed"]) {
      expect(findings([leaf(clause)]), `cleared by ${clause}`).toEqual([]);
    }
  });

  /**
   * `handed` is the second tier and it is NOT the verdict. Ticket the two the
   * same way and 206 more leaves join the red list; drop the tier and a leaf
   * under a component that ignores its prop is lost. So both are asked here —
   * and the mixed row is the one that matters: a `findings` that returned
   * nothing passes the first assertion, and a `findings` that ignored the
   * clauses passes neither.
   */
  it("keeps the handoff tier out of the verdict and in `unjudged`", () => {
    expect(findings([leaf("handed")])).toEqual([]);
    expect(findings([leaf(null), leaf("handed"), leaf("named")])).toHaveLength(1);
    expect(unjudged([leaf("handed"), leaf(null), leaf("named")])).toHaveLength(1);
  });
});

/**
 * The composition, on a tree of its own — the half the blocks above cannot
 * reach. Each clause is proven against a string above; what is never proven there
 * is the sentence they are joined into, and `scanRepo()` on the real tree is now
 * a red list, so a walk that stopped finding anything would be the one failure a
 * `[]`-shaped assertion could not tell from success.
 *
 * EVERY CASE READS THE CENSUS BEFORE IT READS THE VERDICT. A census row is the
 * same statement the gate makes about a real leaf — which file, which line, which
 * clause cleared it — so a fixture whose consumer stopped being read fails as a
 * FIXTURE, naming its own leaf, instead of passing as a verdict.
 */
describe("scanRepo on a tree of its own", () => {
  /** The three paths a fixture must write: the entry table, and a consumer. */
  const ENTRY = "apps/desktop/src/renderer/src/strings.sr.ts";
  const CONSUMER = "apps/desktop/src/renderer/src/Page.tsx";

  /**
   * The consumer's import, which is what makes `sr` a name this walk will follow
   * rather than an identifier it has never heard of. Every case writes it, since
   * a fixture that omitted it would report the whole table and look like a rule.
   */
  const import_ = 'import { sr } from "./strings.sr.js";';

  function fakeRepo(files) {
    const root = mkdtempSync(join(tmpdir(), "nexus-copy-"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text, "utf8");
    }
    return root;
  }

  function scanFixture(files) {
    const root = fakeRepo(files);
    try {
      return { census: repoCopyLeaves(root), verdict: scanRepo(root) };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  /** What `main()` prints for a finding, so a case can assert the report too. */
  const reported = (rows) => rows.map((f) => `${f.file}:${f.line}: ${f.path}`);

  it("reports a leaf nothing reads, naming its file and line", () => {
    const { census, verdict } = scanFixture({
      [ENTRY]: TABLE,
      [CONSUMER]: [
        import_,
        "const s = sr.panel;",
        "const a = s.title;",
        "const b = sr.tools[id];",
      ].join("\n"),
    });
    // The census first, with the clause that cleared each leaf: the two reads
    // above clear four of the six leaves, and the two that are left are the
    // finding. `greeting` and `weekdayShort` are read by nothing at all here.
    expect(census.map((row) => [row.path, row.read])).toEqual([
      ["greeting", null],
      ["panel.title", "named"],
      ["panel.hint", null],
      ["tools.a", "indexed"],
      ["tools.b", "indexed"],
      ["weekdayShort", null],
    ]);
    // The second clause of the path — `indexed` clears the SUBTREE, so `tools.b`
    // is read by the index on `tools` alone. A walking rule that cleared one leaf
    // would report it, and this is the assertion that says so.
    expect(reported(verdict)).toEqual([
      `${ENTRY}:2: greeting`,
      `${ENTRY}:5: panel.hint`,
      `${ENTRY}:11: weekdayShort`,
    ]);
  });

  it("says nothing about a leaf whose path is written as data", () => {
    const { census, verdict } = scanFixture({
      [ENTRY]: TABLE,
      [CONSUMER]: [import_, "const registries = {", '  key: "panel.hint",', "};"].join("\n"),
    });
    expect(census.find((row) => row.path === "panel.hint")?.read).toBe("keyed");
    expect(reported(verdict)).toEqual([
      `${ENTRY}:2: greeting`,
      `${ENTRY}:4: panel.title`,
      `${ENTRY}:8: tools.a`,
      `${ENTRY}:9: tools.b`,
      `${ENTRY}:11: weekdayShort`,
    ]);
  });

  /**
   * THE TIER BOUNDARY, on a tree: a leaf under a handed subtree is not reported
   * by `findings` and IS reported by `unjudged`. Neither list alone is the
   * answer — that is the whole point of the split — so both are asserted here.
   */
  it("hands a subtree out of sight without calling it unread", () => {
    const { census, verdict } = scanFixture({
      [ENTRY]: TABLE,
      [CONSUMER]: [
        import_,
        "formatStructuredError(sr.panel, key);",
        "const b = sr.tools[id];",
      ].join("\n"),
    });
    expect(census.map((row) => [row.path, row.read])).toEqual([
      ["greeting", null],
      ["panel.title", "handed"],
      ["panel.hint", "handed"],
      ["tools.a", "indexed"],
      ["tools.b", "indexed"],
      ["weekdayShort", null],
    ]);
    expect(reported(verdict)).toEqual([`${ENTRY}:2: greeting`, `${ENTRY}:11: weekdayShort`]);
    expect(reported(unjudged(census))).toEqual([
      `${ENTRY}:4: panel.title`,
      `${ENTRY}:5: panel.hint`,
    ]);
  });

  /**
   * The clause with no witness in the real tree, driven here instead: not one
   * `Object.keys/values/entries` over a copy subtree exists in this repository,
   * so a `0 enumerated` tally is what a working clause and a dead one both
   * produce. This case is the only thing that tells them apart.
   */
  it("clears a subtree that is enumerated", () => {
    const { census, verdict } = scanFixture({
      [ENTRY]: TABLE,
      [CONSUMER]: [import_, "const all = Object.values(sr.tools);"].join("\n"),
    });
    expect(census.find((row) => row.path === "tools.a")?.read).toBe("enumerated");
    expect(reported(verdict)).toEqual([
      `${ENTRY}:2: greeting`,
      `${ENTRY}:4: panel.title`,
      `${ENTRY}:5: panel.hint`,
      `${ENTRY}:11: weekdayShort`,
    ]);
  });

  /** The root exception on a tree: the whole table indexed clears no leaf. */
  it("does not clear the tree when the root itself is indexed", () => {
    const { census, verdict } = scanFixture({
      [ENTRY]: TABLE,
      [CONSUMER]: [import_, "const a = lookupString(sr, key);"].join("\n"),
    });
    expect(census.every((row) => row.read === null)).toBe(true);
    expect(reported(verdict)).toHaveLength(census.length);
  });
});

/**
 * THE LIVE TREE IS WALKED ONCE, and this memo is the whole of why.
 *
 * It was walked three times — once for the census, and twice inside the
 * verdict's test, because `scanRepo()` is `findings(repoCopyLeaves())` and the
 * call beside it walked the tree again. One walk measures 7.3 s here against
 * this suite's ~15 900 leaves, so the file spent 22 of its 35 seconds doing the
 * same work on the same unchanged tree: two walks to answer one question, and
 * the third to ask it about a tree the second had already read.
 *
 * Locally the verdict's test sat at 14.7 s against `testTimeout`'s 30 s and
 * passed. On CI's four-core runner, where all thirty-three files walk the
 * repository at once, it crossed 30 s and the run went red with „Test timed
 * out" — a message naming neither the gate's subject nor the real cause, which
 * is the failure `vitest.scripts.config.mjs` had already met once and answered
 * by raising the budget. Raising it again would answer it the same way twice.
 *
 * The memo is not a cache for speed alone: the census and the verdict now
 * describe the SAME walk, so „found nothing" and „looked at less than it
 * should" cannot come from two different readings of the tree. The tree does
 * not change while the file runs, so one walk is the honest number of walks.
 */
let liveCensus = null;
function liveTree() {
  liveCensus ??= repoCopyLeaves();
  return liveCensus;
}

describe("the live tree", () => {
  /**
   * THE CENSUS FIRST, because the verdict below is a red list and a red list is
   * also what a walk that read nothing produces. The floor is coarse on purpose:
   * it catches a walk that stopped descending, and a floor is not a figure to
   * keep in step with the table.
   */
  it("reads the two tables whole, and says how each leaf is read", () => {
    const census = liveTree();
    expect(census.length).toBeGreaterThan(15_000);
    // `read` is total: every leaf is cleared by a clause or is `null`. A walk
    // that forgot to write the column would show up here and nowhere else.
    expect(census.every((row) => row.read !== undefined)).toBe(true);
    const count = (clause) => census.filter((row) => row.read === clause).length;
    expect(count("named") + count("keyed") + count("indexed")).toBeGreaterThan(15_000);

    // One row per clause that clears leaves in this tree, so a silent change to
    // any one of them lands on a line that names the clause it broke.
    const row = (path) => census.find((leaf) => leaf.path === path);
    expect(row("app.brand")?.read, "a chain that spells the path").toBe("named");
    expect(row("dashboard.today.title")?.read, "a path written as registry data").toBe("keyed");
    expect(row("onboarding.week.shapes.posao.name")?.read, "inside an indexed subtree").toBe(
      "indexed",
    );
    expect(row("tools.title")?.read, "handed to the drawer's chrome thunk").toBe("handed");
    // The clause with no witness here, asserted as the measurement it is: if
    // `Object.keys` over a subtree ever appears, this line fails and says so.
    expect(count("enumerated"), "no enumeration of a copy subtree in this tree").toBe(0);
  });

  /**
   * THE INSTRUMENT'S OWN REPORT, PINNED — and it has now shrunk to nothing.
   *
   * Every path that stood here was a leaf no clause reads, which is a question
   * and not a verdict, and the two answers were opposite: some wanted RENDERING
   * (`onboarding.packsNoChoice` was a sentence about picking nothing, in the
   * dialog that asks you to pick; `devtools.design.gradient.stops` was a
   * section heading over a section that had none; `waveValuesHint` is the one
   * this gate was written for) and some wanted DELETING (`study.title` said
   * „Predmeti" for a page whose rail and header both say „Učenje", and the fix
   * that reconciled them left it behind).
   *
   * So what is pinned is not the empty array — an empty array is a constant,
   * and `expect([]).toEqual([])` asserts nothing about the walk. It is the
   * CENSUS beside it. A walk that stopped parsing, or lost its file list, would
   * report no unread leaf either, and „found nothing" and „looked at nothing"
   * are the same green line; these four lines are the only thing in the tree
   * that can tell them apart. Each is a FLOOR or a CEILING rather than an
   * equality, because the table only grows — and a failure means the walk
   * shrank, which is a question about this gate and not about the copy.
   */
  it("finds nothing unread in this tree, and can prove it looked", () => {
    const census = liveTree();
    const count = (clause) => census.filter((leaf) => leaf.read === clause).length;
    // `findings(census)` rather than `scanRepo()`: the entry point is the same
    // composition — `scanRepo(root)` is `findings(repoCopyLeaves(root))` — and
    // asking the census this file already holds is what keeps the verdict and
    // the floors below describing one walk instead of two.
    expect(findings(census)).toEqual([]);
    expect(census.length).toBeGreaterThan(15_000);
    expect(count("named")).toBeGreaterThan(13_000);
    // The gate's own admission, bounded: a leaf under a subtree handed out of
    // the walk's sight is not judged, and that list is printed rather than
    // hidden. It stays a rounding error or this stops being a gate over the
    // copy table and becomes a gate over the part of it that is convenient.
    expect(count("handed")).toBeLessThan(census.length / 10);
  });
});
