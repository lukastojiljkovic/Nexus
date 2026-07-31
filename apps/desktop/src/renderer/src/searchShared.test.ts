import { SEARCH_KIND_PREFIXES, SEARCH_KINDS, foldSearchTag } from "@nexus/core";
import type { SearchKind } from "@nexus/core";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SearchHighlight, SearchResult } from "../../shared/ipc.js";
import {
  buildEffectiveQuery,
  formatContextDate,
  groupByKind,
  KIND_QUERY_PREFIX,
  renderHighlighted,
  SEARCH_DEBOUNCE_MS,
  toggleKindInQuery,
  toggleTagInQuery,
} from "./searchShared.js";

/**
 * The grammar the palette (ADR-021) and the search page (ADR-039) share. Every
 * function here is pure except `formatContextDate`, which reads the clock
 * through `formatNotificationWhen` — so those cases pin "now" with fake timers
 * at BOTH edges of a local day, and assert the two output SHAPES rather than a
 * locale-rendered day or month name.
 *
 * `renderHighlighted` returns React nodes, not DOM: the assertions read the
 * returned array's structure (`type`, `props`, `key`) directly, which is what
 * lets this file run in the node environment with no DOM library.
 */

afterEach(() => {
  vi.useRealTimers();
});

// --- KIND_QUERY_PREFIX --------------------------------------------------------

describe("KIND_QUERY_PREFIX", () => {
  it("names one prefix per indexed kind, and nothing else", () => {
    expect(Object.keys(KIND_QUERY_PREFIX).sort()).toEqual([...SEARCH_KINDS].sort());
  });

  it("is the shortest alias core publishes for each kind", () => {
    for (const kind of SEARCH_KINDS) {
      const aliases = Object.entries(SEARCH_KIND_PREFIXES)
        .filter(([, aliasKind]) => aliasKind === kind)
        .map(([alias]) => alias);
      expect(aliases.length, kind).toBeGreaterThan(0);
      const shortest = Math.min(...aliases.map((alias) => alias.length));
      expect(KIND_QUERY_PREFIX[kind].length, kind).toBe(shortest);
    }
  });

  it("only ever names an alias core would parse back to the same kind", () => {
    for (const kind of SEARCH_KINDS) {
      expect(SEARCH_KIND_PREFIXES[KIND_QUERY_PREFIX[kind]], kind).toBe(kind);
    }
  });

  it("pins the letters a chip click splices in", () => {
    expect(KIND_QUERY_PREFIX).toEqual({
      task: "z",
      event: "d",
      note: "b",
      document: "dok",
      subject: "p",
      exam: "i",
      deck: "s",
      card: "k",
      attachment: "pr",
    });
  });
});

// --- toggleKindInQuery --------------------------------------------------------

describe("toggleKindInQuery", () => {
  it("prepends the canonical token when the kind is not filtered yet", () => {
    expect(toggleKindInQuery("ispit", "task")).toBe("z: ispit");
    expect(toggleKindInQuery("", "note")).toBe("b:");
    expect(toggleKindInQuery("ispit", "attachment")).toBe("pr: ispit");
  });

  it("removes EVERY alias of the kind, not only the canonical one", () => {
    for (const alias of ["z", "zad", "zadatak", "zadaci"]) {
      expect(toggleKindInQuery(`${alias}: ispit`, "task"), alias).toBe("ispit");
    }
  });

  it("removes an alias however it was spelled — folding decides, not the letters", () => {
    expect(toggleKindInQuery("BELEŠKA: ispit", "note")).toBe("ispit");
    expect(toggleKindInQuery("Белешка: ispit", "note")).toBe("ispit");
  });

  it("keeps the text riding on a removed token", () => {
    expect(toggleKindInQuery("z:ispit", "task")).toBe("ispit");
    expect(toggleKindInQuery("uvod z:ispit kraj", "task")).toBe("uvod ispit kraj");
  });

  it("leaves another kind's token alone", () => {
    expect(toggleKindInQuery("b: ispit", "task")).toBe("z: b: ispit");
    expect(toggleKindInQuery("z: b: ispit", "note")).toBe("z: ispit");
  });

  it("round-trips: toggling a kind on and back off restores the query", () => {
    for (const query of ["ispit", "uvod kraj", ""]) {
      for (const kind of SEARCH_KINDS) {
        expect(toggleKindInQuery(toggleKindInQuery(query, kind), kind), `${query}/${kind}`).toBe(
          query,
        );
      }
    }
  });

  it("normalizes runs of whitespace on its way through, in both directions", () => {
    expect(toggleKindInQuery("  uvod   kraj  ", "task")).toBe("z: uvod kraj");
    expect(toggleKindInQuery("z:   uvod   kraj", "task")).toBe("uvod kraj");
  });

  it("removes a bare token down to an empty query", () => {
    expect(toggleKindInQuery("z:", "task")).toBe("");
  });

  it("removes every occurrence when the same kind was typed twice", () => {
    expect(toggleKindInQuery("z: zadaci: ispit", "task")).toBe("ispit");
  });

  // CURRENT BEHAVIOUR, pinned rather than endorsed: `readKindWord` splits at the
  // FIRST colon, so a `rok:`/`due:` date filter is never mistaken for a kind —
  // but a word whose head folds to an alias swallows the rest as free text.
  // Both are the documented design; this test exists so a change to the split
  // point shows up here rather than in a user's query.
  it("does not touch a date filter or an unknown prefix", () => {
    expect(toggleKindInQuery("rok:danas", "task")).toBe("z: rok:danas");
    expect(toggleKindInQuery("konstruktor:x", "task")).toBe("z: konstruktor:x");
    expect(toggleKindInQuery("constructor:x", "task")).toBe("z: constructor:x");
  });
});

