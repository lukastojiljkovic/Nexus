import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import type { NexusDatabase } from "@nexus/db";
import { KnowledgeStore } from "./store.js";
import { encodeVector } from "./vectors.js";
import { insertProfile, tempDatabase } from "./testFixtures.js";

/**
 * The one measurement the knowledge base owes: what a brute-force vector search
 * costs at the size a full profile can reach.
 *
 * Fifty thousand passages is the corpus this service is built to hold without a
 * vector index - a library of notes, tasks, events and attachment text on one
 * machine - and brute force is exactly what the design claims is affordable at
 * that size. The number is recorded in the report and in ADR-104 rather than only
 * asserted here, because a threshold without a measurement beside it is how a
 * bound stops describing anything.
 *
 * The vectors are 384 wide, which is what the small embedding models in the
 * runtime's catalogue produce, so the memory traffic is the real one and not a
 * toy. The seeding writes the same INSERT the store does, inside one transaction;
 * what is being measured is the SEARCH, and seeding through 50 000 separate
 * transactions would measure SQLite's commit path instead.
 */

const CHUNKS = 50_000;
const DIMENSIONS = 384;
const MODEL = "perf-embed";
/** The one chunk whose vector IS the query, so the result is a fact rather than a threshold. */
const MATCH_AT = 12_345;

let db: NexusDatabase;
let dir: string;

// Seeding 50 000 rows takes about 2.8 s alone on the maintainer's machine
// (measured 2026-10-10), and ran past vitest's 10 s hook default under the full
// suite's load; CI's four-core runner is slower still, hence the explicit budget.
beforeAll(() => {
  const created = tempDatabase();
  db = created.db;
  dir = created.dir;
  const profileId = insertProfile(db);

  const insertChunk = db.raw.prepare(
    `INSERT INTO knowledge_chunks
       (profile_id, kind, source_id, locale, safety, title, keywords, locator, ordinal, text)
     VALUES (?, 'note', ?, '', 0, 'Zapis', '', NULL, 0, ?)`,
  );
  const insertVector = db.raw.prepare(
    "INSERT INTO knowledge_vectors (chunk_id, model_id, dimensions, vector) VALUES (?, ?, ?, ?)",
  );

  const seed = db.raw.transaction(() => {
    for (let index = 1; index <= CHUNKS; index += 1) {
      const row = insertChunk.run(
        profileId,
        `s${String(index)}`,
        `Zapis broj ${String(index)} o svemu i svacemu.`,
      );
      const chunkId = Number(row.lastInsertRowid);

      const vector = new Float32Array(DIMENSIONS);
      if (index === MATCH_AT) {
        vector[0] = 1;
      } else {
        for (let at = 0; at < DIMENSIONS; at += 1) {
          vector[at] = ((index * 31 + at * 17) % 101) / 101 - 0.5;
        }
      }
      insertVector.run(chunkId, MODEL, DIMENSIONS, encodeVector(vector));
    }
  });
  seed();
}, 60_000);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("vector search over 50 000 passages", () => {
  it(
    "finds the matching passage and stays inside the measured budget",
    () => {
      const store = new KnowledgeStore(db.raw, "p1");
      const query = new Float32Array(DIMENSIONS);
      query[0] = 1;

      const started = performance.now();
      const hits = store.searchVectors(query, MODEL, null, "sr", 10);
      const elapsedMs = performance.now() - started;

      // Written to the test log on purpose: the number IS the finding, and a
      // wrapped assertion would hide it from the run that produced it.
      console.log(
        `knowledge: brute-force vector search over ${String(CHUNKS)} x ${String(DIMENSIONS)} values took ${elapsedMs.toFixed(1)} ms`,
      );

      // Measured on this machine on 2026-10-10, while the rest of the wave's
      // worktrees were running: 342 ms for the scan itself, dominated by
      // decoding 77 MB of Float32 blobs and by 19.2 million multiply-adds. The
      // bound is thirty times that, so it fails a hang rather than a busy
      // machine.
      expect(elapsedMs).toBeLessThan(10_000);
      expect(hits[0]?.citation.id).toBe(`s${String(MATCH_AT)}`);
      expect(hits).toHaveLength(10);
      expect(hits[0]?.text).toBe(`Zapis broj ${String(MATCH_AT)} o svemu i svacemu.`);
    },
    // Measured on this machine on 2026-10-10: seeding the 50 000 rows and their
    // vectors takes about 8 s. The maintainer's four-core CI runner is three to
    // four times slower, so the budget is stated rather than assumed.
    60_000,
  );
});
