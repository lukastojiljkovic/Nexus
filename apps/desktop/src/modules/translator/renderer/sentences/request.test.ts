import { describe, expect, it } from "vitest";
import type { ModulePageIntent } from "../../../../shared/moduleApi.js";
import { sentenceRequestOf } from "./request.js";

function translate(payload: unknown): ModulePageIntent {
  return { kind: "action", action: "translate", payload };
}

describe("sentenceRequestOf", () => {
  it("reads the text and the direction the assistant's translate action names", () => {
    expect(sentenceRequestOf(translate({ text: "Dobar dan.", from: "sr", to: "en" }))).toEqual({
      text: "Dobar dan.",
      direction: "sr-en",
    });
    expect(sentenceRequestOf(translate({ text: "Good evening.", from: "en", to: "bs" }))).toEqual({
      text: "Good evening.",
      direction: "en-bs",
    });
  });

  it("ignores every intent that is not a translate action", () => {
    expect(sentenceRequestOf(null)).toBeNull();
    expect(sentenceRequestOf(undefined)).toBeNull();
    expect(sentenceRequestOf({ kind: "reveal", item: "x" })).toBeNull();
    expect(
      sentenceRequestOf({ kind: "action", action: "set-preference", payload: { text: "a", from: "sr", to: "en" } }),
    ).toBeNull();
  });

  it("refuses a payload the page does not accept, rather than translating something else", () => {
    expect(sentenceRequestOf(translate(null))).toBeNull();
    expect(sentenceRequestOf(translate({ text: "", from: "sr", to: "en" }))).toBeNull();
    expect(sentenceRequestOf(translate({ text: 4, from: "sr", to: "en" }))).toBeNull();
    expect(sentenceRequestOf(translate({ text: "a".repeat(4001), from: "sr", to: "en" }))).toBeNull();
    // A pair with no pack behind it is not a direction.
    expect(sentenceRequestOf(translate({ text: "a", from: "sr", to: "sr" }))).toBeNull();
    expect(sentenceRequestOf(translate({ text: "a", from: "de", to: "en" }))).toBeNull();
    expect(sentenceRequestOf(translate({ text: "a", from: "en" }))).toBeNull();
  });
});
