import { createHash } from "node:crypto";

/**
 * The Markdown reading the knowledge base does: front matter, the units a
 * document is made of, the lead of an article, and the one content fingerprint
 * every change marker is built from.
 *
 * **What this is, and what it deliberately is not.** The app manual
 * (`assistant/manual/<locale>/*.md`) and a `content` pack's articles
 * (`articles/*.md`) are Markdown this project writes, so a small reader over a
 * fixed subset is the honest tool: headings, paragraphs, lists, fenced code and
 * tables. There is no Markdown dependency and there must not be one - a full
 * CommonMark parser would be a second, larger format to keep in step with the
 * documents, and the failure mode of the subset here is a paragraph that reads
 * slightly longer than it should in a passage.
 *
 * **The front matter subset is stated rather than guessed at.** Three shapes are
 * read: `key: value`, `key: [a, b]`, and a key whose value is the block of
 * `- item` lines or `sub: value` lines indented under it (which is what flattens
 * `location.module`). Anything else - a `|` block, an anchor, a comment at the
 * end of a line - is NOT interpreted: a document that needs it is a document to
 * simplify, because a manual page whose title depends on a feature of YAML this
 * reader does not implement would be a page the assistant explains the app from
 * without ever having read it.
 */

/** A page's front matter, flattened: `location.module` is the key `"location.module"`. */
export interface FrontMatter {
  readonly scalars: ReadonlyMap<string, string>;
  readonly lists: ReadonlyMap<string, readonly string[]>;
}

export interface ParsedPage {
  /** `null` when the document does not open with a front-matter block. */
  readonly frontMatter: FrontMatter | null;
  /** The document's body, with the front-matter block removed. */
  readonly body: string;
}

const FRONT_MATTER_FENCE = /^-{3,}\s*$/;
const KEY_LINE = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/;
const LIST_ITEM = /^\s*-\s+(.*)$/;

/** A scalar with its quoting removed: `"a \"b\""` is `a "b"`, `'it''s'` is `it's`. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/** An inline list: `[a, "b c"]`. An empty `[]` is an empty list, not one empty item. */
function inlineList(value: string): readonly string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === "") return [];
  return inner
    .split(",")
    .map((part) => unquote(part))
    .filter((part) => part !== "");
}

/**
 * An inline map: `{ module: settings, settings: data }`.
 *
 * The other spelling of `location:` in a page's front matter, and the one a
 * hand-written page reaches for when the map is two keys long. Read as the same
 * dotted keys the block form produces, so a page may use either and the reader
 * cannot tell the difference - which is the point.
 */
function inlineMap(value: string): ReadonlyMap<string, string> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1).trim();
  const entries = new Map<string, string>();
  if (inner === "") return entries;
  for (const part of inner.split(",")) {
    const pair = KEY_LINE.exec(part.trim());
    if (pair === null) return null;
    entries.set(pair[1] ?? "", unquote(pair[2] ?? ""));
  }
  return entries;
}

/**
 * Reads a front-matter block and answers with the body that follows it.
 *
 * A document with no opening `---`, or with an opening one that is never closed,
 * has NO front matter and its whole text is the body: a page whose block is
 * half-written is a page whose text should still be readable, not one that
 * silently becomes empty.
 */
export function parsePage(source: string): ParsedPage {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !FRONT_MATTER_FENCE.test(lines[0] ?? "")) {
    return { frontMatter: null, body: text };
  }

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONT_MATTER_FENCE.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  if (end === -1) return { frontMatter: null, body: text };

  const scalars = new Map<string, string>();
  const lists = new Map<string, readonly string[]>();
  // The key a more-indented line belongs to, and its own indentation.
  let parent: { key: string; indent: number } | null = null;

  for (const raw of lines.slice(1, end)) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const line = raw.replace(/\t/g, " ");
    const indent = line.length - line.trimStart().length;
    const content = line.trim();

    const item = LIST_ITEM.exec(line);
    if (item !== null && parent !== null && indent > parent.indent) {
      const value = unquote(item[1] ?? "");
      if (value !== "") {
        const existing = lists.get(parent.key) ?? [];
        lists.set(parent.key, [...existing, value]);
      }
      continue;
    }

    const keyed = KEY_LINE.exec(content);
    if (keyed === null) continue;
    const key = keyed[1] ?? "";
    const value = keyed[2] ?? "";
    // A line more indented than the open key belongs to it, and the key STAYS
    // open: `location:` followed by two indented keys is one map, not a map and
    // then a stray key at the top level.
    const nested = parent !== null && indent > parent.indent;
    const fullKey: string = nested && parent !== null ? `${parent.key}.${key}` : key;

    if (value.trim() === "") {
      // A key with nothing after it: the lines under it decide what it is.
      parent = { key: fullKey, indent };
      continue;
    }
    const inline = inlineList(value);
    if (inline !== null) {
      lists.set(fullKey, inline);
      if (!nested) parent = null;
      continue;
    }
    const map = inlineMap(value);
    if (map !== null) {
      for (const [key, entryValue] of map) scalars.set(`${fullKey}.${key}`, entryValue);
      if (!nested) parent = null;
      continue;
    }
    scalars.set(fullKey, unquote(value));
    if (!nested) parent = null;
  }

  return { frontMatter: { scalars, lists }, body: lines.slice(end + 1).join("\n") };
}

