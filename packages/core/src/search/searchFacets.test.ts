import { describe, expect, it } from "vitest";
import type { SearchKind } from "./searchQuery.js";
import { MAX_TAG_FACETS, buildSearchTagFacets, countSearchKinds } from "./searchFacets.js";
import type { SearchFacetHit, TagFacetSource } from "./searchFacets.js";

/**
 * `searchFacets` is the pure half of the ADR-039 search page: it turns a hit
 * set plus the raw tag/link rows main already reads into the two facet rows
 * the page draws. No clock, no DOM, no database, no locale — the tie-break
 * below is deliberately codepoint order rather than a Serbian collator, since
 * core stays locale-free.
 */

function hit(kind: SearchKind, entityId: string): SearchFacetHit {
  return { kind, entityId };
}

describe("countSearchKinds", () => {
  it("counts each kind present, in SEARCH_KINDS order", () => {
    const counts = countSearchKinds([
      hit("note", "n1"),
      hit("task", "t1"),
      hit("note", "n2"),
      hit("task", "t2"),
      hit("task", "t3"),
    ]);

    // SEARCH_KINDS puts task before note, so the ordering is the schema's,
    // never "whichever kind happened to appear first".
    expect(counts).toEqual([
      { kind: "task", count: 3 },
      { kind: "note", count: 2 },
    ]);
  });

  it("omits kinds with no hits rather than reporting them as zero", () => {
    const counts = countSearchKinds([hit("exam", "e1")]);
    expect(counts).toEqual([{ kind: "exam", count: 1 }]);
  });

  it("returns an empty array for an empty hit set", () => {
    expect(countSearchKinds([])).toEqual([]);
  });
});

