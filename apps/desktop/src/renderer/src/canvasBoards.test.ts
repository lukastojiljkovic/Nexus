import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { CanvasBoard } from "../../shared/ipc.js";
import {
  MERMAID_KEYWORDS,
  boardAfterDelete,
  looksLikeMermaid,
  resolveActiveBoard,
} from "./canvasBoards.js";

function board(id: string, name = id): CanvasBoard {
  return {
    id,
    profileId: "p1",
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

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

describe("boardAfterDelete", () => {
  const boards = [board("a"), board("b"), board("c")];

  it("lands on the NEXT board, so the strip does not jump back to the start", () => {
    expect(boardAfterDelete(boards, "a")).toBe("b");
    expect(boardAfterDelete(boards, "b")).toBe("c");
  });

  it("falls back to the previous one when the deleted board was last", () => {
    expect(boardAfterDelete(boards, "c")).toBe("b");
  });

  it("answers null when that board was the only one there was", () => {
    expect(boardAfterDelete([board("a")], "a")).toBeNull();
    expect(boardAfterDelete([], "a")).toBeNull();
  });

  it("falls to the head for an id that is not in the list", () => {
    expect(boardAfterDelete(boards, "nema-me")).toBe("a");
  });
});

describe("resolveActiveBoard", () => {
  const boards = [board("a"), board("b")];

  it("keeps the current board when it is still there — a refresh must not move the user", () => {
    expect(resolveActiveBoard(boards, "b")).toBe("b");
  });

  it("falls to the alphabetical head when there is no current board, or it is gone", () => {
    expect(resolveActiveBoard(boards, null)).toBe("a");
    expect(resolveActiveBoard(boards, "nema-me")).toBe("a");
  });

  it("answers null for a profile with no boards at all", () => {
    expect(resolveActiveBoard([], null)).toBeNull();
    expect(resolveActiveBoard([], "a")).toBeNull();
  });
});
