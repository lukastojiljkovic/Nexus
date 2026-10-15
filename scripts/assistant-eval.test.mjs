import { describe, expect, it } from "vitest";

import { parseArgs, parseModelSelection, selectModels } from "./assistant-eval.mjs";

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

describe("the --models selection", () => {
  const installed = [
    { id: "qwen", capabilities: ["chat", "tools"] },
    { id: "e5-embed", capabilities: ["embedding"] },
    { id: "gemma", capabilities: ["chat"] },
  ];

  it("reads the ids in the order they are listed, and all", () => {
    expect(parseArgs(["--models", "gemma,qwen"])).toMatchObject({ models: ["gemma", "qwen"] });
    expect(parseArgs(["--models", "all", "--data", "D:/Nexus"])).toMatchObject({ models: "all", data: "D:/Nexus" });
    expect(parseModelSelection("a, b")).toEqual(["a", "b"]);
  });

  it("refuses an empty id, a missing value and a second mode", () => {
    expect(() => parseModelSelection("a,,b")).toThrow(/separated by commas/);
    expect(() => parseArgs(["--models"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--models", "all", "--scripted"])).toThrow(/exactly one/);
    expect(() => parseArgs(["--models", "all", "--model", "x.gguf"])).toThrow(/exactly one/);
  });

  it("selects every installed chat model for all, and the named ones in their order", () => {
    expect(selectModels(installed, "all").map((entry) => entry.id)).toEqual(["qwen", "gemma"]);
    expect(selectModels(installed, ["gemma", "qwen"]).map((entry) => entry.id)).toEqual(["gemma", "qwen"]);
  });

  it("refuses an id that is not an installed chat model, by name, and an empty all", () => {
    expect(() => selectModels(installed, ["e5-embed"])).toThrow(/"e5-embed" is not an installed chat model/);
    expect(() => selectModels(installed, ["nope"])).toThrow(/"nope"/);
    expect(() => selectModels([], "all")).toThrow(/no chat model is installed/);
  });
});