// --- toggleTagInQuery ---------------------------------------------------------

describe("toggleTagInQuery", () => {
  it("appends the token at the end when it is not present", () => {
    expect(toggleTagInQuery("ispit", "posao")).toBe("ispit #posao");
    expect(toggleTagInQuery("", "posao")).toBe("#posao");
  });

  it("removes a present token, matching by the folded tag form", () => {
    expect(foldSearchTag("Đorđe")).toBe("djordje");
    expect(toggleTagInQuery("#Đorđe ispit", "djordje")).toBe("ispit");
    expect(toggleTagInQuery("#djordje ispit", "djordje")).toBe("ispit");
    expect(toggleTagInQuery("#ĐORĐE ispit", "djordje")).toBe("ispit");
  });

  it("treats a spaced tag name the way a query token spells it", () => {
    expect(foldSearchTag("moj posao")).toBe("mojposao");
    expect(toggleTagInQuery("#mojposao ispit", "mojposao")).toBe("ispit");
  });

  it("leaves a word that merely looks like the tag but carries no #", () => {
    expect(toggleTagInQuery("posao #posao", "posao")).toBe("posao");
    expect(toggleTagInQuery("posao", "posao")).toBe("posao #posao");
  });

  it("removes every spelling of the same tag at once", () => {
    expect(toggleTagInQuery("#Đorđe #djordje ispit", "djordje")).toBe("ispit");
  });

  it("round-trips, up to whitespace normalization", () => {
    expect(toggleTagInQuery(toggleTagInQuery("ispit", "posao"), "posao")).toBe("ispit");
  });

  // CURRENT BEHAVIOUR: the `token` argument is the ALREADY FOLDED tag form —
  // what `SearchTagFacet.token` carries. Handing it an unfolded name matches
  // nothing and appends a token that can never be removed by the same call.
  it("only recognizes an already-folded token — an unfolded one appends instead", () => {
    expect(toggleTagInQuery("#Đorđe ispit", "Đorđe")).toBe("#Đorđe ispit #Đorđe");
  });
});

// --- buildEffectiveQuery ------------------------------------------------------

describe("buildEffectiveQuery", () => {
  it("is the identity — same string, whitespace included — when no chip is set", () => {
    const raw = "  ispit  iz  matematike  ";
    expect(buildEffectiveQuery(raw, new Set(), [])).toBe(raw);
    expect(buildEffectiveQuery("", new Set(), ["task"])).toBe("");
  });

  it("splices one prefix token per chip, in the chip set's own order", () => {
    expect(buildEffectiveQuery("ispit", new Set<SearchKind>(["note", "task"]), [])).toBe(
      "b: z: ispit",
    );
  });

  it("skips a chip whose kind the user already typed, so nothing is duplicated", () => {
    expect(buildEffectiveQuery("z: ispit", new Set<SearchKind>(["task"]), ["task"])).toBe(
      "z: ispit",
    );
    expect(buildEffectiveQuery("z: ispit", new Set<SearchKind>(["task", "note"]), ["task"])).toBe(
      "b: z: ispit",
    );
  });

  it("leaves a trailing separator when the raw query is empty but a chip is set", () => {
    // CURRENT BEHAVIOUR: the join is unconditional, so an empty query becomes
    // "z: " rather than "z:". Harmless — every consumer re-parses — but pinned
    // so a change to the joining is a deliberate one.
    expect(buildEffectiveQuery("", new Set<SearchKind>(["task"]), [])).toBe("z: ");
  });
});

// --- groupByKind --------------------------------------------------------------

function hit(kind: SearchKind, entityId: string): SearchResult {
  return {
    kind,
    entityId,
    parentId: null,
    title: entityId,
    titleRanges: [],
    snippet: "",
    snippetRanges: [],
    contextDate: null,
    updatedAt: "2026-07-30T10:00:00.000Z",
    fromAttachment: false,
  };
}

