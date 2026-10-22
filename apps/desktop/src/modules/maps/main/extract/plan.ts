/**
 * Cutting a region out of a PMTiles archive: what to read, and the new file.
 *
 * **Only the directories are read to plan.** The header and root come first,
 * then the leaf directories whose span meets the region's id runs, and from
 * them the entries the new file keeps. That is enough to know the new file to
 * the byte, so the size a person is shown before a download starts is exact,
 * and the plan carries everything written before the first tile (`prefix`).
 *
 * **The tiles are read in the source's order and written in it.** The planet
 * build is clustered: its tile bytes lie in tile-id order, so a region's tiles
 * sit in a few long stretches of it. The plan reads those stretches whole,
 * reading through gaps of up to {@link FETCH_GAP_BYTES}, and the new file
 * stores each kept tile in the order the source does, once however many tiles
 * share its bytes. The download is therefore one append after another, which
 * is what lets it resume from the file's length.
 *
 * **The new file is marked unclustered.** A subset's first appearances need
 * not follow the source's order (a shared ocean tile first used outside the
 * region), so the flag that promises it is not set. Readers do not use it.
 */

import { gzipSync } from "node:zlib";

import { Compression, tileIdToZxy, type Entry, type Header } from "pmtiles";

import {
  HEADER_BYTES,
  ROOT_SPAN,
  decodeDirectory,
  decompress,
  packDirectories,
  readHeader,
  writeHeader,
} from "./archive.js";
import type { TileRange } from "./cover.js";

