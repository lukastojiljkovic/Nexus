import { createHash } from "node:crypto";
import { zstdCompressSync } from "node:zlib";

import { ZIM_HEADER_BYTES } from "../header.js";
import { compareKeys, pathKey } from "../dirent.js";
import { CLUSTER_LZMA, CLUSTER_NONE, CLUSTER_ZSTD } from "../cluster.js";

/**
 * A tiny ZIM WRITER, for tests only.
 *
 * **Why the repository contains a writer it does not ship.** A reader's tests
 * need files it can assert exactly: a zstd cluster, an extended (8-byte) offset
 * table, a main page, a redirect, a corrupt checksum — and the one real fixture
 * the suite carries (`fixtures/`, openZIM's Belarusian Wikibooks pack) is a
 * **format 5.0** file whose content cluster is LZMA, which this reader refuses
 * by design. So the compression path has no real file to run against, and the
 * honest answer is to write one rather than to leave the path untested or to
 * weaken the reader to reach the fixture.
 *
 * **It implements the format, not a shortcut.** The header is the 80 bytes the
 * specification lists, the two pointer lists are sorted by the keys the format
 * says they are sorted by, the entries are emitted in that same order, the
 * clusters carry a real offset table, and the trailer is a real MD5 of the bytes
 * before it. The property that matters is that nothing in `reader.ts` was
 * written against this file: the shipped fixture is what proves that.
 *
 * Nothing here is imported by a shipped file.
 */

export type BuildCompression = "none" | "zstd" | "lzma";

export interface BuildCluster {
  readonly blobs: readonly Uint8Array[];
  readonly compression: BuildCompression;
  /** 8-byte blob offsets. The format allows it in major version 6, which is what this builder writes. */
  readonly extended?: boolean;
}

export interface BuildContentEntry {
  readonly namespace: string;
  readonly path: string;
  readonly title?: string;
  readonly mime: string;
  readonly cluster: number;
  readonly blob: number;
}

export interface BuildRedirectEntry {
  readonly namespace: string;
  readonly path: string;
  readonly title?: string;
  /** The index of an entry in the SAME `entries` array, before the sort. */
  readonly target: number;
}

export type BuildEntry = BuildContentEntry | BuildRedirectEntry;

export interface ZimBuildInput {
  readonly entries: readonly BuildEntry[];
  readonly clusters: readonly BuildCluster[];
  /** The entry INDEX (into `entries`) of the main page, if the file declares one. */
  readonly mainPage?: number;
  readonly layoutPage?: number;
  /** Whether to add the format-6 `X/listing/titleOrdered/v1` entry, in a cluster of its own. */
  readonly titleListing?: boolean;
  /** `"wrong"` writes sixteen bytes that are not the MD5 of the file. */
  readonly checksum?: "correct" | "wrong";
}

const text = (value: string): Buffer => Buffer.from(new TextEncoder().encode(value));

function isRedirect(entry: BuildEntry): entry is BuildRedirectEntry {
  return "target" in entry;
}

