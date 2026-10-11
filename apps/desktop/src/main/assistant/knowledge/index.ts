import type { KnowledgeHit, KnowledgeQuery, KnowledgeStatus, SourceKind } from "@nexus/core";
import { parseSearchQuery } from "@nexus/core";
import { chunkDocument } from "./chunker.js";
import { fuseRanked, type RankedHit } from "./fusion.js";
import { orMatchExpression } from "./query.js";
import { KNOWLEDGE_KINDS, type KnowledgeDeps, type KnowledgeIndex, type KnowledgeSource } from "./types.js";
import { createSources, defaultManualPages, wikiHits } from "./sources.js";
import { KnowledgeStore } from "./store.js";

/**
 * The assistant's knowledge base: local retrieval over the user's own material.
 *
 * **What it is.** A hybrid index - SQLite FTS5 over folded text, plus vectors
 * from whichever embedding model the runtime has loaded - fused by reciprocal
 * rank fusion into one list of cited passages. Everything the assistant is told
 * about the user's notes, tasks, events, files, the app manual, installed content
 * packs and the offline wiki comes through `search`, or it does not come at all.
 *
 * **Offline, always.** Nothing here opens a socket. The one source that could
 * have (a download of pack content) reads packs that the application already
 * installed and verified, through `packs/registry.ts`'s own verification, and
 * the wiki reader is a seam this module consumes and never implements. There is
 * no fetch in this folder, which is what keeps `check:egress` green by
 * construction rather than by review.
 *
 * **The user's data stays in the profile's encrypted database.** Every row this
 * service writes goes to the migration-093 tables of the profile it was created
 * for - notes, tasks, events and attachment text included - so the index is
 * exactly as protected as the material it was derived from. Nothing is written
 * to a cache file, a temp file or the packs directory.
 *
 * **Indexing is background work that cannot fail anybody.** A pass runs
 * unawaited, yields to the event loop between documents, stops the moment the
 * profile's database is locked (`isSessionLive`), and survives a source that
 * throws by logging it and moving to the next one. That is
 * `backfillAttachmentText`'s contract, and it is the right one here for the same
 * reason: this is housekeeping, and there is no user action waiting on it to
 * fail.
 */

/** How many candidates each list offers the fusion, as a multiple of the asked-for limit. */
const CANDIDATE_FACTOR = 4;

/** The most candidates one list may offer. Fusion can only rank what the lists hand it, and a list longer than this ranks passages nobody will read. */
const MAX_CANDIDATES = 200;

/** The most hits one search returns, whatever `limit` the caller asks for. */
const MAX_RESULTS = 200;

/** Passages one embedding call carries. Small enough to keep a pass responsive, large enough that the model is not invoked per paragraph. */
const EMBED_BATCH_SIZE = 16;

/**
 * Kinds a caller may filter by: the contract's `SourceKind` set, intersected
 * with the kinds this build actually indexes.
 *
 * `null` means "every kind" and an EMPTY ARRAY means "no kind" - they are
 * different answers, and collapsing the empty one into `null` would turn a
 * filter nothing satisfies into a search over everything. The filter arrives
 * from a model's tool call, so it is narrowed here rather than trusted: a value
 * outside the set narrows nothing.
 */
function allowedKinds(kinds: readonly SourceKind[] | undefined): readonly SourceKind[] | null {
  if (kinds === undefined) return null;
  return KNOWLEDGE_KINDS.filter((kind) => kinds.includes(kind));
}

