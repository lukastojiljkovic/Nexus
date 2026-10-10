import { parseMarkdownUnits, type MarkdownUnit } from "./markup.js";
import type { ChunkDraft } from "./types.js";

/**
 * Cutting a document into passages.
 *
 * **Why passages at all.** Retrieval quality is decided here more than anywhere
 * else in this folder. A whole note embedded as one vector is one vector for
 * every subject the note touches, so a question about one paragraph competes
 * with everything else on the page; a passage of a few sentences is closer to
 * what a question looks like, and it is what a citation can honestly point at.
 *
 * **Why 320 tokens, and why 64 of overlap.** Both are chosen against the
 * embedders this application can load rather than by taste. Every embedding
 * model in the runtime's catalogue takes at least 512 tokens of input, so 320
 * leaves room for the title line and the truncation an embedder applies itself,
 * while staying well above the ~100-token floor under which a passage stops
 * carrying enough context to be judged relevant. The overlap is 64 tokens, a
 * fifth of the target: a sentence that straddles a boundary is retrievable from
 * both sides, and a question answered by the joint of two paragraphs still
 * finds a passage that holds both. `CHUNK_MAX_TOKENS` is a ceiling rather than a
 * second target - a wall of text with no paragraph breaks is split at it instead
 * of producing a passage no embedder can take whole.
 *
 * **The size is ESTIMATED, and the constant says so.** There is no tokenizer
 * here and there cannot be one: the embedder's own tokenizer belongs to the
 * model runtime, and an approximation that names itself (`CHARS_PER_TOKEN`) is
 * more honest than a tokenizer that would silently disagree with the model
 * actually loaded. Four characters per token is the usual order of magnitude for
 * BPE models on Latin-script text; the thresholds are constants precisely so
 * they can be retuned once the runtime can measure real token counts.
 *
 * **Boundaries are hard at a heading.** A passage never spans two sections: a
 * chunk's locator (its heading path) is then true rather than approximate, and a
 * citation that opens a section opens the section it was retrieved from. The
 * overlap rule therefore applies WITHIN a section, and a single unit longer than
 * the ceiling is hard-split with no overlap - there is no unit boundary left to
 * carry.
 */

/** Characters per token in every estimate below; see the module comment. */
export const CHARS_PER_TOKEN = 4;

/** The size a passage is grown to before it is closed. */
export const CHUNK_TARGET_TOKENS = 320;

/** How much of a closed passage is carried into the next one, as a change marker. */
export const CHUNK_OVERLAP_TOKENS = 64;

/** The ceiling one passage may reach, and where a paragraph with no breaks is split. */
export const CHUNK_MAX_TOKENS = 480;

export interface ChunkOptions {
  readonly targetTokens?: number;
  readonly overlapTokens?: number;
  readonly maxTokens?: number;
}

/** Tokens in `text`, estimated - the one place the estimate is computed. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The locator a heading path becomes: `"A > B"`, or `null` when there is none. */
export function locatorOf(headings: readonly string[]): string | null {
  const parts = headings.filter((heading) => heading !== "");
  return parts.length === 0 ? null : parts.join(" > ");
}

/**
 * A unit that does not fit one passage, cut at whitespace near the ceiling.
 *
 * Attachment text (SRCH-008) is the case this exists for: a text file has no
 * blank lines, so its whole body arrives as one unit, and the knowledge base
 * still has to be able to retrieve the paragraph in the middle of it.
 */
function sliceUnit(unit: MarkdownUnit, maxChars: number): MarkdownUnit[] {
  if (unit.text.length <= maxChars) return [unit];
  const pieces: MarkdownUnit[] = [];
  let rest = unit.text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // Prefer a break at the last whitespace in the window, but only when it is
    // not so early that the piece would be much smaller than a passage. The
    // floor is half the window; past that a hard cut is the better failure.
    const breakAt = window.search(/\s+\S*$/);
    const cut = breakAt >= maxChars / 2 ? breakAt : maxChars;
    pieces.push({ text: window.slice(0, cut).trim(), headings: unit.headings });
    rest = rest.slice(cut).trimStart();
  }
  if (rest !== "") pieces.push({ text: rest, headings: unit.headings });
  return pieces.filter((piece) => piece.text !== "");
}

interface Section {
  readonly headingKey: string;
  readonly units: MarkdownUnit[];
  chars: number;
}

function headingKeyOf(headings: readonly string[]): string {
  return headings.filter((heading) => heading !== "").join(" > ");
}

/**
 * The document's passages, in order.
 *
 * Pure, and deterministic down to the character: the same text always produces
 * the same passages at the same ordinals, which is what lets the index replace a
 * document's rows by deleting them and writing these again (migration 090's
 * uniqueness rule depends on it).
 */
export function chunkDocument(text: string, options: ChunkOptions = {}): ChunkDraft[] {
  const targetChars = (options.targetTokens ?? CHUNK_TARGET_TOKENS) * CHARS_PER_TOKEN;
  const overlapChars = (options.overlapTokens ?? CHUNK_OVERLAP_TOKENS) * CHARS_PER_TOKEN;
  const maxChars = (options.maxTokens ?? CHUNK_MAX_TOKENS) * CHARS_PER_TOKEN;

  const units = parseMarkdownUnits(text).flatMap((unit) => sliceUnit(unit, maxChars));
  const chunks: ChunkDraft[] = [];
  let current: Section | null = null;

  const draft = (section: Section): ChunkDraft => ({
    text: section.units.map((unit) => unit.text).join("\n\n"),
    locator: locatorOf(section.units[0]?.headings ?? []),
  });

  /**
   * Closes the section, and answers with what the next one starts from: the
   * trailing units that fit the overlap budget. Never the whole section - at
   * least one unit stays behind, or the next passage would repeat this one
   * entirely and the pass would make no progress.
   */
  const close = (section: Section): Section | null => {
    if (section.units.length === 0) return null;
    chunks.push(draft(section));
    const carried: MarkdownUnit[] = [];
    let carriedChars = 0;
    for (let index = section.units.length - 1; index >= 1; index -= 1) {
      const unit = section.units[index];
      if (unit === undefined) break;
      const cost = unit.text.length + 2;
      if (carriedChars + cost > overlapChars) break;
      carried.unshift(unit);
      carriedChars += cost;
    }
    if (carried.length === 0) return null;
    return { headingKey: section.headingKey, units: carried, chars: carriedChars };
  };

  for (const unit of units) {
    const key = headingKeyOf(unit.headings);
    // A heading is a hard boundary: the passage is closed and nothing is carried
    // across it, because a carried passage would make the next chunk's locator
    // name a section its text is not from.
    if (current !== null && key !== current.headingKey) {
      close(current);
      current = null;
    }
    if (current === null) current = { headingKey: key, units: [], chars: 0 };

    let cost = unit.text.length + (current.units.length > 0 ? 2 : 0);
    if (current.chars > 0 && current.chars + cost > maxChars) {
      current = close(current);
      if (current === null) current = { headingKey: key, units: [], chars: 0 };
      cost = unit.text.length + (current.units.length > 0 ? 2 : 0);
    }

    current.units.push(unit);
    current.chars += cost;

    if (current.chars >= targetChars) current = close(current);
  }

  if (current !== null) close(current);
  return chunks;
}
