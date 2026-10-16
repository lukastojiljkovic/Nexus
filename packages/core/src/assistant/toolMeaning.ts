/**
 * How close each tool is to the question, when an embedder is loaded.
 *
 * The lexical choice (`toolChoice.ts`) is the answer on a machine with no
 * embedding model, and it stays the answer on every machine it can serve. When
 * one is installed, a tool's description is embedded once and its vector is kept
 * for as long as the description stays the same, so a question costs one
 * embedding call and the registry's descriptions cost one call each, ever.
 *
 * Those descriptions are embedded in the background, never on a turn's clock: a
 * few hundred of them take seconds on a CPU, and the turn that first finds them
 * missing is answered by the lexical choice instead of waiting.
 */

import type { Embedder, ToolSpec } from "./contract.js";
import { MAX_TOOLS_PER_TURN } from "./toolChoice.js";

/** Descriptions one warm-up call embeds: the knowledge pass's batch size, so neither holds the model for long. */
const WARM_BATCH_SIZE = 16;

/** What a tool is embedded by: both descriptions, the English one first, which is the half the model reads. */
function meaningText(tool: ToolSpec): string {
  return `${tool.name}: ${tool.description.en}\n${tool.description.sr}`;
}

/**
 * A 32-bit FNV-1a hash of a description, as hex: a cache key that changes when
 * the text does. Not a security hash, and it does not need to be one.
 */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/** The cache key of one tool's vector: the model that produced it, the tool's name and its description's fingerprint. */
function keyOf(modelId: string, tool: ToolSpec): string {
  return `${modelId}\n${tool.name}\n${fingerprint(meaningText(tool))}`;
}

/** Cosine similarity, or 0 when either vector is empty: a missing meaning is no meaning, not an error. */
function cosine(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm);
}

/**
 * The vectors of the tools' descriptions, kept between turns.
 *
 * One instance lives as long as the assistant's registration (one per process),
 * and its keys carry the model id, so a different embedding model is never
 * compared with the vectors of another. Entries are never evicted: a registry
 * is a few hundred short descriptions, and a changed description is a new key
 * that the old one simply never matches again.
 */
export class ToolMeaningIndex {
  private readonly vectors = new Map<string, Float32Array>();
  /** The background embedding of missing descriptions, while one runs: two turns never start two. */
  private warming: Promise<void> | null = null;

  /**
   * The cosine of the closest tools' descriptions against the question, keyed by
   * tool name, or `undefined` when there is no embedder, it cannot answer, or a
   * description is not embedded yet - the lexical choice is then the whole of the
   * answer, which is what the assistant does on a machine without an embedding
   * model.
   *
   * Only the {@link MAX_TOOLS_PER_TURN} closest tools are in the map. An embedding
   * model scores every text against every other on a baseline of its own, so a
   * floor alone could lift the whole registry above the core tools; a turn can
   * offer no more than this many, and no more than this many are lifted.
   */
  async similarities(
    tools: readonly ToolSpec[],
    question: string,
    embedder: Embedder | null,
    signal: AbortSignal,
  ): Promise<ReadonlyMap<string, number> | undefined> {
    if (embedder === null) return undefined;
    const missing = tools.filter((tool) => !this.vectors.has(keyOf(embedder.modelId, tool)));
    if (missing.length > 0) {
      this.warm(embedder, missing);
      return undefined;
    }
    try {
      const [questionVector] = await embedder.embed([question], signal);
      if (questionVector === undefined) return undefined;
      const closest = tools
        .map((tool) => ({
          name: tool.name,
          cosine: cosine(questionVector, this.vectors.get(keyOf(embedder.modelId, tool)) ?? new Float32Array()),
        }))
        .sort((left, right) => right.cosine - left.cosine)
        .slice(0, MAX_TOOLS_PER_TURN);
      return new Map(closest.map((entry) => [entry.name, entry.cosine]));
    } catch {
      // An embedder that fails is an aid that is missing, not a failed turn: the
      // lexical choice answers this turn.
      return undefined;
    }
  }

  /**
   * Embeds the missing descriptions in the background, a batch at a time. Its own
   * signal, not a turn's: stopping the turn that started it does not throw away
   * the vectors every later turn needs. A failure stores nothing more, and the
   * next turn that finds a description missing starts again.
   */
  private warm(embedder: Embedder, missing: readonly ToolSpec[]): void {
    if (this.warming !== null) return;
    const signal = new AbortController().signal;
    this.warming = (async () => {
      for (let start = 0; start < missing.length; start += WARM_BATCH_SIZE) {
        const batch = missing.slice(start, start + WARM_BATCH_SIZE);
        const vectors = await embedder.embed(batch.map(meaningText), signal);
        if (vectors.length !== batch.length) return;
        batch.forEach((tool, index) => {
          const vector = vectors[index];
          if (vector !== undefined) this.vectors.set(keyOf(embedder.modelId, tool), vector);
        });
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        this.warming = null;
      });
  }
}
