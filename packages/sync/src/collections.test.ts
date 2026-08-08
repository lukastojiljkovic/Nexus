import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_COLLECTIONS,
  OPEN_QUESTIONS,
  SYNC_MAP,
  classify,
  collections,
  parentFields,
} from "./collections.js";

describe("the sync map", () => {
  it("classifies every table exactly once", () => {
    const tables = SYNC_MAP.map((entry) => entry.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("explains every classification — an unexplained one is a rumour (DC-07)", () => {
    for (const entry of SYNC_MAP) {
      expect({ table: entry.table, sentence: entry.why.endsWith(".") && entry.why.length > 20 })
        .toEqual({ table: entry.table, sentence: true });
    }
  });

  it("explains every JUDGEMENT at length — the obvious cases may be brief, these may not", () => {
    // „A deck is named, opened and edited" is a complete reason and does not
    // need to be longer. What needs a paragraph is anything a reader would not
    // have guessed: a row demoted to a field of its parent, a table that syncs
    // nothing at all, and the one collection that is not a field map. Those are
    // the entries somebody will one day want to overturn, and they must find
    // the argument here rather than have to reconstruct it.
    for (const entry of SYNC_MAP) {
      const isJudgement =
        entry.kind !== "collection" || entry.shape === "updates";
      if (!isJudgement) continue;
      expect({ table: entry.table, argued: entry.why.length >= 80 }).toEqual({
        table: entry.table,
        argued: true,
      });
    }
  });

  it("points every parent-field at a table that is itself a collection", () => {
    for (const entry of parentFields()) {
      const parent = classify(entry.parent);
      expect({ table: entry.table, parentKind: parent?.kind }).toEqual({
        table: entry.table,
        parentKind: "collection",
      });
    }
  });

  it("points every derived table at something that does sync", () => {
    for (const entry of SYNC_MAP) {
      if (entry.kind !== "derived") continue;
      const source = classify(entry.from);
      expect({ table: entry.table, sourceKind: source?.kind }).toEqual({
        table: entry.table,
        sourceKind: "collection",
      });
    }
  });

  it("uses the update-log shape for exactly one collection, and it is the note body", () => {
    const logs = collections().filter((entry) => entry.shape === "updates");
    expect(logs.map((entry) => entry.table)).toEqual(["note_updates"]);
  });

  it("keeps every attachment collection in the map as a collection", () => {
    // They carry bytes, and the bytes travel a different transport from the
    // metadata — so an attachment is its own object on BOTH paths or neither.
    for (const table of ATTACHMENT_COLLECTIONS) {
      expect({ table, kind: classify(table)?.kind }).toEqual({ table, kind: "collection" });
    }
  });

  it("carries no device-local or sealed table", () => {
    // Absence IS the classification (see the module header). Naming them here
    // makes that a test rather than a thing a reader has to notice.
    for (const table of [
      "backup_settings",
      "search_history",
      "meta",
      "profiles",
      "private_notes",
      "private_note_versions",
      "private_settings",
      "search_entries",
      "search_fts",
    ]) {
      expect({ table, classified: classify(table) !== undefined }).toEqual({
        table,
        classified: false,
      });
    }
  });

  it("still has its open questions, and they are specific", () => {
    // A decision that quietly disappears from a list nobody re-reads is exactly
    // the class ADR-082 opened. When one of these is answered it is deleted
    // deliberately, and this test is what makes that a deliberate act.
    expect(OPEN_QUESTIONS.length).toBeGreaterThan(0);
    for (const question of OPEN_QUESTIONS) {
      expect(question.length).toBeGreaterThan(80);
    }
  });
});

describe("classify", () => {
  it("answers for a table it carries and undefined for one it does not", () => {
    expect(classify("tasks")?.kind).toBe("collection");
    expect(classify("task_tag_links")?.kind).toBe("parent-field");
    expect(classify("note_snapshots")?.kind).toBe("derived");
    expect(classify("nothing_of_the_sort")).toBeUndefined();
  });
});
