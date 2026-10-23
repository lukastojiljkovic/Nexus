import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MapPlace } from "@nexus/core";
import type { SearchMessage, SearchResponse } from "./searchWorker.js";

const reads = vi.hoisted(() => ({ urls: [] as string[], unreadable: new Set<string>() }));

// The archive only has to carry its url; the places of each url are the test's own.
vi.mock("pmtiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("pmtiles")>()),
  PMTiles: class {
    constructor(readonly url: string) {}
  },
}));

vi.mock("./placeIndex.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./placeIndex.js")>()),
  readRegionPlaces: async (archive: { url: string }) => {
    reads.urls.push(archive.url);
    if (reads.unreadable.has(archive.url)) throw new Error("a broken archive");
    return [place(archive.url.includes("cacak") ? "Čačak" : "Ivanjica", archive.url.includes("cacak") ? 1 : 2)];
  },
}));

function place(name: string, id: number): MapPlace {
  return { id, name, nameCyr: null, nameEn: null, kind: "city", lat: 43.9, lon: 20.3, population: null };
}

const CACAK = { id: "SRB", detail: "towns", url: "nx-map://region/cacak.pmtiles" } as const;
const IVANJICA = { id: "continent:Europe", detail: "overview", url: "nx-map://region/ivanjica.pmtiles" } as const;
const BROKEN = { id: "BIH", detail: "towns", url: "nx-map://region/broken.pmtiles" } as const;

describe("the place search worker", () => {
  let posted: SearchResponse[];
  let send: (message: SearchMessage) => void;

  beforeEach(async () => {
    vi.resetModules();
    reads.urls.length = 0;
    reads.unreadable.clear();
    posted = [];
    vi.stubGlobal("self", {
      postMessage: (message: SearchResponse) => posted.push(message),
      location: { origin: "nx://app" },
      onmessage: null,
    });
    await import("./searchWorker.js");
    const scope = self as unknown as { onmessage: (event: { data: SearchMessage; origin: string }) => void };
    send = (message) => scope.onmessage({ data: message, origin: "nx://app" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("answers a question asked before the index was ready, once it is", async () => {
    send({ type: "search", id: 1, query: "cac", limit: 5 });
    expect(posted).toEqual([]);
    send({ type: "regions", regions: [CACAK] });
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[0]).toEqual({ type: "ready", count: 1 });
    expect(posted[1]).toMatchObject({ type: "results", id: 1, hits: [{ place: { name: "Čačak" } }] });
  });

  it("reads a region once, and reads it again only after it has been removed", async () => {
    send({ type: "regions", regions: [CACAK] });
    send({ type: "regions", regions: [CACAK, IVANJICA] });
    await vi.waitFor(() => expect(posted.at(-1)).toEqual({ type: "ready", count: 2 }));
    expect(reads.urls.filter((url) => url === CACAK.url)).toHaveLength(1);

    send({ type: "regions", regions: [] });
    send({ type: "regions", regions: [CACAK] });
    await vi.waitFor(() => expect(posted.at(-1)).toEqual({ type: "ready", count: 1 }));
    expect(reads.urls.filter((url) => url === CACAK.url)).toHaveLength(2);
  });

  it("leaves out a region that cannot be read, and fails only when none can", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reads.unreadable.add(BROKEN.url);

    send({ type: "regions", regions: [BROKEN, CACAK] });
    await vi.waitFor(() => expect(posted).toContainEqual({ type: "ready", count: 1 }));
    expect(logged).toHaveBeenCalledWith(expect.any(String), BROKEN.url, expect.any(Error));

    send({ type: "regions", regions: [BROKEN] });
    await vi.waitFor(() => expect(posted).toContainEqual({ type: "failed" }));
    send({ type: "search", id: 2, query: "cac", limit: 5 });
    expect(posted.at(-1)).toEqual({ type: "results", id: 2, hits: [] });
  });

  it("answers with no places when no region is installed", () => {
    send({ type: "regions", regions: [] });
    expect(posted).toEqual([{ type: "ready", count: 0 }]);
  });
});
