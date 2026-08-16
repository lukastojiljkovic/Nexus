import { describe, expect, it } from "vitest";
import { applyEdit, emptyRowState, hlcSend, hlcZero, markDeleted } from "@nexus/sync-crypto";
import type { Hlc, RowState } from "@nexus/sync-crypto";
import { classify, collections } from "./collections.js";
import type { SyncCollection } from "./collections.js";
import { parentIdOf, splitObjectId, UNIT_SEPARATOR } from "./objectId.js";

/**
 * The separator is written out by hand here rather than imported, deliberately.
 * A test that asks the module what the separator is cannot notice the module
 * changing it, and this byte is on the wire and inside migration 063's SQL.
 */
const US = String.fromCharCode(31);

const NOW: Hlc = hlcSend(hlcZero("device-a"), 1_800_000_000_000);

function collection(table: string): SyncCollection {
  const entry = classify(table);
  if (entry?.kind !== "collection") throw new Error(`${table} is not a collection`);
  return entry;
}

function stateWith(fields: Record<string, string>): RowState {
  return applyEdit(emptyRowState(NOW), fields, NOW);
}

describe("the separator", () => {
  it("is the ASCII unit separator, the byte migration 063's triggers join on", () => {
    expect(UNIT_SEPARATOR).toBe(US);
    expect(UNIT_SEPARATOR.charCodeAt(0)).toBe(31);
  });
});

describe("taking an object id apart", () => {
  it("hands back the id itself when one column identifies the object", () => {
    expect(splitObjectId("01J000000000000000000000A", collection("tasks"))).toEqual([
      "01J000000000000000000000A",
    ]);
  });

  it("splits a natural key on the separator, in identity order", () => {
    const versions = collection("note_versions");
    expect(versions.identity).toEqual(["note_id", "covered_seq"]);
    expect(splitObjectId(`note-1${US}7`, versions)).toEqual(["note-1", "7"]);
  });

  it("hands back nothing for a per-profile singleton, whose id is the empty key", () => {
    const settings = collection("ntf_settings");
    expect(settings.identity).toEqual([]);
    expect(splitObjectId("", settings)).toEqual([]);
  });

  it("refuses an id with the wrong number of parts, loudly", () => {
    expect(() => splitObjectId("note-1", collection("note_versions"))).toThrow(
      /note_versions has 1 identity part/,
    );
    expect(() => splitObjectId(`a${US}b${US}c`, collection("note_versions"))).toThrow(/expected 2/);
  });
});

describe("the parent an object hangs off", () => {
  it("is null for a collection that reaches its profile directly", () => {
    const tasks = collection("tasks");
    expect(tasks.profileVia).toBeUndefined();
    expect(parentIdOf(tasks, "01J000000000000000000000A", stateWith({ title: "Kupovina" }))).toBe(
      null,
    );
  });

  it("comes out of the fields when the parent key is an ordinary column", () => {
    const attachments = collection("note_attachments");
    const state = stateWith({ note_id: "note-1", file_name: "skica.png" });
    expect(parentIdOf(attachments, "att-1", state)).toBe("note-1");
  });

  it("THE TRAP: comes out of the object id when the parent key is part of the identity", () => {
    // `fieldColumns` subtracts the identity from the field map, so `note_id` is
    // not a field of a `note_versions` state and never will be. A derivation
    // that read the fields would answer `undefined` here — for two of the eight
    // parented collections, every time, and the hint would silently be null.
    const versions = collection("note_versions");
    const state = stateWith({ ciphertext_ref: "blob-9" });
    expect(state.fields["note_id"]).toBeUndefined();

    expect(parentIdOf(versions, `note-1${US}7`, state)).toBe("note-1");
  });

  it("survives the row being deleted, because a tombstone keeps its fields", () => {
    const attachments = collection("note_attachments");
    const state = markDeleted(stateWith({ note_id: "note-1", file_name: "skica.png" }), NOW);
    expect(state.deleted.value).toBe(true);

    expect(parentIdOf(attachments, "att-1", state)).toBe("note-1");
  });

  it("refuses a state that lost the parent key, rather than pushing a null hint", () => {
    const attachments = collection("note_attachments");
    expect(() => parentIdOf(attachments, "att-1", stateWith({ file_name: "skica.png" }))).toThrow(
      /note_attachments.*note_id/,
    );
  });

  it("refuses a parent key that is not a string", () => {
    const attachments = collection("note_attachments");
    const state = applyEdit(emptyRowState(NOW), { note_id: null }, NOW);
    expect(() => parentIdOf(attachments, "att-1", state)).toThrow(/note_attachments.*note_id/);
  });
});

describe("what the derivation assumes about the map", () => {
  it("answers for every parented collection there is, from whichever place holds the key", () => {
    const parented = collections().filter((entry) => entry.profileVia !== undefined);
    expect(parented).toHaveLength(8);

    for (const entry of parented) {
      const key = entry.profileVia!.key;
      const index = entry.identity.indexOf(key);
      const parts = entry.identity.map((column) => (column === key ? "parent-7" : "x"));
      const objectId = index === -1 ? "own-id" : parts.join(US);
      const state = index === -1 ? stateWith({ [key]: "parent-7" }) : stateWith({ other: "v" });

      expect(parentIdOf(entry, objectId, state), entry.table).toBe("parent-7");
    }
  });

  it("only names parents whose own object id is a single value", () => {
    // The derivation returns ONE value and calls it the parent's object id. That
    // is only true while every parent is identified by one column: the day a map
    // entry points at a composite-key parent, the id returned here would be half
    // of one, and the server's „give me this parent's children" query would join
    // on a prefix. This test is the derivation's precondition, checked.
    for (const entry of collections()) {
      const via = entry.profileVia;
      if (via === undefined) continue;
      const parent = classify(via.parent);
      expect(parent?.kind, `${entry.table} → ${via.parent}`).toBe("collection");
      expect((parent as SyncCollection).identity, `${entry.table} → ${via.parent}`).toHaveLength(1);
    }
  });

  it("names a key the collection really carries — in its identity or in its fields", () => {
    // The other half of the precondition: a `profileVia.key` that is neither an
    // identity column nor a syncable field would make the throw above fire on
    // every row of that table, forever. `fieldColumns` is what decides the
    // second case, and it subtracts `profile_id` and the derived columns.
    for (const entry of collections()) {
      const via = entry.profileVia;
      if (via === undefined) continue;
      expect(via.key, entry.table).not.toBe("profile_id");
      expect(["updated_at", "deleted_at"], entry.table).not.toContain(via.key);
    }
  });
});