export function createKnowledgeService(deps: KnowledgeDeps): KnowledgeIndex {
  const store = new KnowledgeStore(deps.db, deps.profileId);
  const manualPages = deps.manualPages ?? defaultManualPages();
  const { sources, wiki } = createSources({
    db: deps.db,
    profileId: deps.profileId,
    userData: deps.userData,
    packPublicKeyPem: deps.packPublicKeyPem,
    wiki: deps.wiki ?? null,
    manualPages,
  });

  /**
   * The sources that have not finished a pass in this process. Built full, and
   * emptied one source at a time: "has this been indexed" is a question about
   * this run, and a source whose cursor predates this session still has changes
   * to pick up.
   */
  const pending = new Set<string>(sources.map((source) => source.name));
  const background = new AbortController();

  /** The service's queue of passes: one at a time, in order, so a reindex never interleaves with an incremental pass. */
  let queue: Promise<void> = Promise.resolve();

  const alive = (signal: AbortSignal): boolean =>
    !signal.aborted && (deps.isSessionLive === undefined || deps.isSessionLive());

  /** Hands the event loop back, which is what makes a pass over a large profile invisible to the rest of the app. */
  const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  /**
   * Embeds whatever still needs a vector, in batches, until nothing does.
   *
   * Skipped entirely when no embedder is loaded, which is the whole of "full text
   * alone works". A batch that produced no vectors ends the loop rather than
   * retrying forever: an embedder answering nothing is a model that is not
   * actually serving, and a background pass must not spin on it.
   */
  const embedPending = async (signal: AbortSignal): Promise<void> => {
    const embedder = await deps.embedder();
    if (embedder === null) return;
    store.dropVectorsOfOtherModels(embedder.modelId);

    for (;;) {
      if (!alive(signal)) return;
      const batch = store.missingVectors(embedder.modelId, embedder.dimensions, EMBED_BATCH_SIZE);
      if (batch.length === 0) return;
      const vectors = await embedder.embed(
        batch.map((chunk) => chunk.text),
        signal,
      );
      if (!alive(signal)) return;
      let written = 0;
      batch.forEach((chunk, index) => {
        const vector = vectors[index];
        if (vector === undefined) return;
        store.setVector(chunk.id, embedder.modelId, vector);
        written += 1;
      });
      if (written < batch.length || batch.length < EMBED_BATCH_SIZE) return;
      await yieldToLoop();
    }
  };

  /** One source's pass: batches until it says it is done, then the prune, then the marker. */
  const passSource = async (source: KnowledgeSource, signal: AbortSignal): Promise<void> => {
    let cursor = store.cursor(source.name);
    for (;;) {
      const batch = await source.collect(cursor, signal);
      if (!alive(signal)) return;
      for (const document of batch.documents) {
        if (!alive(signal)) return;
        store.replaceDocument(document, chunkDocument(document.text));
        await yieldToLoop();
      }
      cursor = batch.cursor;
      store.setCursor(source.name, cursor);
      if (!batch.more) {
        if (batch.prune.mode === "entries") store.pruneAgainstEntries(batch.prune.kinds);
        if (batch.prune.mode === "ids") store.pruneAgainstIds(batch.prune.kind, batch.prune.ids);
        return;
      }
      await yieldToLoop();
    }
  };

  const sync = async (signal: AbortSignal): Promise<void> => {
    for (const source of sources) {
      if (!alive(signal)) return;
      try {
        await passSource(source, signal);
      } catch (error) {
        // One source failing is not the pass failing: a pack whose manifest this
        // build cannot read must not cost the user their notes. A source that was
        // interrupted is not marked done either - its cursor is wherever it got
        // to, and the next pass resumes from there.
        console.error(`Indexing the "${source.name}" source failed:`, error);
        continue;
      }
      if (!alive(signal)) return;
      pending.delete(source.name);
    }
    try {
      await embedPending(signal);
    } catch (error) {
      // The embedder is the runtime's, and it can be unloading while this runs.
      // The text index is already correct; the vectors arrive on a later pass.
      console.error("Embedding indexed passages failed:", error);
    }
  };

  /** Serialises every pass behind the one before it. */
  const serialized = (task: () => Promise<void>): Promise<void> => {
    const started = queue.then(task, task);
    queue = started.catch(() => undefined);
    return started;
  };

  if (deps.autoIndex !== false) {
    void serialized(() => sync(background.signal)).catch(() => undefined);
  }

  return {
    sync(signal: AbortSignal): Promise<void> {
      return serialized(() => sync(signal));
    },

    /**
     * Empty the profile's index and build it again from the sources.
     *
     * This is what a repair looks like, and it is deliberately total: dropping
     * every row (and every source's marker with it) is the one shape that cannot
     * leave a passage behind that some cursor persuaded the service to skip.
     */
    reindex(signal: AbortSignal): Promise<void> {
      return serialized(async () => {
        store.dropProfile();
        for (const source of sources) pending.add(source.name);
        await sync(signal);
      });
    },

    async status(): Promise<KnowledgeStatus> {
      const embedder = await deps.embedder();
      return {
        indexedChunks: store.countChunksForProfile(),
        pendingSources: pending.size,
        embedderId: embedder?.modelId ?? null,
      };
    },

    /**
     * The hybrid search: full text, vectors, and the wiki's live titles, fused.
     *
     * Each list is asked for up to four times the requested limit (never more
     * than `MAX_CANDIDATES` positions) because fusion reorders what it is given
     * and cannot rank a passage no list offered. An empty query returns nothing;
     * a query that yields no searchable terms (punctuation) simply contributes
     * no text list, so the answer is whatever the vectors and the wiki found.
     */
    async search(query: KnowledgeQuery, signal: AbortSignal): Promise<KnowledgeHit[]> {
      const limit = Math.min(Math.max(0, Math.floor(query.limit)), MAX_RESULTS);
      const text = query.text.trim();
      if (limit === 0 || text === "") return [];

      const kinds = allowedKinds(query.kinds);
      if (kinds !== null && kinds.length === 0) return [];
      const candidates = Math.min(Math.max(limit * CANDIDATE_FACTOR, limit), MAX_CANDIDATES);
      const lists: RankedHit[][] = [];

      const terms = parseSearchQuery(text).terms;
      const match = orMatchExpression(terms);
      if (match !== null) {
        lists.push(store.searchText(match, kinds, query.locale, candidates));
      }

      const embedder = await deps.embedder();
      if (embedder !== null && !signal.aborted) {
        const vectors = await embedder.embed([text], signal);
        const vector = vectors[0];
        if (vector !== undefined) {
          lists.push(
            store.searchVectors(vector, embedder.modelId, kinds, query.locale, candidates),
          );
        }
      }

      if (wiki !== null && (kinds === null || kinds.includes("wiki"))) {
        lists.push(await wikiHits(wiki, text, signal));
      }

      return fuseRanked(lists, { limit });
    },
  };
}
