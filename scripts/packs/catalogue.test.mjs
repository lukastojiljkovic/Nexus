// The catalogue builder, against a pack folder this test makes itself.
//
// What the file's own doc cannot say and this suite has to: that the document
// it writes is one the APP's parser accepts, and that the staged files are the
// bytes the catalogue pins. Both are checked here against a two-file pack that
// costs a millisecond to build, rather than against 838 MB of real packs.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assetName, buildCatalogue, packBaseUrl, packIdsIn } from "./catalogue.mjs";

const BASE = "https://github.com/lukastojiljkovic/nexus-packs/releases/download/catalogue/";
const PER_PACK = "https://github.com/lukastojiljkovic/nexus-packs/releases/download/{id}-{version}/";

/** One signed-looking pack folder: a manifest, its signature and two content files. */
function makePack(root, id, files) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const listed = [];
  for (const [path, body] of files) {
    const absolute = join(dir, ...path.split("/"));
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, body);
    listed.push({
      path,
      size: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }
  writeFileSync(
    join(dir, "pack.json"),
    `${JSON.stringify({
      format: 1,
      id,
      version: "2026.10.11",
      kind: "content",
      title: { sr: "Test", en: "Test" },
      description: { sr: "Test", en: "Test" },
      licence: {
        spdx: "CC0-1.0",
        attribution: "Nobody",
        url: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
      source: { name: "Test", url: "https://example.org" },
      minAppVersion: "1.5.0",
      files: listed,
    })}\n`,
  );
  writeFileSync(join(dir, "pack.json.sig"), "not-a-real-signature\n");
  writeFileSync(join(root, `${id}.meta.json`), "{}\n");
  return dir;
}

describe("assetName", () => {
  it("leads with the pack id and keeps the whole path, so two packs cannot collide", () => {
    const a = assetName("survival", "images/fire.png", "0".repeat(64));
    const b = assetName("reference-sr", "images/fire.png", "0".repeat(64));
    expect(a).toBe("survival__images__fire.png");
    expect(a).not.toBe(b);
  });

  it("replaces what GitHub will not carry in an asset name", () => {
    expect(assetName("x", "a b#c?d%e:f", "0".repeat(64))).toBe("x__a_b_c_d_e_f");
  });

  it("trims a long name and disambiguates it by its own hash", () => {
    // 238 characters before the pack id: past the cap, which is where the rule
    // it is testing starts to apply.
    const long = Array.from({ length: 20 }, (_, i) => `abcdefghij${String(i)}`).join("/");
    const name = assetName("p", long, "dead".padEnd(64, "0"));
    expect(name.length).toBeLessThanOrEqual(197);
    expect(name.endsWith("dead000000000000")).toBe(true);
  });
});

