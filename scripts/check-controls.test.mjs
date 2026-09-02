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
 */

const PAGE = "apps/desktop/src/renderer/src/SomePage.tsx";
const SHARED = "packages/ui/src/components/Checkbox.tsx";

describe("scanSource", () => {
  it("refuses a native radio with no shared class", () => {
    const findings = scanSource(PAGE, '<input type="radio" name="a" checked={x} />');
    expect(findings).toHaveLength(1);
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
});

describe("the live tree", () => {
  it("has no native radio or checkbox outside the shared component", () => {
    expect(scanRepo()).toEqual([]);
  });

  /**
   * One entry, on purpose. „Anything under `packages/ui`" reads like the
   * obvious rule and is the wrong one: it would admit the next component that
   * reaches for a native input by pattern instead of by decision, in the one
   * package whose whole job is that they do not.
   */
  it("admits exactly one file, and it is the Checkbox component", () => {
    expect([...ALLOWED]).toEqual([SHARED]);
  });
});
