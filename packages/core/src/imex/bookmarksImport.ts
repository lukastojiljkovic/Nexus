/**
 * Pure reader for browser bookmarks in the Netscape bookmark format (IMEX-007),
 * the HTML file Chrome, Edge and Firefox all export. It sits beside
 * `icsImport.ts` and has the same two halves: `parseBookmarksHtml` turns the
 * untrusted TEXT into plain folders and counted losses, and
 * `translateBookmarks` turns those into the note rows `planForeignImport`
 * merges.
 *
 * Four decisions a reader would otherwise have to reverse-engineer:
 *
 *  - **One note per folder that holds a kept bookmark.** The note's first block
 *    is its title, the folder path (`Work / Docs`), and the body is a list of
 *    `[title](url)` links in file order — the markdown shape a reader can open
 *    in Notes and read at a glance. The folder tree itself is not rebuilt: the
 *    path is the title, which keeps the import flat the way the notes module is.
 *
 *  - **Only `http:` and `https:` links are kept.** `javascript:`, `data:`,
 *    `file:`, Firefox's `place:` queries and anything else are not web pages a
 *    user can open from a note, so they are skipped and counted, never silently
 *    dropped.
 *
 *  - **The parser is a single forward scan.** It finds each `<` with `indexOf`
 *    and reads text up to the next `<`, so no pattern in this file can backtrack
 *    against a hostile file. A tag's end is found by `tagEnd`, which respects
 *    quoted attribute values, because a URL may contain a `>`.
 *
 *  - **Everything the file does not say is tolerated.** Unclosed `<DT>`s, a
 *    stray `</DL>` and missing `</H3>`s are all read as far as they can be; the
 *    only whole-file refusal is text with no `<DL>` at all, since every real
 *    bookmark file has one.
 */

import { buildNoteUpdate, type MarkdownBlock } from "./markdownImport.js";
import { emptyImportedProfile } from "./emptyImportedProfile.js";
import type { ExportNote, ExportNoteTag, ExportNoteTagLink, ProfileData } from "./exportArchive.js";

/** Why a bookmark is not in the result. The one code so far; a list keeps the preview's shape the calendar's has. */
export type BookmarksImportSkipCode = "unsupported-url";

export interface BookmarksImportSkip {
  code: BookmarksImportSkipCode;
  count: number;
}

export interface BookmarkEntry {
  /** The link's text, or its URL when the file gave it none. */
  title: string;
  /** The `http:` or `https:` URL exactly as the file wrote it, entities decoded. */
  url: string;
}

/** One folder's kept bookmarks. `path` is the folder names from the top of the file down; empty for the file's top level. */
export interface BookmarkFolder {
  path: readonly string[];
  bookmarks: readonly BookmarkEntry[];
}

export interface ParsedBookmarks {
  /** Folders holding at least one kept bookmark, in file order. */
  folders: readonly BookmarkFolder[];
  /** Kept bookmarks across every folder. */
  bookmarks: number;
  /** Every named loss, zero-count lines omitted. */
  skips: readonly BookmarksImportSkip[];
}

/** The one whole-file refusal: text with no `<DL>` in it is not a bookmark file. */
export type BookmarksParseResult =
  | { status: "failed"; code: "not-bookmarks" }
  | { status: "ok"; bookmarks: ParsedBookmarks };

// --- Scanning ----------------------------------------------------------------

const DL_OPENING = /<dl[\s>]/i;
const TAG_NAME = /^[A-Za-z0-9]+/;
const HREF_ATTRIBUTE = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body[0] !== "#") return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    const isHex = body[1] === "x" || body[1] === "X";
    const codePoint = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole;
  });
}

