import { describe, expect, it } from "vitest";
import type { AssistantRuntimeOptionsView } from "../shared/ipc.js";
import {
  checkDraft,
  draftFrom,
  isChanged,
  parseField,
  withModelDefaults,
  type RuntimeDraft,
  type RuntimeLimits,
} from "./runtimeForm.js";

const limits: RuntimeLimits = {
  contextTokens: { min: 512, max: 32768, integer: true },
  temperature: { min: 0, max: 2, integer: false },
  topP: { min: 0, max: 1, integer: false },
  topK: { min: 1, max: 200, integer: true },
  repeatPenalty: { min: 0.5, max: 2, integer: false },
  idleUnloadMinutes: { min: 0, max: 1440, integer: true },
};

const saved: AssistantRuntimeOptionsView = {
  contextTokens: 4096,
  temperature: 0.7,
  topP: null,
  topK: null,
  repeatPenalty: null,
  idleUnloadMinutes: 10,
  autoCompact: true,
};

describe("parseField", () => {
  it("reads an empty model value as the model's own value", () => {
    expect(parseField("temperature", "", limits.temperature)).toEqual({ ok: true, value: null });
    expect(parseField("topK", "  ", limits.topK)).toEqual({ ok: true, value: null });
  });

  it("refuses an empty idle time, because main stores a number there", () => {
    expect(parseField("idleUnloadMinutes", "", limits.idleUnloadMinutes)).toEqual({
      ok: false,
      problem: "not-a-number",
    });
  });

  it("reads a Serbian decimal comma as the same value as a point", () => {
    expect(parseField("temperature", "0,7", limits.temperature)).toEqual({ ok: true, value: 0.7 });
    expect(parseField("temperature", "0.7", limits.temperature)).toEqual({ ok: true, value: 0.7 });
  });

  it("refuses text that is not a plain decimal", () => {
    for (const text of ["abc", "1e3", "0x10", "1,2,3", "2.", "-"]) {
      expect(parseField("temperature", text, limits.temperature), text).toEqual({
        ok: false,
        problem: "not-a-number",
      });
    }
  });

  it("refuses a value outside the limit, at both ends", () => {
    expect(parseField("temperature", "2,5", limits.temperature)).toEqual({ ok: false, problem: "out-of-range" });
    expect(parseField("topP", "-0.1", limits.topP)).toEqual({ ok: false, problem: "out-of-range" });
    expect(parseField("temperature", "2", limits.temperature)).toEqual({ ok: true, value: 2 });
  });

  it("refuses a fraction in an integer field, and accepts the whole number", () => {
    expect(parseField("contextTokens", "4096,5", limits.contextTokens)).toEqual({ ok: false, problem: "not-whole" });
    expect(parseField("contextTokens", "4096", limits.contextTokens)).toEqual({ ok: true, value: 4096 });
  });
});

describe("checkDraft", () => {
  const draft = draftFrom(saved);

  it("sends the options when every field is valid", () => {
    expect(checkDraft(draft, limits)).toEqual({ options: saved, problems: {} });
  });

  it("sends nothing, and names the field, when one is refused", () => {
    const checked = checkDraft({ ...draft, topK: "0" }, limits);
    expect(checked.options).toBeNull();
    expect(checked.problems).toEqual({ topK: "out-of-range" });
  });
});

describe("draftFrom and withModelDefaults", () => {
  it("shows a null as an empty field and a number as its text", () => {
    const draft = draftFrom(saved);
    expect(draft.topP).toBe("");
    expect(draft.temperature).toBe("0.7");
    expect(draft.idleUnloadMinutes).toBe("10");
    expect(draft.autoCompact).toBe(true);
  });

  it("clears the five model values and keeps the rest", () => {
    const draft: RuntimeDraft = { ...draftFrom(saved), temperature: "1", idleUnloadMinutes: "30", autoCompact: false };
    const cleared = withModelDefaults(draft);
    expect(cleared.temperature).toBe("");
    expect(cleared.contextTokens).toBe("");
    expect(cleared.idleUnloadMinutes).toBe("30");
    expect(cleared.autoCompact).toBe(false);
  });
});

describe("isChanged", () => {
  it("is false for the saved options and true when any one field differs", () => {
    expect(isChanged(saved, saved)).toBe(false);
    expect(isChanged({ ...saved, autoCompact: false }, saved)).toBe(true);
    expect(isChanged({ ...saved, repeatPenalty: 1.1 }, saved)).toBe(true);
    expect(isChanged({ ...saved, idleUnloadMinutes: 0 }, saved)).toBe(true);
  });
});
