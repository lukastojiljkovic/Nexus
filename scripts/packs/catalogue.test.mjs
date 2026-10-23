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

import { packAssetName } from "../../apps/desktop/src/main/packs/assets.ts";
import { assetName, buildCatalogue, fromFormat1, mergeEntries, packBaseUrl, packIdsIn } from "./catalogue.mjs";

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

  it("is the rule the app derives every format-2 address with", () => {
    // The app never sees this file; it rebuilds each asset's name from the
    // signed manifest. One case the two spellings disagree on is one pack
    // whose downloads all 404.
    const long = Array.from({ length: 20 }, (_, i) => `abcdefghij${String(i)}`).join("/");
    const cases = [
      ["survival", "pack.json"],
      ["survival", "pack.json.sig"],
      ["reference-sr", "content/first-aid/a b#1?.md"],
      ["x", "a b#c?d%e:f"],
      ["p", long],
      ["nonograms-pictures", "nonograms.json"],
    ];
    for (const [id, path] of cases) {
      const sha = createHash("sha256").update(path).digest("hex");
      expect(packAssetName(id, path, sha)).toBe(assetName(id, path, sha));
    }
  });
});

describe("buildCatalogue", () => {
  it("writes a format-2 entry: the pair pinned, the size and count of every file", async () => {
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
    expect(entry.fileCount).toBe(4);
    expect(entry.minAppVersion).toBe("1.5.0");
    expect(entry.assets).toBe(BASE);
    expect(entry.files).toBeUndefined();
    const dir = join(packs, "alpha");
    const onDisk = ["pack.json", "pack.json.sig", "content.json", "images/a.png"].map(
      (path) => readFileSync(join(dir, ...path.split("/"))).byteLength,
    );
    expect(entry.size).toBe(onDisk.reduce((sum, size) => sum + size, 0));
    // The pair the entry pins is the pair on the disk, staged under the name the
    // app will ask for.
    for (const [key, name] of [
      ["manifest", "pack.json"],
      ["signature", "pack.json.sig"],
    ]) {
      const bytes = readFileSync(join(dir, name));
      expect(entry[key]).toEqual({
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      expect(existsSync(join(out, "assets", assetName("alpha", name, entry[key].sha256)))).toBe(true);
    }
    for (const row of assets) expect(existsSync(join(out, "assets", row.asset))).toBe(true);

    const written = JSON.parse(readFileSync(join(out, "catalogue.json"), "utf8"));
    expect(written.format).toBe(2);
    expect(written.packs).toEqual(entries);
  });

  it("keeps the entries of a merged catalogue it does not rebuild, and replaces the ones it does", async () => {
    const root = mkdtempSync(join(tmpdir(), "catalogue-"));
    const packs = join(root, "packs");
    mkdirSync(packs, { recursive: true });
    makePack(packs, "beta", [["content.json", "{}"]]);
    const kept = { id: "alpha", version: "1" };
    const stale = { id: "beta", version: "0" };

    const { entries } = await buildCatalogue({
      packIds: ["beta"],
      packsDir: packs,
      outDir: join(root, "out"),
      baseUrl: BASE,
      merge: { format: 2, packs: [stale, kept] },
    });
    expect(entries.map((entry) => [entry.id, entry.version])).toEqual([
      ["alpha", "1"],
      ["beta", "2026.10.11"],
    ]);
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
    expect(entries[0].assets).toBe(`${PER_PACK.split("{id}")[0]}alpha-2026.10.11/`);
  });
});

describe("mergeEntries", () => {
  it("lists each pack once, the fresh entry winning, sorted by id", () => {
    expect(
      mergeEntries(
        [
          { id: "b", version: "1" },
          { id: "a", version: "1" },
        ],
        [{ id: "b", version: "2" }],
      ),
    ).toEqual([
      { id: "a", version: "1" },
      { id: "b", version: "2" },
    ]);
  });
});

describe("fromFormat1", () => {
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const RELEASE = "https://github.com/lukastojiljkovic/nexus-packs/releases/download/survival-2026.10.10/";
  const manifestBytes = Buffer.from(
    JSON.stringify({
      format: 1,
      id: "survival",
      version: "2026.10.10",
      kind: "content",
      title: { sr: "Opstanak", en: "Survival" },
      description: { sr: "Opis.", en: "About." },
      licence: { spdx: "CC0-1.0", attribution: "Nobody", url: "https://example.org/l" },
      source: { name: "Test", url: "https://example.org" },
      minAppVersion: "2.0.0",
      files: [],
    }),
  );
  const signatureBytes = Buffer.from("sig");

  /** The format-1 entry the live catalogue holds for the pack above, `edit` applied to its file rows. */
  function v1(edit = (file) => file) {
    const row = (path, bytes) => ({
      path,
      url: `${RELEASE}${assetName("survival", path, sha(bytes))}`,
      size: bytes.byteLength,
      sha256: sha(bytes),
    });
    const files = [
      row("pack.json", manifestBytes),
      row("pack.json.sig", signatureBytes),
      row("content/a b.md", Buffer.from("text")),
    ].map(edit);
    return {
      format: 1,
      packs: [
        {
          id: "survival",
          version: "2026.10.10",
          kind: "content",
          title: { sr: "Opstanak", en: "Survival" },
          description: { sr: "Opis.", en: "About." },
          size: files.reduce((sum, file) => sum + file.size, 0),
          licence: { spdx: "CC0-1.0", attribution: "Nobody", url: "https://example.org/l" },
          source: { name: "Test", url: "https://example.org" },
          notice: "safety",
          files,
        },
      ],
    };
  }

  const serve = (bytes) => async () => new Uint8Array(bytes);

  it("writes the entry a 2.5 app reads, its floor taken from the pinned manifest", async () => {
    const [entry] = await fromFormat1(v1(), serve(manifestBytes));
    expect(entry).toEqual({
      id: "survival",
      version: "2026.10.10",
      kind: "content",
      title: { sr: "Opstanak", en: "Survival" },
      description: { sr: "Opis.", en: "About." },
      size: manifestBytes.byteLength + signatureBytes.byteLength + 4,
      fileCount: 3,
      licence: { spdx: "CC0-1.0", attribution: "Nobody", url: "https://example.org/l" },
      source: { name: "Test", url: "https://example.org" },
      minAppVersion: "2.0.0",
      assets: RELEASE,
      manifest: { size: manifestBytes.byteLength, sha256: sha(manifestBytes) },
      signature: { size: signatureBytes.byteLength, sha256: sha(signatureBytes) },
    });
  });

  it("refuses a published file whose URL is not the asset rule's name", async () => {
    const moved = v1((file) => (file.path === "content/a b.md" ? { ...file, url: `${RELEASE}a.md` } : file));
    await expect(fromFormat1(moved, serve(manifestBytes))).rejects.toThrow(/publishes content\/a b\.md at/);
  });

  it("refuses a fetched manifest that is not the one format 1 pins", async () => {
    await expect(fromFormat1(v1(), serve(Buffer.from("{}")))).rejects.toThrow(/not the one format 1 pins/);
  });

  it("refuses anything but a format-1 document", async () => {
    await expect(fromFormat1({ format: 2, packs: [] }, serve(manifestBytes))).rejects.toThrow(/format-1/);
  });
});
