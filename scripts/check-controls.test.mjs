import { describe, expect, it } from "vitest";

import { ALLOWED, scanRepo, scanSource } from "./check-controls.mjs";

/**
 * `check:controls` makes „use the shared control" structural instead of
 * remembered.
 *
 * The class has three instances — `priv.css`, the Elektronika chassis dialog,
 * and a checkbox that had been sitting in `FitRoutines.tsx` unnoticed — and the
 * third is the whole argument for a gate: it lives three modal steps inside a
 * form the screenshot sweep cannot reach, so the audit that caught the second
 * one structurally could not catch it. This suite's job is to show the gate
 * goes RED on the shape that was written three times, because a rule that
 * cannot fail is the design document again with extra steps.
 *
 * The select half is the same rule one layer up, and its instances numbered ten
 * rather than three. What makes it worth testing separately is that its fix is
 * a COMPONENT and not a class, so „add the right className" — the answer this
 * file is otherwise entirely about — is the wrong answer to it, and a gate that
 * accepted any class on a `<select>` would have passed all ten.
 */

const PAGE = "apps/desktop/src/renderer/src/SomePage.tsx";
const SHARED = "packages/ui/src/components/Checkbox.tsx";
const SHARED_SELECT = "packages/ui/src/components/Select.tsx";

describe("scanSource", () => {
  it("refuses a native radio with no shared class", () => {
    const findings = scanSource(PAGE, '<input type="radio" name="a" checked={x} />');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.native).toBe("input");
    expect(findings[0]?.type).toBe("radio");
    expect(findings[0]?.expected).toBe("nx-radio");
  });

  it("refuses a native checkbox with no shared class", () => {
    const findings = scanSource(PAGE, '<input type="checkbox" checked={x} />');
    expect(findings[0]?.expected).toBe("nx-checkbox");
  });

  /**
   * Paired, not pooled. A radio wearing `.nx-checkbox` draws a square where the
   * control means „one of these" — a different bug from the same cause, and one
   * a gate that accepted either class would wave through.
   */
  it("refuses a radio wearing the checkbox's class", () => {
    expect(scanSource(PAGE, '<input className="nx-checkbox" type="radio" />')).toHaveLength(1);
  });

  it("allows either control once it carries its own class", () => {
    expect(scanSource(PAGE, '<input className="nx-radio" type="radio" />')).toEqual([]);
    expect(scanSource(PAGE, '<input className="nx-checkbox" type="checkbox" />')).toEqual([]);
  });

  /**
   * The negative control that a regex version of this gate fails, and the
   * reason the scanner tracks brace depth at all.
   *
   * `/<input[^>]*>/` ends the element at the FIRST `>`, which in every real
   * instance is the arrow inside `onChange={(event) => …}` — before the
   * `className` that makes the control legal. The gate would then report a
   * finding on the four `PrivPage.tsx` radios that have been correct all along,
   * and the first thing anybody would do about it is delete the gate.
   */
  it("is not ended early by the arrow in an onChange handler", () => {
    const source = [
      "<input",
      "  type=\"radio\"",
      "  onChange={(event) => setThing(event.target.value)}",
      "  className=\"nx-radio\"",
      "/>",
    ].join("\n");
    expect(scanSource(PAGE, source)).toEqual([]);
  });

  /**
   * `FitRoutines.tsx` now explains, in the JSX comment above the control it
   * fixed, that an unstyled `input type="checkbox"` renders at 13x13. A gate
   * that fires on the sentence describing the rule teaches people to stop
   * writing the sentence — which `check:egress` and `check:elec` both learned
   * before this one existed.
   */
  it("is not set off by prose about the controls", () => {
    const cases = [
      '// an unstyled `input type="checkbox"` renders at 13x13',
      '/* <input type="radio" /> is the OS widget */',
      '{/* the shared control, never `<input type="checkbox">` */}',
    ];
    for (const source of cases) expect(scanSource(PAGE, source)).toEqual([]);
  });

  it("says nothing about the inputs the design system never replaced", () => {
    expect(scanSource(PAGE, '<input type="text" value={x} />')).toEqual([]);
    expect(scanSource(PAGE, '<input type="range" min={0} max={9} />')).toEqual([]);
  });

  it("reports the line the reader has to open", () => {
    const source = ["a", "b", '<input type="checkbox" />'].join("\n");
    expect(scanSource(PAGE, source)[0]?.line).toBe(3);
  });

  it("admits the shared component, which paints the class on its label", () => {
    expect(scanSource(SHARED, '<input type="checkbox" {...rest} />')).toEqual([]);
  });

  it("refuses a hand-written select, and no class rescues it", () => {
    expect(scanSource(PAGE, "<select value={v} />")).toEqual([
      { file: PAGE, line: 1, native: "select" },
    ]);
    // The fix is a component, so a class is not one. `.nx-select__control` is
    // what `Select` puts on its own element, and wearing it by hand produces
    // the exact defect the gate is for: the drawn chevron lives in the
    // component's markup, `appearance: none` in that class, and a bare select
    // wearing it therefore has neither arrow.
    expect(scanSource(PAGE, '<select className="nx-select__control" />')).toHaveLength(1);
  });

  /**
   * The component IS the fix, so a lexer that could not tell it from the native
   * would fail on the one file that matters. `jsxElements` matches the tag name
   * case-sensitively, which is what keeps these two apart.
   */
  it("says nothing about the component that replaces it", () => {
    expect(scanSource(PAGE, '<Select label="Rok" value={v} />')).toEqual([]);
    expect(scanSource(PAGE, '<Select aria-labelledby={id} />')).toEqual([]);
  });

  it("is not set off by prose about the select either", () => {
    expect(scanSource(PAGE, "// a raw <select> keeps the OS arrow")).toEqual([]);
  });

  /**
   * The pairing, which is why `ALLOWED` names an element and not just a file.
   * `Select.tsx` has a reason to write `<select>` and none at all to write a
   * bare checkbox; a file-level pass would hand it both, in the one package
   * whose whole job is that its components do not reach for natives by pattern.
   */
  it("admits each component only for the native it replaces", () => {
    expect(scanSource(SHARED_SELECT, "<select id={selectId} {...rest} />")).toEqual([]);
    expect(scanSource(SHARED_SELECT, '<input type="checkbox" />')).toHaveLength(1);
    expect(scanSource(SHARED, "<select />")).toHaveLength(1);
  });
});

describe("the live tree", () => {
  it("has no native radio, checkbox or select outside the shared components", () => {
    expect(scanRepo()).toEqual([]);
  });

  /**
   * Two entries, on purpose. „Anything under `packages/ui`" reads like the
   * obvious rule and is the wrong one: it would admit the next component that
   * reaches for a native by pattern instead of by decision, in the one package
   * whose whole job is that they do not.
   */
  it("admits exactly two files, and each for one native", () => {
    expect([...ALLOWED]).toEqual([
      [SHARED, "input"],
      [SHARED_SELECT, "select"],
    ]);
  });
});
