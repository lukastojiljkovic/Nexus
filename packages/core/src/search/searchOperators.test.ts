import { describe, expect, it } from "vitest";
import {
  applySearchOperators,
  foldSearchTag,
  resolveDueRange,
  searchContextDay,
} from "./searchOperators.js";
import type { SearchTagMatch } from "./searchOperators.js";
import type { SearchHit } from "./searchRanking.js";
import type { SearchKind } from "./searchQuery.js";

const TODAY = "2026-08-15";

function hit(kind: SearchKind, entityId: string, contextDate: string | null): SearchHit {
  return {
    kind,
    entityId,
    parentId: null,
    title: entityId,
    body: "",
    contextDate,
    updatedAt: "2026-08-01T10:00:00.000Z",
    bm25: -1,
  };
}

function tagMatch(taskIds: readonly string[], noteIds: readonly string[]): SearchTagMatch {
  return { taskIds: new Set(taskIds), noteIds: new Set(noteIds) };
}

/** A full ISO instant for a given LOCAL wall-clock moment — the only way to assert local-day reduction without pinning the test to one timezone. */
function localInstant(year: number, month: number, day: number, hour: number): string {
  return new Date(year, month - 1, day, hour, 30).toISOString();
}

describe("foldSearchTag", () => {
  it("folds a tag name the way the query folds a token", () => {
    expect(foldSearchTag("Đorđe")).toBe("djordje");
    expect(foldSearchTag("Ђорђе")).toBe("djordje");
  });

  it("strips the spaces a '#' token cannot carry, inside and around the name", () => {
    expect(foldSearchTag("moj posao")).toBe("mojposao");
    expect(foldSearchTag("  moj   stari  posao ")).toBe("mojstariposao");
  });

  it("makes a typed token a PREFIX of every tag it should reach", () => {
    const token = foldSearchTag("moj");
    expect(foldSearchTag("moj posao").startsWith(token)).toBe(true);
    expect(foldSearchTag("mojstari").startsWith(token)).toBe(true);
    expect(foldSearchTag("tvoj posao").startsWith(token)).toBe(false);
  });
});

describe("resolveDueRange", () => {
  it("resolves today to a single day", () => {
    expect(resolveDueRange({ kind: "preset", preset: "today" }, TODAY)).toEqual({
      from: TODAY,
      to: TODAY,
    });
  });

  it("resolves tomorrow to the single following day", () => {
    expect(resolveDueRange({ kind: "preset", preset: "tomorrow" }, TODAY)).toEqual({
      from: "2026-08-16",
      to: "2026-08-16",
    });
  });

  it("resolves week to today plus the next six days (seven inclusive)", () => {
    expect(resolveDueRange({ kind: "preset", preset: "week" }, TODAY)).toEqual({
      from: "2026-08-15",
      to: "2026-08-21",
    });
  });

  it("rolls over a month boundary", () => {
    expect(resolveDueRange({ kind: "preset", preset: "tomorrow" }, "2026-08-31")).toEqual({
      from: "2026-09-01",
      to: "2026-09-01",
    });
    expect(resolveDueRange({ kind: "preset", preset: "week" }, "2026-12-30")).toEqual({
      from: "2026-12-30",
      to: "2027-01-05",
    });
  });

  it("resolves an explicit date to itself", () => {
    expect(resolveDueRange({ kind: "date", date: "2026-02-29" }, TODAY)).toEqual({
      from: "2026-02-29",
      to: "2026-02-29",
    });
  });
});

describe("searchContextDay", () => {
  it("passes a bare day through unchanged", () => {
    expect(searchContextDay("2026-08-15")).toBe("2026-08-15");
  });

  it("is null for a kind that has no context date", () => {
    expect(searchContextDay(null)).toBeNull();
  });

  it("reduces a full ISO instant to the LOCAL calendar day the user sees it on", () => {
    expect(searchContextDay(localInstant(2026, 8, 15, 23))).toBe("2026-08-15");
    expect(searchContextDay(localInstant(2026, 8, 16, 0))).toBe("2026-08-16");
  });

  it("is null for an unparseable value rather than guessing a day", () => {
    expect(searchContextDay("nekad")).toBeNull();
  });
});

