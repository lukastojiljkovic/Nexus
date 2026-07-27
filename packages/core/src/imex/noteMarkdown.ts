import * as Y from "yjs";
import { xmlTextContent } from "../notes/yjsText.js";

/**
 * Renders one note's merged Yjs document as Markdown (ADR-022 section 3, the
 * IMEX archive's human-readable note mirror). Pure: builds a throwaway
 * `Y.Doc` from the snapshot, walks the fixed "default" fragment (the same
 * contract `yjsMerge.ts`/`noteCards.ts` walk, per ADR-012), and destroys it —
 * no file IO, no clock reads.
 *
 * The walk is split into a BLOCK pass and an INLINE pass, mirroring the
 * TipTap schema itself: `renderBlock` decides what one node contributes as a
 * standalone block (or nothing), `renderInline` decides what one node
 * contributes to the text of the block it's inside. Both are deliberately
 * total functions over "any node the schema can produce" — an *unknown* node
 * must never silently swallow its text (the exact bug `yjsMerge.ts`'s inline
 * allow-list comment warns about), so both passes end in a catch-all that
 * recurses into children rather than dropping them.
 */

/** The subset of an attachment row a Markdown image node needs. */
export interface NoteMarkdownAttachment {
  fileName: string;
  sha256: string;
}

export interface NoteMarkdownContext {
  /** `attachmentId` -> its row. A node whose id is absent (the attachment was removed) renders nothing. */
  attachments: ReadonlyMap<string, NoteMarkdownAttachment>;
  /**
   * Relative prefix from the `.md` file's OWN directory back to the archive
   * root: `"../"` for `notes/x.md`, `"../../"` for `notes/a/x.md`. Image links
   * are written as `<rootPrefix>blobs/<sha256>` so they resolve however deep
   * the note's folder nests.
   */
  rootPrefix: string;
}

/** TipTap inline atoms that can appear as siblings of text runs — mirrors `yjsMerge.ts`'s `INLINE_ELEMENT_NAMES`, the same allow-list discipline applied to a second walk. */
const INLINE_ELEMENT_NAMES = new Set(["noteLink", "hardBreak"]);

/** Renders one note's merged Yjs state as Markdown. Empty document -> `""`. */
export function renderNoteMarkdown(snapshot: Uint8Array, context: NoteMarkdownContext): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, snapshot);
    const body = renderBlocks(doc.getXmlFragment("default").toArray(), context);
    return body.length > 0 ? `${body}\n` : "";
  } finally {
    // `applyUpdate` throws on a corrupt snapshot; an export of a thousand
    // notes must not leak a document per failure before it reports one.
    doc.destroy();
  }
}

// --- Block pass --------------------------------------------------------

/** Renders a sequence of siblings as independent blocks, dropping any that contribute nothing, joined with a blank line. */
function renderBlocks(
  children: readonly (Y.XmlElement | Y.XmlText | Y.XmlHook)[],
  context: NoteMarkdownContext,
): string {
  const blocks: string[] = [];
  for (const child of children) {
    const block = renderBlock(child, context);
    if (block !== null) blocks.push(block);
  }
  return blocks.join("\n\n");
}

/** One node's contribution as a standalone block, or `null` when it contributes nothing (an empty paragraph, a removed attachment, …). */
function renderBlock(
  node: Y.XmlElement | Y.XmlText | Y.XmlHook,
  context: NoteMarkdownContext,
): string | null {
  // Defensive: a bare text run or an inline atom stranded directly at the
  // document root (never emitted by the schema, but never fusing silently).
  if (node instanceof Y.XmlText) {
    return renderParagraphLike([node]);
  }
  if (!(node instanceof Y.XmlElement)) {
    return null; // Y.XmlHook carries no renderable content
  }

  switch (node.nodeName) {
    case "paragraph":
      return renderParagraphLike(node.toArray());
    case "heading":
      return renderHeading(node);
    case "blockquote":
      return renderBlockquote(node, context);
    case "codeBlock":
      return renderCodeBlock(node);
    case "horizontalRule":
      return "---";
    case "bulletList":
      return renderBulletList(node, context);
    case "orderedList":
      return renderOrderedList(node, context);
    case "taskList":
      return renderTaskList(node, context);
    case "attachmentImage":
      return renderAttachmentImage(node, context);
    default:
      return renderUnknownBlock(node, context);
  }
}