describe("groupByKind", () => {
  it("has nothing to group when there are no results", () => {
    expect(groupByKind([])).toEqual([]);
  });

  it("orders the groups by SEARCH_KINDS, whatever order the results arrived in", () => {
    const grouped = groupByKind([hit("card", "c1"), hit("task", "t1"), hit("note", "n1")]);
    expect(grouped.map(([kind]) => kind)).toEqual(["task", "note", "card"]);
  });

  it("drops every kind that has no result — an empty heading is never rendered", () => {
    const grouped = groupByKind([hit("exam", "e1")]);
    expect(grouped).toHaveLength(1);
    expect(grouped.map(([kind]) => kind)).toEqual(["exam"]);
  });

  it("keeps each group's own results in the order the ranking handed them over", () => {
    const grouped = groupByKind([
      hit("task", "t1"),
      hit("note", "n1"),
      hit("task", "t2"),
      hit("task", "t3"),
    ]);
    expect(grouped.map(([kind, list]) => [kind, list.map((result) => result.entityId)])).toEqual([
      ["task", ["t1", "t2", "t3"]],
      ["note", ["n1"]],
    ]);
  });

  it("can hold every indexed kind at once, still in canonical order", () => {
    const grouped = groupByKind([...SEARCH_KINDS].reverse().map((kind) => hit(kind, kind)));
    expect(grouped.map(([kind]) => kind)).toEqual([...SEARCH_KINDS]);
  });
});

// --- formatContextDate --------------------------------------------------------

/** Pins "now" to a local wall-clock moment, so no host offset can move the day. */
function pinLocal(year: number, monthIndex: number, day: number, hour: number, minute = 0): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(year, monthIndex, day, hour, minute, 0));
}

describe("formatContextDate", () => {
  it("renders a bare day key as a full date, not as a clock", () => {
    const rendered = formatContextDate("2026-07-08");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).not.toBe("2026-07-08");
    expect(rendered).toContain("2026");
    expect(rendered).not.toMatch(/\d{2}:\d{2}/);
  });

  it("renders an instant on today's local day as a bare clock — a different shape entirely", () => {
    for (const [hour, minute] of [
      [0, 0],
      [23, 59],
    ] as const) {
      pinLocal(2026, 6, 30, hour, minute);
      const instant = formatContextDate(new Date(2026, 6, 30, 9, 5, 0).toISOString());
      expect(instant, `${hour}:${minute}`).toMatch(/^\d{2}:\d{2}$/);
      expect(instant, `${hour}:${minute}`).not.toBe(formatContextDate("2026-07-30"));
    }
  });

  it("renders an instant on another day with a day prefix, still unlike the bare-date shape", () => {
    pinLocal(2026, 6, 30, 12);
    const instant = formatContextDate(new Date(2026, 0, 5, 9, 30, 0).toISOString());
    expect(instant).toMatch(/^.+,\s\d{2}:\d{2}$/);
    expect(instant).not.toBe(formatContextDate("2026-01-05"));
  });

  it("routes on the SHAPE of the value, so the same day reads two ways", () => {
    pinLocal(2026, 6, 30, 12);
    const bare = formatContextDate("2026-01-05");
    const instant = formatContextDate("2026-01-05T00:00:00.000Z");
    expect(bare.length).toBeGreaterThan(0);
    expect(instant.length).toBeGreaterThan(0);
    expect(bare).not.toBe(instant);
  });

  it("hands an unusable value back untouched, from either branch", () => {
    pinLocal(2026, 6, 30, 12);
    expect(formatContextDate("not-a-date")).toBe("not-a-date");
    expect(formatContextDate("")).toBe("");
    // Well-formed shape, impossible day: it takes the bare-date branch, where
    // `formatExamDate` returns the input rather than an "Invalid Date".
    expect(formatContextDate("2026-13-45")).toBe("2026-13-45");
  });
});

// --- renderHighlighted --------------------------------------------------------

interface MarkProps {
  readonly className?: string;
  readonly children?: ReactNode;
}

/** The returned node as the array it is for any non-empty range list. */
function piecesOf(node: ReactNode): readonly ReactNode[] {
  if (!Array.isArray(node)) throw new Error(`Expected an array of pieces, got ${typeof node}.`);
  return node as readonly ReactNode[];
}

/** A piece as the `<mark>` element it must be — asserts the tag and the class on the way through. */
function markOf(piece: ReactNode): ReactElement<MarkProps> {
  if (!isValidElement(piece)) throw new Error("Expected a React element.");
  const element = piece as ReactElement<MarkProps>;
  expect(element.type).toBe("mark");
  expect(element.props.className).toBe("search__mark");
  return element;
}

/** The text a `<mark>` piece wraps. */
function markText(piece: ReactNode): unknown {
  return markOf(piece).props.children;
}

