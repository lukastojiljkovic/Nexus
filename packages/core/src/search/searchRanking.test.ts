import { describe, expect, it } from "vitest";
import { foldSearchText } from "./searchText.js";
import type { ParsedSearchQuery } from "./searchQuery.js";
import {
  KIND_PRIOR,
  rankSearchResults,
  RECENCY_DECAY_DAYS,
  RECENCY_WEIGHT,
  RELEVANCE_WEIGHT,
  TITLE_EXACT_BOOST,
  TITLE_PREFIX_BOOST,
  type SearchHit,
} from "./searchRanking.js";

const NOW = "2026-07-26T00:00:00.000Z";

const emptyQuery: ParsedSearchQuery = {
  kinds: [],
  terms: [],
  tags: [],
  due: null,
  commandsOnly: false,
  text: "",
  prefixLast: true,
};

function makeHit(overrides: Partial<SearchHit> & Pick<SearchHit, "entityId">): SearchHit {
  return {
    kind: "note",
    parentId: null,
    title: "Naslov",
    body: "Telo beleske.",
    contextDate: null,
    updatedAt: NOW,
    bm25: -1,
    ...overrides,
  };
}

describe("rankSearchResults — relevance normalization", () => {
  it("gives a single hit full relevance regardless of its bm25 magnitude", () => {
    const [ranked] = rankSearchResults([makeHit({ entityId: "a", bm25: -2e-6 })], {
      now: NOW,
      query: emptyQuery,
    });
    expect(ranked).toBeDefined();
    // With one hit min===max, so relevance is fixed at 1 — score is recency + kindPrior only beyond that.
    expect(ranked!.score).toBeGreaterThan(0);
  });

  it("ranks the strongest bm25 match first among several, all else equal", () => {
    const hits: SearchHit[] = [
      makeHit({ entityId: "weak", bm25: -0.5 }),
      makeHit({ entityId: "strong", bm25: -5 }),
      makeHit({ entityId: "mid", bm25: -2 }),
    ];
    const ranked = rankSearchResults(hits, { now: NOW, query: emptyQuery });
    expect(ranked.map((h) => h.entityId)).toEqual(["strong", "mid", "weak"]);
  });
});

describe("rankSearchResults — recency can outrank a weaker-but-fresher gap", () => {
  it("lets a much newer, weaker match outrank an older, modestly-better one", () => {
    const hits: SearchHit[] = [
      // Anchor: clearly the best bm25, stretches the normalization range so
      // "older" and "fresher" below land close together in relevance.
      makeHit({ entityId: "anchor", bm25: -20, updatedAt: NOW }),
      makeHit({ entityId: "older", bm25: -5, updatedAt: "2026-06-26T00:00:00.000Z" }), // 30 days old
      makeHit({ entityId: "fresher", bm25: -4, updatedAt: NOW }), // 0 days old
    ];
    const ranked = rankSearchResults(hits, { now: NOW, query: emptyQuery });
    const order = ranked.map((h) => h.entityId);
    expect(order[0]).toBe("anchor");
    expect(order.indexOf("fresher")).toBeLessThan(order.indexOf("older"));
  });
});

describe("rankSearchResults — NaN guards", () => {
  it("contributes zero recency instead of NaN for an unparseable updatedAt", () => {
    const [ranked] = rankSearchResults([makeHit({ entityId: "a", updatedAt: "not-a-date" })], {
      now: NOW,
      query: emptyQuery,
    });
    expect(ranked).toBeDefined();
    expect(Number.isNaN(ranked!.score)).toBe(false);
  });

  it("contributes zero recency instead of NaN for an unparseable 'now'", () => {
    const [ranked] = rankSearchResults([makeHit({ entityId: "a" })], {
      now: "not-a-date",
      query: emptyQuery,
    });
    expect(ranked).toBeDefined();
    expect(Number.isNaN(ranked!.score)).toBe(false);
  });

  it("clamps a future updatedAt to zero age rather than a negative one", () => {
    const [ranked] = rankSearchResults(
      [makeHit({ entityId: "a", updatedAt: "2026-08-26T00:00:00.000Z" })],
      { now: NOW, query: emptyQuery },
    );
    expect(ranked).toBeDefined();
    expect(Number.isNaN(ranked!.score)).toBe(false);
    // Clamped age 0 gives the maximum possible recency contribution.
    expect(ranked!.score).toBeCloseTo(RELEVANCE_WEIGHT + RECENCY_WEIGHT + KIND_PRIOR.note, 5);
  });
});

