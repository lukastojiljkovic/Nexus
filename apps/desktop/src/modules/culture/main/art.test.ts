import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseManifest, entry, makeKey, writePack } from "../../../main/packs/fixtures.js";
import { artImageMime, parseArtDataset, readArtDatasets } from "./art.js";

/**
 * The arts guide, read from a FIXTURE PACK FOLDER.
 *
 * The fixture is a real installed pack - a folder under `<userData>/packs/<id>/
 * <version>/` with a manifest, a signature over that manifest's exact bytes, and
 * the content the manifest lists - signed with a throwaway key from
 * `main/packs/fixtures.ts`. That is what makes these tests exercise the real
 * gate: `readArtDatasets` verifies the signature against the key it is handed,
 * so a folder that is not a pack this build would install contributes nothing.
 *
 * The image is four bytes of a JPEG signature: nothing in this module decodes a
 * picture, it only serves bytes, so a real photograph would prove nothing the
 * four bytes do not.
 */

const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function artJson(layout: number, works: unknown[]): string {
  return `${JSON.stringify({ layout, works }, null, 2)}\n`;
}

const PORTRAIT = {
  id: "portrait-1",
  title: "Portret",
  artist: "Nepoznati autor",
  date: "1850",
  medium: "ulje na platnu",
  museum: "Narodni muzej",
  credit: "Narodni muzej, Beograd",
  licence: "CC0-1.0",
  image: "images/portret.jpg",
  width: 800,
  height: 1000,
};

let userData: string;
let key: { publicKeyPem: string; privateKey: import("node:crypto").KeyObject };

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-culture-art-"));
  key = makeKey();
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

/** Installs one pack folder under the fixture userData directory. */
function install(options: {
  id?: string;
  version?: string;
  kind?: string;
  dataset?: string | null;
  extraFiles?: Readonly<Record<string, string | Uint8Array>>;
  contents?: Readonly<Record<string, string | Uint8Array>>;
}): void {
  const id = options.id ?? "art-test";
  const version = options.version ?? "1.0.0";
  const contents: Record<string, string | Uint8Array> = {
    "images/portret.jpg": IMAGE,
    ...(options.contents ?? {}),
  };
  if (options.dataset !== null) {
    contents["art.json"] = options.dataset ?? artJson(1, [PORTRAIT]);
  }
  for (const [path, body] of Object.entries(options.extraFiles ?? {})) contents[path] = body;
  const manifest = baseManifest(
    Object.entries(contents).map(([path, body]) => entry(path, body)),
    {
      id,
      version,
      kind: options.kind ?? "dataset",
      title: { sr: "Test galerija", en: "Test gallery" },
      licence: {
        spdx: "CC0-1.0",
        attribution: "Test muzej",
        url: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
    },
  );
  writePack({
    dir: join(userData, "packs", id, version),
    key: key.privateKey,
    manifest,
    contents,
  });
}

describe("readArtDatasets", () => {
  it("reads every work of an installed dataset pack, with the credit line it carries", () => {
    install({});
    const reading = readArtDatasets(userData, key.publicKeyPem);
    expect(reading.skipped).toEqual([]);
    expect(reading.packs).toEqual([
      {
        id: "art-test",
        version: "1.0.0",
        title: { sr: "Test galerija", en: "Test gallery" },
        licence: {
          spdx: "CC0-1.0",
          attribution: "Test muzej",
          url: "https://creativecommons.org/publicdomain/zero/1.0/",
        },
      },
    ]);
    expect(reading.works).toEqual([
      {
        ...PORTRAIT,
        medium: "ulje na platnu",
        packId: "art-test",
        version: "1.0.0",
      },
    ]);
  });

  it("ignores a pack that is not a dataset, and one whose art.json is malformed", () => {
    install({ id: "zim-test", kind: "zim", dataset: null, contents: { "book.zim": "x" } });
    install({ id: "broken-test", dataset: "{ ovo nije JSON" });
    install({ id: "layout-two", dataset: artJson(2, [PORTRAIT]) });

    const reading = readArtDatasets(userData, key.publicKeyPem);
    expect(reading.works).toEqual([]);
    expect(reading.packs).toEqual([]);
    expect(reading.skipped).toEqual(["broken-test", "layout-two"]);
  });

  it("reads nothing at all when no pack is installed", () => {
    expect(readArtDatasets(userData, key.publicKeyPem)).toEqual({
      works: [],
      packs: [],
      skipped: [],
    });
  });
});

describe("parseArtDataset", () => {
  const carried = new Set(["art.json", "images/portret.jpg"]);
  const pack = { id: "art-test", version: "1.0.0", carriedFiles: carried };

  it("refuses a layout this build does not read, by name", () => {
    expect(() => parseArtDataset({ layout: 2, works: [] }, pack)).toThrow(/layout 2/);
  });

  it("refuses an image the pack does not carry, and one that is not a picture", () => {
    expect(() =>
      parseArtDataset(
        { layout: 1, works: [{ ...PORTRAIT, image: "images/other.jpg" }] },
        pack,
      ),
    ).toThrow(/does not carry/);
    expect(() =>
      parseArtDataset({ layout: 1, works: [{ ...PORTRAIT, image: "images/a.txt" }] }, pack),
    ).toThrow(/image types/);
    expect(() =>
      parseArtDataset({ layout: 1, works: [{ ...PORTRAIT, image: "../portret.jpg" }] }, pack),
    ).toThrow(/path inside the pack/);
  });

  it("refuses two works with one id, and a size that is not a size", () => {
    expect(() =>
      parseArtDataset({ layout: 1, works: [PORTRAIT, PORTRAIT] }, pack),
    ).toThrow(/Two works carry the id/);
    expect(() =>
      parseArtDataset({ layout: 1, works: [{ ...PORTRAIT, width: 0 }] }, pack),
    ).toThrow(/pixels/);
  });

  it("treats an absent medium as absent rather than as an empty string", () => {
    const [work] = parseArtDataset(
      { layout: 1, works: [{ ...PORTRAIT, medium: undefined }] },
      pack,
    );
    expect(work?.medium).toBeNull();
  });
});

describe("artImageMime", () => {
  it("knows the six picture types the guide draws, and nothing else", () => {
    expect(artImageMime("images/a.jpg")).toBe("image/jpeg");
    expect(artImageMime("images/a.JPEG")).toBe("image/jpeg");
    expect(artImageMime("images/a.png")).toBe("image/png");
    expect(artImageMime("images/a.webp")).toBe("image/webp");
    expect(artImageMime("images/a.gif")).toBe("image/gif");
    expect(artImageMime("images/a.avif")).toBe("image/avif");
    expect(artImageMime("images/a.svg")).toBeNull();
    expect(artImageMime("images/a")).toBeNull();
  });
});

