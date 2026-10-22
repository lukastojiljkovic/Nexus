import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { NLLB_LANGUAGES } from "../../../apps/desktop/src/modules/translator/shared/languages.ts";
import { checkMeta } from "../../pack-sign.mjs";
import {
  checkFileSize,
  checkLicence,
  fileUrl,
  gather,
  listFiles,
  loadSources,
  metadataFor,
  missingFile,
  packById,
  parseArgs,
  readmeUrl,
  sha256,
  sourcesWithMeasured,
  MAX_FILE_BYTES,
} from "./build.mjs";

const sources = loadSources();
const scratch = mkdtempSync(join(tmpdir(), "nexus-nllb-build-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const REQUIRED = [
  "config.json",
  "generation_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];

/** A local folder holding every required file, plus whatever `extra` names. */
function localFolder(name, extra = []) {
  const folder = join(scratch, name);
  for (const path of [...REQUIRED, ...extra]) {
    const file = join(folder, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `fixture ${path}\n`);
  }
  return folder;
}

/** A readme whose front matter states the given licence line. */
function readme(line) {
  return `---\nlanguage:\n- en\n${line}\n---\n\n# NLLB\n`;
}

describe("sources.json", () => {
  it("names the three packs in size order", () => {
    expect(sources.packs.map((pack) => pack.id)).toEqual(["nllb-600m", "nllb-1.3b", "nllb-3.3b"]);
  });

  it("lists the same paths for every pack, and nothing else", () => {
    for (const pack of sources.packs) expect(pack.paths).toEqual(REQUIRED);
  });

  it("downloads the 600M files from the pinned Xenova revision and converts the other two locally", () => {
    expect(packById(sources, "nllb-600m").origin).toEqual({
      download: { repo: "Xenova/nllb-200-distilled-600M", revision: "261c31d1a5732c67cdd16d80e8d6088507c7ccea" },
    });
    expect(packById(sources, "nllb-1.3b").origin.local).toMatch(/nllb-200-distilled-1\.3B$/);
    expect(packById(sources, "nllb-3.3b").origin.local).toMatch(/nllb-200-3\.3B$/);
  });

  it("refuses a pack that is neither a download nor a local folder", () => {
    const broken = JSON.parse(JSON.stringify(sources));
    broken.packs[0].origin = {};
    const file = join(scratch, "broken.json");
    writeFileSync(file, JSON.stringify(broken));
    expect(() => loadSources(file)).toThrow(/origin/);
  });
});

describe("listFiles", () => {
  it("lists the downloaded pack's paths, sorted", () => {
    expect(listFiles(packById(sources, "nllb-600m"))).toEqual([...REQUIRED].sort());
  });

  it("adds the external-data chunks of the pack's own graphs, and nothing else", () => {
    // The converter leaves every graph it exported in the folder: the
    // non-merged decoders' data is not the pack's, and each is over the limit.
    const folder = localFolder("external", [
      "onnx/decoder_model_merged_quantized.onnx_data",
      "onnx/decoder_model_merged_quantized.onnx_data_1",
      "onnx/decoder_model_merged.onnx",
      "onnx/decoder_model_quantized.onnx_data",
      "onnx/decoder_with_past_model_quantized.onnx_data",
    ]);
    const pack = { ...packById(sources, "nllb-1.3b"), origin: { local: folder } };
    expect(listFiles(pack)).toEqual(
      [
        ...REQUIRED,
        "onnx/decoder_model_merged_quantized.onnx_data",
        "onnx/decoder_model_merged_quantized.onnx_data_1",
      ].sort(),
    );
  });
});

describe("missingFile", () => {
  it("names the first required file a local folder does not hold, and is silent for a complete folder", () => {
    const pack = packById(sources, "nllb-1.3b");
    const partial = join(scratch, "partial");
    mkdirSync(partial, { recursive: true });
    writeFileSync(join(partial, "config.json"), "{}\n");
    expect(missingFile({ ...pack, origin: { local: partial } })).toBe("generation_config.json");
    expect(missingFile({ ...pack, origin: { local: localFolder("complete") } })).toBeUndefined();
  });

  it("is silent for a downloaded pack, which is fetched rather than read", () => {
    expect(missingFile(packById(sources, "nllb-600m"))).toBeUndefined();
  });
});

describe("checkFileSize", () => {
  it("refuses a file of 2 GiB or more, naming it", () => {
    expect(MAX_FILE_BYTES).toBe(2147483648);
    expect(() => checkFileSize("onnx/big.onnx", MAX_FILE_BYTES)).toThrow(/onnx\/big\.onnx/);
  });

  it("accepts a file one byte under 2 GiB", () => {
    expect(() => checkFileSize("onnx/big.onnx", MAX_FILE_BYTES - 1)).not.toThrow();
  });
});

describe("checkLicence", () => {
  const pack = packById(sources, "nllb-600m");

  it("accepts a readme whose front matter states the recorded CC-BY-NC licence", () => {
    expect(() => checkLicence(readme(pack.licence.evidence.line), pack)).not.toThrow();
  });

  it("refuses a readme that states no licence line", () => {
    expect(() => checkLicence("# no front matter\n", pack)).toThrow(/does not state/);
  });

  it("refuses a readme whose licence is one this builder does not ship under", () => {
    const apache = 'license: "apache-2.0"';
    const altered = { ...pack, licence: { ...pack.licence, evidence: { ...pack.licence.evidence, line: apache } } };
    expect(() => checkLicence(readme(apache), altered)).toThrow(/apache-2\.0/);
  });
});

describe("fileUrl and readmeUrl", () => {
  it("pins every download to its revision and reads the licence from the model's own page", () => {
    const pack = packById(sources, "nllb-600m");
    expect(fileUrl(sources, pack, "onnx/encoder_model_quantized.onnx")).toBe(
      "https://huggingface.co/Xenova/nllb-200-distilled-600M/resolve/261c31d1a5732c67cdd16d80e8d6088507c7ccea/onnx/encoder_model_quantized.onnx",
    );
    expect(readmeUrl(sources, pack)).toBe(
      "https://huggingface.co/facebook/nllb-200-distilled-600M/raw/main/README.md",
    );
  });
});

describe("gather", () => {
  const download = packById(sources, "nllb-600m");

  it("reuses a cached file whose hash matches, and fetches nothing", async () => {
    const cacheDir = join(scratch, "cache-hit");
    const body = Buffer.from("cached config\n");
    const pack = { ...download, paths: ["config.json"], files: { "config.json": sha256(body) } };
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "config.json"), body);
    const fetched = [];
    const files = await gather({
      sources,
      pack,
      cacheDir,
      updateSources: false,
      fetchImpl: async (url) => {
        fetched.push(url);
        return Buffer.from("never");
      },
    });
    expect(fetched).toEqual([]);
    expect(files).toEqual([{ path: "config.json", file: join(cacheDir, "config.json"), bytes: body.byteLength, sha256: sha256(body) }]);
  });

  it("fetches a download that is not cached and refuses it when its hash differs from the record", async () => {
    const cacheDir = join(scratch, "cache-miss");
    const pack = { ...download, paths: ["config.json"], files: { "config.json": "0".repeat(64) } };
    await expect(
      gather({ sources, pack, cacheDir, updateSources: false, fetchImpl: async () => Buffer.from("other\n") }),
    ).rejects.toThrow(/config\.json hashes/);
  });

  it("records a changed hash when --update-sources is given", async () => {
    const cacheDir = join(scratch, "cache-update");
    const body = Buffer.from("new upstream\n");
    const pack = { ...download, paths: ["config.json"], files: { "config.json": "0".repeat(64) } };
    const files = await gather({ sources, pack, cacheDir, updateSources: true, fetchImpl: async () => body });
    expect(files[0].sha256).toBe(sha256(body));
  });

  it("reads a local folder in place and hashes what it reads", async () => {
    const folder = localFolder("local-read");
    const pack = { ...packById(sources, "nllb-1.3b"), origin: { local: folder }, files: undefined };
    const files = await gather({ sources, pack, cacheDir: join(scratch, "unused"), updateSources: false, fetchImpl: undefined });
    expect(files.map((file) => file.path)).toEqual([...REQUIRED].sort());
    const config = files.find((file) => file.path === "config.json");
    expect(config.file).toBe(join(folder, "config.json"));
    expect(config.sha256).toBe(sha256(readFileSync(join(folder, "config.json"))));
  });

  it("refuses a local file whose hash differs from the record, until --update-sources", async () => {
    const folder = localFolder("local-hash");
    const pack = { ...packById(sources, "nllb-1.3b"), origin: { local: folder }, files: { "config.json": "0".repeat(64) } };
    await expect(gather({ sources, pack, cacheDir: join(scratch, "unused"), updateSources: false })).rejects.toThrow(
      /config\.json hashes/,
    );
    const updated = await gather({ sources, pack, cacheDir: join(scratch, "unused"), updateSources: true });
    const recorded = sourcesWithMeasured(sources, pack.id, updated);
    expect(packById(recorded, pack.id).files["config.json"]).toBe(sha256(readFileSync(join(folder, "config.json"))));
  });
});

