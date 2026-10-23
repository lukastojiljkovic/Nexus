import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMapProtocolHandler, regionUrl } from "./protocol.js";
import { mapsDir, writeRegions } from "./registry.js";

let userData = "";
const FILE = "srb.20261022.full.pmtiles";

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-map-protocol-"));
  writeRegions(userData, [{ id: "SRB", detail: "full", build: "20261022", bytes: 10, file: FILE }]);
  writeFileSync(join(mapsDir(userData), FILE), "0123456789");
  writeFileSync(join(mapsDir(userData), "srb.part"), "partial");
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

const ask = (url: string, range?: string) =>
  createMapProtocolHandler({ userData })(new Request(url, range === undefined ? {} : { headers: { Range: range } }));

describe("the map region protocol", () => {
  it("serves an installed region's file, and the range a reader asks for", async () => {
    const whole = await ask(regionUrl(FILE));
    expect(whole.status).toBe(200);
    expect(await whole.text()).toBe("0123456789");
    const part = await ask(regionUrl(FILE), "bytes=2-4");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    // The map reads the file with `fetch` from a page at file://, another origin.
    expect(part.headers.get("access-control-allow-origin")).toBe("*");
    expect(await part.text()).toBe("234");
  });

  it("serves nothing the registry does not name", async () => {
    for (const url of [
      "nx-map://region/srb.part",
      "nx-map://region/regions.json",
      "nx-map://region/..%2F..%2Fnexus.db",
      "nx-map://other/srb.20261022.full.pmtiles",
      "nx-map://region/",
    ]) {
      expect((await ask(url)).status, url).toBe(404);
    }
  });
});
