import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { MERMAID_KEYWORDS, looksLikeMermaid } from "./canvasBoards.js";

describe("looksLikeMermaid", () => {
  it.each(MERMAID_KEYWORDS)("recognises a definition beginning %s", (keyword) => {
    expect(looksLikeMermaid(`${keyword} TD\n  A --> B`)).toBe(true);
  });

  it("recognises the -beta suffix and a leading %%{…}%% directive", () => {
    expect(looksLikeMermaid("flowchart-beta TD\n A --> B")).toBe(true);
    expect(looksLikeMermaid('%%{init: {"theme":"dark"}}%%\ngraph TD\n A --> B')).toBe(true);
  });

  it("ignores leading whitespace, which is what a pasted block usually has", () => {
    expect(looksLikeMermaid("\n\n  gantt\n  title X")).toBe(true);
  });

  it.each([
    ["ordinary prose", "Ovo je beleška o grafovima."],
    ["a word that merely contains one", "graphql shema"],
    ["a keyword that is not at the start", "prvo ovo, pa graph TD"],
    ["empty text", ""],
  ])("leaves %s alone", (_label, text) => {
    expect(looksLikeMermaid(text)).toBe(false);
  });

  /**
   * The copy is only worth anything while it still matches (see
   * `MERMAID_KEYWORDS`' own doc). This reads the installed editor's bundle and
   * fails on an upgrade that added a keyword we do not intercept — which is
   * exactly the case where a paste would silently start converting again.
   */
  it("still matches the keyword list inside the installed Excalidraw build", () => {
    const require = createRequire(import.meta.url);
    // `dist/prod`, never whatever the `exports` conditions pick in a test
    // runner — see `excalidrawSurface.test.ts`'s `distProd` for the full note.
    const entry = require.resolve("@excalidraw/excalidraw");
    const bundle = readFileSync(join(entry, "..", "..", "prod", "index.js"), "utf8");
    // The literal array Excalidraw's own detector is built from.
    const listed = `["${MERMAID_KEYWORDS.join('","')}"]`;
    expect(bundle).toContain(listed);
  });
});