/** The index of the `>` that closes the tag starting at `from`, or -1. A quoted attribute value is skipped whole, so a `>` inside a URL does not end the tag. */
function tagEnd(text: string, from: number): number {
  let quote: string | null = null;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if ((char === '"' || char === "'") && text[index - 1] === "=") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

/** The text an element holds: everything from `from` up to the next tag, decoded and trimmed. */
function textAt(text: string, from: number): string {
  const next = text.indexOf("<", from);
  return decodeEntities(text.slice(from, next === -1 ? text.length : next)).trim();
}

/** Whether a link's URL is one a note may carry: an absolute `http:` or `https:` URL, nothing else. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// --- Parsing -----------------------------------------------------------------

interface OpenFolder {
  path: readonly string[];
  bookmarks: BookmarkEntry[];
}

/**
 * Reads one Netscape bookmark file. `<H3>` names the folder whose `<DL>` follows
 * it; every `<A HREF>` between a `<DL>` and its `</DL>` belongs to that folder.
 * The file's top level is a folder of its own, with an empty path.
 */
export function parseBookmarksHtml(text: string): BookmarksParseResult {
  if (!DL_OPENING.test(text)) return { status: "failed", code: "not-bookmarks" };

  const folders: OpenFolder[] = [];
  const stack: OpenFolder[] = [];
  const open = (path: readonly string[]): void => {
    const folder: OpenFolder = { path, bookmarks: [] };
    folders.push(folder);
    stack.push(folder);
  };
  open([]);

  let unsupported = 0;
  let kept = 0;
  let pendingName: string | null = null;
  let position = 0;

  for (;;) {
    const start = text.indexOf("<", position);
    if (start === -1) break;
    const end = tagEnd(text, start + 1);
    if (end === -1) break;

    const tag = text.slice(start + 1, end);
    position = end + 1;
    const closing = tag.startsWith("/");
    const name = (TAG_NAME.exec(closing ? tag.slice(1) : tag)?.[0] ?? "").toUpperCase();

    if (name === "DL" && !closing) {
      const parent = stack[stack.length - 1]?.path ?? [];
      open(pendingName === null ? parent : [...parent, pendingName]);
      pendingName = null;
    } else if (name === "DL" && stack.length > 1) {
      stack.pop();
      pendingName = null;
    } else if (name === "H3" && !closing) {
      pendingName = textAt(text, position) || null;
    } else if (name === "A" && !closing) {
      const href = HREF_ATTRIBUTE.exec(tag);
      if (href === null) continue;
      const url = decodeEntities(href[1] ?? href[2] ?? href[3] ?? "").trim();
      const title = textAt(text, position) || url;
      if (!isWebUrl(url)) {
        unsupported += 1;
        continue;
      }
      stack[stack.length - 1]?.bookmarks.push({ title, url });
      kept += 1;
    }
  }

  const bookmarkFolders = folders
    .filter((folder) => folder.bookmarks.length > 0)
    .map(({ path, bookmarks }) => ({ path, bookmarks }));
  const skips: BookmarksImportSkip[] = unsupported > 0 ? [{ code: "unsupported-url", count: unsupported }] : [];

  return { status: "ok", bookmarks: { folders: bookmarkFolders, bookmarks: kept, skips } };
}

// --- Translation -------------------------------------------------------------

/** The cap `notes.title` carries, as `markdownImport.ts` derives an imported title. */
const MAX_TITLE_LENGTH = 200;

export interface BookmarksTranslateTarget {
  /** The profile every row is stamped with. */
  profileId: string;
  /** ISO-8601, injected: this module reads no clock. Every row's `createdAt`/`updatedAt`. */
  now: string;
  /** The one tag every imported note carries; a tag already in the profile under this name is merged into, not duplicated. */
  tagName: string;
  /** The title of the note holding the file's top-level bookmarks, which have no folder to name them. */
  rootTitle: string;
}

/**
 * Bookmark folders as the profile data an import inserts: one note per folder,
 * all of them under the one tag. Written against `emptyImportedProfile`, so every
 * collection a bookmark file does not carry stays empty.
 */
export function translateBookmarks(
  bookmarks: ParsedBookmarks,
  target: BookmarksTranslateTarget,
): ProfileData {
  const notes: ExportNote[] = bookmarks.folders.map((folder, index) => {
    const title = folder.path.length > 0 ? folder.path.join(" / ") : target.rootTitle;
    const blocks: MarkdownBlock[] = [
      { type: "heading", level: 1, content: [{ type: "text", text: title.slice(0, MAX_TITLE_LENGTH), marks: {} }] },
      {
        type: "bulletList",
        items: folder.bookmarks.map((bookmark) => [
          {
            type: "paragraph",
            content: [{ type: "text", text: bookmark.title, marks: { link: bookmark.url } }],
          },
        ]),
      },
    ];
    return {
      id: `bookmarks:note:${index}`,
      profileId: target.profileId,
      title: title.slice(0, MAX_TITLE_LENGTH),
      folderId: null,
      categoryId: null,
      pinned: false,
      cardDeckId: null,
      createdAt: target.now,
      updatedAt: target.now,
      snapshot: buildNoteUpdate(blocks),
    };
  });

  const tag: ExportNoteTag = {
    id: "bookmarks:tag",
    profileId: target.profileId,
    name: target.tagName,
    createdAt: target.now,
  };
  const noteTagLinks: ExportNoteTagLink[] = notes.map((note) => ({ noteId: note.id, tagId: tag.id }));

  return {
    ...emptyImportedProfile(),
    notes,
    noteTags: notes.length > 0 ? [tag] : [],
    noteTagLinks,
  };
}
