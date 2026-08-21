import { describe, expect, it } from "vitest";

import { neighbourAfterDelete, resolveOpenItem } from "./pickedList.js";

function item(id: string) {
  return { id, name: id };
}

describe("neighbourAfterDelete", () => {
  const items = [item("a"), item("b"), item("c")];

  it("lands on the NEXT item, so the list does not jump back to the start", () => {
    expect(neighbourAfterDelete(items, "a")).toBe("b");
    expect(neighbourAfterDelete(items, "b")).toBe("c");
  });

  it("falls back to the previous one when the deleted item was last", () => {
    expect(neighbourAfterDelete(items, "c")).toBe("b");
  });

  it("answers null when that item was the only one there was", () => {
    expect(neighbourAfterDelete([item("a")], "a")).toBeNull();
    expect(neighbourAfterDelete([], "a")).toBeNull();
  });

  it("falls to the head for an id that is not in the list", () => {
    expect(neighbourAfterDelete(items, "nema-me")).toBe("a");
  });
});

describe("resolveOpenItem", () => {
  const items = [item("a"), item("b")];

  it("keeps the current item when it is still there — a refresh must not move the user", () => {
    expect(resolveOpenItem(items, "b")).toBe("b");
  });

  it("falls to the alphabetical head when there is no current item, or it is gone", () => {
    expect(resolveOpenItem(items, null)).toBe("a");
    expect(resolveOpenItem(items, "nema-me")).toBe("a");
  });

  it("answers null for a profile with nothing in the list at all", () => {
    expect(resolveOpenItem([], null)).toBeNull();
    expect(resolveOpenItem([], "a")).toBeNull();
  });
});
