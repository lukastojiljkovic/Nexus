import { describe, expect, it } from "vitest";

import { parseArgs } from "./assistant-eval.mjs";

describe("parseArgs", () => {
  it("reads the scripted mode and its defaults", () => {
    expect(parseArgs(["--scripted"])).toMatchObject({
      scripted: true,
      model: null,
      locale: null,
      timeoutMs: 120_000,
      json: false,
    });
  });

  it("reads a model path and a locale filter", () => {
    expect(parseArgs(["--model", "C:\\models\\qwen.gguf", "--locale", "sr"])).toMatchObject({
      scripted: false,
      model: "C:\\models\\qwen.gguf",
      locale: "sr",
    });
  });

  it("reads the output switches", () => {
    expect(parseArgs(["--scripted", "--json", "--out-md", "a.md", "--out-json", "a.json", "--timeout", "5000"])).toMatchObject({
      json: true,
      outMd: "a.md",
      outJson: "a.json",
      timeoutMs: 5000,
    });
  });

  it("refuses both modes at once, and neither", () => {
    expect(() => parseArgs(["--scripted", "--model", "x.gguf"])).toThrow(/exactly one/);
    expect(() => parseArgs([])).toThrow(/exactly one/);
  });

  it("refuses an unknown argument", () => {
    expect(() => parseArgs(["--scripted", "--everywhere"])).toThrow(/unknown argument/);
  });

  it("refuses a flag with no value, and a locale that is not one of the two", () => {
    expect(() => parseArgs(["--scripted", "--model"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--scripted", "--locale", "de"])).toThrow(/sr or en/);
    expect(() => parseArgs(["--scripted", "--timeout", "0"])).toThrow(/positive number/);
  });
});