/**
 * The fallback for anything not named above — this includes `listItem`/
 * `taskItem` reached outside a list (defensive) and any node from a future
 * schema addition. Same discipline as `yjsMerge.ts`'s inline allow-list,
 * applied to blocks: an inline atom stranded at a block position is wrapped
 * as a one-node paragraph; anything else carrying a direct text child is
 * rendered the same way (never lose the text); anything else again recurses
 * into its children as further blocks, so an unknown wrapper around real
 * content never fuses two sibling blocks into one line.
 */
function renderUnknownBlock(node: Y.XmlElement, context: NoteMarkdownContext): string | null {
  if (INLINE_ELEMENT_NAMES.has(node.nodeName)) {
    return renderParagraphLike([node]);
  }
  const children = node.toArray();
  if (children.some((child) => child instanceof Y.XmlText)) {
    return renderParagraphLike(children);
  }
  const inner = renderBlocks(children, context);
  return inner.length > 0 ? inner : null;
}

/** A paragraph (or anything treated like one): its inline content, with the line-leading-construct escape applied; empty -> no block. */
function renderParagraphLike(children: readonly (Y.XmlElement | Y.XmlText | Y.XmlHook)[]): string | null {
  const inline = renderInline(children);
  return inline.length > 0 ? escapeLeadingConstructs(inline) : null;
}

/** `level` may arrive as a number or a string; coerced, defaulting to 1, clamped to 1-6. Never escapes leading constructs — a heading's `#`s are the real thing. */
function renderHeading(node: Y.XmlElement): string | null {
  const inline = renderInline(node.toArray());
  if (inline.length === 0) return null;
  const rawLevel = Number(node.getAttribute("level"));
  const level = Number.isFinite(rawLevel) ? clamp(Math.round(rawLevel), 1, 6) : 1;
  return `${"#".repeat(level)} ${inline}`;
}

/** Its children rendered as blocks, then every line (including a blank line between two child blocks) prefixed with "> " — an empty line becomes ">" with no dangling space. */
function renderBlockquote(node: Y.XmlElement, context: NoteMarkdownContext): string | null {
  const inner = renderBlocks(node.toArray(), context);
  if (inner.length === 0) return null;
  return inner
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

/** A fenced code block: text via `xmlTextContent` (never escaped, never marked up — code is code), fence lengthened past the longest backtick run the text itself contains. */
function renderCodeBlock(node: Y.XmlElement): string {
  const languageAttr = node.getAttribute("language");
  const language = typeof languageAttr === "string" ? languageAttr : "";
  const text = collectXmlText(node);
  const fence = "`".repeat(fenceLengthFor(text, 3));
  return `${fence}${language}\n${text}\n${fence}`;
}

function collectXmlText(node: Y.XmlElement): string {
  let out = "";
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) out += xmlTextContent(child);
  }
  return out;
}