describe("buildCatalogue", () => {
  it("writes a document whose sizes are the sum of its files, manifest and signature included", async () => {
    const root = mkdtempSync(join(tmpdir(), "catalogue-"));
    const out = join(root, "out");
    const packs = join(root, "packs");
    mkdirSync(packs, { recursive: true });
    makePack(packs, "alpha", [
      ["content.json", "{}"],
      ["images/a.png", "PNG-A"],
    ]);

    const { entries, assets } = await buildCatalogue({
      packIds: packIdsIn(packs),
      packsDir: packs,
      outDir: out,
      baseUrl: BASE,
    });

    expect(assets).toHaveLength(4);
    const entry = entries[0];
    expect(entry.id).toBe("alpha");
    expect(entry.files.map((file) => file.path)).toEqual([
      "pack.json",
      "pack.json.sig",
      "content.json",
      "images/a.png",
    ]);
    expect(entry.size).toBe(entry.files.reduce((sum, file) => sum + file.size, 0));
    // The two files a pack cannot be installed without are pinned like content.
    for (const file of entry.files) {
      expect(file.url.startsWith(BASE)).toBe(true);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(existsSync(join(out, "assets", file.url.slice(BASE.length)))).toBe(true);
    }

    const written = JSON.parse(readFileSync(join(out, "catalogue.json"), "utf8"));
    expect(written.format).toBe(1);
    expect(written.packs).toHaveLength(1);
  });

  it("refuses a manifest whose recorded size is not what is on the disk", async () => {
    const root = mkdtempSync(join(tmpdir(), "catalogue-"));
    const packs = join(root, "packs");
    mkdirSync(packs, { recursive: true });
    const dir = makePack(packs, "beta", [["content.json", "{}"]]);
    const manifest = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
    manifest.files[0].size += 1;
    writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest));

    await expect(
      buildCatalogue({ packIds: ["beta"], packsDir: packs, outDir: join(root, "out"), baseUrl: BASE }),
    ).rejects.toThrow(/lists content\.json as 3 bytes; it is 2/);
  });

  it("refuses a folder whose manifest names another pack", async () => {
    const root = mkdtempSync(join(tmpdir(), "catalogue-"));
    const packs = join(root, "packs");
    mkdirSync(packs, { recursive: true });
    const dir = makePack(packs, "delta", [["content.json", "{}"]]);
    // The folder is named for the id `pack-sign.mjs` was pointed at; the
    // manifest it wrote says otherwise, which is the shape a mislabelled
    // publish has.
    const manifest = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
    manifest.id = "gamma";
    writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest));

    await expect(
      buildCatalogue({ packIds: ["delta"], packsDir: packs, outDir: join(root, "out"), baseUrl: BASE }),
    ).rejects.toThrow(/names the pack "gamma"/);
  });

  it("refuses a base that does not end with a slash", async () => {
    const root = mkdtempSync(join(tmpdir(), "catalogue-"));
    const packs = join(root, "packs");
    mkdirSync(packs, { recursive: true });
    makePack(packs, "epsilon", [["content.json", "{}"]]);

    await expect(
      buildCatalogue({
        packIds: ["epsilon"],
        packsDir: packs,
        outDir: join(root, "out"),
        baseUrl: "https://github.com/x",
      }),
    ).rejects.toThrow(/must end with a slash/);
  });
});

describe("packBaseUrl", () => {
  it("fills the pack's own id and version, which is what one release per pack needs", () => {
    expect(packBaseUrl(PER_PACK, "survival", "2026.10.10")).toBe(
      "https://github.com/lukastojiljkovic/nexus-packs/releases/download/survival-2026.10.10/",
    );
  });

  it("refuses a template with a placeholder it does not know", () => {
    expect(() => packBaseUrl(`${PER_PACK}{owner}/`, "x", "1")).toThrow(/still holds a placeholder/);
  });
});

describe("packIdsIn", () => {
  it("narrows to the packs a wave publishes, and refuses an id that has none", () => {
    const root = mkdtempSync(join(tmpdir(), "catalogue-"));
    const packs = join(root, "packs");
    mkdirSync(packs, { recursive: true });
    makePack(packs, "one", [["content.json", "{}"]]);
    makePack(packs, "two", [["content.json", "{}"]]);
    expect(packIdsIn(packs)).toEqual(["one", "two"]);
    expect(packIdsIn(packs, ["two"])).toEqual(["two"]);
    expect(() => packIdsIn(packs, ["three"])).toThrow(/no pack/);
  });
});

describe("buildCatalogue with a template", () => {
  it("puts each pack's files under that pack's own release tag", async () => {
    const root = mkdtempSync(join(tmpdir(), "catalogue-"));
    const packs = join(root, "packs");
    mkdirSync(packs, { recursive: true });
    makePack(packs, "alpha", [["content.json", "{}"]]);

    const { entries } = await buildCatalogue({
      packIds: packIdsIn(packs),
      packsDir: packs,
      outDir: join(root, "out"),
      baseUrl: PER_PACK,
    });
    for (const file of entries[0].files) {
      expect(file.url.startsWith(`${PER_PACK.split("{id}")[0]}alpha-2026.10.11/`)).toBe(true);
    }
  });
});
