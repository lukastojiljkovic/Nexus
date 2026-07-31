import { describe, expect, it } from "vitest";
import { SEARCH_KINDS, type SearchKind } from "@nexus/core";
import { SEARCH_KIND_MODULE, filterSearchHitsByModules } from "./searchGate.js";

/** Every v0 module id, as the registry registers them — the "everything on" set. */
const ALL_MODULES = new Set(["dashboard", "tasks", "calendar", "settings", "notes", "study"]);

function hit(kind: SearchKind): { kind: SearchKind } {
  return { kind };
}

describe("SEARCH_KIND_MODULE", () => {
  it("maps every indexed kind — the Record type enforces it at compile time, this pins it at run time", () => {
    expect(Object.keys(SEARCH_KIND_MODULE).sort()).toEqual([...SEARCH_KINDS].sort());
  });

  it("maps each kind onto the module that owns its page", () => {
    expect(SEARCH_KIND_MODULE).toEqual({
      task: "tasks",
      event: "calendar",
      document: "calendar",
      note: "notes",
      subject: "study",
      exam: "study",
      deck: "study",
      card: "study",
      attachment: "notes",
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
    ]);
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
