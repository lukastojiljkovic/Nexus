import { ZimError } from "./errors.js";

/**
 * Directory entries, parsed from the bytes a caller read at the offset the URL
 * pointer list named.
 *
 * The entry is the format's smallest unit of "a thing with a name": what an
 * entry is called, what its MIME type is, and either which blob holds it or
 * which other entry it redirects to. Implemented from
 * <https://wiki.openzim.org/wiki/ZIM_file_format> ("Content Entry" and "Redirect
 * Entry"): a content entry carries `mimetype, parameter len, namespace,
 * revision, cluster number, blob number, path, title`, and a redirect entry is
 * the same layout with a 4-byte **redirect index** in place of the cluster and
 * blob numbers — twelve header bytes instead of sixteen.
 *
 * **The redirect layout is the trap in this format**, and it is why the two
 * shapes are parsed in one function rather than by two parsers with a `+4` in
 * one of them: a reader that assumes sixteen header bytes for both reads a
 * redirect's path four bytes early and finds a plausible-looking string, so the
 * damage is a wrong page rather than an error. The five redirects in the
 * `wikibooks_be_all_nopic_2017-02.zim` fixture are what pins this.
 *
 * **`0xfffe` (linktarget) and `0xfffd` (deleted) get no parse.** The
 * specification's table does not give their field layout, so this reader reports
 * them as `ignored` and reads nothing: an entry it does not need to understand
 * cannot be read wrongly. They exist in old files, the research counted them in
 * the format's own summary, and the correct handling of one is to leave it
 * out of every list rather than to guess at its bytes.
 */

/** The MIME-type value that marks a redirect entry. */
export const REDIRECT_MIMETYPE = 0xffff;
/** Deprecated marker: an entry that is a link target rather than content. */
export const LINKTARGET_MIMETYPE = 0xfffe;
/** Deprecated marker: an entry that has been deleted. */
export const DELETED_MIMETYPE = 0xfffd;

/** The longest path or title this reader will hold, in bytes. Longest real path measured in the fixture: 60. */
export const MAX_NAME_BYTES = 4096;

export interface ZimContentDirent {
  readonly kind: "content";
  readonly mimetype: number;
  readonly namespace: string;
  readonly revision: number;
  readonly cluster: number;
  readonly blob: number;
  readonly path: string;
  readonly title: string;
}

export interface ZimRedirectDirent {
  readonly kind: "redirect";
  readonly namespace: string;
  readonly revision: number;
  /** The entry index of the target, into the same URL pointer list. */
  readonly redirectIndex: number;
  readonly path: string;
  readonly title: string;
}

/** A `0xfffe`/`0xfffd` entry: present in the file, deliberately not understood. */
export interface ZimIgnoredDirent {
  readonly kind: "ignored";
  readonly mimetype: number;
}

export type ZimDirent = ZimContentDirent | ZimRedirectDirent | ZimIgnoredDirent;

/**
 * One entry, from the bytes at its own offset.
 *
 * `bytes` is a bounded chunk beginning at the entry — the caller caps it, which
 * is the whole reason a hostile file cannot make this function read without
 * bound. A string that is not terminated inside the chunk is `corrupt`, and so
 * is a chunk too short for even the header.
 */
export function parseDirent(bytes: Uint8Array): ZimDirent {
  if (bytes.byteLength < 3) {
    throw new ZimError("corrupt", "A directory entry is shorter than its own header.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mimetype = view.getUint16(0, true);
  if (mimetype === LINKTARGET_MIMETYPE || mimetype === DELETED_MIMETYPE) {
    return { kind: "ignored", mimetype };
  }
  const namespace = String.fromCharCode(bytes[3] ?? 0);
  const revision = bytes.byteLength >= 8 ? view.getUint32(4, true) : 0;
  if (mimetype === REDIRECT_MIMETYPE) {
    if (bytes.byteLength < 12) {
      throw new ZimError("corrupt", "A redirect entry is shorter than its own header.");
    }
    const names = parseNames(bytes, 12);
    return {
      kind: "redirect",
      namespace,
      revision,
      redirectIndex: view.getUint32(8, true),
      path: names.path,
      title: names.title,
    };
  }
  if (bytes.byteLength < 16) {
    throw new ZimError("corrupt", "A content entry is shorter than its own header.");
  }
  const names = parseNames(bytes, 16);
  return {
    kind: "content",
    mimetype,
    namespace,
    revision,
    cluster: view.getUint32(8, true),
    blob: view.getUint32(12, true),
    path: names.path,
    title: names.title,
  };
}

/**
 * The path and the title, which are the two zero-terminated strings every entry
 * ends with. The spec's `parameter` bytes come after them and are deliberately
 * neither read nor validated: they are documented as unused, every file the
 * research measured carries none, and their length is a field a hostile file
 * could use to point a reader at arbitrary bytes for no benefit.
 */
function parseNames(bytes: Uint8Array, from: number): { path: string; title: string } {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const pathEnd = bytes.indexOf(0, from);
  if (pathEnd < 0) throw new ZimError("corrupt", "A directory entry's path is not terminated.");
  if (pathEnd - from > MAX_NAME_BYTES) {
    throw new ZimError("too-large", "A directory entry's path is implausibly long.");
  }
  const titleEnd = bytes.indexOf(0, pathEnd + 1);
  if (titleEnd < 0) throw new ZimError("corrupt", "A directory entry's title is not terminated.");
  if (titleEnd - pathEnd - 1 > MAX_NAME_BYTES) {
    throw new ZimError("too-large", "A directory entry's title is implausibly long.");
  }
  return {
    path: decoder.decode(bytes.subarray(from, pathEnd)),
    title: decoder.decode(bytes.subarray(pathEnd + 1, titleEnd)),
  };
}

/**
 * The name an entry is known by when its title is empty.
 *
 * The spec says so in as many words ("in case it is empty, the path is used as
 * title"), and it is not a detail: every image, every asset and every `M/`
 * metadata entry in a real file carries no title, so a title list built without
 * this rule is short by however many of those the file has. In the fixture, 106
 * of 118 entries have an empty title.
 */
export function displayTitle(dirent: ZimDirent): string {
  if (dirent.kind === "ignored") return "";
  return dirent.title === "" ? dirent.path : dirent.title;
}

/**
 * The key the URL pointer list is sorted by: the namespace byte followed by the
 * path, compared as UTF-8 BYTES.
 *
 * Byte order rather than locale order, because the file's own writer sorted it
 * with a byte comparison and binary search is only correct against the same
 * order. The fixture is what proves it holds for real content: `A/Main_Page.html`
 * sorts before `A/Першая_старонка.html`, and it does so in both orders — but
 * only byte order puts `A/index.htm` between them, which is where the file has
 * it.
 */
export function pathKey(namespace: string, path: string): Uint8Array {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(`${namespace}/${path}`);
  return encoded;
}

/** Byte-wise comparison of two `pathKey`s, the order both pointer lists are in. */
export function compareKeys(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let at = 0; at < length; at += 1) {
    const a = left[at] ?? 0;
    const b = right[at] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return left.byteLength - right.byteLength;
}
