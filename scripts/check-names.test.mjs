import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  findings,
  labelsNamingControls,
  repoLabelsNamingControls,
  scanRepo,
} from "./check-names.mjs";

/**
 * `check:names` makes „a field's name is its name" structural.
 *
 * The class it enforces is invisible to every other instrument in the tree. A
 * `<label>` holding a name, a control and a hint renders exactly as intended —
 * name above, control, hint below — and that is why it shipped twice: UČENJE's
 * two daily caps, and PRIVATNO's four credential choices. The markup is right;
 * only what the label SAYS is wrong, and that is what decides whether a screen
 * reader hears one utterance or three.
 *
 * So this suite's job is to show the gate goes RED on that shape — on a tree of
 * its own, not only on a string, because `scanRepo()` returning `[]` is the
 * correct answer AND the answer a walk pointed at the wrong directory gives —
 * and, as important, that it stays quiet on the labels that are correct.
 */

/** A tree of its own, so the verdict is shown to fire rather than assumed. */
function fakeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "nexus-names-"));
  for (const [name, source] of Object.entries(files)) {
    const full = join(root, "apps", "desktop", name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source);
  }
  return root;
}

/**
 * PRIVATNO's row, which is the shape that makes LEAVES the right unit: the name
 * and the note are one `<span>` apart from the label, so a rule that counted
 * direct children would see one thing here and call it clean.
 */
const PRIV_ROW = `
  <label className={choiceRowClass(on)}>
    <input className="nx-radio" type="radio" aria-labelledby="priv-cred-separate" />
    <span className="priv__choice-text">
      <span className="priv__choice-name" id="priv-cred-separate">{s.useSeparate}</span>
      <span className="nx-hint" id="priv-cred-separate-note">{s.useSeparateNote}</span>
    </span>
  </label>`;

describe("what a label says", () => {
  it("finds the name and the note inside one wrapper — leaves, not children", () => {
    const [row] = labelsNamingControls(PRIV_ROW);
    expect(row?.says.map((piece) => piece.what)).toEqual(["priv__choice-name", "nx-hint"]);
    expect(row?.named).toBe(true);
  });

  /**
   * THE REGRESSION THIS RULE WAS REWRITTEN FOR, asked directly: with the
   * reference gone, the row is a finding again. If this ever passes, `named` has
   * stopped being load-bearing and the four rows are only green by accident.
   */
  it("is a finding the moment the reference goes", () => {
    const source = PRIV_ROW.replaceAll(/\s*aria-labelledby="[^"]*"/g, "");
    const found = labelsNamingControls(source);
    expect(found[0]?.named).toBe(false);
    expect(findings(found)).toHaveLength(1);
  });

  it("counts a name and a bare description with no wrapper at all", () => {
    const source = `
      <label className="elec-chassis__shape">
        <input className="nx-radio" type="radio" aria-labelledby="s-0" />
        <span className="elec-chassis__shape-name" id="s-0">{s.shapes[c]}</span>
        <span className="elec-chassis__shape-hint">{s.shapeHints[c]}</span>
      </label>`;
    const [row] = labelsNamingControls(source);
    expect(row?.says.map((piece) => piece.what)).toEqual([
      "elec-chassis__shape-name",
      "elec-chassis__shape-hint",
    ]);
  });

  /** A `for` label takes its whole text content too, and holds no control. */
  it("reads a label that points at its control from outside", () => {
    const source = `
      <label className="set__dash-dim-label" htmlFor="d">
        <span id="n">{s.dimLabel}</span>
        <span className="set__dash-dim-value">{v}%</span>
      </label>
      <input id="d" className="set__dash-slider" type="range" />`;
    const [row] = labelsNamingControls(source);
    // The `for` id resolves to the input in the same file, so the control is
    // known. `null` here means the id was an expression no reader can follow.
    expect(row?.control).toBe("input");
    expect(row?.says.map((piece) => piece.what)).toEqual(["span", "set__dash-dim-value"]);
    expect(findings(labelsNamingControls(source))).toHaveLength(1);
  });

  /** The same row, silenced the way the tree now silences it. */
  it("accepts a `for` label whose control names itself by reference", () => {
    const source = `
      <label className="set__dash-dim-label" htmlFor="d">
        <span id="n">{s.dimLabel}</span>
        <span className="set__dash-dim-value">{v}%</span>
      </label>
      <input id="d" aria-labelledby="n" type="range" />`;
    const [row] = labelsNamingControls(source);
    expect(row?.named).toBe(true);
    expect(findings(labelsNamingControls(source))).toEqual([]);
  });

  it("says nothing about a label that holds a name and nothing else", () => {
    const source = `
      <label className="recur__field">
        <span className="recur__label">{s.intervalLabel}</span>
        <input type="number" className="nx-textfield__input recur__number" value={v} />
      </label>`;
    const found = labelsNamingControls(source);
    expect(found[0]?.says.map((piece) => piece.what)).toEqual(["recur__label"]);
    expect(findings(found)).toEqual([]);
  });

  it("counts a bare text node as the thing it is", () => {
    const source = `
      <label className="x__row">
        Email <input className="nx-textfield__input" value={v} /> we never share it
      </label>`;
    // Two runs of text outside the control, so two things said about it — the
    // shape the first version of this gate documented as invisible to it.
    expect(findings(labelsNamingControls(source))).toHaveLength(1);
  });

  /**
   * The components draw a `<label for>` BESIDE the control, which is why the
   * six settings rows stopped being this defect the day they adopted
   * `TextField`. A gate that read the rendered DOM would have to know that;
   * this one reads the call site, so it has nothing to say and says nothing.
   */
  it("says nothing about a field whose component draws its own label", () => {
    const source = `
      <SettingsField label={s.newPerDayLabel} hint={s.newPerDayHint} value={v} />`;
    expect(labelsNamingControls(source)).toEqual([]);
  });

  it("is not set off by prose about the shape", () => {
    const source = `
      {/* <label className="x"><input /><span className="nx-hint">{s.n}</span></label> */}
      <div className="real" />`;
    expect(labelsNamingControls(source)).toEqual([]);
  });
});