/** The shortest fence, at least `minimum` backticks, that stays longer than any backtick run already in `text` — 3 for a fenced code block, 1 for an inline code span. */
function fenceLengthFor(text: string, minimum: number): number {
  const runs = text.match(/`+/g) ?? [];
  const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return Math.max(minimum, longestRun + 1);
}

/** One entry per `listItem` child: its own children rendered as blocks, first line marked, continuation lines indented past the marker; entries joined tightly (one blank line between blocks WITHIN an item, none between items). */
function renderBulletList(node: Y.XmlElement, context: NoteMarkdownContext): string | null {
  const entries: string[] = [];
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement && child.nodeName === "listItem") {
      const itemText = renderBlocks(child.toArray(), context);
      entries.push(prefixLines(itemText, "- ", "  "));
    }
  }
  return entries.length > 0 ? entries.join("\n") : null;
}

/** Same shape as `renderBulletList`, with `${n}. ` markers counting up from the `start` attribute (coerced, default 1). */
function renderOrderedList(node: Y.XmlElement, context: NoteMarkdownContext): string | null {
  const rawStart = Number(node.getAttribute("start"));
  let n = Number.isFinite(rawStart) ? Math.trunc(rawStart) : 1;
  const entries: string[] = [];
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement && child.nodeName === "listItem") {
      const marker = `${n}. `;
      const itemText = renderBlocks(child.toArray(), context);
      entries.push(prefixLines(itemText, marker, " ".repeat(marker.length)));
      n += 1;
    }
  }
  return entries.length > 0 ? entries.join("\n") : null;
}

/** Same shape again, over `taskItem` children; marker reflects the `checked` attribute (boolean `true` or the string `"true"`). */
function renderTaskList(node: Y.XmlElement, context: NoteMarkdownContext): string | null {
  const entries: string[] = [];
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement && child.nodeName === "taskItem") {
      // `Y.XmlElement`'s default TS generic types every attribute as `string`,
      // but a real document may store `checked` as a genuine boolean — widen
      // to `unknown` before comparing rather than trusting the too-narrow type.
      const checkedAttr: unknown = child.getAttribute("checked");
      const marker = checkedAttr === true || checkedAttr === "true" ? "- [x] " : "- [ ] ";
      const itemText = renderBlocks(child.toArray(), context);
      entries.push(prefixLines(itemText, marker, " ".repeat(marker.length)));
    }
  }
  return entries.length > 0 ? entries.join("\n") : null;
}

/**
 * Prefixes a (possibly multi-line) block's rendered text for one list entry:
 * `firstPrefix` on line 0, `continuationPrefix` on every line after. A blank
 * line — the separator between two blocks inside one item — is left bare:
 * indenting it would add nothing but invisible trailing whitespace, which
 * editors strip on save and diffs flag forever.
 */
function prefixLines(text: string, firstPrefix: string, continuationPrefix: string): string {
  return text
    .split("\n")
    .map((line, index) => {
      if (index === 0) return `${firstPrefix}${line}`;
      return line.length === 0 ? "" : `${continuationPrefix}${line}`;
    })
    .join("\n");
}

/** An unresolvable id (removed attachment, or no id at all) renders nothing — never a broken link. */
function renderAttachmentImage(node: Y.XmlElement, context: NoteMarkdownContext): string | null {
  const idAttr = node.getAttribute("attachmentId");
  if (typeof idAttr !== "string" || idAttr.length === 0) return null;
  const attachment = context.attachments.get(idAttr);
  if (!attachment) return null;
  const alt = attachment.fileName.replace(/[\\[\]]/g, (ch) => `\\${ch}`);
  return `![${alt}](${context.rootPrefix}blobs/${attachment.sha256})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// --- Inline pass ---------------------------------------------------------

/** Renders a sequence of inline siblings, concatenated (no separator — inline content is one continuous line, save for an explicit hardBreak). */
function renderInline(children: readonly (Y.XmlElement | Y.XmlText | Y.XmlHook)[]): string {
  let out = "";
  for (const child of children) out += renderInlineNode(child);
  return out;
}

function renderInlineNode(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return renderInlineText(node);
  if (node instanceof Y.XmlHook) return ""; // carries no text
  switch (node.nodeName) {
    case "hardBreak":
      // CommonMark's explicit hard break: two trailing spaces would be
      // silently stripped by editors/formatters that trim trailing whitespace.
      return "\\\n";
    case "noteLink":
      return renderNoteLinkInline(node);
    default:
      // Unknown inline-position node (including a block atom like
      // attachmentImage stranded here, defensively): never lose its text.
      return renderInline(node.toArray());
  }
}

/** `[[Label]]`, or escaped plain text when the label itself contains `[`/`]` and so cannot round-trip as a wiki-link. A missing/empty label renders nothing. */
function renderNoteLinkInline(node: Y.XmlElement): string {
  const label = node.getAttribute("label");
  if (typeof label !== "string" || label.length === 0) return "";
  if (label.includes("[") || label.includes("]")) return escapeText(label);
  return `[[${label}]]`;
}

/** One `Y.XmlText`'s delta, mark-aware: each string segment is code-wrapped or escaped, then wrapped innermost-to-outermost italic -> bold -> link. */
function renderInlineText(text: Y.XmlText): string {
  let out = "";
  for (const op of text.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
    if (typeof op.insert !== "string") continue; // an embed is never text (defensive; nothing in a note embeds one)
    out += renderTextRun(op.insert, op.attributes ?? {});
  }
  return out;
}

function renderTextRun(raw: string, attrs: Record<string, unknown>): string {
  let rendered = attrs["code"] ? wrapInlineCode(raw) : escapeText(raw);
  if (attrs["italic"]) rendered = `*${rendered}*`;
  if (attrs["bold"]) rendered = `**${rendered}**`;
  if (attrs["link"]) rendered = `[${rendered}](${renderHref(attrs["link"])})`;
  return rendered;
}

/** Backtick-fences `text` past its own longest backtick run, padding with a space on each side when the text itself starts or ends with a backtick (so the fence doesn't visually merge with it). Never escapes the text — code is code. */
function wrapInlineCode(text: string): string {
  const fence = "`".repeat(fenceLengthFor(text, 1));
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** The `link` mark's `href` lives at `attributes.link.href`; wrapped in `<…>` (with any `<`/`>` inside escaped) when it contains whitespace or parentheses, which would otherwise end the Markdown link early. */
function renderHref(linkAttr: unknown): string {
  const href = isRecord(linkAttr) && typeof linkAttr["href"] === "string" ? linkAttr["href"] : "";
  if (/[\s()]/.test(href)) {
    return `<${href.replace(/[<>]/g, (ch) => `\\${ch}`)}>`;
  }
  return href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Escapes plain (non-code) text so it round-trips as the literal characters
 * it represents rather than being read as Markdown syntax: a backslash
 * doubles, `` ` ``/`*`/`[`/`]`/`<` get a backslash in front, and `_` gets one
 * only at a word boundary (so `snake_case` stays readable while `_emphasis_`
 * is neutralised).
 */
function escapeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === "\\") {
      out += "\\\\";
    } else if (ch === "`" || ch === "*" || ch === "[" || ch === "]" || ch === "<") {
      out += `\\${ch}`;
    } else if (ch === "_") {
      const boundary = !isWordChar(text.charAt(i - 1)) || !isWordChar(text.charAt(i + 1));
      out += boundary ? "\\_" : "_";
    } else {
      out += ch;
    }
  }
  return out;
}

function isWordChar(ch: string): boolean {
  return /^[A-Za-z0-9]$/.test(ch);
}

/** A leading `#`/`>`/`-`/`+`/`=` would turn a paragraph LINE into a heading, a quote, a list item or a setext underline. */
const LEADING_PUNCTUATION = /^[#>\-+=]/;

/** A leading `<digits>` followed by `.` or `)` would turn the line into an ordered list item. */
const LEADING_ORDERED_MARKER = /^(\d+)([.)])/;

/**
 * Neutralises a line-leading construct in a paragraph's rendered text —
 * applied per line (a paragraph may hold hardBreak-separated lines) and to
 * paragraph output only, never to a heading or to the list/quote markers this
 * module generated itself.
 *
 * The backslash always goes before the PUNCTUATION, never before a digit:
 * CommonMark only recognises a backslash escape ahead of ASCII punctuation, so
 * `\1.` would render the backslash literally while `1\.` is the real escape.
 */
function escapeLeadingConstructs(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      LEADING_PUNCTUATION.test(line) ? `\\${line}` : line.replace(LEADING_ORDERED_MARKER, "$1\\$2"),
    )
    .join("\n");
}
