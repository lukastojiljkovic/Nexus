import { bytesToHeader, Compression, PMTiles, TileType, type Entry } from "pmtiles";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  HEADER_BYTES,
  INFLATED_MAX_BYTES,
  decodeDirectory,
  decompress,
  encodeDirectory,
  packDirectories,
  readHeader,
  writeHeader,
} from "./archive.js";
import { allTiles, bufferSource, buildArchive, tileBytes } from "./fixtures.js";

const HEADER = {
  specVersion: 3,
  rootDirectoryOffset: 127,
  rootDirectoryLength: 300,
  jsonMetadataOffset: 427,
  jsonMetadataLength: 40,
  leafDirectoryOffset: 467,
  leafDirectoryLength: 0,
  tileDataOffset: 467,
  // Past 2^32, as the planet's offsets are: the codec must not use 32-bit arithmetic.
  tileDataLength: 138_724_392_719,
  numAddressedTiles: 1_431_655_765,
  numTileEntries: 178_354_289,
  numTileContents: 136_466_038,
  clustered: false,
  internalCompression: Compression.Gzip,
  tileCompression: Compression.Gzip,
  tileType: TileType.Mvt,
  minZoom: 0,
  maxZoom: 15,
  minLon: 18.8170241,
  minLat: 42.2322435,
  maxLon: 23.0063915,
  maxLat: 46.1900524,
  centerZoom: 7,
  centerLon: 20.9117078,
  centerLat: 44.2111479,
};

describe("the PMTiles v3 header", () => {
  it("writes the 127 bytes the library reads back field for field", () => {
    const bytes = writeHeader(HEADER);
    expect(bytes).toHaveLength(HEADER_BYTES);
    const read = bytesToHeader(bytes.slice().buffer);
    expect(read).toMatchObject({ ...HEADER, etag: undefined });
    expect(readHeader(bytes)).toMatchObject(HEADER);
  });

  it("refuses bytes that are not a version 3 archive", () => {
    const bytes = writeHeader(HEADER);
    expect(() => readHeader(bytes.subarray(0, 100))).toThrow(/127 bytes/);
    const wrongMagic = bytes.slice();
    wrongMagic[0] = 0x58;
    expect(() => readHeader(wrongMagic)).toThrow(/not a PMTiles archive/);
    const version2 = bytes.slice();
    version2[7] = 2;
    expect(() => readHeader(version2)).toThrow(/version 2/);
  });
});

describe("a directory", () => {
  const entries: Entry[] = [
    { tileId: 0, offset: 0, length: 120, runLength: 1 },
    { tileId: 1, offset: 120, length: 80, runLength: 3 },
    // Points back at the first tile's bytes: a deduplicated tile.
    { tileId: 9, offset: 0, length: 120, runLength: 1 },
    { tileId: 1_431_655_764, offset: 138_724_392_000, length: 719, runLength: 1 },
    { tileId: 1_431_655_765, offset: 5_000, length: 2_048, runLength: 0 },
  ];

  it("round-trips through the spec's varint columns, gzip-compressed", () => {
    expect(decodeDirectory(encodeDirectory(entries), Compression.Gzip)).toEqual(entries);
  });

  it("reads an uncompressed directory, and refuses a compression it cannot undo", () => {
    const gzipped = encodeDirectory(entries);
    expect(() => decodeDirectory(gzipped, Compression.Brotli)).toThrow(/compression 3/);
    expect(() => decodeDirectory(new Uint8Array([2, 0]), Compression.None)).toThrow(/ends early/);
  });

  it("refuses to inflate past the cap, so a few kilobytes cannot fill memory", () => {
    const bomb = gzipSync(new Uint8Array(INFLATED_MAX_BYTES + 1));
    expect(bomb.length).toBeLessThan(INFLATED_MAX_BYTES / 100);
    expect(() => decompress(bomb, Compression.Gzip)).toThrow(/larger than/);
  });
});

describe("packing the directories", () => {
  // Irregular on purpose: regular columns gzip to almost nothing and never split.
  let seed = 7;
  const next = (limit: number) => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed % limit;
  };
  let tileId = 0;
  const entries: Entry[] = Array.from({ length: 5_000 }, (_, index) => {
    tileId += 1 + next(50);
    return { tileId, offset: index * 70_000, length: 1 + next(65_000), runLength: 1 + next(3) };
  });

  it("keeps everything in the root when it fits", () => {
    const packed = packDirectories(entries.slice(0, 10));
    expect(packed.leaves).toHaveLength(0);
    expect(decodeDirectory(packed.root, Compression.Gzip)).toEqual(entries.slice(0, 10));
  });

  it("splits into leaves until the root fits its budget, and every entry stays reachable", () => {
    const packed = packDirectories(entries, 400);
    expect(packed.root.length).toBeLessThanOrEqual(400);
    const root = decodeDirectory(packed.root, Compression.Gzip);
    expect(root.every((entry) => entry.runLength === 0)).toBe(true);
    const leaves = root.flatMap((pointer) =>
      decodeDirectory(packed.leaves.subarray(pointer.offset, pointer.offset + pointer.length), Compression.Gzip),
    );
    expect(leaves).toEqual(entries);
  });
});

describe("an archive written with this codec", () => {
  it("is read by the pmtiles library: tiles, deduplicated tiles, runs and leaves", async () => {
    // A budget this small forces a leaf: the whole directory gzips to a few hundred bytes.
    const archive = buildArchive(allTiles(5), { rootBudget: 64 });
    const reader = new PMTiles(bufferSource(archive));
    const header = await reader.getHeader();
    expect(header.leafDirectoryLength).toBeGreaterThan(0);
    expect(header.numTileContents).toBeLessThan(header.numTileEntries);
    for (const [z, x, y] of [
      [0, 0, 0],
      [3, 5, 2],
      [5, 31, 31],
      [5, 0, 28],
    ] as const) {
      const tile = await reader.getZxy(z, x, y);
      expect(new Uint8Array(tile?.data ?? new ArrayBuffer(0))).toEqual(tileBytes(z, x, y));
    }
  });
});