const TEXT = "abcdef";

describe("renderHighlighted", () => {
  it("returns the plain string, not an array, when there is nothing to highlight", () => {
    expect(renderHighlighted(TEXT, [])).toBe(TEXT);
    expect(renderHighlighted("", [])).toBe("");
  });

  it("wraps a leading range and leaves the tail as plain text", () => {
    const pieces = piecesOf(renderHighlighted(TEXT, [[0, 3]]));
    expect(pieces).toHaveLength(2);
    expect(markText(pieces[0])).toBe("abc");
    expect(pieces[1]).toBe("def");
  });

  it("emits the text before, inside and after an interior range", () => {
    const pieces = piecesOf(renderHighlighted(TEXT, [[2, 4]]));
    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toBe("ab");
    expect(markText(pieces[1])).toBe("cd");
    expect(pieces[2]).toBe("ef");
  });

  it("keys each mark by its own bounds, so several marks are stable siblings", () => {
    const pieces = piecesOf(
      renderHighlighted(TEXT, [
        [0, 2],
        [3, 5],
      ]),
    );
    expect(pieces).toHaveLength(4);
    expect(markText(pieces[0])).toBe("ab");
    expect(pieces[1]).toBe("c");
    expect(markText(pieces[2])).toBe("de");
    expect(pieces[3]).toBe("f");
    expect([markOf(pieces[0]).key, markOf(pieces[2]).key]).toEqual(["0-2", "3-5"]);
  });

  it("clamps a range that runs past the end of the text", () => {
    const pieces = piecesOf(renderHighlighted(TEXT, [[3, 999]]));
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toBe("abc");
    expect(markText(pieces[1])).toBe("def");
  });

  it("clamps a negative start rather than slicing from the end", () => {
    const pieces = piecesOf(renderHighlighted(TEXT, [[-5, 3]]));
    expect(pieces).toHaveLength(2);
    expect(markText(pieces[0])).toBe("abc");
    expect(pieces[1]).toBe("def");
  });

  it("marks nothing for a range wholly past the end, and still returns the whole text", () => {
    const pieces = piecesOf(renderHighlighted(TEXT, [[10, 20]]));
    expect(pieces).toEqual([TEXT]);
  });

  it("skips an overlapping range instead of re-rendering consumed text", () => {
    const pieces = piecesOf(
      renderHighlighted(TEXT, [
        [0, 3],
        [1, 4],
      ]),
    );
    expect(pieces).toHaveLength(2);
    expect(markText(pieces[0])).toBe("abc");
    expect(pieces[1]).toBe("def");
  });

  it("skips a backward range — the cursor never moves left", () => {
    const pieces = piecesOf(
      renderHighlighted(TEXT, [
        [3, 5],
        [0, 2],
      ]),
    );
    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toBe("abc");
    expect(markText(pieces[1])).toBe("de");
    expect(pieces[2]).toBe("f");
  });

  it("skips an exact duplicate range, so a key can never repeat", () => {
    const pieces = piecesOf(
      renderHighlighted(TEXT, [
        [0, 3],
        [0, 3],
      ]),
    );
    expect(pieces).toHaveLength(2);
    expect(markText(pieces[0])).toBe("abc");
    expect(pieces[1]).toBe("def");
  });

  it("emits no mark for an empty range, splitting the text in two plain pieces", () => {
    // CURRENT BEHAVIOUR: an empty range contributes no `<mark>` but still cuts
    // the surrounding text at that point. React renders the two adjacent
    // strings identically to one, so this is invisible — pinned because the
    // piece COUNT is what a future change would silently alter.
    const pieces = piecesOf(renderHighlighted(TEXT, [[2, 2]]));
    expect(pieces).toEqual(["ab", "cdef"]);
  });

  it("renders a range covering the whole text as one mark and nothing else", () => {
    const pieces = piecesOf(renderHighlighted(TEXT, [[0, TEXT.length]]));
    expect(pieces).toHaveLength(1);
    expect(markText(pieces[0])).toBe(TEXT);
  });

  it("accepts the ranges core actually produces, untouched", () => {
    const ranges: readonly SearchHighlight[] = [
      [0, 5],
      [6, 8],
    ];
    const pieces = piecesOf(renderHighlighted("Ispit iz matematike", ranges));
    expect(markText(pieces[0])).toBe("Ispit");
    expect(pieces[1]).toBe(" ");
    expect(markText(pieces[2])).toBe("iz");
    expect(pieces[3]).toBe(" matematike");
  });
});

// --- constants ----------------------------------------------------------------

describe("SEARCH_DEBOUNCE_MS", () => {
  it("is a positive, sub-second delay — both surfaces read the same one", () => {
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(SEARCH_DEBOUNCE_MS).toBeLessThan(1000);
  });
});
