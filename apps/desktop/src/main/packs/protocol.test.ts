import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { baseManifest, entry, makeKey, writePack } from "./fixtures.js";
import { packVersionDir, refreshInstalled } from "./registry.js";
import {
  createPackProtocolHandler,
  packContentType,
  parseRangeHeader,
  PACK_SCHEME,
} from "./protocol.js";

/**
 * The `nx-pack:` read protocol (ADR-100): what it serves, what it refuses, and
 * how it answers a range.
 *
 * The pack is a real signed one written into the installed layout, because the
 * two refusals that matter - a pack that does not verify and a path the manifest
 * does not list - are the index's and the manifest's, not a rule this file could
 * fake.
 */

let root: string;
let publicKeyPem: string;
let handler: (request: Request) => Promise<Response>;
const IMAGE = new Uint8Array(Array.from({ length: 300 }, (_unused, index) => index % 256));

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-pack-protocol-"));
  const key = makeKey();
  publicKeyPem = key.publicKeyPem;
  const contents = {
    "uvod.md": "# Uvod\n\nVoda.\n",
    "slike/velika.png": IMAGE,
  };
  const files = Object.entries(contents).map(([path, body]) => entry(path, body));
  writePack({
    dir: packVersionDir(root, "prva-pomoc", "1.0.0"),
    key: key.privateKey,
    manifest: baseManifest(files, { id: "prva-pomoc", version: "1.0.0", kind: "content" }),
    contents,
  });
  // A pack that does NOT verify: its signature is by another key, so it is not in
  // the index and nothing in it may be served.
  const other = makeKey();
  writePack({
    dir: packVersionDir(root, "lazni-paket", "1.0.0"),
    key: other.privateKey,
    manifest: baseManifest([entry("tajna.md", "# Tajna\n")], {
      id: "lazni-paket",
      version: "1.0.0",
      kind: "content",
    }),
    contents: { "tajna.md": "# Tajna\n" },
  });
  rmSync(join(packVersionDir(root, "lazni-paket", "1.0.0"), "pack.json.sig"));
  refreshInstalled(root, publicKeyPem);
  handler = createPackProtocolHandler({ userData: root, publicKeyPem });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the path rules", () => {
  it("serves a path the manifest lists, with the type its extension names", async () => {
    const response = await handler(new Request(`${PACK_SCHEME}://prva-pomoc/uvod.md`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("14");
    expect(await response.text()).toBe("# Uvod\n\nVoda.\n");
  });

  it("serves a file inside a folder, and a percent-escaped name", async () => {
    const response = await handler(new Request(`${PACK_SCHEME}://prva-pomoc/slike/velika.png`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect((await response.arrayBuffer()).byteLength).toBe(IMAGE.byteLength);
  });

  it("refuses a path the manifest does not list, and one that leaves the pack", async () => {
    for (const url of [
      `${PACK_SCHEME}://prva-pomoc/nema.md`,
      `${PACK_SCHEME}://prva-pomoc/../pack.json`,
      `${PACK_SCHEME}://prva-pomoc/%2E%2E%2Fpack.json`,
      `${PACK_SCHEME}://prva-pomoc/..%2F..%2Fnexus.db`,
      `${PACK_SCHEME}://prva-pomoc/C:/Windows/System32/calc.exe`,
    ]) {
      const response = await handler(new Request(url));
      expect({ url, status: response.status }).toEqual({ url, status: 404 });
    }
  });

  it("refuses a pack that is not installed, and one whose signature does not verify", async () => {
    expect((await handler(new Request(`${PACK_SCHEME}://nema-paketa/uvod.md`))).status).toBe(404);
    expect((await handler(new Request(`${PACK_SCHEME}://lazni-paket/tajna.md`))).status).toBe(404);
  });

  it("refuses a request with no pack and no path at all", async () => {
    expect((await handler(new Request(`${PACK_SCHEME}://prva-pomoc/`))).status).toBe(404);
    expect((await handler(new Request(`${PACK_SCHEME}:///uvod.md`))).status).toBe(404);
  });
});

describe("the ranges", () => {
  it("answers a byte range with 206 and an exact Content-Range", async () => {
    const response = await handler(
      new Request(`${PACK_SCHEME}://prva-pomoc/slike/velika.png`, {
        headers: { range: "bytes=10-19" },
      }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 10-19/${String(IMAGE.byteLength)}`);
    expect(response.headers.get("content-length")).toBe("10");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes]).toEqual([...IMAGE.slice(10, 20)]);
  });

  it("answers an open-ended range, a suffix range and a range past the end", async () => {
    const open = await handler(
      new Request(`${PACK_SCHEME}://prva-pomoc/slike/velika.png`, {
        headers: { range: "bytes=290-" },
      }),
    );
    expect(open.status).toBe(206);
    expect(open.headers.get("content-range")).toBe(`bytes 290-299/${String(IMAGE.byteLength)}`);

    const suffix = await handler(
      new Request(`${PACK_SCHEME}://prva-pomoc/slike/velika.png`, {
        headers: { range: "bytes=-5" },
      }),
    );
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe(`bytes 295-299/${String(IMAGE.byteLength)}`);

    const stretched = await handler(
      new Request(`${PACK_SCHEME}://prva-pomoc/slike/velika.png`, {
        headers: { range: "bytes=295-9999" },
      }),
    );
    expect(stretched.status).toBe(206);
    expect(stretched.headers.get("content-range")).toBe(`bytes 295-299/${String(IMAGE.byteLength)}`);
  });

  it("answers an unsatisfiable range with 416 and the size, and ignores one it cannot read", async () => {
    const beyond = await handler(
      new Request(`${PACK_SCHEME}://prva-pomoc/slike/velika.png`, {
        headers: { range: "bytes=400-" },
      }),
    );
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("content-range")).toBe(`bytes */${String(IMAGE.byteLength)}`);

    for (const range of ["bytes=5-1", "bytes=-0", "items=0-1", "bytes=0-1,4-5"]) {
      const response = await handler(
        new Request(`${PACK_SCHEME}://prva-pomoc/slike/velika.png`, { headers: { range } }),
      );
      expect({ range, status: response.status }).toEqual({ range, status: 200 });
      expect(response.headers.get("content-length")).toBe(String(IMAGE.byteLength));
    }
  });

  it("parses a header the way the handler does, on its own", () => {
    expect(parseRangeHeader(null, 100)).toBeNull();
    expect(parseRangeHeader("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRangeHeader("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRangeHeader("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRangeHeader("bytes=200-", 100)).toBe("unsatisfiable");
    // An invalid spec is ignored; a valid range past the end is unsatisfiable.
    expect(parseRangeHeader("bytes=5-1", 100)).toBeNull();
    expect(parseRangeHeader("bytes=-0", 100)).toBeNull();
    expect(parseRangeHeader("bytes=-", 100)).toBeNull();
    expect(parseRangeHeader("bytes=0-1,4-5", 100)).toBeNull();
    expect(parseRangeHeader("seconds=0-9", 100)).toBeNull();
  });
});

describe("the content types", () => {
  it("names the types the packs this module serves actually carry", () => {
    expect(packContentType("slike/a.png")).toBe("image/png");
    expect(packContentType("slike/a.JPEG")).toBe("image/jpeg");
    expect(packContentType("a.md")).toBe("text/plain; charset=utf-8");
    expect(packContentType("mapa.pmtiles")).toBe("application/octet-stream");
  });

  it("never serves a type that executes as a document", () => {
    // An SVG is the case that matters: it draws in an `<img>` and it can carry a
    // script, so it is served as bytes rather than as markup.
    for (const path of ["a.svg", "a.html", "a.htm", "a.xml", "a.js"]) {
      expect(packContentType(path), path).toBe("application/octet-stream");
    }
  });
});
