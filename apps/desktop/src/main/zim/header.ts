import { ZimError } from "./errors.js";

/**
 * The ZIM header, and the two numbers in it that make the rest of the file
 * safe to read.
 *
 * Implemented from the openZIM file-format specification,
 * <https://wiki.openzim.org/wiki/ZIM_file_format> ("Header" and "MIME type
 * list"), for format **6.x** and the **5.x** files still in the Kiwix
 * catalogue — the two the research measured. Nothing here is copied from the
 * wiki's prose: the field list below is a restatement of the table, and every
 * number is one this file computes.
 *
 * **Why the header is parsed against the FILE SIZE and not on its own.** Every
 * other offset in the format is a pointer INTO the file, and the header is where
 * they all come from, so "is this header consistent" cannot be answered by the
 * header alone. `parseZimHeader` therefore takes the size, and refuses a
 * `checksumPos` past it, a pointer list that would extend past the checksum, and
 * a `mainPage` index that names no entry. A file that fails any of those is
 * refused here, once, rather than at whichever read happens to touch the bad
 * number first.
 *
 * **Why the two page fields are checked now and not when somebody asks for the
 * main page.** `0xffffffff` is the format's "there is none", and a value that is
 * neither that nor a valid entry index is a broken file. Both are read against
 * `entryCount` here, so `mainPagePath` downstream has one case to handle
 * (`null`) instead of two.
 */

/** `72173914` in the spec's decimal spelling; the four bytes are `44 4d 49 5a` = "ZIMD" read as a little-endian uint32. */
export const ZIM_MAGIC = 0x044d495a;

/** The header is exactly this long, and in every version this reader knows the MIME list begins right after it. */
export const ZIM_HEADER_BYTES = 80;

/**
 * How much of the file is read to find the MIME list's terminator.
 *
 * The list is a handful of short strings in every real file (six in the
 * fixture, and the longest measured is `application/octet-stream+xapian` at 31
 * characters), so four kilobytes is a hundredfold headroom — and it is a CAP,
 * because a list without its terminating empty string must fail rather than be
 * read to the end of a 100 GB file.
 */
export const MAX_HEADER_READ_BYTES = 4096;

/** The format's "this page does not exist". */
export const NO_PAGE = 0xffffffff;

/**
 * The major versions this reader implements.
 *
 * 6 is what every current Kiwix file is (measured: the Serbian and English
 * Wikipedia packs, Gutenberg, DevDocs). 5 is the minority still in the
 * catalogue, and it differs from 6 only in what the clusters may use as
 * compression — which `cluster.ts` handles by refusing LZMA with a sentence
 * rather than by pretending the file is unreadable. A major version outside this
 * pair is refused by name, because the format's own rule is that a major bump
 * means a change a reader may not assume.
 */
export const SUPPORTED_MAJOR_VERSIONS: readonly number[] = [5, 6];

export interface ZimHeader {
  readonly majorVersion: number;
  readonly minorVersion: number;
  /** How many directory entries the file has — the length of both pointer lists. */
  readonly entryCount: number;
  readonly clusterCount: number;
  readonly urlPtrPos: number;
  readonly titlePtrPos: number;
  readonly clusterPtrPos: number;
  /** Where the zero-terminated MIME list begins. */
  readonly mimeListPos: number;
  /** The entry index of the main page, or `null`. */
  readonly mainPage: number | null;
  /** The entry index of the layout page, or `null`. */
  readonly layoutPage: number | null;
  /** The offset of the 16 checksum bytes, which are the last 16 bytes of the file. */
  readonly checksumPos: number;
}

/**
 * A uint64 header field as a JS number.
 *
 * Offsets in the format are 64-bit and the English Wikipedia pack already uses
 * one above 2^32 (measured: a 9.5 GB cluster starts past byte 127 billion is
 * where the file ENDS, but the index cluster alone reaches past 8 GB). Numbers
 * above 2^53 cannot be represented exactly, and an inexact offset is a read of
 * the wrong bytes — so the conversion is refused rather than rounded, and the
 * refusal is `too-large` because a file that large cannot be addressed by this
 * reader at all.
 */
function readOffset(bytes: Uint8Array, at: number, what: string): number {
  const value = new DataView(bytes.buffer, bytes.byteOffset + at, 8).getBigUint64(0, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZimError("too-large", `${what} is past the largest offset this reader can address.`);
  }
  return Number(value);
}

