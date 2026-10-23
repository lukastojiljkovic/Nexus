import { describe, expect, it } from "vitest";
import type { ModulePageIntent } from "../../../../shared/moduleApi.js";
import { translateRequestOf } from "./request.js";

function translate(payload: unknown): ModulePageIntent {
  return { kind: "action", action: "translate", payload };
}

describe("translateRequestOf", () => {
  it("reads the text and the two NLLB codes the assistant's translate action names", () => {
    expect(translateRequestOf(translate({ text: "Dobar dan.", from: "srp_Cyrl", to: "eng_Latn" }))).toEqual({
      text: "Dobar dan.",
      from: "srp_Cyrl",
      to: "eng_Latn",
    });
  });

  it("reads auto as the source when the assistant leaves it to detection", () => {
    expect(translateRequestOf(translate({ text: "Good evening.", from: "auto", to: "deu_Latn" }))).toEqual({
      text: "Good evening.",
      from: "auto",
      to: "deu_Latn",
    });
  });

  it("ignores every intent that is not a translate action", () => {
    expect(translateRequestOf(null)).toBeNull();
    expect(translateRequestOf(undefined)).toBeNull();
    expect(translateRequestOf({ kind: "reveal", item: "x" })).toBeNull();
    expect(
      translateRequestOf({
        kind: "action",
        action: "set-preference",
        payload: { text: "a", from: "auto", to: "eng_Latn" },
      }),
    ).toBeNull();
  });

  it("refuses a payload the page does not accept, rather than translating something else", () => {
    expect(translateRequestOf(translate(null))).toBeNull();
    expect(translateRequestOf(translate({ text: "", from: "auto", to: "eng_Latn" }))).toBeNull();
    expect(translateRequestOf(translate({ text: "   ", from: "auto", to: "eng_Latn" }))).toBeNull();
    expect(translateRequestOf(translate({ text: 4, from: "auto", to: "eng_Latn" }))).toBeNull();
    expect(translateRequestOf(translate({ text: "a".repeat(4001), from: "auto", to: "eng_Latn" }))).toBeNull();
    // A two-letter code is not an NLLB code, and neither is the word auto as a target.
    expect(translateRequestOf(translate({ text: "a", from: "de", to: "en" }))).toBeNull();
    expect(translateRequestOf(translate({ text: "a", from: "auto", to: "auto" }))).toBeNull();
    expect(translateRequestOf(translate({ text: "a", from: "auto", to: "xyz_Latn" }))).toBeNull();
    expect(translateRequestOf(translate({ text: "a", from: "auto" }))).toBeNull();
    expect(translateRequestOf(translate({ text: "a", to: "eng_Latn" }))).toBeNull();
  });
});