/** Reads a byte range of the source archive: a file, or the planet build over HTTP. */
export interface ArchiveReader {
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** One request to the source, and the parts of its answer the new file keeps, in order. */
export interface ExtractFetch {
  readonly offset: number;
  readonly length: number;
  /** `[start, length]` within the fetched bytes. */
  readonly keep: readonly (readonly [start: number, length: number])[];
}

export interface ExtractPlan {
  /** The header, the directories and the metadata: everything before the first tile. */
  readonly prefix: Uint8Array;
  readonly fetches: readonly ExtractFetch[];
  /** The finished file's size. */
  readonly bytes: number;
}

export interface ExtractInput {
  readonly source: ArchiveReader;
  /** The region's tile ids, sorted and merged (`cover.ts`). */
  readonly ranges: readonly TileRange[];
  /** The region's box, written into the new header for the map to fit to. */
  readonly bounds: { readonly minLon: number; readonly minLat: number; readonly maxLon: number; readonly maxLat: number };
}

/**
 * A gap between two wanted stretches this small is read through rather than
 * asked for twice. A policy value: one more request costs a round trip, and
 * 64 KiB at 10 Mbit/s take about 50 ms, which is about one.
 */
export const FETCH_GAP_BYTES = 64 * 1024;

/** The most one request asks for, so a fetch held in memory before it is written stays bounded. */
export const FETCH_MAX_BYTES = 16 * 1024 * 1024;

interface Located {
  readonly offset: number;
  readonly length: number;
}

interface Leaf extends Located {
  /** The first tile id past the leaf's span. */
  readonly end: number;
}

export async function planExtract({ source, ranges, bounds }: ExtractInput): Promise<ExtractPlan> {
  const head = await source.read(0, ROOT_SPAN);
  const header = readHeader(head);
  if (!header.clustered) {
    throw new Error("The source archive is not clustered, so a region's tiles cannot be read in order.");
  }
  const kept: Entry[] = [];
  let leaves: Leaf[] = [];
  const visit = (entries: readonly Entry[], end: number) => {
    entries.forEach((entry, index) => {
      if (entry.runLength === 0) {
        const spanEnd = entries[index + 1]?.tileId ?? end;
        if (overlaps(ranges, entry.tileId, spanEnd)) {
          leaves.push({ offset: header.leafDirectoryOffset + entry.offset, length: entry.length, end: spanEnd });
        }
        return;
      }
      for (const [start, stop] of clip(ranges, entry.tileId, entry.tileId + entry.runLength)) {
        kept.push({ tileId: start, runLength: stop - start, offset: entry.offset, length: entry.length });
      }
    });
  };
  visit(decodeDirectory(await bytesAt(source, head, header.rootDirectoryOffset, header.rootDirectoryLength), header.internalCompression), Infinity);
  while (leaves.length > 0) {
    const batch = leaves;
    leaves = [];
    for (const group of coalesce(batch)) {
      const bytes = await source.read(group.offset, group.length);
      for (const leaf of group.items) {
        const start = leaf.offset - group.offset;
        visit(decodeDirectory(bytes.subarray(start, start + leaf.length), header.internalCompression), leaf.end);
      }
    }
  }
  if (kept.length === 0) throw new Error("The region holds no tiles of this archive.");
  kept.sort((left, right) => left.tileId - right.tileId);

  // Each stored tile once, in the source's order.
  const lengths = new Map<number, number>();
  for (const entry of kept) lengths.set(entry.offset, entry.length);
  const order = [...lengths.keys()].sort((left, right) => left - right);
  const placed = new Map<number, number>();
  let dataLength = 0;
  for (const offset of order) {
    placed.set(offset, dataLength);
    dataLength += lengths.get(offset) as number;
  }
  const entries = kept.map((entry) => ({ ...entry, offset: placed.get(entry.offset) as number }));
  const fetches = coalesce(
    order.map((offset) => ({ offset: header.tileDataOffset + offset, length: lengths.get(offset) as number })),
  ).map((group) => ({
    offset: group.offset,
    length: group.length,
    keep: group.items.map((item) => [item.offset - group.offset, item.length] as const),
  }));

  const { root, leaves: leafBytes } = packDirectories(entries);
  const metadata = gzipSync(
    decompress(await source.read(header.jsonMetadataOffset, header.jsonMetadataLength), header.internalCompression),
  );
  const last = kept.at(-1) as Entry;
  const [minZoom] = tileIdToZxy((kept[0] as Entry).tileId);
  const [maxZoom] = tileIdToZxy(last.tileId + last.runLength - 1);
  const tileDataOffset = HEADER_BYTES + root.length + metadata.length + leafBytes.length;
  const out: Header = {
    specVersion: 3,
    rootDirectoryOffset: HEADER_BYTES,
    rootDirectoryLength: root.length,
    jsonMetadataOffset: HEADER_BYTES + root.length,
    jsonMetadataLength: metadata.length,
    leafDirectoryOffset: HEADER_BYTES + root.length + metadata.length,
    leafDirectoryLength: leafBytes.length,
    tileDataOffset,
    tileDataLength: dataLength,
    numAddressedTiles: entries.reduce((sum, entry) => sum + entry.runLength, 0),
    numTileEntries: entries.length,
    numTileContents: order.length,
    clustered: false,
    internalCompression: Compression.Gzip,
    tileCompression: header.tileCompression,
    tileType: header.tileType,
    minZoom,
    maxZoom,
    ...bounds,
    centerZoom: minZoom,
    centerLon: (bounds.minLon + bounds.maxLon) / 2,
    centerLat: (bounds.minLat + bounds.maxLat) / 2,
  };
  const prefix = new Uint8Array(Buffer.concat([writeHeader(out), root, metadata, leafBytes]));
  return { prefix, fetches, bytes: tileDataOffset + dataLength };
}

/** Writes the new file through `write`: the prefix, then every kept tile in order. */
export async function extractInto(
  plan: ExtractPlan,
  source: ArchiveReader,
  write: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  await write(plan.prefix);
  for (const fetch of plan.fetches) {
    const bytes = await source.read(fetch.offset, fetch.length);
    for (const [start, length] of fetch.keep) await write(bytes.subarray(start, start + length));
  }
}

/** Bytes at `offset`, from the first read when it already holds them. */
async function bytesAt(source: ArchiveReader, head: Uint8Array, offset: number, length: number): Promise<Uint8Array> {
  return offset + length <= head.length ? head.subarray(offset, offset + length) : source.read(offset, length);
}

/** The index of the first range that ends after `id`. */
function firstAfter(ranges: readonly TileRange[], id: number): number {
  let [low, high] = [0, ranges.length];
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((ranges[middle] as TileRange).end <= id) low = middle + 1;
    else high = middle;
  }
  return low;
}

function overlaps(ranges: readonly TileRange[], start: number, end: number): boolean {
  const range = ranges[firstAfter(ranges, start)];
  return range !== undefined && range.start < end;
}

/** The parts of `[start, end)` inside the ranges, as `[start, end)` pairs. */
function clip(ranges: readonly TileRange[], start: number, end: number): [number, number][] {
  const parts: [number, number][] = [];
  for (let index = firstAfter(ranges, start); index < ranges.length; index += 1) {
    const range = ranges[index] as TileRange;
    if (range.start >= end) break;
    parts.push([Math.max(start, range.start), Math.min(end, range.end)]);
  }
  return parts;
}

/** Byte ranges grouped into requests: sorted, gaps up to the limit read through, no request past the cap. */
function coalesce<T extends Located>(items: readonly T[]): { offset: number; length: number; items: T[] }[] {
  const groups: { offset: number; length: number; items: T[] }[] = [];
  for (const item of [...items].sort((left, right) => left.offset - right.offset)) {
    const group = groups.at(-1);
    const end = item.offset + item.length;
    if (
      group !== undefined &&
      item.offset - (group.offset + group.length) <= FETCH_GAP_BYTES &&
      end - group.offset <= FETCH_MAX_BYTES
    ) {
      group.length = Math.max(group.length, end - group.offset);
      group.items.push(item);
    } else {
      groups.push({ offset: item.offset, length: item.length, items: [item] });
    }
  }
  return groups;
}
