import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, openDatabase, type NexusDatabase } from "../index.js";

/**
 * Migration 93's own suite: what the assistant's knowledge tables ARE, once the
 * schema is in place.
 *
 * The interesting half is the FTS5 maintenance, because that is the half written
 * in SQL and therefore the half no TypeScript signature describes: the
 * contentless index is filled by a trigger that folds through `nx_fold`, an
 * update deletes-then-inserts, and a delete takes the row out of the shadow.
 * Each of those is asserted here against a real database rather than assumed from
 * reading the trigger.
 */

/** The newest schema version this build knows - derived, never spelled out, so the maintainer's renumbering does not touch this file. */
const LATEST_VERSION = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0);
const NOW = "2026-10-10T10:00:00.000Z";

let db: NexusDatabase;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-knowledge-migration-"));
  db = openDatabase({ path: join(dir, "fresh.db") });
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES ('p1', 'personal', 'P', ?)")
    .run(NOW);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function insertChunk(id: number, text: string, title = "Naslov", locator: string | null = null): void {
  db.raw
    .prepare(
      `INSERT INTO knowledge_chunks
         (id, profile_id, kind, source_id, locale, safety, title, keywords, locator, ordinal, text)
       VALUES (?, 'p1', 'note', ?, '', 0, ?, '', ?, 0, ?)`,
    )
    .run(id, `s${String(id)}`, title, locator, text);
}

