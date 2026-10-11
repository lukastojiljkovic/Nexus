import type Database from "better-sqlite3-multiple-ciphers";
import type { AppLocation, AssistantLocale, Citation, SourceKind } from "@nexus/core";
import type { RankedHit } from "./fusion.js";
import type { ChunkDraft, IndexedDocument } from "./types.js";
import { decodeVector, encodeVector, rankBySimilarity, type Similarity } from "./vectors.js";

type DatabaseHandle = Database.Database;

/**
 * The knowledge tables of one profile: every read and every write the index has,
 * over the migration-093 schema.
 *
 * **Nothing else in the service writes a row.** The indexing pass, the search and
 * the status report all come through here, which keeps the two rules this store
 * exists to hold in one place: every statement is scoped by the profile id (the
 * database belongs to one account, and one account holds several profiles), and
 * every value is bound - no caller-supplied string is ever spliced into a
 * statement. The only SQL text built from a value is an `IN (...)` placeholder
 * list whose COUNT comes from an array the caller already allowlisted, exactly
 * as `SearchStore` builds one; the values themselves are still bound.
 *
 * **A document is replaced, never patched.** `replaceDocument` deletes the
 * document's rows and writes the chunker's output again, in one transaction.
 * Because the chunker is pure, this is not a rewrite of identical rows: a
 * document whose text changed produces different passages, and delete-then-insert
 * is the one shape that cannot leave a stale passage behind. Deleting a passage
 * takes its vector with it (`ON DELETE CASCADE`) and the FTS shadow follows
 * through the table's own triggers.
 *
 * **Deletion is by id, from a list the database answered.** `pruneAgainstIds`
 * reads the ids currently indexed under a kind and deletes the ones the source
 * no longer yields, one statement per removed document against the primary-key
 * index. The alternative - a single `NOT IN` over a caller-built id list - would
 * have to be cut into batches, and a batch of a `NOT IN` is a *different*
 * predicate from the whole of it: the removed documents would depend on how many
 * there were.
 */

/** The columns every read needs to build a citation, in one place so two queries cannot drift apart. */
const CHUNK_COLUMNS =
  "c.id AS id, c.kind AS kind, c.source_id AS source_id, c.locale AS locale, " +
  "c.pack_id AS pack_id, c.safety AS safety, c.title AS title, c.locator AS locator, " +
  "c.location_json AS location_json, c.text AS text";

interface ChunkRow {
  id: number;
  kind: SourceKind;
  source_id: string;
  locale: string;
  pack_id: string | null;
  safety: number;
  title: string;
  locator: string | null;
  location_json: string | null;
  text: string;
}

interface VectorRow {
  id: number;
  vector: Buffer;
}

/**
 * A row's location back as a structured value, or `null`.
 *
 * A `location_json` this build wrote is always a valid location; a broken one
 * can only come from a file somebody edited, and the honest reading of that is a
 * citation without a place to open, not a search that fails.
 */
function parseLocation(json: string | null): AppLocation | null {
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const module = record["module"];
    if (typeof module !== "string" || module === "") return null;
    const location: { module: string; item?: string; settings?: string } = { module };
    const item = record["item"];
    if (typeof item === "string" && item !== "") location.item = item;
    const settings = record["settings"];
    if (typeof settings === "string" && settings !== "") location.settings = settings;
    return location;
  } catch {
    return null;
  }
}

/** A chunk row as the contract's citation: absent facts are absent properties, never `undefined` values. */
function toCitation(row: ChunkRow): Citation {
  const citation: {
    kind: SourceKind;
    id: string;
    title: string;
    locator?: string;
    packId?: string;
    safety?: boolean;
    location?: AppLocation;
  } = { kind: row.kind, id: row.source_id, title: row.title };
  if (row.locator !== null) citation.locator = row.locator;
  if (row.pack_id !== null) citation.packId = row.pack_id;
  if (row.safety === 1) citation.safety = true;
  const location = parseLocation(row.location_json);
  if (location !== null) citation.location = location;
  return citation;
}