/** One block of a document: its text, and the heading path it sits under. */
export interface MarkdownUnit {
  readonly text: string;
  /** Empty for a document with no headings above the unit. */
  readonly headings: readonly string[];
}

const ATX_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const LIST_ITEM_LINE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const TABLE_ROW = /^\s*\|/;
const BLOCK_QUOTE = /^\s*>\s?/;

/** A fenced code block's text with its fence lines dropped, so a passage does not open with three backticks. */
function codeBlockText(lines: readonly string[]): string {
  return lines.join("\n").trim();
}

/**
 * Splits a body into units, in order.
 *
 * A unit is a paragraph, a list, a table, or a fenced code block - the things a
 * person wrote as one thought. A heading is NOT a unit: it changes the heading
 * path every following unit carries (and a section that holds nothing but a
 * heading therefore contributes nothing, which is right - there is no text in it
 * to retrieve). The heading path is what the chunker turns into a chunk's
 * locator, and what the index folds into the searchable text beside the passage.
 */
export function parseMarkdownUnits(body: string): MarkdownUnit[] {
  const units: MarkdownUnit[] = [];
  const lines = body.split(/\r?\n/);
  const headings: string[] = [];
  let paragraph: string[] = [];
  let block: string[] = [];
  let blockIsListOrTable = false;
  let fence: { marker: string; lines: string[] } | null = null;

  const path = (): readonly string[] => headings;
  const flush = (): void => {
    if (block.length > 0) {
      const text = blockIsListOrTable ? block.join("\n").trim() : block.join(" ").trim();
      if (text !== "") units.push({ text, headings: [...path()] });
      block = [];
      blockIsListOrTable = false;
    }
    if (paragraph.length > 0) {
      const text = paragraph.join(" ").trim();
      if (text !== "") units.push({ text, headings: [...path()] });
      paragraph = [];
    }
  };

  for (const line of lines) {
    if (fence !== null) {
      const closing = FENCE.exec(line);
      if (closing !== null && closing[1]?.startsWith(fence.marker[0] ?? "") === true) {
        const text = codeBlockText(fence.lines);
        if (text !== "") units.push({ text, headings: [...path()] });
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }

    const opener = FENCE.exec(line);
    // An info string is a language tag (` ```ts `). A fence whose tail holds the
    // fence character itself is one line of prose that starts with backticks.
    if (opener !== null && !/[`~]/.test(opener[2] ?? "")) {
      flush();
      fence = { marker: opener[1] ?? "```", lines: [] };
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading !== null) {
      flush();
      const level = (heading[1] ?? "#").length;
      headings.length = Math.max(0, level - 1);
      headings[level - 1] = (heading[2] ?? "").trim();
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    const quote = BLOCK_QUOTE.exec(line);
    if (quote !== null) {
      paragraph.push(line.trim().replace(/^>\s?/, ""));
      continue;
    }

    const isList = LIST_ITEM_LINE.test(line);
    const isTable = TABLE_ROW.test(line);
    if (isList || isTable) {
      if (paragraph.length > 0) flush();
      if (block.length > 0 && !blockIsListOrTable) flush();
      blockIsListOrTable = true;
      block.push(line.trim());
      continue;
    }

    if (block.length > 0) flush();
    paragraph.push(line.trim());
  }

  if (fence !== null) {
    const text = codeBlockText(fence.lines);
    if (text !== "") units.push({ text, headings: [...path()] });
  }
  flush();
  return units;
}

/**
 * The lead section of an article: what it opens with, up to the next heading
 * after the opening one.
 *
 * This is the whole of what the knowledge base reads out of a wiki article
 * (`types.ts`'s `WikiSource` explains why the rest is never read), so it strips
 * a leading level-1 heading - the article's own title, which the citation
 * already carries - and stops at the next heading of any level.
 */
export function leadSection(text: string, maxChars: number): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let started = false;
  for (const line of lines) {
    const heading = ATX_HEADING.exec(line);
    if (heading !== null) {
      if (!started) {
        // The title heading itself is not part of the lead's prose.
        started = true;
        continue;
      }
      break;
    }
    if (!started && line.trim() === "") continue;
    started = true;
    kept.push(line);
  }
  const lead = kept.join(" ").replace(/\s+/g, " ").trim();
  return lead.length > maxChars ? `${lead.slice(0, maxChars).trimEnd()}` : lead;
}

/**
 * A short, stable fingerprint of a set of strings - the one source of every
 * content-derived change marker this service stores.
 *
 * Deliberately a real digest rather than a counter or a timestamp: a marker has
 * to change when the bundled manual changes and stay identical when it does not,
 * across restarts and across an application update, and a hash of the text is
 * the only thing that answers both. Sixteen hex characters is 64 bits, which for
 * "did this file change since last unlock" is far past the point where a
 * collision could matter.
 */
export function contentMarker(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 16);
}
