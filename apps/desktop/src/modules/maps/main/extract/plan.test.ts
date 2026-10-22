import { Compression, PMTiles, zxyToTileId } from "pmtiles";
import { describe, expect, it } from "vitest";

import { HEADER_BYTES, decodeDirectory, encodeDirectory, readHeader, writeHeader } from "./archive.js";
import { rangesOf } from "./cover.js";
import { allTiles, bufferReader, bufferSource, buildArchive, tileBytes } from "./fixtures.js";
import { extractInto, planExtract, PlanTooLarge, type ExtractPlan } from "./plan.js";

const BOUNDS = { minLon: 0, minLat: 0, maxLon: 45, maxLat: 40 };

/** Runs the plan against the source and returns the finished file. */
async function cut(plan: ExtractPlan, source: Uint8Array): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await extractInto(plan, bufferReader(source), async (bytes) => {
    chunks.push(bytes);
  });
  return new Uint8Array(Buffer.concat(chunks));
}

async function tileOf(archive: Uint8Array, z: number, x: number, y: number): Promise<Uint8Array | null> {
  const tile = await new PMTiles(bufferSource(archive)).getZxy(z, x, y);
  return tile === undefined ? null : new Uint8Array(tile.data);
}

describe("cutting a region out of an archive", () => {
  // Zooms 0 to 6, its directory split into leaves as the planet's is.
  const source = buildArchive(allTiles(6), { rootBudget: 300 });
  const tile = zxyToTileId(3, 4, 2);
  const ranges = rangesOf([tile], 3, 6);

  it("keeps the region's tiles at every zoom and nothing else, readable by the library", async () => {
    const plan = await planExtract({ source: bufferReader(source), ranges, bounds: BOUNDS });
    const archive = await cut(plan, source);
    expect(archive.length).toBe(plan.bytes);
    for (const [z, x, y] of [
      [0, 0, 0],
      [1, 1, 0],
      [3, 4, 2],
      [5, 17, 9],
      [6, 39, 23],
    ] as const) {
      expect(await tileOf(archive, z, x, y)).toEqual(tileBytes(z, x, y));
    }
    for (const [z, x, y] of [
      [1, 0, 0],
      [3, 5, 2],
      [6, 40, 23],
    ] as const) {
      expect(await tileOf(archive, z, x, y)).toBeNull();
    }
  });

  it("writes a header that says what the file holds", async () => {
    const plan = await planExtract({ source: bufferReader(source), ranges, bounds: BOUNDS });
    const header = readHeader(plan.prefix);
    // One tile at each of zooms 0 to 3, then 4, 16 and 64 below it.
    expect(header.numAddressedTiles).toBe(4 + 4 + 16 + 64);
    expect([header.minZoom, header.maxZoom]).toEqual([0, 6]);
    expect([header.minLon, header.minLat, header.maxLon, header.maxLat]).toEqual([0, 0, 45, 40]);
    expect(header.rootDirectoryOffset).toBe(HEADER_BYTES);
    expect(header.tileDataOffset).toBe(plan.prefix.length);
    expect(header.tileDataLength).toBe(plan.bytes - plan.prefix.length);
  });

  it("stores a tile the region repeats once, as the source does", async () => {
    // Zoom 3's bottom row is all ocean, so everything below this tile is one tile's bytes.
    const plan = await planExtract({
      source: bufferReader(source),
      ranges: rangesOf([zxyToTileId(3, 1, 7)], 3, 6),
      bounds: BOUNDS,
    });
    const header = readHeader(plan.prefix);
    expect(header.numTileContents).toBeLessThan(header.numTileEntries);
    const archive = await cut(plan, source);
    expect(await tileOf(archive, 6, 8, 60)).toEqual(tileBytes(6, 8, 60));
  });

  it("reads the tile data in a few long requests rather than one per tile", async () => {
    const reader = bufferReader(source);
    const plan = await planExtract({ source: reader, ranges, bounds: BOUNDS });
    expect(plan.fetches.length).toBeLessThan(5);
    const reads = reader.requests.length;
    await extractInto(plan, reader, async () => undefined);
    expect(reader.requests.length - reads).toBe(plan.fetches.length);
  });

  it("refuses a region that keeps more entries than the cap, and plans one at the cap", async () => {
    const plan = await planExtract({ source: bufferReader(source), ranges, bounds: BOUNDS });
    const entries = readHeader(plan.prefix).numTileEntries;
    await expect(
      planExtract({ source: bufferReader(source), ranges, bounds: BOUNDS, maxEntries: entries - 1 }),
    ).rejects.toBeInstanceOf(PlanTooLarge);
    await expect(planExtract({ source: bufferReader(source), ranges, bounds: BOUNDS, maxEntries: entries })).resolves.toEqual(plan);
  });

  it("refuses a source it cannot cut", async () => {
    const unclustered = source.slice();
    const header = readHeader(unclustered);
    unclustered.set(writeHeader({ ...header, clustered: false }), 0);
    await expect(planExtract({ source: bufferReader(unclustered), ranges, bounds: BOUNDS })).rejects.toThrow(
      /not clustered/,
    );
  });

  it("refuses directories that nest deeper than a reader follows, a leaf that points at itself among them", async () => {
    // A leaf whose one entry is a pointer to the leaf itself: its length is its own size.
    let leaf = encodeDirectory([{ tileId: 0, runLength: 0, offset: 0, length: 0 }]);
    while (leaf[0] === undefined || decodedLength(leaf) !== leaf.length) {
      leaf = encodeDirectory([{ tileId: 0, runLength: 0, offset: 0, length: leaf.length }]);
    }
    const header = readHeader(source);
    const looped = new Uint8Array(Buffer.concat([
      writeHeader({
        ...header,
        rootDirectoryOffset: HEADER_BYTES,
        rootDirectoryLength: leaf.length,
        leafDirectoryOffset: HEADER_BYTES,
        leafDirectoryLength: leaf.length,
      }),
      leaf,
    ]));
    await expect(planExtract({ source: bufferReader(looped), ranges, bounds: BOUNDS })).rejects.toThrow(/deeper/);
  });
});

/** The length a single-entry directory names, read back from its own bytes. */
function decodedLength(directory: Uint8Array): number {
  return decodeDirectory(directory, Compression.Gzip)[0]?.length ?? -1;
}
