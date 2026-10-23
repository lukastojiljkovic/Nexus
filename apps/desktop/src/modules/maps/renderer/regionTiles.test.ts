import { describe, expect, it } from "vitest";

import type { MapRegionView } from "../shared/ipc.js";
import { createRegionTiles, type TileArchive } from "./regionTiles.js";

function region(id: string, detail: MapRegionView["detail"], build: string): MapRegionView {
  const file = `${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${build}.${detail}.pmtiles`;
  return { id, detail, build, bytes: 1, url: `nx-map://region/${file}` };
}

/** An archive holding the listed tiles, each answering with its own address so a test reads which archive answered. */
function archiveOf(url: string, tiles: readonly string[], opened: string[]): TileArchive {
  opened.push(url);
  return {
    getZxy: async (z, x, y) => {
      const key = `${String(z)}/${String(x)}/${String(y)}`;
      return tiles.includes(key) ? { data: new TextEncoder().encode(`${url}#${key}`).buffer } : undefined;
    },
  };
}

const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe("the region tile source", () => {
  const SERBIA = region("SRB", "full", "20261022");
  const EUROPE_OLD = region("continent:Europe", "towns", "20260901");
  const SERBIA_TOWNS = region("SRB", "towns", "20261022");

  function setUp(tiles: Record<string, readonly string[]>) {
    const opened: string[] = [];
    const source = createRegionTiles((url) => archiveOf(url, tiles[url] ?? [], opened));
    return { source, opened };
  }

  it("declares one tile address per installed detail, versioned by the files behind it", () => {
    const { source } = setUp({});
    expect(source.set([SERBIA, EUROPE_OLD])).toEqual([
      { detail: "towns", tiles: "nx-regions://towns/{z}/{x}/{y}?v=continent-europe.20260901.towns.pmtiles" },
      { detail: "full", tiles: "nx-regions://full/{z}/{x}/{y}?v=srb.20261022.full.pmtiles" },
    ]);
    expect(source.set([])).toEqual([]);
  });

  it("answers a tile from the region that has it, the newest build first", async () => {
    const { source } = setUp({
      [EUROPE_OLD.url]: ["5/17/11", "6/35/23"],
      [SERBIA_TOWNS.url]: ["6/35/23"],
    });
    source.set([EUROPE_OLD, SERBIA_TOWNS]);
    expect(text(await source.tile("nx-regions://towns/5/17/11?v=x", new AbortController().signal))).toBe(
      `${EUROPE_OLD.url}#5/17/11`,
    );
    expect(text(await source.tile("nx-regions://towns/6/35/23?v=x", new AbortController().signal))).toBe(
      `${SERBIA_TOWNS.url}#6/35/23`,
    );
  });

  it("answers an empty tile where no region has one, and for a detail with nothing installed", async () => {
    const { source } = setUp({ [SERBIA.url]: ["6/35/23"] });
    source.set([SERBIA]);
    expect(await source.tile("nx-regions://full/6/0/0", new AbortController().signal)).toEqual(new Uint8Array());
    expect(await source.tile("nx-regions://overview/6/35/23", new AbortController().signal)).toEqual(
      new Uint8Array(),
    );
  });

  it("keeps an archive open across updates that still list it, and drops one that is gone", () => {
    const { source, opened } = setUp({});
    source.set([SERBIA]);
    source.set([SERBIA, EUROPE_OLD]);
    source.set([EUROPE_OLD]);
    source.set([SERBIA]);
    expect(opened).toEqual([SERBIA.url, EUROPE_OLD.url, SERBIA.url]);
  });

  it("refuses an address that is not a region tile", async () => {
    const { source } = setUp({});
    await expect(source.tile("nx-regions://elsewhere/1/2", new AbortController().signal)).rejects.toThrow(
      /not a region tile/,
    );
  });
});
