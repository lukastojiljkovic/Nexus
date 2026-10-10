import { describe, expect, it } from "vitest";

import { fieldWiring } from "./Field.js";

/**
 * A field's wiring, which is the whole of what `Field`, `FieldError` and the
 * control between them agree on:
 *
 *   - the help line and the refusal are named as descriptions, in the order
 *     they are drawn;
 *   - a description the control already carried is KEPT, not replaced — the
 *     control's own name and its own caption belong to the caller;
 *   - the requirement is `aria-required`, never the native `required`
 *     attribute, because the house forms validate in their own submit handler
 *     and the native attribute adds the browser's own bubble to a page whose
 *     refusals are drawn in the page.
 */
describe("fieldWiring", () => {
  it("describes the control with the help line it drew", () => {
    expect(
      fieldWiring({ baseId: "f1", required: false, hasHelp: true, hasError: false }),
    ).toEqual({
      helpId: "f1-help",
      errorId: "f1-error",
      control: { "aria-describedby": "f1-help" },
    });
  });

  it("reads the help line and then the refusal, the order they are drawn in", () => {
    const wiring = fieldWiring({ baseId: "f1", required: false, hasHelp: true, hasError: true });
    expect(wiring.control["aria-describedby"]).toBe("f1-help f1-error");
  });

  it("describes the control with the refusal alone when there is no help line", () => {
    const wiring = fieldWiring({ baseId: "f1", required: false, hasHelp: false, hasError: true });
    expect(wiring.control["aria-describedby"]).toBe("f1-error");
  });

  it("omits the description entirely rather than pointing at nothing", () => {
    const wiring = fieldWiring({ baseId: "f1", required: false, hasHelp: false, hasError: false });
    expect("aria-describedby" in wiring.control).toBe(false);
  });

  it("keeps a description the control already had, ahead of its own", () => {
    // A cell of the markdown grid is named by its row and its column, and the
    // field's help line is one more thing to say, not a replacement.
    const wiring = fieldWiring({
      baseId: "f1",
      required: false,
      hasHelp: true,
      hasError: true,
      describedBy: "grid-row grid-column",
    });
    expect(wiring.control["aria-describedby"]).toBe("grid-row grid-column f1-help f1-error");
  });

  it("ignores an empty description rather than leaving a leading space", () => {
    const wiring = fieldWiring({
      baseId: "f1",
      required: false,
      hasHelp: true,
      hasError: false,
      describedBy: "",
    });
    expect(wiring.control["aria-describedby"]).toBe("f1-help");
  });

  it("announces a required field without turning on native validation", () => {
    const wiring = fieldWiring({ baseId: "f1", required: true, hasHelp: false, hasError: false });
    expect(wiring.control["aria-required"]).toBe(true);
    expect("required" in wiring.control).toBe(false);
  });

  it("says nothing about the control when the field has nothing to add", () => {
    expect(
      fieldWiring({ baseId: "f1", required: false, hasHelp: false, hasError: false }).control,
    ).toEqual({});
  });
});