/**
 * The header of a ZIM whose size is `fileSize`, or a `ZimError` naming the rule
 * it broke. `bytes` must be the file's first `ZIM_HEADER_BYTES` bytes.
 */
export function parseZimHeader(bytes: Uint8Array, fileSize: number): ZimHeader {
  if (bytes.byteLength < ZIM_HEADER_BYTES) {
    throw new ZimError("not-zim", "The file is shorter than a ZIM header.");
  }
  if (fileSize < ZIM_HEADER_BYTES) {
    throw new ZimError("not-zim", "The file is shorter than a ZIM header.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, ZIM_HEADER_BYTES);
  if (view.getUint32(0, true) !== ZIM_MAGIC) {
    throw new ZimError("not-zim", "These are not the ZIM magic bytes.");
  }
  const majorVersion = view.getUint16(4, true);
  if (!SUPPORTED_MAJOR_VERSIONS.includes(majorVersion)) {
    throw new ZimError(
      "version",
      `ZIM format ${String(majorVersion)} is not one this reader implements (it reads ${SUPPORTED_MAJOR_VERSIONS.join(" and ")}).`,
    );
  }
  const entryCount = view.getUint32(24, true);
  const clusterCount = view.getUint32(28, true);
  const urlPtrPos = readOffset(bytes, 32, "The URL pointer list");
  const titlePtrPos = readOffset(bytes, 40, "The title pointer list");
  const clusterPtrPos = readOffset(bytes, 48, "The cluster pointer list");
  const mimeListPos = readOffset(bytes, 56, "The MIME list");
  const mainPage = view.getUint32(64, true);
  const layoutPage = view.getUint32(68, true);
  const checksumPos = readOffset(bytes, 72, "The checksum position");

  if (checksumPos < ZIM_HEADER_BYTES || checksumPos + 16 > fileSize) {
    throw new ZimError("out-of-range", "The checksum position is not inside the file.");
  }
  // The two pointer lists and the cluster pointer list are the three arrays the
  // header places; each has a length derivable from its own count, and each is
  // held to the region before the checksum so a later read can never land in the
  // trailer.
  requireRegion(urlPtrPos, entryCount * 8, checksumPos, "The URL pointer list");
  requireRegion(titlePtrPos, entryCount * 4, checksumPos, "The title pointer list");
  requireRegion(clusterPtrPos, clusterCount * 8, checksumPos, "The cluster pointer list");
  requireRegion(mimeListPos, 2, checksumPos, "The MIME list");

  return {
    majorVersion,
    minorVersion: view.getUint16(6, true),
    entryCount,
    clusterCount,
    urlPtrPos,
    titlePtrPos,
    clusterPtrPos,
    mimeListPos,
    mainPage: entryIndexOrNull(mainPage, entryCount),
    layoutPage: entryIndexOrNull(layoutPage, entryCount),
    checksumPos,
  };
}

/**
 * A page field: `null` for the format's "none", the index when it names an
 * entry, and a refusal for anything else.
 *
 * A number that is neither is not a file this reader can describe, and reading
 * past it would be reading whatever happens to be at that offset.
 */
function entryIndexOrNull(value: number, entryCount: number): number | null {
  if (value === NO_PAGE) return null;
  if (value >= entryCount) {
    throw new ZimError("corrupt", `The header names entry ${String(value)}, which the file does not have.`);
  }
  return value;
}

function requireRegion(at: number, length: number, limit: number, what: string): void {
  if (at < ZIM_HEADER_BYTES && at !== 0) {
    throw new ZimError("out-of-range", `${what} starts inside the header.`);
  }
  if (at > limit || at + length > limit) {
    throw new ZimError("out-of-range", `${what} does not fit inside the file.`);
  }
}

/** The MIME types, in the order the directory entries index them. */
export function parseMimeList(bytes: Uint8Array): readonly string[] {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const types: string[] = [];
  let at = 0;
  for (;;) {
    const end = bytes.indexOf(0, at);
    if (end < 0) {
      throw new ZimError("corrupt", "The MIME list is not terminated.");
    }
    if (end === at) return types;
    // A MIME type is an ASCII token of the shape `type/subtype`; anything
    // longer than this is not one, and the bound keeps a hostile list from
    // being turned into a million strings.
    if (end - at > 255) {
      throw new ZimError("corrupt", "A MIME type in the list is implausibly long.");
    }
    types.push(decoder.decode(bytes.subarray(at, end)));
    at = end + 1;
    if (types.length > 512) {
      throw new ZimError("corrupt", "The MIME list has more entries than a ZIM may declare.");
    }
  }
}
