import { describe, expect, it } from "vitest";
import { collectionProgress } from "./collections.js";
import type { LibraryStatus } from "./item.js";

describe("collectionProgress", () => {
  it("counts only the items that are done", () => {
    const statuses: LibraryStatus[] = ["done", "done", "in-progress", "planned", "dropped"];
    expect(collectionProgress(statuses)).toEqual({ done: 2, total: 5 });
  });

  it("counts a dropped work as not done — a put-down book is not a finished one", () => {
    expect(collectionProgress(["dropped"])).toEqual({ done: 0, total: 1 });
  });

  it("answers 0/0 for an empty collection rather than null", () => {
    expect(collectionProgress([])).toEqual({ done: 0, total: 0 });
  });
});
