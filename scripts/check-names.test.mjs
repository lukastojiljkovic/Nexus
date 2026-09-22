import { describe, expect, it } from "vitest";

import {
  findings,
  isExplanation,
  repoWrappingLabels,
  scanRepo,
  wrappingLabels,
} from "./check-names.mjs";

/**
 * `check:names` makes „a field's name is its name" structural.
 *
 * The class it enforces is invisible to every other instrument in the tree. A
 * wrapping `<label>` holding a name, a control and a hint renders exactly as
 * intended — name above, control, hint below — and that is why it shipped
 * twice: UČENJE's two daily caps, and PRIVATNO's four credential choices. The
 * markup is right; only the WRAPPING is wrong, and the wrapping is what decides
 * whether a screen reader hears one utterance or three.
 *
 * So this suite's job is to show the gate goes RED on that shape, and — as
 * important — that it stays quiet on the wrapping labels that are correct: the
 * four in `RecurrencePicker` that wrap a name and a number, and the slider
 * whose label points at its input from outside.
 */

describe("what counts as an explanation", () => {
  it("reads the hint tier, its modifiers, and the error family", () => {
    expect(isExplanation('<span className="nx-hint">{s.note}</span>')).toBe(true);
    expect(isExplanation('<span className="nx-hint nx-hint--prose">{s.note}</span>')).toBe(true);
    expect(isExplanation('<p className="set__error">{s.refused}</p>')).toBe(true);
    expect(isExplanation('<p className="fit__error">{s.refused}</p>')).toBe(true);
  });

  /**
   * A name is not an explanation. `priv__choice-name` sits one level above the
   * hint that was the finding, and a rule that fired on it would have reported
   * every row it exists to protect.
   */
  it("says nothing about the classes that name things", () => {
    expect(isExplanation('<span className="priv__choice-name">{s.useSeparate}</span>')).toBe(false);
    expect(isExplanation('<span className="nx-select__label">{s.label}</span>')).toBe(false);
  });

  it("says nothing about an element with no class at all", () => {
    expect(isExplanation("<span>{s.note}</span>")).toBe(false);
  });
});

describe("wrappingLabels", () => {
  it("finds the shape that shipped, and names the class that makes it one", () => {
    const source = `
      <label className="priv__choice-row">
        <input className="nx-radio" type="radio" name="x" checked={on} onChange={f} />
        <span className="priv__choice-text">
          <span className="priv__choice-name">{s.name}</span>
          <span className="nx-hint">{s.note}</span>
        </span>
      </label>`;
    const found = wrappingLabels(source);
    expect(found).toHaveLength(1);
    expect(found[0]?.naming).toBe("nx-hint");
    expect(found[0]?.named).toBe(false);
  });

  it("finds it one layer down, where the wrong elements are nested", () => {
    const source = `
      <label className="x__row">
        <span className="x__text"><span className="x__name">{s.n}</span>
          <span className="x__error">{s.refused}</span></span>
        <input className="nx-textfield__input" value={v} onChange={f} />
      </label>`;
    expect(wrappingLabels(source)[0]?.naming).toBe("x__error");
  });

  /** The other way out, and the one PRIVATNO takes. */
  it("accepts a control named by the span the user reads", () => {
    const source = `
      <label className="priv__choice-row">
        <input className="nx-radio" type="radio" aria-labelledby="priv-cred-separate" />
        <span className="priv__choice-text">
          <span className="priv__choice-name" id="priv-cred-separate">{s.name}</span>
          <span className="nx-hint">{s.note}</span>
        </span>
      </label>`;
    const found = wrappingLabels(source);
    expect(found[0]?.naming).toBe("nx-hint");
    expect(found[0]?.named).toBe(true);
  });

  /**
   * The four correct wrappers in the tree, in miniature. A wrapping label with
   * nothing in it but the control and its name is how a label is supposed to
   * work, and it is a finding here only if something else got in.
   */
  it("says nothing about a label that wraps a name and nothing else", () => {
    const source = `
      <label className="recur__field">
        <span className="recur__label">{s.intervalLabel}</span>
        <input type="number" className="nx-textfield__input recur__number" value={v} />
      </label>`;
    const found = wrappingLabels(source);
    expect(found).toHaveLength(1);
    expect(found[0]?.naming).toBeNull();
  });

  /**
   * `htmlFor` names the control from OUTSIDE the tag, so the label's text is
   * never the name and a hint near it cannot join one. This is the Dashboard
   * dim slider, which has a `.nx-hint` three lines below its input.
   */
  it("says nothing about a label that points at its control", () => {
    const source = `
      <label className="set__dash-dim-label" htmlFor="set-dash-dim">{s.dimLabel}</label>
      <input id="set-dash-dim" className="set__dash-slider" type="range" value={v} />
      <p className="nx-hint">{s.dimHint}</p>`;
    expect(wrappingLabels(source)).toEqual([]);
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
    expect(wrappingLabels(source)).toEqual([]);
  });

  it("is not set off by prose about the shape", () => {
    const source = `
      {/* <label className="x"><input /><span className="nx-hint">{s.n}</span></label> */}
      <div className="real" />`;
    expect(wrappingLabels(source)).toEqual([]);
  });
});

/**
 * The verdict on its own, because this is the one place the gate can be wrong
 * in silence: `scanRepo()` returning `[]` is the correct answer AND the answer
 * an inverted predicate gives, and the census would be full either way.
 */
describe("findings", () => {
  const label = (naming, named) => ({ naming, named });

  it("is a finding only when an explanation is inside and nothing names the control", () => {
    expect(findings([label("nx-hint", false)])).toHaveLength(1);
    expect(findings([label("nx-hint", true)])).toEqual([]);
    expect(findings([label(null, false)])).toEqual([]);
    expect(findings([label(null, true)])).toEqual([]);
  });
});

describe("the live tree", () => {
  it("has no wrapping label that speaks an explanation as a name", () => {
    expect(scanRepo()).toEqual([]);
  });

  /**
   * THE TEST THAT WOULD HAVE CAUGHT A BROKEN WALK. `scanRepo()` returning `[]`
   * is the correct answer AND the answer a walk that found nothing gives — and
   * for this gate it is the answer a walk that found TOO MUCH also gives, once
   * `aria-labelledby` clears the finding. So the suite asks the census
   * instead: are the four rows this rule was written for still being seen, each
   * with its explanation and each cleared by name?
   */
  it("still sees the four rows it was written for, so green is not silence", () => {
    const priv = repoWrappingLabels().filter((l) => l.file.endsWith("PrivPage.tsx"));
    expect(priv.map((l) => l.line)).toEqual([269, 285, 335, 351]);
    for (const row of priv) {
      expect(row.naming).toBe("nx-hint");
      expect(row.named).toBe(true);
    }
  });

  /** And the correct wrappers are counted too, or the census proves nothing. */
  it("still counts the wrapping labels that are not findings", () => {
    const recur = repoWrappingLabels().filter((l) => l.file.endsWith("RecurrencePicker.tsx"));
    expect(recur).toHaveLength(4);
    for (const row of recur) expect(row.naming).toBeNull();
  });
});
