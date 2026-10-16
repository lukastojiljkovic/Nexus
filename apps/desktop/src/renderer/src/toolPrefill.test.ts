import { describe, expect, it } from "vitest";
import { toolPrefillOf } from "./toolPrefill.js";

describe("toolPrefillOf", () => {
  it("reads the values of a prefill action as the text each field holds", () => {
    const action = { name: "prefill", payload: { values: { amount: 1000, rate: 20, direction: "add" } } };
    expect(toolPrefillOf(action)).toEqual({ amount: "1000", rate: "20", direction: "add" });
  });

  it("ignores another action, a prefill without values, and anything that is not an object", () => {
    expect(toolPrefillOf({ name: "sketch", payload: { values: { amount: 1 } } })).toBeUndefined();
    expect(toolPrefillOf({ name: "prefill" })).toBeUndefined();
    expect(toolPrefillOf({ name: "prefill", payload: { values: "1000" } })).toBeUndefined();
    expect(toolPrefillOf(undefined)).toBeUndefined();
    expect(toolPrefillOf("prefill")).toBeUndefined();
  });
});
