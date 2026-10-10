import { ZimError } from "./errors.js";

/**
 * Clusters: how the format packs many blobs into one compressed unit, and how
 * one blob is cut back out of it.
 *
 * From <https://wiki.openzim.org/wiki/ZIM_file_format> ("Clusters"): the first
 * byte of a cluster says how the rest is stored — the low nibble is the
 * compression scheme and bit 4 says the blob offsets are 8 bytes wide rather
 * than 4, "for clusters stored in a file larger than 4 GB". The research
 * measured both forms in the live catalogue: `0x05` (zstd) on every current
 * Wikipedia pack, `0x11` (no compression, extended) on the full-text index
 * cluster of a 118 GB file, `0x04` (LZMA2/XZ) on the 2019 format-5 pack, and
 * `0x01` on Gutenberg's EPUB payloads. All four are handled here; LZMA is
 * handled by refusing it, which is the decision the ADR records.
 *
 * **The uncompressed path never reads the cluster.** The offset table's first
 * value is its own length in bytes, so the table can be read on its own and the
 * blob's `[start, end)` then read straight from the file. That is what makes a
 * 9.5 GB index cluster tolerable: the alternative — decode the cluster, then
 * slice it — would read every byte of an index nobody asked to search.
 *
 * **The offsets are relative to the payload, i.e. to the byte AFTER the info
 * byte.** This is the trap the research recorded: the specification's table
 * reads as if the table starts at file offset 1 and the offsets are counted from
 * there, and libzim starts its sub-reader at `offset + 1` for the same reason.
 * Both descriptions agree once the first entry is understood to be the table's
 * own length; `blobRange` answers in payload coordinates and each caller adds
 * the payload's own position.
 */

/** No compression: the payload is the blobs verbatim. */
export const CLUSTER_NONE = 1;
/** LZMA2/XZ, used by format-5 files. Refused — see `parseClusterInfo`. */
export const CLUSTER_LZMA = 4;
/** Zstandard, what every current pack uses. */
export const CLUSTER_ZSTD = 5;

/**
 * The widest offset table this reader will accept.
 *
 * A table is 4 or 8 bytes per blob plus its own leading length, so this is a
 * bound of about four million blobs in one cluster — two orders of magnitude
 * more than any real file (the fixture's largest cluster holds 34). It exists so
 * that a hostile `tableBytes` cannot make this reader read sixteen megabytes of
 * table and then a blob range derived from it.
 */
export const MAX_TABLE_BYTES = 16 * 1024 * 1024;

/**
 * The largest single blob this reader returns, and the largest cluster it will
 * decompress. Both are memory bounds rather than format ones: a ZIM blob is an
 * article or an image (a megabyte or two measured), and the API this reader
 * serves is one entry at a time.
 */
export const MAX_BLOB_BYTES = 64 * 1024 * 1024;
export const MAX_DECOMPRESSED_CLUSTER_BYTES = 256 * 1024 * 1024;

export interface ClusterInfo {
  /** The low nibble: `CLUSTER_NONE`, `CLUSTER_LZMA` or `CLUSTER_ZSTD`. */
  readonly compression: number;
  /** Bit 4: the blob offsets in this cluster are 8 bytes wide. */
  readonly extended: boolean;
}

/**
 * The first byte of a cluster, or a refusal.
 *
 * LZMA is refused HERE rather than at the point of decompression, so a caller
 * asking for an entry in an old file gets one sentence naming the cause instead
 * of a decoder error. The code is `compression` and the message names the
 * format version, because "this file is from an era this build does not read"
 * is what the user can act on.
 */
export function parseClusterInfo(info: number): ClusterInfo {
  const compression = info & 0x0f;
  if (compression === CLUSTER_LZMA) {
    throw new ZimError(
      "compression",
      "This ZIM stores its content as LZMA/XZ (ZIM format 5). Nexus reads Zstandard and uncompressed clusters only.",
    );
  }
  if (compression !== CLUSTER_NONE && compression !== CLUSTER_ZSTD) {
    throw new ZimError(
      "compression",
      `This ZIM uses cluster compression ${String(compression)}, which this reader does not implement.`,
    );
  }
  return { compression, extended: (info & 0x10) !== 0 };
}

/** How wide one table entry is: 4 bytes, or 8 in the extended form. */
export function tableEntryBytes(extended: boolean): number {
  return extended ? 8 : 4;
}

/** One table entry, as a number, refusing an offset this reader cannot address. */
function tableEntry(table: Uint8Array, extended: boolean, index: number): number {
  const at = extended ? index * 8 : index * 4;
  if (at < 0 || at + (extended ? 8 : 4) > table.byteLength) {
    throw new ZimError("corrupt", "A blob offset table is shorter than it declares.");
  }
  const view = new DataView(table.buffer, table.byteOffset + at, extended ? 8 : 4);
  if (!extended) return view.getUint32(0, true);
  const value = view.getBigUint64(0, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZimError("too-large", "A blob offset is past the largest this reader can address.");
  }
  return Number(value);
}

/**
 * The offset table's own length, from its first entry.
 *
 * The first value is the length of the table in bytes, which is what makes the
 * blob count self-describing: the count is `length / entryBytes - 1`, and the
 * other entries are the offsets of the blobs.
 */
export function tableBytesOf(table: Uint8Array, extended: boolean): number {
  const declared = tableEntry(table, extended, 0);
  const entryBytes = tableEntryBytes(extended);
  if (declared < entryBytes || declared % entryBytes !== 0) {
    throw new ZimError("corrupt", "A cluster's blob offset table has an impossible length.");
  }
  if (declared > MAX_TABLE_BYTES) {
    throw new ZimError("too-large", "A cluster's blob offset table is larger than this reader will read.");
  }
  return declared;
}

/** How many blobs a cluster holds, from its table. */
export function blobCountOf(table: Uint8Array, extended: boolean): number {
  return tableBytesOf(table, extended) / tableEntryBytes(extended) - 1;
}

/**
 * One blob's `[start, end)` inside the cluster's payload — the bytes after the
 * info byte, including the offset table.
 *
 * Every entry is validated against the next one and against `payloadBytes`, so a
 * table that runs backwards, names a blob past the payload, or claims more blobs
 * than it can hold is refused here rather than producing a subarray of the wrong
 * bytes. `payloadBytes` is the decoded length for a compressed cluster and the
 * cluster's own length minus one for an uncompressed one.
 */
export function blobRange(
  table: Uint8Array,
  extended: boolean,
  blobIndex: number,
  payloadBytes: number,
): { start: number; end: number } {
  const entryBytes = tableEntryBytes(extended);
  const tableBytes = tableBytesOf(table, extended);
  const count = tableBytes / entryBytes - 1;
  if (!Number.isInteger(blobIndex) || blobIndex < 0 || blobIndex >= count) {
    throw new ZimError(
      "corrupt",
      `A directory entry names blob ${String(blobIndex)}, but its cluster holds ${String(count)}.`,
    );
  }
  // The table has one more entry than the cluster has blobs: entry 0 is both
  // the table's own length and the first blob's start, and the LAST entry is
  // the offset of the end of the data area — the spec states that "there is
  // always one more offset than blobs", and it is what makes the final blob's
  // length well defined without a second count.
  const start = tableEntry(table, extended, blobIndex);
  const end = tableEntry(table, extended, blobIndex + 1);
  if (end < start || end > payloadBytes) {
    throw new ZimError("corrupt", "A cluster's blob offsets do not describe a blob inside it.");
  }
  if (end - start > MAX_BLOB_BYTES) {
    throw new ZimError("too-large", "A blob is larger than this reader will hold.");
  }
  return { start, end };
}