/**
 * The verdict on its own, because this is the one place the gate can be wrong
 * in silence: `scanRepo()` returning `[]` is the correct answer AND the answer
 * an inverted predicate gives, and the census would be full either way.
 */
describe("findings", () => {
  const label = (says, named) => ({ says: Array.from({ length: says }, () => ({})), named });

  it("is a finding only when the label says more than a name and nothing names it", () => {
    expect(findings([label(2, false)])).toHaveLength(1);
    expect(findings([label(2, true)])).toEqual([]);
    expect(findings([label(1, false)])).toEqual([]);
    expect(findings([label(1, true)])).toEqual([]);
    expect(findings([label(0, false)])).toEqual([]);
  });
});

describe("on a tree of its own", () => {
  it("goes red, and names the file and the line it found", () => {
    const root = fakeRepo({
      "Bad.tsx": [
        "export function Bad() {",
        "  return (",
        '    <label className="x__row">',
        '      <input className="nx-radio" type="radio" />',
        '      <span className="x__name">{s.name}</span>',
        '      <span className="x__note">{s.note}</span>',
        "    </label>",
        "  );",
        "}",
      ].join("\n"),
    });
    try {
      const census = repoLabelsNamingControls(root);
      // The census first: a walk that found nothing and a walk that read
      // nothing are the same `[]`, and only this tells them apart.
      expect(census).toHaveLength(1);
      expect(census[0]?.file).toBe("apps/desktop/Bad.tsx");
      expect(census[0]?.line).toBeGreaterThan(0);

      const found = scanRepo(root);
      expect(found).toHaveLength(1);
      expect(found[0]?.says.map((piece) => piece.what)).toEqual(["x__name", "x__note"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is quiet on the same tree once the control is named by reference", () => {
    const root = fakeRepo({
      "Good.tsx": [
        "export function Good() {",
        "  return (",
        '    <label className="x__row">',
        '      <input className="nx-radio" type="radio" aria-labelledby="n" />',
        '      <span className="x__name" id="n">{s.name}</span>',
        '      <span className="x__note">{s.note}</span>',
        "    </label>",
        "  );",
        "}",
      ].join("\n"),
    });
    try {
      expect(repoLabelsNamingControls(root)).toHaveLength(1);
      expect(scanRepo(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the live tree", () => {
  it("has no label that speaks more than a name for the control it names", () => {
    expect(scanRepo()).toEqual([]);
  });

  /**
   * THE TEST THAT WOULD HAVE CAUGHT A BROKEN WALK, and the one that caught the
   * rule being too coarse. `scanRepo()` returning `[]` is the correct answer AND
   * the answer a walk that found nothing gives — so the suite asks the census
   * instead: are the rows this rule was written for still being seen, with
   * everything they say, and each cleared by the reference that clears them?
   */
  it("still sees the four rows it was written for, so green is not silence", () => {
    const census = repoLabelsNamingControls();
    const priv = census.filter((row) => row.file.endsWith("PrivPage.tsx"));
    expect(priv).toHaveLength(4);
    for (const row of priv) {
      // Two pieces, not one: this is the assertion that fails if the count
      // stops reaching through `priv__choice-text`, and with it any guarantee
      // that `aria-labelledby` is doing anything.
      expect(row.says.map((piece) => piece.what)).toEqual(["priv__choice-name", "nx-hint"]);
      expect(row.named).toBe(true);
    }
    // The two rows this gate surfaced when it learned to count, rather than to
    // look for a class name it already knew.
    for (const file of ["ElecChassisDialog.tsx", "moduleSettingsPanels.tsx"]) {
      const row = census.find((entry) => entry.file.endsWith(file));
      expect(row?.says).toHaveLength(2);
      expect(row?.named).toBe(true);
    }
  });

  /** And the `for` path reaches the tree, on the one label that takes it. */
  it("reads a label that names its control from outside", () => {
    const row = repoLabelsNamingControls().find((entry) => entry.file.endsWith("pro/shared.tsx"));
    expect(row?.control).toBeNull();
    expect(row?.named).toBe(false);
    expect(row?.says).toHaveLength(1);
  });
});