describe("metadataFor", () => {
  it("passes checkMeta for every pack, with the language count from NLLB_LANGUAGES", () => {
    for (const pack of sources.packs) {
      const meta = checkMeta(metadataFor(sources, pack));
      expect(meta.kind).toBe("model");
      expect(meta.minAppVersion).toBe("2.5.0");
      expect(meta.description.en).toBe(`Translates between ${NLLB_LANGUAGES.length} languages, offline.`);
      expect(meta.description.sr).toBe(`Prevodi između ${NLLB_LANGUAGES.length} jezika, bez interneta.`);
    }
  });

  it("names the 600M origin as the Xenova repository and the local packs as the model they were converted from", () => {
    expect(metadataFor(sources, packById(sources, "nllb-600m")).source).toEqual({
      name: "Xenova/nllb-200-distilled-600M",
      url: "https://huggingface.co/Xenova/nllb-200-distilled-600M",
    });
    expect(metadataFor(sources, packById(sources, "nllb-1.3b")).source.name).toBe("facebook/nllb-200-distilled-1.3B");
  });

  it("states the licence and its attribution, with the model card as its URL", () => {
    const meta = metadataFor(sources, packById(sources, "nllb-1.3b"));
    expect(meta.licence).toEqual({
      spdx: "CC-BY-NC-4.0",
      attribution: "NLLB-200 by Meta AI; converted to ONNX for Nexus",
      url: "https://huggingface.co/facebook/nllb-200-distilled-1.3B",
    });
  });
});

describe("parseArgs", () => {
  it("reads --pack as a list and --update-sources as a flag", () => {
    expect(parseArgs(["--pack", "nllb-600m,nllb-1.3b", "--update-sources"])).toEqual({
      packs: ["nllb-600m", "nllb-1.3b"],
      updateSources: true,
    });
  });

  it("reads --all as every pack", () => {
    expect(parseArgs(["--all"])).toEqual({ packs: null, updateSources: false });
  });

  it("refuses to run without a pack, and refuses an unknown flag", () => {
    expect(() => parseArgs([])).toThrow(/--pack/);
    expect(() => parseArgs(["--pack", "nllb-600m", "--sign"])).toThrow(/unknown argument/);
  });
});
