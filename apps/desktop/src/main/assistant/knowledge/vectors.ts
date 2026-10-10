/**
 * The vector half of retrieval: the blob a Float32Array becomes in the database,
 * and the similarity the search ranks by.
 *
 * **The layout is this build's own, and it is stated rather than derivable.**
 * `knowledge_vectors.vector` holds the embedder's Float32 values as consecutive
 * four-byte words in the platform's byte order. Nothing else ever reads the
 * column - no tool, no second reader, no export: the rows are derived and rebuilt
 * from the sources (`reindex`), so a file moved between architectures loses the
 * vectors and nothing else. Writing a length prefix or a byte-order marker would
 * be a format for an interoperability that does not exist. There is ONE
 * assumption, and it is the one every consumer of this blob shares: the byte
 * length is a whole number of four-byte words, and a blob that is not is
 * corruption to be skipped, never something to interpret.
 *
 * **Cosine, not dot product, even though the contract normalises.** `Embedder`
 * says its vectors are L2-normalised, and for a normalised pair cosine and dot
 * product are the same number - so dividing by the norms costs one square root
 * per candidate and buys the one thing a comment cannot: a fake embedder in a
 * test, or a model that quietly stops normalising, produces a similarity that is
 * still a similarity. Brute force over every vector is what a profile-sized
 * corpus affords, and the measured cost is in `perf.test.ts`.
 */

/** The values of `vector` as a blob the database can store. Copied, never aliased to the caller's buffer. */
export function encodeVector(vector: Float32Array): Buffer {
  const copy = new Float32Array(vector);
  return Buffer.from(copy.buffer, 0, copy.byteLength);
}

/** The blob back as values, or `null` when it is not a whole number of Float32 words. */
export function decodeVector(blob: Uint8Array): Float32Array | null {
  if (blob.byteLength === 0 || blob.byteLength % 4 !== 0) return null;
  // `Uint8Array.from` always allocates a buffer of exactly this length, so the
  // Float32Array view below can never read past the blob into a driver's pooled
  // page the way a zero-copy view over `blob.buffer` could.
  const bytes = Uint8Array.from(blob);
  return new Float32Array(bytes.buffer, 0, bytes.byteLength / 4);
}

/**
 * Cosine similarity of two vectors, or `0` when they cannot be compared at all
 * (different lengths, or one of them all zeros).
 *
 * `0` rather than an exception because this runs once per candidate over the
 * whole corpus: a zero-length vector is a row nothing can match, not a reason to
 * fail a search that a hundred thousand other rows could answer.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/** One candidate's id and its similarity to the query. */
export interface Similarity {
  readonly id: number;
  readonly score: number;
}

/**
 * The best `limit` candidates by cosine similarity, best first, ties broken by
 * id so the order does not depend on the order rows came out of SQLite.
 *
 * The candidates are consumed one at a time and only the best `limit` are kept,
 * which is what makes a brute-force scan over a whole corpus cost one vector of
 * memory per corpus entry rather than one result object. `minScore` is an
 * EXCLUSIVE floor - the vector search passes `0`, so a passage that shares no
 * direction with the question is not a candidate rather than a candidate at
 * rank four hundred.
 */
export function rankBySimilarity(
  query: Float32Array,
  candidates: Iterable<{ readonly id: number; readonly vector: Float32Array }>,
  limit: number,
  options?: { readonly minScore?: number },
): Similarity[] {
  if (limit <= 0) return [];
  // The floor is how a caller says "a passage that points in no shared direction
  // with the question is not a candidate at all". Without it a scan over a whole
  // corpus returns every row at some rank, and fusion has no way to tell a
  // passage that matched from one that merely existed.
  const floor = options?.minScore ?? Number.NEGATIVE_INFINITY;
  const best: Similarity[] = [];
  let worst = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const score = cosineSimilarity(query, candidate.vector);
    if (score <= floor) continue;
    // `<` and not `<=`: at equal similarity a smaller id wins, so a candidate
    // that ties the worst kept one is still allowed to displace it.
    if (best.length === limit && score < worst) continue;
    let at = best.length;
    while (at > 0) {
      const previous = best[at - 1];
      if (previous === undefined) break;
      if (previous.score > score || (previous.score === score && previous.id < candidate.id)) break;
      at -= 1;
    }
    best.splice(at, 0, { id: candidate.id, score });
    if (best.length > limit) best.length = limit;
    worst = best[best.length - 1]?.score ?? Number.NEGATIVE_INFINITY;
  }
  return best;
}
