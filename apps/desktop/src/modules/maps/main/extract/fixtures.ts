/**
 * Small PMTiles archives for the extract tests, written with the production
 * codec and read back with the `pmtiles` library, so a test proves that both
 * sides agree on the format rather than that the codec agrees with itself.
 */

import { gzipSync } from "node:zlib";

import { Compression, TileType, tileIdToZxy, zxyToTileId, type Entry, type Source } from "pmtiles";

import { HEADER_BYTES, packDirectories, writeHeader } from "./archive.js";
import type { ArchiveReader } from "./plan.js";

const OCEAN = new TextEncoder().encode("ocean");

/**
 * A tile's bytes: its own address, except the southern quarter of every zoom,
 * which is one shared "ocean" tile. That gives the archive what the planet has:
 * runs of identical tiles, and the same bytes referenced from far apart.
 */
export function tileBytes(z: number, x: number, y: number): Uint8Array {
  if (z > 0 && y >= (3 * 2 ** z) / 4) return OCEAN;
  return new TextEncoder().encode(`${String(z)}/${String(x)}/${String(y)}`);
}

/** Every tile from zoom 0 to `maxZoom`, keyed by tile id. */
export function allTiles(maxZoom: number): Map<number, Uint8Array> {
  const tiles = new Map<number, Uint8Array>();
  for (let z = 0; z <= maxZoom; z += 1) {
    for (let x = 0; x < 2 ** z; x += 1) {
      for (let y = 0; y < 2 ** z; y += 1) tiles.set(zxyToTileId(z, x, y), tileBytes(z, x, y));
    }
  }
  return tiles;
}

/**
 * A clustered archive of `tiles`: data in tile-id order, identical bytes stored
 * once, consecutive identical tiles as one run. `rootBudget` forces leaves.
 */
export function buildArchive(
  tiles: ReadonlyMap<number, Uint8Array>,
  options: { readonly rootBudget?: number } = {},
): Uint8Array {
  const ids = [...tiles.keys()].sort((a, b) => a - b);
  const stored = new Map<string, number>();
  const chunks: Uint8Array[] = [];
  const entries: Entry[] = [];
  let dataLength = 0;
  for (const id of ids) {
    const bytes = tiles.get(id) as Uint8Array;
    const key = Buffer.from(bytes).toString("base64");
    let offset = stored.get(key);
    if (offset === undefined) {
      offset = dataLength;
      stored.set(key, offset);
      chunks.push(bytes);
      dataLength += bytes.length;
    }
    const last = entries.at(-1);
    if (last !== undefined && last.offset === offset && last.tileId + last.runLength === id) {
      last.runLength += 1;
    } else {
      entries.push({ tileId: id, offset, length: bytes.length, runLength: 1 });
    }
  }
  const { root, leaves } = packDirectories(entries, options.rootBudget);
  const metadata = gzipSync(JSON.stringify({ name: "fixture" }));
  const [minZoom] = tileIdToZxy(ids[0] ?? 0);
  const [maxZoom] = tileIdToZxy(ids.at(-1) ?? 0);
  const header = writeHeader({
    specVersion: 3,
    rootDirectoryOffset: HEADER_BYTES,
    rootDirectoryLength: root.length,
    jsonMetadataOffset: HEADER_BYTES + root.length,
    jsonMetadataLength: metadata.length,
    leafDirectoryOffset: HEADER_BYTES + root.length + metadata.length,
    leafDirectoryLength: leaves.length,
    tileDataOffset: HEADER_BYTES + root.length + metadata.length + leaves.length,
    tileDataLength: dataLength,
    numAddressedTiles: ids.length,
    numTileEntries: entries.length,
    numTileContents: chunks.length,
    clustered: true,
    internalCompression: Compression.Gzip,
    tileCompression: Compression.None,
    tileType: TileType.Mvt,
    minZoom,
    maxZoom,
    minLon: -180,
    minLat: -85,
    maxLon: 180,
    maxLat: 85,
    centerZoom: 0,
    centerLon: 0,
    centerLat: 0,
  });
  // A copy with its own buffer: a `Buffer` from the pool would hand a reader
  // the whole pool through `.buffer`.
  return new Uint8Array(Buffer.concat([header, root, metadata, leaves, ...chunks]));
}

/** The archive as the `pmtiles` library's reader takes it. */
export function bufferSource(bytes: Uint8Array): Source {
  return {
    getKey: () => "fixture",
    getBytes: async (offset, length) => ({ data: new Uint8Array(bytes.subarray(offset, offset + length)).buffer }),
  };
}

/** The archive as the extract reads it, counting the requests it makes. */
export function bufferReader(bytes: Uint8Array): ArchiveReader & { readonly requests: [number, number][] } {
  const requests: [number, number][] = [];
  return {
    requests,
    read: async (offset, length) => {
      requests.push([offset, length]);
      return bytes.slice(offset, offset + length);
    },
  };
}
