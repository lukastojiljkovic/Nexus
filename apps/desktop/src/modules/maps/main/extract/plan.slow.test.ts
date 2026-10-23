/**
 * A plan against the REAL planet build, skipped by default: it reads tens of
 * megabytes of directories over the network. Point it at a build to run it:
 *
 *     $env:NEXUS_PLANET_URL = "https://build.protomaps.com/20261022.pmtiles"
 *     node ../../node_modules/vitest/vitest.mjs run src/modules/maps/main/extract/plan.slow.test.ts --silent=false
 *
 * It proves what the fixtures cannot: that the planet's own directories plan a
 * country at full detail, how many requests and bytes that takes, and that a
 * cut the library reads comes out of it.
 */

import { PMTiles } from "pmtiles";
import { describe, expect, it } from "vitest";

import { regionBounds, regionById } from "../../shared/world/outline.js";
import { coverZoom, rangesOf, ringsOf, tileCover } from "../../shared/world/cover.js";
import { extractInto, planExtract, type ArchiveReader } from "./plan.js";

const PLANET = process.env["NEXUS_PLANET_URL"];

/** The planet build over HTTP range requests, counting what it asks for. */
function planetReader(): ArchiveReader & { requests: number; received: number } {
  const reader = {
    requests: 0,
    received: 0,
    read: async (offset: number, length: number) => {
      const response = await fetch(PLANET ?? "", {
        headers: { Range: `bytes=${String(offset)}-${String(offset + length - 1)}` },
      });
      if (response.status !== 206) throw new Error(`The build answered ${String(response.status)}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      reader.requests += 1;
      reader.received += bytes.length;
      return bytes;
    },
  };
  return reader;
}

/** The plan of a territory from zoom 0 to `maxZoom`. */
function planOf(id: string, maxZoom: number, reader: ArchiveReader) {
  const rings = ringsOf(regionById(id)?.geometry ?? { type: "MultiPolygon", coordinates: [] });
  const zoom = coverZoom(rings, maxZoom);
  const ranges = rangesOf(tileCover(rings, zoom), zoom, maxZoom);
  return { zoom, ranges, plan: planExtract({ source: reader, ranges, bounds: regionBounds(id) }) };
}

describe.skipIf(PLANET === undefined)("cutting regions out of the planet build", () => {
  it("plans Serbia at full detail from the directories alone", async () => {
    const reader = planetReader();
    const started = performance.now();
    const { zoom, ranges, plan: planned } = planOf("SRB", 15, reader);
    const plan = await planned;
    console.log(
      JSON.stringify({
        coverZoom: zoom,
        ranges: ranges.length,
        directoryRequests: reader.requests,
        directoryBytes: reader.received,
        prefixBytes: plan.prefix.length,
        tileFetches: plan.fetches.length,
        fileBytes: plan.bytes,
        seconds: Math.round((performance.now() - started) / 1000),
        heapMiB: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
      }),
    );
    expect(plan.bytes).toBeGreaterThan(plan.prefix.length);
  }, 900_000);

  it("cuts Montenegro to zoom 10 into a file the library reads", async () => {
    const reader = planetReader();
    const plan = await planOf("MNE", 10, reader).plan;
    const chunks: Uint8Array[] = [];
    await extractInto(plan, reader, async (bytes) => {
      chunks.push(bytes.slice());
    });
    const archive = new Uint8Array(Buffer.concat(chunks));
    expect(archive.length).toBe(plan.bytes);
    const tiles = new PMTiles({
      getKey: () => "montenegro",
      getBytes: async (offset, length) => ({ data: archive.slice(offset, offset + length).buffer }),
    });
    // Podgorica at zoom 10, and a tile in the middle of the Atlantic that must not be there.
    const podgorica = await tiles.getZxy(10, 566, 378);
    console.log(JSON.stringify({ montenegroBytes: plan.bytes, podgoricaTileBytes: podgorica?.data.byteLength }));
    expect(podgorica?.data.byteLength).toBeGreaterThan(0);
    expect(await tiles.getZxy(10, 399, 378)).toBeUndefined();
  }, 900_000);
});
