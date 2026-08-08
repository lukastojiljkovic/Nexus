import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYNC_MAP, classify, parentFields } from "@nexus/sync";
import { openDatabase, RESTORE_WIPE_TABLES } from "../index.js";
import type { NexusDatabase } from "../index.js";

/**
 * The guard that makes `@nexus/sync`'s collection map a DERIVATION rather than a
 * second opinion.
 *
 * ADR-082's first decision was that the set of user content is derived from
 * `RESTORE_WIPE_TABLES` and never written out again — because a table added in
 * six months would be caught by the restore guard and sail straight past sync,
 * and nothing would look wrong (DC-07, DC-08). The map itself cannot live beside
 * that list: `@nexus/db` is SQLite and therefore Node-only, while the map has to
 * be readable in a browser tab. So the map is declared portably in
 * `@nexus/sync`, and this file is what keeps it honest — it reads the real
 * schema and the real list and fails until the two agree.
 *
 * It goes further than "the tables match", because a table list is the easy
 * half. The map claims a SHAPE for every table it calls a field of its parent,
 * and those claims are checked against the columns that actually exist: a
 * classification nothing can falsify is an opinion, not a decision.
 */

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-syncmap-"));
  db = openDatabase({ path: join(dir, "map.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

function columns(table: string): ColumnInfo[] {
  return db.raw.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

/**
 * A column that carries the user's DATA, as opposed to one that only says which
 * rows this row joins or when it was written. Anything ending `_id`, the primary
 * key itself, and the two bookkeeping timestamps are structure; everything else
 * is something a person typed or chose.
 */
function dataColumns(table: string): string[] {
  return columns(table)
    .filter((column) => column.pk === 0)
    .map((column) => column.name)
    .filter((name) => !name.endsWith("_id") && name !== "id")
    .filter((name) => name !== "created_at" && name !== "updated_at");
}

describe("the sync map against the real schema", () => {
  it("classifies exactly the tables RESTORE_WIPE_TABLES calls content — no more, no fewer", () => {
    const mapped = new Set(SYNC_MAP.map((entry) => entry.table));
    const content = new Set<string>(RESTORE_WIPE_TABLES);

    // Reported as two named lists rather than a set comparison, because the
    // whole point of this test is that its failure tells you what to do.
    const missing = [...content].filter((table) => !mapped.has(table));
    const extra = [...mapped].filter((table) => !content.has(table));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("names only tables that exist", () => {
    const live = new Set(
      (
        db.raw
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((row) => row.name),
    );
    const ghosts = SYNC_MAP.map((entry) => entry.table).filter((table) => !live.has(table));
    expect(ghosts).toEqual([]);
  });

  it("gives every parent-field a parent column that is really there, and really NOT NULL", () => {
    for (const entry of parentFields()) {
      const column = columns(entry.table).find((each) => each.name === entry.parentColumn);
      // NOT NULL because a row that can exist without its parent is not a field
      // OF that parent — it is an orphan waiting to happen.
      expect({ table: entry.table, column: column?.name, notnull: column?.notnull }).toEqual({
        table: entry.table,
        column: entry.parentColumn,
        notnull: 1,
      });
    }
  });

  it("proves every table it calls a join really carries no data of its own", () => {
    for (const entry of parentFields()) {
      if (entry.form !== "join") continue;
      // If this fails, the table has grown a column somebody types into — and a
      // row with data of its own is a row a user can point at, which by ADR-082
      // §2 makes it a collection rather than a field.
      expect({ table: entry.table, data: dataColumns(entry.table) }).toEqual({
        table: entry.table,
        data: [],
      });
    }
  });

  it("proves every table it calls an ordered child really is an array inside its parent", () => {
    for (const entry of parentFields()) {
      if (entry.form !== "ordered-child") continue;
      const position = columns(entry.table).find((each) => each.name === "position");
      // An integer `position`, deliberately NOT the fractional rank migration 062
      // gave the hand-orderable scopes: this one indexes its parent's array, and
      // the array is replaced whole, so there are never two writers to merge.
      expect({
        table: entry.table,
        type: position?.type,
        notnull: position?.notnull,
      }).toEqual({ table: entry.table, type: "INTEGER", notnull: 1 });
    }
  });

  it("proves no table it calls a collection is secretly a join row", () => {
    const jointish = SYNC_MAP.filter((entry) => entry.kind === "collection")
      .map((entry) => entry.table)
      .filter((table) => dataColumns(table).length === 0);
    // A row that is nothing but a pair of ids has no identity of its own to
    // merge, and syncing it as an object is how orphans are made.
    expect(jointish).toEqual([]);
  });

  it("leaves every device-local and sealed table out, which is how they stay off the wire", () => {
    for (const table of [
      "backup_settings",
      "search_history",
      "meta",
      "profiles",
      "private_notes",
      "private_note_versions",
      "private_settings",
    ]) {
      expect({ table, classified: classify(table) !== undefined }).toEqual({
        table,
        classified: false,
      });
    }
  });
});
