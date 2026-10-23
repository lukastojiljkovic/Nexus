import { describe, expect, it } from "vitest";

import { replyProblem, requestId, requestProblem } from "./protocol.js";

const TRANSLATE = {
  id: 1,
  type: "translate",
  directory: "C:\\packs\\nllb-600m\\1.0.0",
  sentences: ["Добар дан."],
  source: "srp_Cyrl",
  target: "eng_Latn",
};

describe("the translator worker's protocol", () => {
  it("takes a translation of non-blank sentences between two NLLB codes", () => {
    expect(requestProblem(TRANSLATE)).toBeNull();
    expect(requestProblem({ ...TRANSLATE, sentences: [] })).toMatch(/sentences/);
    expect(requestProblem({ ...TRANSLATE, sentences: ["Da.", "  "] })).toMatch(/non-blank/);
    expect(requestProblem({ ...TRANSLATE, source: "sr" })).toMatch(/source/);
    expect(requestProblem({ ...TRANSLATE, target: "eng_latn" })).toMatch(/target/);
    expect(requestProblem({ ...TRANSLATE, directory: "" })).toMatch(/directory/);
    expect(requestProblem({ ...TRANSLATE, id: 0 })).toMatch(/id/);
  });

  it("takes a cancel that names a request, and nothing else", () => {
    expect(requestProblem({ id: 2, type: "cancel", request: 1 })).toBeNull();
    expect(requestProblem({ id: 2, type: "cancel" })).toMatch(/request/);
    expect(requestProblem({ id: 3, type: "dispose" })).toMatch(/unknown/);
    expect(requestProblem({ id: 4, type: "load" })).toMatch(/unknown/);
  });

  it("refuses a reply that is not one of its own", () => {
    expect(replyProblem({ id: 1, type: "sentence", index: 0, text: "Good day." })).toBeNull();
    expect(replyProblem({ id: 1, type: "sentence", index: -1, text: "" })).toMatch(/index/);
    expect(replyProblem({ id: 1, type: "translated" })).toBeNull();
    expect(replyProblem({ id: 1, type: "failed", code: "aborted", message: "stopped." })).toBeNull();
    expect(replyProblem({ id: 1, type: "failed", code: "exploded", message: "" })).toMatch(/failure code/);
    expect(replyProblem("ready")).toMatch(/object/);
  });

  it("names the request a message carries, when it carries a usable one", () => {
    expect(requestId({ id: 7 })).toBe(7);
    expect(requestId({ id: "7" })).toBeNull();
  });
});