describe("rankSearchResults — title boosts", () => {
  it("ranks an exact title match above a prefix match above no match", () => {
    const title = "Prijava na ispit";
    const query: ParsedSearchQuery = { ...emptyQuery, text: foldSearchText(title) };
    const hits: SearchHit[] = [
      makeHit({ entityId: "none", title: "Sasvim druga stvar" }),
      makeHit({ entityId: "prefix", title: `${title} dodatno` }),
      makeHit({ entityId: "exact", title }),
    ];
    const ranked = rankSearchResults(hits, { now: NOW, query });
    expect(ranked.map((h) => h.entityId)).toEqual(["exact", "prefix", "none"]);
  });

  it("skips the title boost entirely for an empty query", () => {
    const [ranked] = rankSearchResults([makeHit({ entityId: "a", title: "Bilo šta" })], {
      now: NOW,
      query: emptyQuery,
    });
    expect(ranked).toBeDefined();
    expect(ranked!.score).toBeCloseTo(RELEVANCE_WEIGHT + RECENCY_WEIGHT + KIND_PRIOR.note, 5);
  });

  it("TITLE_EXACT_BOOST is strictly greater than TITLE_PREFIX_BOOST", () => {
    expect(TITLE_EXACT_BOOST).toBeGreaterThan(TITLE_PREFIX_BOOST);
  });
});

describe("rankSearchResults — kind prior", () => {
  it("orders note, task, event, document, subject, exam, deck, card, attachment strictly descending", () => {
    const order = [
      "note",
      "task",
      "event",
      "document",
      "subject",
      "exam",
      "deck",
      "card",
      "attachment",
    ] as const;
    for (let i = 1; i < order.length; i++) {
      const prevKind = order[i - 1]!;
      const kind = order[i]!;
      expect(KIND_PRIOR[prevKind]).toBeGreaterThan(KIND_PRIOR[kind]);
    }
  });

  it("breaks a tie between two otherwise-identical hits purely by kind prior", () => {
    const hits: SearchHit[] = [
      makeHit({ entityId: "a", kind: "attachment" }),
      makeHit({ entityId: "b", kind: "note" }),
    ];
    const ranked = rankSearchResults(hits, { now: NOW, query: emptyQuery });
    expect(ranked.map((h) => h.entityId)).toEqual(["b", "a"]);
  });
});

describe("rankSearchResults — determinism and purity", () => {
  it("breaks a full tie by updatedAt descending, then entityId ascending", () => {
    const hits: SearchHit[] = [
      makeHit({ entityId: "z", updatedAt: "2026-07-01T00:00:00.000Z" }),
      makeHit({ entityId: "a", updatedAt: "2026-07-01T00:00:00.000Z" }),
      makeHit({ entityId: "m", updatedAt: "2026-07-10T00:00:00.000Z" }),
    ];
    const ranked = rankSearchResults(hits, { now: NOW, query: emptyQuery });
    // "m" is newer so it wins outright; "a" then "z" tie-break by entityId.
    expect(ranked.map((h) => h.entityId)).toEqual(["m", "a", "z"]);
  });

  it("does not mutate the input array or its hit objects", () => {
    const hits: SearchHit[] = [makeHit({ entityId: "b" }), makeHit({ entityId: "a" })];
    const snapshot = hits.map((h) => ({ ...h }));
    rankSearchResults(hits, { now: NOW, query: emptyQuery });
    expect(hits).toEqual(snapshot);
    expect(hits.map((h) => h.entityId)).toEqual(["b", "a"]);
    expect((hits[0] as unknown as Record<string, unknown>)["score"]).toBeUndefined();
  });

  it("returns a new array, not the same reference", () => {
    const hits: SearchHit[] = [makeHit({ entityId: "a" })];
    const ranked = rankSearchResults(hits, { now: NOW, query: emptyQuery });
    expect(ranked).not.toBe(hits);
  });
});

// Pins the decay's shape, which the constant's name alone cannot: at an age of
// exactly RECENCY_DECAY_DAYS the boost is 1/e (~0.368) of its peak, not a half.
describe("rankSearchResults — recency decay shape", () => {
  it("decays recency by exactly 1/e after RECENCY_DECAY_DAYS", () => {
    const oneDecayAgo = new Date(Date.parse(NOW) - RECENCY_DECAY_DAYS * 86_400_000).toISOString();
    const [fresh, old] = rankSearchResults(
      [
        makeHit({ entityId: "fresh", updatedAt: NOW, bm25: -1 }),
        makeHit({ entityId: "old", updatedAt: oneDecayAgo, bm25: -1 }),
      ],
      { now: NOW, query: emptyQuery },
    ).sort((a, b) => (a.entityId < b.entityId ? -1 : 1));
    expect(fresh).toBeDefined();
    expect(old).toBeDefined();
    const freshRecency = fresh!.score - RELEVANCE_WEIGHT - KIND_PRIOR.note;
    const oldRecency = old!.score - RELEVANCE_WEIGHT - KIND_PRIOR.note;
    expect(freshRecency).toBeCloseTo(RECENCY_WEIGHT, 5);
    expect(oldRecency).toBeCloseTo(RECENCY_WEIGHT * Math.exp(-1), 5);
  });
});
