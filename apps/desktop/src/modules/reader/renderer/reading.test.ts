import { describe, expect, it } from "vitest";

import type { ReaderTocViewNode } from "../shared/ipc.js";
import { indexProgress, pickStartArticle } from "./reading.js";

/**
 * The reading view's own arithmetic (ADR-100).
 *
 * `pickStartArticle` is the case that matters: a pack updated between two
 * sessions can have lost the article a position names, and the answer then is the
 * book's beginning rather than an error.
 */

const TOC: readonly ReaderTocViewNode[] = [
  {
    kind: "chapter",
    id: "1-zakoni/",
    title: "Zakoni",
    children: [{ kind: "article", id: "1-zakoni/ustav.md", title: "Ustav", children: [] }],
  },
  {
    kind: "article",
    id: "uvod.md",
    title: "Uvod",
    children: [],
  },
];

describe("pickStartArticle", () => {
  it("answers the position when the pack still holds that article", () => {
    expect(pickStartArticle(TOC, "uvod.md")).toBe("uvod.md");
    expect(pickStartArticle(TOC, "1-zakoni/ustav.md")).toBe("1-zakoni/ustav.md");
  });

  it("answers the first article in reading order when there is no position or it is gone", () => {
    expect(pickStartArticle(TOC, null)).toBe("1-zakoni/ustav.md");
    expect(pickStartArticle(TOC, "obrisano.md")).toBe("1-zakoni/ustav.md");
  });

  it("answers null for a pack with no articles at all", () => {
    expect(pickStartArticle([], null)).toBeNull();
    expect(pickStartArticle([{ kind: "chapter", id: "prazno/", title: "Prazno", children: [] }], null)).toBeNull();
  });
});

describe("indexProgress", () => {
  it("answers a fraction only while the index is building", () => {
    expect(indexProgress({ state: "building", articlesDone: 3, articlesTotal: 12 })).toBe(0.25);
    expect(indexProgress({ state: "ready", articlesDone: 12, articlesTotal: 12 })).toBeNull();
    expect(indexProgress({ state: "cold", articlesDone: 0, articlesTotal: 0 })).toBeNull();
    expect(indexProgress({ state: "failed", articlesDone: 2, articlesTotal: 12 })).toBeNull();
  });

  it("answers null rather than a division by zero for a pack with no articles", () => {
    expect(indexProgress({ state: "building", articlesDone: 0, articlesTotal: 0 })).toBeNull();
  });
});