describe("applySearchOperators — no operators", () => {
  it("passes every hit through when nothing is filtering", () => {
    const hits = [hit("note", "n1", null), hit("deck", "d1", null)];
    expect(applySearchOperators(hits, {})).toEqual(hits);
    expect(applySearchOperators(hits, { tagMatches: [], dueRange: null })).toEqual(hits);
  });
});

describe("applySearchOperators — tag filter", () => {
  it("keeps a task in the token's set and drops one that is not", () => {
    const hits = [hit("task", "t1", null), hit("task", "t2", null)];
    const filtered = applySearchOperators(hits, { tagMatches: [tagMatch(["t1"], [])] });
    expect(filtered.map((row) => row.entityId)).toEqual(["t1"]);
  });

  it("keeps a note through its own id set", () => {
    const hits = [hit("note", "n1", null), hit("note", "n2", null)];
    const filtered = applySearchOperators(hits, { tagMatches: [tagMatch([], ["n2"])] });
    expect(filtered.map((row) => row.entityId)).toEqual(["n2"]);
  });

  it("ANDs across tokens — a hit must be in EVERY token's set", () => {
    const hits = [hit("task", "t1", null), hit("task", "t2", null)];
    const filtered = applySearchOperators(hits, {
      tagMatches: [tagMatch(["t1", "t2"], []), tagMatch(["t2"], [])],
    });
    expect(filtered.map((row) => row.entityId)).toEqual(["t2"]);
  });

  it("excludes every non-taggable kind outright while a '#' token is present", () => {
    const hits = [
      hit("task", "t1", null),
      hit("note", "n1", null),
      hit("event", "e1", null),
      hit("document", "doc1", null),
      hit("subject", "s1", null),
      hit("exam", "x1", null),
      hit("deck", "dk1", null),
      hit("card", "c1", null),
      hit("attachment", "a1", null),
      hit("circuit", "circ1", null),
    ];
    const filtered = applySearchOperators(hits, {
      tagMatches: [
        tagMatch(["t1", "e1", "doc1", "s1", "x1", "dk1", "c1", "a1", "circ1"], ["n1"]),
      ],
    });
    expect(filtered.map((row) => row.entityId)).toEqual(["t1", "n1"]);
  });

  it("drops everything when a token matched no entity at all", () => {
    const hits = [hit("task", "t1", null), hit("note", "n1", null)];
    expect(applySearchOperators(hits, { tagMatches: [tagMatch([], [])] })).toEqual([]);
  });
});

describe("applySearchOperators — due filter", () => {
  const range = { from: "2026-08-15", to: "2026-08-21" };

  it("keeps a hit whose bare context date is inside the inclusive range", () => {
    const hits = [
      hit("task", "t1", "2026-08-15"),
      hit("task", "t2", "2026-08-21"),
      hit("task", "t3", "2026-08-14"),
      hit("task", "t4", "2026-08-22"),
    ];
    const filtered = applySearchOperators(hits, { dueRange: range });
    expect(filtered.map((row) => row.entityId)).toEqual(["t1", "t2"]);
  });

  it("compares an instant by its LOCAL day, so a late-evening event stays on the day it is shown", () => {
    const hits = [
      hit("event", "e1", localInstant(2026, 8, 21, 23)),
      hit("event", "e2", localInstant(2026, 8, 22, 0)),
    ];
    const filtered = applySearchOperators(hits, { dueRange: range });
    expect(filtered.map((row) => row.entityId)).toEqual(["e1"]);
  });

  it("drops every hit whose kind carries no context date, with no kind allowlist involved", () => {
    const hits = [hit("note", "n1", null), hit("deck", "d1", null), hit("task", "t1", "2026-08-16")];
    const filtered = applySearchOperators(hits, { dueRange: range });
    expect(filtered.map((row) => row.entityId)).toEqual(["t1"]);
  });
});

describe("applySearchOperators — both filters", () => {
  it("requires a hit to pass the tag AND the date filter", () => {
    const hits = [
      hit("task", "t1", "2026-08-16"),
      hit("task", "t2", "2026-09-01"),
      hit("note", "n1", null),
    ];
    const filtered = applySearchOperators(hits, {
      tagMatches: [tagMatch(["t1", "t2"], ["n1"])],
      dueRange: { from: "2026-08-15", to: "2026-08-21" },
    });
    expect(filtered.map((row) => row.entityId)).toEqual(["t1"]);
  });
});
