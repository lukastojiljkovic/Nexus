import { describe, expect, it } from "vitest";
import { SEARCH_KINDS, type SearchKind } from "@nexus/core";
import { filterSearchHitsByModules, searchKindModule } from "./searchGate.js";

/**
 * The modules that own an indexed kind — the "everything on" set.
 *
 * It is exactly the image of `searchKindModule` rather than every registered module
 * (there are sixteen of those, most of which index nothing), because that is the
 * set this suite's question needs: „does a hit survive when its module is on".
 * `circuit`/`electronics` joined on 2026-09-22 with the tenth kind.
 */
const ALL_MODULES = new Set([
  "tasks",
  "calendar",
  "notes",
  "study",
  "electronics",
]);

function hit(kind: SearchKind): { kind: SearchKind } {
  return { kind };
}

describe("searchKindModule", () => {
  /**
   * The check the compiler used to make. Ownership was a `Record<SearchKind,
   * string>` until 2026-09-26, so a kind with no owner did not compile; it is
   * the manifests' `searchIndexers` now, and a manifest that forgets a kind is
   * well-typed. A kind nobody owns is a hit no flag can show — so the tenth kind
   * would have vanished from the palette with every gate green but this one.
   */
  it("finds an owner for every indexed kind in the shipping registry", () => {
    expect(SEARCH_KINDS.filter((kind) => searchKindModule(kind) === undefined)).toEqual([]);
  });

  it("maps each kind onto the module that owns its page", () => {
    expect(Object.fromEntries(SEARCH_KINDS.map((kind) => [kind, searchKindModule(kind)]))).toEqual({
      task: "tasks",
      event: "calendar",
      document: "calendar",
      note: "notes",
      subject: "study",
      exam: "study",
      deck: "study",
      card: "study",
      attachment: "notes",
      circuit: "electronics",
    });
  });
});

describe("filterSearchHitsByModules", () => {
  it("keeps everything while every module is enabled", () => {
    const hits = SEARCH_KINDS.map(hit);
    expect(filterSearchHitsByModules(hits, ALL_MODULES)).toEqual(hits);
  });

  it("drops subject/exam/deck/card when STUDY is off — the business-profile case", () => {
    const enabled = new Set([...ALL_MODULES].filter((id) => id !== "study"));
    const kept = filterSearchHitsByModules(SEARCH_KINDS.map(hit), enabled);
    expect(kept.map((entry) => entry.kind)).toEqual([
      "task",
      "event",
      "note",
      "document",
      "attachment",
      "circuit",
    ]);
  });

  it("drops notes AND attachments when NOTES is off — an attachment's parent is its note (migration 017 indexes note attachments only)", () => {
    const enabled = new Set([...ALL_MODULES].filter((id) => id !== "notes"));
    const kept = filterSearchHitsByModules(SEARCH_KINDS.map(hit), enabled);
    expect(kept.map((entry) => entry.kind)).toEqual([
      "task",
      "event",
      "document",
      "subject",
      "exam",
      "deck",
      "card",
      "circuit",
    ]);
  });

  it("drops circuits when ELEKTRONIKA is off — the newest module's rows obey the same gate", () => {
    const enabled = new Set([...ALL_MODULES].filter((id) => id !== "electronics"));
    const kept = filterSearchHitsByModules(SEARCH_KINDS.map(hit), enabled);
    expect(kept.map((entry) => entry.kind)).not.toContain("circuit");
    // And nothing else moved: a gate is per-kind, not a filter over the list.
    expect(kept).toHaveLength(SEARCH_KINDS.length - 1);
  });

  it("drops events and documents together when CALENDAR is off — documents live on the calendar page", () => {
    const enabled = new Set([...ALL_MODULES].filter((id) => id !== "calendar"));
    const kept = filterSearchHitsByModules(SEARCH_KINDS.map(hit), enabled);
    expect(kept.map((entry) => entry.kind)).not.toContain("event");
    expect(kept.map((entry) => entry.kind)).not.toContain("document");
  });

  it("returns a fresh array and never mutates its input", () => {
    const hits = [hit("task"), hit("deck")];
    const kept = filterSearchHitsByModules(hits, new Set(["tasks"]));
    expect(kept).toEqual([hit("task")]);
    expect(hits).toHaveLength(2);
  });
});
