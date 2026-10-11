import { describe, expect, it } from "vitest";
import { compareLibraryItems, sortLibraryItems } from "./sort.js";
import type { LibrarySortableItem } from "./sort.js";

/** One row of the shape the sorters read; `updatedAt` defaults to a fixed moment so only the tested field differs. */
function row(
  id: string,
  title: string,
  extra: Partial<Pick<LibrarySortableItem, "year" | "rating" | "updatedAt">> = {},
): LibrarySortableItem {
  return {
    id,
    title,
    year: extra.year ?? null,
    rating: extra.rating ?? null,
    updatedAt: extra.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

const titles = (items: readonly LibrarySortableItem[]): string[] =>
  items.map((item) => item.title);

describe("the title order", () => {
  /**
   * The Serbian Latin alphabet orders these `Ana, Čačak, Ćuprija, Đak, Šuma,
   * Žito`, and a plain code-unit sort orders them by code point instead —
   * `Ana, Ćuprija, Čačak, Đak, Šuma, Žito`, because U+0106 (Ć) precedes U+010C
   * (Č). Both lists are worked out by hand from those code points; the first is
   * what `Intl.Collator(["sr-Latn", "sr"])` must produce and the second is what
   * the sort would be without it.
   */
  const ITEMS = [
    row("6", "Žito"),
    row("2", "Ćuprija"),
    row("3", "Čačak"),
    row("4", "Đak"),
    row("5", "Šuma"),
    row("1", "Ana"),
  ];

  it("sorts by sr-Latn, not by code point", () => {
    expect(titles(sortLibraryItems(ITEMS, "title"))).toEqual([
      "Ana",
      "Čačak",
      "Ćuprija",
      "Đak",
      "Šuma",
      "Žito",
    ]);
    expect(titles([...ITEMS].sort((a, b) => (a.title < b.title ? -1 : 1)))).toEqual([
      "Ana",
      "Ćuprija",
      "Čačak",
      "Đak",
      "Šuma",
      "Žito",
    ]);
  });

  it("breaks a title tie by id, so the order is total", () => {
    const tied = [row("b", "Dune"), row("a", "Dune")];
    expect(sortLibraryItems(tied, "title").map((item) => item.id)).toEqual(["a", "b"]);
    expect(compareLibraryItems(tied[0] as LibrarySortableItem, tied[0] as LibrarySortableItem, "title")).toBe(0);
  });
});

describe("the year order", () => {
  it("puts the newest first and an unknown year last", () => {
    const items = [
      row("a", "A", { year: 1972 }),
      row("b", "B"),
      row("c", "C", { year: 2021 }),
      row("d", "D", { year: 1925 }),
    ];
    expect(sortLibraryItems(items, "year").map((item) => item.year)).toEqual([
      2021,
      1972,
      1925,
      null,
    ]);
  });
});

describe("the rating order", () => {
  it("puts the best first and an unrated item last", () => {
    const items = [
      row("a", "A", { rating: 4 }),
      row("b", "B"),
      row("c", "C", { rating: 10 }),
      row("d", "D", { rating: 7 }),
    ];
    expect(sortLibraryItems(items, "rating").map((item) => item.rating)).toEqual([
      10,
      7,
      4,
      null,
    ]);
  });
});

describe("the activity order", () => {
  it("puts the most recently touched first", () => {
    const items = [
      row("a", "A", { updatedAt: "2026-03-01T10:00:00.000Z" }),
      row("b", "B", { updatedAt: "2026-10-09T23:59:00.000Z" }),
      row("c", "C", { updatedAt: "2025-12-31T00:00:00.000Z" }),
    ];
    expect(sortLibraryItems(items, "activity").map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});

describe("sortLibraryItems", () => {
  it("leaves the caller's array untouched", () => {
    const items = [row("b", "Beta"), row("a", "Alfa")];
    const sorted = sortLibraryItems(items, "title");
    expect(titles(sorted)).toEqual(["Alfa", "Beta"]);
    expect(titles(items)).toEqual(["Beta", "Alfa"]);
  });
});