describe("migration 093 - the assistant's knowledge base", () => {
  it("creates the four tables and stamps the newest schema version", () => {
    const tables = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'knowledge%'")
        .all() as { name: string }[]
    ).map((row) => row.name);

    expect(tables.sort()).toEqual(
      [
        "knowledge_chunks",
        "knowledge_cursors",
        "knowledge_fts",
        "knowledge_fts_config",
        "knowledge_fts_data",
        "knowledge_fts_docsize",
        "knowledge_fts_idx",
        "knowledge_vectors",
      ].sort(),
    );
    expect(db.raw.pragma("user_version", { simple: true })).toBe(LATEST_VERSION);
  });

  it("folds the haystack through nx_fold, so a diacritic word is found without its diacritics", () => {
    insertChunk(1, "Beleške Đorđa o Čačku i Šapcu.");

    const byStroke = db.raw
      .prepare("SELECT rowid FROM knowledge_fts WHERE knowledge_fts MATCH ?")
      .get("djordja") as { rowid: number } | undefined;
    const byDiacritic = db.raw
      .prepare("SELECT rowid FROM knowledge_fts WHERE knowledge_fts MATCH ?")
      .get("cacku") as { rowid: number } | undefined;
    expect({ stroke: byStroke?.rowid, diacritic: byDiacritic?.rowid }).toEqual({
      stroke: 1,
      diacritic: 1,
    });

    // The title and the keywords are part of the haystack too, not only the passage.
    insertChunk(2, "DrugiTekst", "Podešavanja");
    const byTitle = db.raw
      .prepare("SELECT rowid FROM knowledge_fts WHERE knowledge_fts MATCH ?")
      .get("podesavanja") as { rowid: number } | undefined;
    expect(byTitle?.rowid).toBe(2);

    // A NULL locator must not make the whole haystack NULL: SQL's `||` propagates
    // NULL, and a NULL haystack tokenizes to nothing - the passage would be
    // inserted and unfindable, which is the one failure this trigger can have
    // that nothing else in the schema would notice.
    insertChunk(3, "Tekst bez odeljka.", "Bez naslova", null);
    const nullLocator = db.raw
      .prepare("SELECT rowid FROM knowledge_fts WHERE knowledge_fts MATCH ?")
      .get("odeljka") as { rowid: number } | undefined;
    expect(nullLocator?.rowid).toBe(3);

    // And a heading path is searchable too, which is what makes a section name a
    // signal the chunker can hand over without putting it in the passage's text.
    insertChunk(4, "Kratak tekst.", "Naslov", "Podesavanja > Podaci");
    const byLocator = db.raw
      .prepare("SELECT rowid FROM knowledge_fts WHERE knowledge_fts MATCH ? AND rowid = 4")
      .get("podaci") as { rowid: number } | undefined;
    expect(byLocator?.rowid).toBe(4);
  });

  it("re-folds a row when its text is updated - the contentless delete-then-insert", () => {
    insertChunk(1, "prvobitni tekst");
    db.raw.prepare("UPDATE knowledge_chunks SET text = ? WHERE id = 1").run("izmenjeni tekst");

    const old = db.raw
      .prepare("SELECT count(*) AS n FROM knowledge_fts WHERE knowledge_fts MATCH ?")
      .get("prvobitni") as { n: number };
    const fresh = db.raw
      .prepare("SELECT count(*) AS n FROM knowledge_fts WHERE knowledge_fts MATCH ?")
      .get("izmenjeni") as { n: number };
    expect({ old: old.n, fresh: fresh.n }).toEqual({ old: 0, fresh: 1 });
  });

  it("takes the row out of the shadow index when the passage is deleted", () => {
    insertChunk(1, "obrisano uskoro");
    db.raw.prepare("DELETE FROM knowledge_chunks WHERE id = 1").run();

    const remaining = db.raw
      .prepare("SELECT count(*) AS n FROM knowledge_fts WHERE knowledge_fts MATCH ?")
      .get("obrisano") as { n: number };
    // A bare count over a contentless FTS5 table still visits every row, so this
    // is the index's own answer and not a join's.
    expect(remaining.n).toBe(0);
  });

  it("cascades a profile's chunks, vectors and cursors away with the profile", () => {
    insertChunk(1, "tekst");
    db.raw
      .prepare("INSERT INTO knowledge_vectors (chunk_id, model_id, dimensions, vector) VALUES (1, 'm', 2, ?)")
      .run(Buffer.from([0, 0, 128, 63, 0, 0, 0, 64]));
    db.raw
      .prepare("INSERT INTO knowledge_cursors (profile_id, source, marker) VALUES ('p1', 'note', 'x')")
      .run();

    db.raw.prepare("DELETE FROM profiles WHERE id = 'p1'").run();

    for (const table of ["knowledge_chunks", "knowledge_vectors", "knowledge_cursors"]) {
      const { n } = db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      expect({ table, n }).toEqual({ table, n: 0 });
    }
    const { n } = db.raw
      .prepare("SELECT count(*) AS n FROM knowledge_fts WHERE knowledge_fts MATCH ?")
      .get("tekst") as { n: number };
    expect(n).toBe(0);
  });

  it("takes a passage's vector with the passage, and keeps one vector per passage", () => {
    insertChunk(1, "tekst");
    const insert = db.raw.prepare(
      `INSERT INTO knowledge_vectors (chunk_id, model_id, dimensions, vector) VALUES (1, ?, 4, ?)
       ON CONFLICT (chunk_id) DO UPDATE SET model_id = excluded.model_id,
         dimensions = excluded.dimensions, vector = excluded.vector`,
    );
    insert.run("model-a", Buffer.alloc(16));
    insert.run("model-b", Buffer.alloc(16));

    const rows = db.raw
      .prepare("SELECT model_id FROM knowledge_vectors WHERE chunk_id = 1")
      .all() as { model_id: string }[];
    expect(rows).toEqual([{ model_id: "model-b" }]);

    db.raw.prepare("DELETE FROM knowledge_chunks WHERE id = 1").run();
    const after = db.raw.prepare("SELECT count(*) AS n FROM knowledge_vectors").get() as { n: number };
    expect(after.n).toBe(0);
  });

  it("refuses a negative vector width and a safety flag that is not 0 or 1", () => {
    expect(() =>
      db.raw
        .prepare("INSERT INTO knowledge_vectors (chunk_id, model_id, dimensions, vector) VALUES (1, 'm', 0, ?)")
        .run(Buffer.alloc(4)),
    ).toThrow();
    expect(() => insertChunk(9, "x")).not.toThrow();
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO knowledge_chunks (id, profile_id, kind, source_id, locale, safety, title, keywords, ordinal, text)
           VALUES (10, 'p1', 'note', 's10', '', 2, 't', '', 0, 'x')`,
        )
        .run(),
    ).toThrow();
  });
});
