/**
 * The PMTiles v3 format, as far as cutting a region needs it: the header, and
 * the directories that map tile ids to byte ranges.
 *
 * **The `pmtiles` library reads; this file writes.** The library is the map
 * view's reader and already parses headers (`bytesToHeader`) and varints
 * (`readVarint`), so reading goes through it. It has no writer, so writing the
 * header and a directory is here, and the tests prove the two agree by reading
 * this file's output back with the library.
 *
 * **Numbers past 2^32.** The planet's offsets are in the hundreds of gigabytes,
 * so the varint writer uses division rather than bit shifts, which JavaScript
 * performs on 32 bits.
 */

import { gunzipSync, gzipSync } from "node:zlib";

import { bytesToHeader, Compression, readVarint, type Entry, type Header } from "pmtiles";

/** The header's fixed size (spec §3). */
export const HEADER_BYTES = 127;

/** What a reader fetches first: the header and the root directory must both fit in it (spec §3). */
export const ROOT_SPAN = 16_384;

/** The leaf size the packer starts from, and how much it grows a leaf by when the root still does not fit (go-pmtiles' values). */
const FIRST_LEAF_ENTRIES = 4_096;
const LEAF_GROWTH = 1.2;

const MAGIC = "PMTiles";

/** The header in `bytes`, refused unless it is a version 3 archive. */
export function readHeader(bytes: Uint8Array): Header {
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`A PMTiles header is ${String(HEADER_BYTES)} bytes; got ${String(bytes.length)}.`);
  }
  if (new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) {
    throw new Error("The file is not a PMTiles archive.");
  }
  if (bytes[7] !== 3) throw new Error(`The archive is PMTiles version ${String(bytes[7])}; only version 3 is read.`);
  return bytesToHeader(bytes.slice(0, HEADER_BYTES).buffer);
}

/** The 127 header bytes for `header`. */
export function writeHeader(header: Header): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(MAGIC), 0);
  bytes[7] = 3;
  const u64 = [
    header.rootDirectoryOffset,
    header.rootDirectoryLength,
    header.jsonMetadataOffset,
    header.jsonMetadataLength,
    header.leafDirectoryOffset,
    header.leafDirectoryLength ?? 0,
    header.tileDataOffset,
    header.tileDataLength ?? 0,
    header.numAddressedTiles,
    header.numTileEntries,
    header.numTileContents,
  ];
  u64.forEach((value, index) => view.setBigUint64(8 + index * 8, BigInt(value), true));
  bytes[96] = header.clustered ? 1 : 0;
  bytes[97] = header.internalCompression;
  bytes[98] = header.tileCompression;
  bytes[99] = header.tileType;
  bytes[100] = header.minZoom;
  bytes[101] = header.maxZoom;
  const e7 = (degrees: number) => Math.round(degrees * 1e7);
  view.setInt32(102, e7(header.minLon), true);
  view.setInt32(106, e7(header.minLat), true);
  view.setInt32(110, e7(header.maxLon), true);
  view.setInt32(114, e7(header.maxLat), true);
  bytes[118] = header.centerZoom;
  view.setInt32(119, e7(header.centerLon), true);
  view.setInt32(123, e7(header.centerLat), true);
  return bytes;
}

/**
 * The most one directory or the metadata may inflate to. A policy value: far
 * above anything the planet build stores, and low enough that a malformed or
 * hostile archive cannot fill memory from a few kilobytes of gzip.
 */
export const INFLATED_MAX_BYTES = 64 * 1024 * 1024;

/** `bytes` with the archive's internal compression undone. */
export function decompress(bytes: Uint8Array, compression: Compression): Uint8Array {
  if (compression === Compression.None) return bytes;
  if (compression === Compression.Gzip) {
    try {
      return new Uint8Array(gunzipSync(bytes, { maxOutputLength: INFLATED_MAX_BYTES }));
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== "ERR_BUFFER_TOO_LARGE") throw failure;
      throw new Error(`The archive holds a directory larger than ${String(INFLATED_MAX_BYTES)} bytes.`, {
        cause: failure,
      });
    }
  }
  throw new Error(`The archive uses internal compression ${String(compression)}; only none and gzip are read.`);
}

/** A directory's entries, from its bytes as stored (spec §4). */
export function decodeDirectory(bytes: Uint8Array, compression: Compression): Entry[] {
  const position = { buf: decompress(bytes, compression), pos: 0 };
  const varint = () => {
    if (position.pos >= position.buf.length) throw new Error("The directory ends early.");
    return readVarint(position);
  };
  const count = varint();
  const entries: Entry[] = [];
  let tileId = 0;
  for (let index = 0; index < count; index += 1) {
    tileId += varint();
    entries.push({ tileId, offset: 0, length: 0, runLength: 1 });
  }
  for (const entry of entries) entry.runLength = varint();
  for (const entry of entries) entry.length = varint();
  entries.forEach((entry, index) => {
    const value = varint();
    const previous = entries[index - 1];
    // Zero means "right after the previous entry's bytes", which is how a
    // clustered archive stores almost every offset in one byte.
    entry.offset = value === 0 && previous !== undefined ? previous.offset + previous.length : value - 1;
  });
  return entries;
}

/** A directory's bytes: the spec's four varint columns, gzip-compressed. */
export function encodeDirectory(entries: readonly Entry[]): Uint8Array {
  const out: number[] = [];
  const varint = (value: number) => {
    let rest = value;
    while (rest >= 0x80) {
      out.push((rest % 0x80) + 0x80);
      rest = Math.floor(rest / 0x80);
    }
    out.push(rest);
  };
  varint(entries.length);
  let lastId = 0;
  for (const entry of entries) {
    varint(entry.tileId - lastId);
    lastId = entry.tileId;
  }
  for (const entry of entries) varint(entry.runLength);
  for (const entry of entries) varint(entry.length);
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    varint(previous !== undefined && entry.offset === previous.offset + previous.length ? 0 : entry.offset + 1);
  });
  return new Uint8Array(gzipSync(Uint8Array.from(out)));
}

/**
 * The root directory and the leaf section for `entries`.
 *
 * Everything stays in the root when it fits `rootBudget`, which by default is
 * what the first fetch leaves after the header. Otherwise the entries are cut
 * into leaves of growing size until the root that points at them fits.
 */
export function packDirectories(
  entries: readonly Entry[],
  rootBudget = ROOT_SPAN - HEADER_BYTES,
): { root: Uint8Array; leaves: Uint8Array } {
  const whole = encodeDirectory(entries);
  if (whole.length <= rootBudget) return { root: whole, leaves: new Uint8Array(0) };
  for (let leafSize = FIRST_LEAF_ENTRIES; ; leafSize = Math.ceil(leafSize * LEAF_GROWTH)) {
    const leaves: Uint8Array[] = [];
    const pointers: Entry[] = [];
    let offset = 0;
    for (let start = 0; start < entries.length; start += leafSize) {
      const leaf = encodeDirectory(entries.slice(start, start + leafSize));
      pointers.push({ tileId: (entries[start] as Entry).tileId, offset, length: leaf.length, runLength: 0 });
      leaves.push(leaf);
      offset += leaf.length;
    }
    const root = encodeDirectory(pointers);
    if (root.length <= rootBudget) return { root, leaves: Buffer.concat(leaves) };
    if (leafSize >= entries.length) throw new Error("The directory cannot fit its root budget.");
  }
}