describe("buildSearchTagFacets", () => {
  const noteSource = (
    tags: Array<{ id: string; name: string }>,
    links: Array<{ entityId: string; tagId: string }>,
  ): TagFacetSource => ({ kind: "note", tags, links });
  const taskSource = (
    tags: Array<{ id: string; name: string }>,
    links: Array<{ entityId: string; tagId: string }>,
  ): TagFacetSource => ({ kind: "task", tags, links });

  it("counts the hits carrying each tag", () => {
    const facets = buildSearchTagFacets(
      [hit("note", "n1"), hit("note", "n2"), hit("note", "n3")],
      [
        noteSource(
          [
            { id: "a", name: "Matematika" },
            { id: "b", name: "Fizika" },
          ],
          [
            { entityId: "n1", tagId: "a" },
            { entityId: "n2", tagId: "a" },
            { entityId: "n3", tagId: "b" },
          ],
        ),
      ],
    );

    expect(facets).toEqual([
      { name: "Matematika", token: "matematika", count: 2 },
      { name: "Fizika", token: "fizika", count: 1 },
    ]);
  });

  it("ignores links to entities that are not in the hit set", () => {
    const facets = buildSearchTagFacets(
      [hit("note", "n1")],
      [
        noteSource(
          [{ id: "a", name: "Matematika" }],
          [
            { entityId: "n1", tagId: "a" },
            { entityId: "n9", tagId: "a" }, // not a hit — must not be counted
          ],
        ),
      ],
    );

    expect(facets).toEqual([{ name: "Matematika", token: "matematika", count: 1 }]);
  });

  it("scopes links to their source's kind, so a task id never matches a note hit", () => {
    // Both entity ids are the literal string "x": without the kind scoping,
    // the note link would find the task hit and double-count.
    const facets = buildSearchTagFacets(
      [hit("task", "x")],
      [
        noteSource([{ id: "a", name: "Matematika" }], [{ entityId: "x", tagId: "a" }]),
        taskSource([{ id: "b", name: "Fizika" }], [{ entityId: "x", tagId: "b" }]),
      ],
    );

    expect(facets).toEqual([{ name: "Fizika", token: "fizika", count: 1 }]);
  });

  it("merges note and task tags that fold to one token, keeping the first spelling", () => {
    const facets = buildSearchTagFacets(
      [hit("note", "n1"), hit("task", "t1")],
      [
        noteSource([{ id: "a", name: "Matematika" }], [{ entityId: "n1", tagId: "a" }]),
        taskSource([{ id: "b", name: "MATEMATIKA" }], [{ entityId: "t1", tagId: "b" }]),
      ],
    );

    expect(facets).toEqual([{ name: "Matematika", token: "matematika", count: 2 }]);
  });

  it("counts a hit once per facet even when it carries two tags folding alike", () => {
    const facets = buildSearchTagFacets(
      [hit("note", "n1")],
      [
        noteSource(
          [
            { id: "a", name: "Matematika" },
            { id: "b", name: "MATEMATIKA" },
          ],
          [
            { entityId: "n1", tagId: "a" },
            { entityId: "n1", tagId: "b" },
          ],
        ),
      ],
    );

    expect(facets).toEqual([{ name: "Matematika", token: "matematika", count: 1 }]);
  });

  it("breaks count ties by token codepoint order, not by a Serbian collator", () => {
    // Under sr-Latn collation "č" sorts right after "c", so a locale-aware
    // sort would put "cas" then "casovi"... this asserts the plain codepoint
    // rule instead: identical counts, ascending token.
    const facets = buildSearchTagFacets(
      [hit("note", "n1"), hit("note", "n2"), hit("note", "n3")],
      [
        noteSource(
          [
            { id: "a", name: "Zadaci" },
            { id: "b", name: "Ispiti" },
            { id: "c", name: "Alati" },
          ],
          [
            { entityId: "n1", tagId: "a" },
            { entityId: "n2", tagId: "b" },
            { entityId: "n3", tagId: "c" },
          ],
        ),
      ],
    );

    expect(facets.map((facet) => facet.token)).toEqual(["alati", "ispiti", "zadaci"]);
  });

  it("keeps only the top MAX_TAG_FACETS by count", () => {
    const tags = Array.from({ length: MAX_TAG_FACETS + 4 }, (_unused, index) => ({
      id: `tag-${index}`,
      name: `Tag${index}`,
    }));
    // Tag i is carried by (i + 1) hits, so the highest-numbered tags win and
    // the lowest-numbered ones fall off the end.
    const hits: SearchFacetHit[] = [];
    const links: Array<{ entityId: string; tagId: string }> = [];
    for (const [index, tag] of tags.entries()) {
      for (let n = 0; n <= index; n++) {
        const entityId = `n-${index}-${n}`;
        hits.push(hit("note", entityId));
        links.push({ entityId, tagId: tag.id });
      }
    }

    const facets = buildSearchTagFacets(hits, [noteSource(tags, links)]);

    expect(facets).toHaveLength(MAX_TAG_FACETS);
    expect(facets[0]?.name).toBe(`Tag${tags.length - 1}`);
    expect(facets.map((facet) => facet.count)).toEqual(
      Array.from({ length: MAX_TAG_FACETS }, (_unused, i) => tags.length - i),
    );
  });

  it("drops a tag no hit carries", () => {
    const facets = buildSearchTagFacets(
      [hit("note", "n1")],
      [noteSource([{ id: "a", name: "Nekorišćen" }], [])],
    );
    expect(facets).toEqual([]);
  });

  it("drops a tag whose name folds to an empty token", () => {
    // A whitespace-only name folds away entirely under `foldSearchTag`; it
    // could never be spliced into a query as `#`, so offering it as a chip
    // would produce a facet that cannot be applied. (Punctuation survives
    // folding — `#c++` is a real, typable filter — so only nothing-left names
    // are dropped.)
    const facets = buildSearchTagFacets(
      [hit("note", "n1")],
      [noteSource([{ id: "a", name: "   " }], [{ entityId: "n1", tagId: "a" }])],
    );
    expect(facets).toEqual([]);
  });

  it("ignores a link pointing at a tag id that does not exist", () => {
    const facets = buildSearchTagFacets(
      [hit("note", "n1")],
      [noteSource([{ id: "a", name: "Matematika" }], [{ entityId: "n1", tagId: "ghost" }])],
    );
    expect(facets).toEqual([]);
  });

  it("returns an empty array when there are no hits at all", () => {
    const facets = buildSearchTagFacets(
      [],
      [noteSource([{ id: "a", name: "Matematika" }], [{ entityId: "n1", tagId: "a" }])],
    );
    expect(facets).toEqual([]);
  });
});