/** One passage's id and text, on its way to the embedder. */
export interface PendingChunk {
  readonly id: number;
  readonly text: string;
}

function inPlaceholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

export class KnowledgeStore {
  private readonly insertChunk: Database.Statement;
  private readonly deleteDocument: Database.Statement;
  private readonly readCursor: Database.Statement;
  private readonly writeCursor: Database.Statement;
  private readonly countChunks: Database.Statement;
  private readonly pruneKind: Database.Statement;
  private readonly listIds: Database.Statement;
  private readonly dropChunks: Database.Statement;
  private readonly dropCursors: Database.Statement;
  private readonly pendingVectors: Database.Statement;
  private readonly insertVector: Database.Statement;
  private readonly dropOtherVectors: Database.Statement;
  private readonly textNoFilter: Database.Statement;
  private readonly vectorNoFilter: Database.Statement;
  /** Statements with a `kinds` filter, cached by how many placeholders the IN-list needs. */
  private readonly textByKindCount = new Map<number, Database.Statement>();
  private readonly vectorByKindCount = new Map<number, Database.Statement>();
  private readonly chunkByIdCount = new Map<number, Database.Statement>();

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertChunk = db.prepare(
      `INSERT INTO knowledge_chunks
         (profile_id, kind, source_id, locale, pack_id, safety, title, keywords, locator, location_json, ordinal, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteDocument = db.prepare(
      "DELETE FROM knowledge_chunks WHERE profile_id = ? AND kind = ? AND source_id = ?",
    );
    this.readCursor = db.prepare(
      "SELECT marker FROM knowledge_cursors WHERE profile_id = ? AND source = ?",
    );
    this.writeCursor = db.prepare(
      `INSERT INTO knowledge_cursors (profile_id, source, marker) VALUES (?, ?, ?)
       ON CONFLICT (profile_id, source) DO UPDATE SET marker = excluded.marker`,
    );
    this.countChunks = db.prepare("SELECT count(*) AS n FROM knowledge_chunks WHERE profile_id = ?");
    // The anti-join the indexing pass prunes a records-backed kind with. The
    // source of truth for what still exists is the table migration 017's
    // triggers maintain - which is also where the private vault's exclusion is
    // a fact rather than a rule this service has to remember.
    this.pruneKind = db.prepare(
      `DELETE FROM knowledge_chunks
       WHERE profile_id = ? AND kind = ?
         AND source_id NOT IN (
           SELECT entity_id FROM search_entries WHERE profile_id = ? AND kind = ?
         )`,
    );
    this.listIds = db.prepare(
      "SELECT DISTINCT source_id AS id FROM knowledge_chunks WHERE profile_id = ? AND kind = ?",
    );
    this.dropChunks = db.prepare("DELETE FROM knowledge_chunks WHERE profile_id = ?");
    this.dropCursors = db.prepare("DELETE FROM knowledge_cursors WHERE profile_id = ?");
    this.pendingVectors = db.prepare(
      `SELECT c.id AS id, c.text AS text FROM knowledge_chunks c
       LEFT JOIN knowledge_vectors v
         ON v.chunk_id = c.id AND v.model_id = ? AND v.dimensions = ?
       WHERE c.profile_id = ? AND v.chunk_id IS NULL
       ORDER BY c.id
       LIMIT ?`,
    );
    this.insertVector = db.prepare(
      `INSERT INTO knowledge_vectors (chunk_id, model_id, dimensions, vector) VALUES (?, ?, ?, ?)
       ON CONFLICT (chunk_id) DO UPDATE SET
         model_id = excluded.model_id, dimensions = excluded.dimensions, vector = excluded.vector`,
    );
    this.dropOtherVectors = db.prepare(
      `DELETE FROM knowledge_vectors
       WHERE model_id <> ?
         AND chunk_id IN (SELECT id FROM knowledge_chunks WHERE profile_id = ?)`,
    );
    this.textNoFilter = db.prepare(
      `SELECT ${CHUNK_COLUMNS}
       FROM knowledge_fts f JOIN knowledge_chunks c ON c.id = f.rowid
       WHERE knowledge_fts MATCH ? AND c.profile_id = ? AND (c.locale = '' OR c.locale = ?)
       ORDER BY bm25(knowledge_fts), c.id
       LIMIT ?`,
    );
    this.vectorNoFilter = db.prepare(
      `SELECT v.chunk_id AS id, v.vector AS vector
       FROM knowledge_vectors v JOIN knowledge_chunks c ON c.id = v.chunk_id
       WHERE c.profile_id = ? AND v.model_id = ? AND v.dimensions = ?
         AND (c.locale = '' OR c.locale = ?)`,
    );
  }

  /** The marker a source was last left with, or `null` when it has never run. */
  cursor(source: string): string | null {
    const row = this.readCursor.get(this.profileId, source) as { marker: string } | undefined;
    return row?.marker ?? null;
  }

  setCursor(source: string, marker: string): void {
    this.writeCursor.run(this.profileId, source, marker);
  }

  /** Replaces everything indexed under one document. Passages are written in order, so `ordinal` is the position. */
  replaceDocument(doc: IndexedDocument, chunks: readonly ChunkDraft[]): void {
    const keywords = (doc.keywords ?? []).join(" ");
    const location = doc.location === undefined ? null : JSON.stringify(doc.location);
    const safety = doc.safety === true ? 1 : 0;
    this.db.transaction(() => {
      this.deleteDocument.run(this.profileId, doc.kind, doc.id);
      chunks.forEach((chunk, ordinal) => {
        this.insertChunk.run(
          this.profileId,
          doc.kind,
          doc.id,
          doc.locale,
          doc.packId ?? null,
          safety,
          doc.title,
          keywords,
          chunk.locator,
          location,
          ordinal,
          chunk.text,
        );
      });
    })();
  }

  /** Drops every passage of these kinds whose record is gone from `search_entries`. */
  pruneAgainstEntries(kinds: readonly SourceKind[]): void {
    for (const kind of kinds) {
      this.pruneKind.run(this.profileId, kind, this.profileId, kind);
    }
  }

  /** Drops every passage of this kind whose document the source no longer yields. */
  pruneAgainstIds(kind: SourceKind, liveIds: readonly string[]): void {
    const live = new Set(liveIds);
    const indexed = (this.listIds.all(this.profileId, kind) as { id: string }[]).map((row) => row.id);
    for (const id of indexed) {
      if (!live.has(id)) this.deleteDocument.run(this.profileId, kind, id);
    }
  }

  /** How many passages this profile holds - what `status()` reports. */
  countChunksForProfile(): number {
    return (this.countChunks.get(this.profileId) as { n: number }).n;
  }

  /** Empties this profile's index. The sources are still there; a pass rebuilds it. */
  dropProfile(): void {
    this.db.transaction(() => {
      this.dropChunks.run(this.profileId);
      this.dropCursors.run(this.profileId);
    })();
  }

  /** Full-text candidates, best first. `match` is an FTS5 expression from `toFtsMatchExpression`, never hand-typed. */
  searchText(
    match: string,
    kinds: readonly SourceKind[] | null,
    locale: AssistantLocale,
    limit: number,
  ): RankedHit[] {
    const rows = (
      kinds === null
        ? this.textNoFilter.all(match, this.profileId, locale, limit)
        : this.textStatementFor(kinds.length).all(match, this.profileId, locale, ...kinds, limit)
    ) as ChunkRow[];
    return rows.map((row) => ({ key: `c${String(row.id)}`, citation: toCitation(row), text: row.text }));
  }

  /**
   * Vector candidates, best first, by brute force over this profile's vectors
   * for one model.
   *
   * The scan decodes one vector at a time and keeps only the best `limit`, then
   * reads the citations for those rows: materialising a citation for every
   * passage in the corpus would cost one object with four strings per corpus
   * entry, on every single search. The floor is `0` (exclusive) - a passage
   * orthogonal to the question contributes nothing, and without it every row of
   * the corpus would arrive at some rank for fusion to rank.
   */
  searchVectors(
    query: Float32Array,
    modelId: string,
    kinds: readonly SourceKind[] | null,
    locale: AssistantLocale,
    limit: number,
  ): RankedHit[] {
    const statement =
      kinds === null ? this.vectorNoFilter : this.vectorStatementFor(kinds.length);
    const parameters: unknown[] =
      kinds === null
        ? [this.profileId, modelId, query.length, locale]
        : [this.profileId, modelId, query.length, locale, ...kinds];

    const best = rankBySimilarity(query, this.decode(statement.iterate(...parameters)), limit, {
      minScore: 0,
    });
    return this.citationsFor(best);
  }

  /** The passages of this profile that still need a vector for this model. */
  missingVectors(modelId: string, dimensions: number, limit: number): PendingChunk[] {
    return this.pendingVectors.all(modelId, dimensions, this.profileId, limit) as PendingChunk[];
  }

  setVector(chunkId: number, modelId: string, vector: Float32Array): void {
    this.insertVector.run(chunkId, modelId, vector.length, encodeVector(vector));
  }

  /**
   * Forgets every vector written by a different model.
   *
   * One model at a time is the runtime's own shape - there is one embedder
   * loaded - and the alternative is a second set of vectors nothing will ever
   * compare against, kept for the life of the profile. Called before the first
   * vector of a pass is written, so a model switch costs the old set once.
   */
  dropVectorsOfOtherModels(modelId: string): void {
    this.dropOtherVectors.run(modelId, this.profileId);
  }

  private *decode(rows: Iterable<unknown>): Iterable<{ id: number; vector: Float32Array }> {
    for (const row of rows) {
      const { id, vector } = row as VectorRow;
      const decoded = decodeVector(vector);
      if (decoded !== null) yield { id, vector: decoded };
    }
  }

  private citationsFor(best: readonly Similarity[]): RankedHit[] {
    if (best.length === 0) return [];
    const statement = this.chunkByIdStatementFor(best.length);
    const rows = statement.all(...best.map((entry) => entry.id)) as ChunkRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const hits: RankedHit[] = [];
    for (const entry of best) {
      const row = byId.get(entry.id);
      if (row === undefined) continue;
      hits.push({ key: `c${String(row.id)}`, citation: toCitation(row), text: row.text });
    }
    return hits;
  }

  private textStatementFor(count: number): Database.Statement {
    const cached = this.textByKindCount.get(count);
    if (cached !== undefined) return cached;
    const statement = this.db.prepare(
      `SELECT ${CHUNK_COLUMNS}
       FROM knowledge_fts f JOIN knowledge_chunks c ON c.id = f.rowid
       WHERE knowledge_fts MATCH ? AND c.profile_id = ? AND (c.locale = '' OR c.locale = ?)
         AND c.kind IN (${inPlaceholders(count)})
       ORDER BY bm25(knowledge_fts), c.id
       LIMIT ?`,
    );
    this.textByKindCount.set(count, statement);
    return statement;
  }

  private vectorStatementFor(count: number): Database.Statement {
    const cached = this.vectorByKindCount.get(count);
    if (cached !== undefined) return cached;
    const statement = this.db.prepare(
      `SELECT v.chunk_id AS id, v.vector AS vector
       FROM knowledge_vectors v JOIN knowledge_chunks c ON c.id = v.chunk_id
       WHERE c.profile_id = ? AND v.model_id = ? AND v.dimensions = ?
         AND (c.locale = '' OR c.locale = ?) AND c.kind IN (${inPlaceholders(count)})`,
    );
    this.vectorByKindCount.set(count, statement);
    return statement;
  }

  private chunkByIdStatementFor(count: number): Database.Statement {
    const cached = this.chunkByIdCount.get(count);
    if (cached !== undefined) return cached;
    const statement = this.db.prepare(
      `SELECT ${CHUNK_COLUMNS} FROM knowledge_chunks c WHERE c.id IN (${inPlaceholders(count)})`,
    );
    this.chunkByIdCount.set(count, statement);
    return statement;
  }
}
