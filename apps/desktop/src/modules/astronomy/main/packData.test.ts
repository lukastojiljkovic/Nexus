import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MAX_TEXTURES_BYTES,
  PLANET_TEXTURES_PACK_ID,
  loadPlanetTextures,
  packUrl,
  parseTexturesLayout,
  texturesFile,
} from "./packData.js";

/**
 * The planet-textures reader.
 *
 * A pack arrives from outside this machine, so what is pinned here is what the
 * reader will and will not take: the layout number this build reads, the images
 * a body must have and the ones it may omit, a body this contract does not know
 * (dropped, so a newer pack cannot break an older view), and a path that is not
 * a path this app opens. The signature check and the file read are the shell's
 * (`main/packs/registry.ts`) and are exercised by their own suite; what this
 * file owns is the translation from a declared file into the addresses the
 * renderer fetches.
 */

const PACK = PLANET_TEXTURES_PACK_ID;

describe("parseTexturesLayout", () => {
  it("resolves every declared image into a pack address, credit and all", () => {
    const layout = parseTexturesLayout(
      {
        layout: 1,
        bodies: {
          earth: {
            day: "images/earth-day.webp",
            night: "images/earth-night.webp",
            credit: "NASA Earth Observatory",
          },
          saturn: {
            day: "images/saturn-day.webp",
            rings: "images/saturn-rings.webp",
            credit: "Solar System Scope (INOVE) — CC BY 4.0",
          },
        },
      },
      PACK,
    );
    expect(layout).not.toBeNull();
    expect(layout?.bodies.earth).toEqual({
      day: packUrl(PACK, "images/earth-day.webp"),
      night: packUrl(PACK, "images/earth-night.webp"),
      credit: "NASA Earth Observatory",
    });
    expect(layout?.bodies.saturn?.rings).toBe(packUrl(PACK, "images/saturn-rings.webp"));
    expect(layout?.bodies.saturn?.night).toBeUndefined();
    // Bodies the layout does not name are simply absent: the view draws them in
    // the neutral tone, which is what a partial pack looks like.
    expect(layout?.bodies.pluto).toBeUndefined();
  });

  it("refuses a document this build cannot read, whole", () => {
    for (const refused of [
      null,
      "textures",
      [],
      { layout: 2, bodies: {} },
      { bodies: {} },
      { layout: 1 },
      { layout: 1, bodies: [] },
    ]) {
      expect(parseTexturesLayout(refused, PACK), JSON.stringify(refused)).toBeNull();
    }
  });

  it("drops an unknown body, an entry with no image, and a path it will not open", () => {
    const layout = parseTexturesLayout(
      {
        layout: 1,
        bodies: {
          // A body this contract does not know: ignored, so a newer pack cannot
          // break an older view.
          ceres: { day: "images/ceres.webp", credit: "NASA" },
          // A body with no credit is not an entry this view can attribute.
          venus: { day: "images/venus.webp" },
          // A path that leaves the pack, a drive, and a backslash: none of them
          // is a file the shell's protocol would serve.
          jupiter: { day: "../secret.png", credit: "NASA" },
          neptune: { day: "C:/windows/system32/cmd.exe", credit: "NASA" },
          // One of them is fine, and its own credit survives.
          mars: { day: "images/mars.webp", credit: "Solar System Scope (INOVE) — CC BY 4.0" },
        },
      },
      PACK,
    );
    expect(layout?.bodies.mars?.day).toBe(packUrl(PACK, "images/mars.webp"));
    expect(Object.keys(layout?.bodies ?? {})).toEqual(["mars"]);
  });

  it("keeps a body whose optional ring strip is declared unsafely, and drops the strip", () => {
    const layout = parseTexturesLayout(
      {
        layout: 1,
        bodies: {
          saturn: {
            day: "images/saturn-day.webp",
            rings: "../rings.png",
            credit: "Solar System Scope (INOVE) — CC BY 4.0",
          },
        },
      },
      PACK,
    );
    expect(layout?.bodies.saturn?.day).toBe(packUrl(PACK, "images/saturn-day.webp"));
    expect(layout?.bodies.saturn?.rings).toBeUndefined();
  });
});

describe("texturesFile", () => {
  it("takes the shallowest declared copy, and ignores a path this build will not open", () => {
    expect(
      texturesFile({
        files: [
          { path: "vendor/textures.json" },
          { path: "textures.json" },
          { path: "a/b/textures.json" },
        ],
      }),
    ).toBe("textures.json");
    expect(texturesFile({ files: [{ path: "images/earth.webp" }] })).toBeNull();
    // A manifest that lists an unsafe path is still a manifest that was signed;
    // the join is what refuses it, here as everywhere else.
    expect(texturesFile({ files: [{ path: "../textures.json" }] })).toBeNull();
  });
});

describe("loadPlanetTextures", () => {
  it("answers the pack id and no layout when nothing is installed", async () => {
    // A directory that does not exist: `readInstalled` answers an empty index
    // for a missing packs root rather than throwing (main/packs/registry.ts),
    // and nothing here creates or touches a file.
    const userData = join(tmpdir(), `nexus-astronomy-absent-${String(Date.now())}`);
    const view = await loadPlanetTextures(userData, "not-a-key");
    expect(view).toEqual({ packId: PLANET_TEXTURES_PACK_ID, textures: null });
    expect(MAX_TEXTURES_BYTES).toBe(256 * 1024);
  });
});