export function buildZim(input: ZimBuildInput): Buffer {
  const mimeTypes: string[] = [];
  const mimeIndex = (mime: string): number => {
    const existing = mimeTypes.indexOf(mime);
    if (existing >= 0) return existing;
    mimeTypes.push(mime);
    return mimeTypes.length - 1;
  };

  // The title listing is the last entry and lives in a cluster of its own, on
  // the fixture's terms: `X/` sorts after every other namespace. Its own BODY is
  // built in a second step below, because it is a table of ENTRY INDEXES and the
  // indexes only exist once every entry is in the list.
  const listingCluster = input.clusters.length;
  const entries: BuildEntry[] =
    input.titleListing === true
      ? [
          ...input.entries,
          {
            namespace: "X",
            path: "listing/titleOrdered/v1",
            mime: "application/octet-stream",
            cluster: listingCluster,
            blob: 0,
          },
        ]
      : [...input.entries];

  // The URL pointer list is sorted by `namespace + path` as bytes, and a
  // redirect names an ENTRY INDEX — a position in that list. So the entries are
  // sorted first and the input indexes are mapped onto the sorted positions;
  // without that, a redirect in a built file would point at whichever entry
  // happened to sort into the place the input index had.
  const keys = entries.map((entry) => pathKey(entry.namespace, entry.path));
  const urlOrder = entries
    .map((_entry, index) => index)
    .sort((left, right) =>
      compareKeys(keys[left] ?? new Uint8Array(), keys[right] ?? new Uint8Array()),
    );
  const urlIndex = new Map<number, number>();
  urlOrder.forEach((inputIndex, position) => urlIndex.set(inputIndex, position));

  const clusters: BuildCluster[] = [...input.clusters];
  if (input.titleListing === true) {
    const listing = Buffer.alloc(input.entries.length * 4);
    input.entries
      .map((entry, index) => ({ index, title: entry.title ?? entry.path }))
      .sort((left, right) => compareKeys(text(left.title), text(right.title)))
      .forEach((row, position) => {
        listing.writeUInt32LE(urlIndex.get(row.index) ?? 0, position * 4);
      });
    clusters.push({ blobs: [listing], compression: "none" });
  }

  // Every MIME type is registered BEFORE the list is serialised, and the order
  // matters: an index is written into a dirent, so a type first met while the
  // dirents are being written would be one the list — already emitted — does not
  // have.
  for (const entry of entries) {
    if (!isRedirect(entry)) mimeIndex(entry.mime);
  }
  const mimeBytes: number[] = [];
  for (const mime of mimeTypes) mimeBytes.push(...text(mime), 0);
  mimeBytes.push(0);

  const mimeListPos = ZIM_HEADER_BYTES;
  const urlPtrPos = mimeListPos + mimeBytes.length;
  const titlePtrPos = urlPtrPos + urlOrder.length * 8;
  const direntsPos = titlePtrPos + urlOrder.length * 4;

  const direntBuffers: Buffer[] = [];
  const direntOffsets = new Map<number, number>();
  let direntCursor = direntsPos;
  for (const inputIndex of urlOrder) {
    const entry = entries[inputIndex];
    if (entry === undefined) throw new Error("zimBuilder: an entry disappeared while sorting.");
    const header = Buffer.alloc(isRedirect(entry) ? 12 : 16);
    header.writeUInt16LE(isRedirect(entry) ? 0xffff : mimeIndex(entry.mime), 0);
    header.writeUInt8(0, 2);
    header.writeUInt8(entry.namespace.charCodeAt(0), 3);
    header.writeUInt32LE(0, 4);
    if (isRedirect(entry)) header.writeUInt32LE(urlIndex.get(entry.target) ?? 0, 8);
    else {
      header.writeUInt32LE(entry.cluster, 8);
      header.writeUInt32LE(entry.blob, 12);
    }
    const bytes = Buffer.concat([
      header,
      text(entry.path),
      Buffer.from([0]),
      text(entry.title ?? ""),
      Buffer.from([0]),
    ]);
    direntOffsets.set(inputIndex, direntCursor);
    direntCursor += bytes.length;
    direntBuffers.push(bytes);
  }

  const clusterPtrPos = direntCursor;
  const clusterPointers = Buffer.alloc(clusters.length * 8);
  const clusterBuffers: Buffer[] = [];
  let clusterCursor = clusterPtrPos + clusters.length * 8;
  clusters.forEach((cluster, index) => {
    clusterPointers.writeBigUInt64LE(BigInt(clusterCursor), index * 8);
    const info =
      (cluster.compression === "zstd"
        ? CLUSTER_ZSTD
        : cluster.compression === "lzma"
          ? CLUSTER_LZMA
          : CLUSTER_NONE) | (cluster.extended === true ? 0x10 : 0);
    const payload = buildClusterPayload(cluster);
    const stored = cluster.compression === "zstd" ? zstdCompressSync(payload) : payload;
    const bytes = Buffer.concat([Buffer.from([info]), stored]);
    clusterBuffers.push(bytes);
    clusterCursor += bytes.length;
  });
  const checksumPos = clusterCursor;

  const header = Buffer.alloc(ZIM_HEADER_BYTES);
  header.writeUInt32LE(0x044d495a, 0);
  header.writeUInt16LE(6, 4);
  header.writeUInt16LE(1, 6);
  header.writeUInt32LE(urlOrder.length, 24);
  header.writeUInt32LE(clusters.length, 28);
  header.writeBigUInt64LE(BigInt(urlPtrPos), 32);
  header.writeBigUInt64LE(BigInt(titlePtrPos), 40);
  header.writeBigUInt64LE(BigInt(clusterPtrPos), 48);
  header.writeBigUInt64LE(BigInt(mimeListPos), 56);
  header.writeUInt32LE(
    input.mainPage === undefined ? 0xffffffff : urlIndex.get(input.mainPage) ?? 0xffffffff,
    64,
  );
  header.writeUInt32LE(
    input.layoutPage === undefined ? 0xffffffff : urlIndex.get(input.layoutPage) ?? 0xffffffff,
    68,
  );
  header.writeBigUInt64LE(BigInt(checksumPos), 72);

  const urlPointers = Buffer.alloc(urlOrder.length * 8);
  urlOrder.forEach((inputIndex, position) => {
    urlPointers.writeBigUInt64LE(BigInt(direntOffsets.get(inputIndex) ?? 0), position * 8);
  });
  const titlePointers = Buffer.alloc(entries.length * 4);
  entries
    .map((entry, index) => ({ index, title: entry.title ?? entry.path }))
    .sort((left, right) => compareKeys(text(left.title), text(right.title)))
    .forEach((row, position) => {
      titlePointers.writeUInt32LE(urlIndex.get(row.index) ?? 0, position * 4);
    });

  const body = Buffer.concat([
    header,
    Buffer.from(mimeBytes),
    urlPointers,
    titlePointers,
    ...direntBuffers,
    clusterPointers,
    ...clusterBuffers,
  ]);
  if (body.length !== checksumPos) {
    throw new Error("zimBuilder: the computed checksum position is not where the file ends.");
  }
  const digest = createHash("md5").update(body).digest();
  return Buffer.concat([body, input.checksum === "wrong" ? Buffer.alloc(16, 0xab) : digest]);
}

/**
 * One cluster's uncompressed payload: its offset table, then the blobs.
 *
 * The table's first entry is its OWN length, then one entry per blob start, then
 * one for the end of the last blob — "there is always one more offset than
 * blobs", which is what makes the last blob's length well defined.
 */
function buildClusterPayload(cluster: BuildCluster): Buffer {
  const entryBytes = cluster.extended === true ? 8 : 4;
  const blobs = cluster.blobs.map((blob) => Buffer.from(blob));
  const tableBytes = (blobs.length + 1) * entryBytes;
  const table = Buffer.alloc(tableBytes);
  const write = (index: number, value: number): void => {
    if (entryBytes === 8) table.writeBigUInt64LE(BigInt(value), index * 8);
    else table.writeUInt32LE(value, index * 4);
  };
  // Entry `i` is the offset of blob `i`, and the entry one past the last blob is
  // the end of the data area — "there is always one more offset than blobs",
  // which is what gives the final blob its length.
  const offsets = [tableBytes];
  for (const blob of blobs) offsets.push((offsets[offsets.length - 1] ?? 0) + blob.byteLength);
  offsets.forEach((value, index) => {
    write(index, value);
  });
  return Buffer.concat([table, ...blobs]);
}
