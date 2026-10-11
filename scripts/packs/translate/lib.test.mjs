import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { checkMeta } from "../../pack-sign.mjs";
import {
  assertSameBuild,
  buildNotice,
  gunzip,
  PACK_FILES,
  packMeta,
  recordFile,
  registryEntry,
  sha256Hex,
  verifyContent,
} from "./lib.mjs";

/**
 * The translation-pack builder's rules, on fixtures cut from Mozilla's own two
 * registry documents (`fixtures/models.json`, `fixtures/records.json` — the real
 * entries for sr->en and en->hr, byte for byte, with only the unrelated pairs
 * removed).
 *
 * What is pinned here is the part that decides whether a file is allowed into a
 * pack: the hash and size a record states, the cross-check that a pinned object
 * directory and a pinned model version describe the SAME build, and the NOTICE's
 * promise that it names every file with its version and its hash.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const models = JSON.parse(readFileSync(join(HERE, "fixtures", "models.json"), "utf8"));
const records = JSON.parse(readFileSync(join(HERE, "fixtures", "records.json"), "utf8"));

/** sr->en's only registry entry: the `tiny` model in its spring-2024 directory. */
const SR_EN_DIR = "models/sr-en/spring-2024_H5GCfsx4SnqOP4YFIQdkdA";
/** en->hr's two entries, which is exactly the trap this builder checks for: a Release and an older tiny build. */
const EN_HR_RELEASE_DIR = "models/en-hr/hbs-topk10_PLHJ-5OxSNyWlwZM12Kghw";
const EN_HR_TINY_DIR = "models/en-hr/spring-2024_NcLX56D4SuSpByVVfuAHJQ";

describe("sha256Hex", () => {
  it("is lower-case hex, and the digest of the bytes it is given", () => {
    // Hand-computed once: printf 'Nexus' | sha256sum
    expect(sha256Hex(Buffer.from("Nexus", "utf8"))).toBe(
      "7ec8aa5a08624a1f4d540e2534a3b3db5d8c61e2e69954a7cb7022c5c69f971f",
    );
    expect(sha256Hex(Buffer.from("Nexus", "utf8"))).toHaveLength(64);
  });
});

describe("gunzip", () => {
  it("reads back what was gzipped, and refuses bytes that are not a gzip object", () => {
    const text = "model.sren.intgemm.alphas.bin";
    const gz = gzipSync(Buffer.from(text, "utf8"));
    expect(gunzip(gz, "the model").toString("utf8")).toBe(text);
    expect(() => gunzip(Buffer.from("not gzip"), "lex.s2t.bin")).toThrow(/lex\.s2t\.bin is not a readable gzip/);
  });
});

describe("recordFile", () => {
  it("reads one file's name, size and hash out of Mozilla's record", () => {
    expect(recordFile(records, { from: "sr", to: "en", version: "1.0", fileType: "model" })).toEqual({
      name: "model.sren.intgemm.alphas.bin",
      size: 17141051,
      sha256: "99c44e9690a7ed2c1f13468765c3b1db2b8a8ae739980e4056d45dca613a1966",
    });
  });

  it("refuses a file type, a pair or a version the record does not hold", () => {
    expect(() => recordFile(records, { from: "sr", to: "en", version: "1.0", fileType: "config" })).toThrow(
      /no config file/,
    );
    expect(() => recordFile(records, { from: "de", to: "en", version: "1.0", fileType: "model" })).toThrow(
      /no model file for de->en/,
    );
    expect(() => recordFile(records, { from: "sr", to: "en", version: "9.9", fileType: "model" })).toThrow(
      /version 9\.9/,
    );
  });
});

describe("registryEntry", () => {
  it("pins one build by its object directory, not by the pair alone", () => {
    expect(registryEntry(models, { pair: "sr-en", dir: SR_EN_DIR }).architecture).toBe("tiny");
    expect(registryEntry(models, { pair: "en-hr", dir: EN_HR_RELEASE_DIR }).architecture).toBe(
      "base-memory",
    );
    expect(registryEntry(models, { pair: "en-hr", dir: EN_HR_TINY_DIR }).architecture).toBe("tiny");
  });

  it("refuses a pair the registry does not list, and a directory it does not name for one", () => {
    expect(() => registryEntry(models, { pair: "sr-hr", dir: SR_EN_DIR })).toThrow(/no pair "sr-hr"/);
    expect(() => registryEntry(models, { pair: "sr-en", dir: "models/sr-en/nothing" })).toThrow(
      /no "sr-en" model under models\/sr-en\/nothing\//,
    );
  });
});

describe("assertSameBuild", () => {
  it("accepts the registry entry and the record that describe one build", () => {
    const entry = registryEntry(models, { pair: "sr-en", dir: SR_EN_DIR });
    const record = recordFile(records, { from: "sr", to: "en", version: "1.0", fileType: "model" });
    expect(assertSameBuild(entry, record, "sr-en")).toEqual({
      sha256: "99c44e9690a7ed2c1f13468765c3b1db2b8a8ae739980e4056d45dca613a1966",
      size: 17141051,
    });
  });

  it("refuses a pinned directory whose model is not the model the version names", () => {
    // THE REAL CASE, and the reason this check exists. en->hr has a Release build
    // (base-memory, 31 561 787 bytes) and an older tiny one, and Mozilla's record
    // writes the tiny hashes under version "1.0". Pinning the Release directory
    // and the version label would have shipped the tiny model's vocabulary with
    // the Release model's weights; the two hashes below are the real ones.
    const release = registryEntry(models, { pair: "en-hr", dir: EN_HR_RELEASE_DIR });
    const tinyVersionRecord = recordFile(records, {
      from: "en",
      to: "hr",
      version: "1.0",
      fileType: "model",
    });
    expect(tinyVersionRecord.sha256).toBe(
      "29ba32235778da3e38cfeb0d7f36eaf8dc37c961ff8651d86f7cae7e29e97d88",
    );
    expect(() => assertSameBuild(release, tinyVersionRecord, "en-hr")).toThrow(
      /the registry's en-hr model \(2f34590d/,
    );
  });
});

describe("verifyContent", () => {
  const bytes = Buffer.from("shortlist bytes", "utf8");
  const sha256 = sha256Hex(bytes);

  it("accepts exactly the size and hash the record states", () => {
    expect(
      verifyContent({ label: "lex.s2t.bin", expectedSize: bytes.byteLength, expectedSha256: sha256, bytes }),
    ).toBe(sha256);
  });

  it("refuses a size that is not the record's, and a hash that is not the record's", () => {
    expect(() =>
      verifyContent({ label: "lex.s2t.bin", expectedSize: bytes.byteLength + 1, expectedSha256: sha256, bytes }),
    ).toThrow(/lex\.s2t\.bin is 15 bytes, the record states 16/);
    expect(() =>
      verifyContent({ label: "lex.s2t.bin", expectedSize: bytes.byteLength, expectedSha256: "00".repeat(32), bytes }),
    ).toThrow(/lex\.s2t\.bin hashes to [0-9a-f]{64}, the record states 0{64}/);
  });
});

describe("buildNotice", () => {
  const spec = {
    id: "translate-sr-en",
    pair: "sr-en",
    from: "sr",
    to: "en",
    fromName: "Serbian",
    toName: "English",
    version: "1.0",
    architecture: "tiny",
    dir: SR_EN_DIR,
  };
  const files = {
    model: { name: "model.sren.intgemm.alphas.bin", size: 17141051, sha256: "a".repeat(64) },
    shortlist: { name: "lex.50.50.sren.s2t.bin", size: 4628048, sha256: "b".repeat(64) },
    vocab: { name: "vocab.sren.spm", size: 822509, sha256: "c".repeat(64) },
  };
  const notice = buildNotice({
    spec,
    files,
    registry: { generated: "2026-10-09T00:54:11Z" },
    fetchedAt: "2026-10-10T00:00:00.000Z",
  });

  it("names every file with Mozilla's own name, its size and its hash", () => {
    for (const file of Object.values(files)) {
      expect(notice).toContain(file.name);
      expect(notice).toContain(String(file.size));
      expect(notice).toContain(file.sha256);
    }
    expect(notice).toContain(PACK_FILES.model);
    expect(notice).toContain(PACK_FILES.shortlist);
    expect(notice).toContain(PACK_FILES.vocab);
  });

  it("states the version, the architecture, the licence and the licence's own sentence", () => {
    expect(notice).toContain("version 1.0");
    expect(notice).toContain("tiny");
    expect(notice).toContain("MPL-2.0");
    expect(notice).toContain("The model files are distributed under the MPL 2.0 license.");
    expect(notice).toContain("https://raw.githubusercontent.com/mozilla/translations/main/README.md");
  });
});

describe("packMeta", () => {
  const meta = packMeta({
    id: "translate-sr-en",
    packVersion: "2026.10.0",
    fromName: "Serbian",
    toName: "English",
    version: "1.0",
    title: { sr: "Prevod srpskog na engleski", en: "Serbian to English translation" },
    description: { sr: "Opis", en: "Description" },
  });

  it("proves the signer accepts the metadata the builder writes", () => {
    // The signer's own rule, not a copy of it: `--meta` with a missing or an
    // unknown key is a manifest the app refuses after the key was used.
    expect(checkMeta(meta)).toBe(meta);
    expect(Object.hasOwn(meta, "files")).toBe(false);
  });

  it("carries the pack's kind, both languages of copy and the model's attribution", () => {
    expect(meta.kind).toBe("model");
    expect(meta.licence.spdx).toBe("MPL-2.0");
    expect(meta.licence.attribution).toContain("Mozilla");
    expect(meta.title.sr.length).toBeGreaterThan(0);
    expect(meta.title.en.length).toBeGreaterThan(0);
  });
});

describe("the committed sources.json files", () => {
  const packDirs = readdirSync(join(REPO_ROOT, "scripts", "packs")).filter((name) =>
    name.startsWith("translate-"),
  );

  it("names at least the two directions the brief requires", () => {
    expect(packDirs).toContain("translate-sr-en");
    expect(packDirs).toContain("translate-en-sr");
  });

  it("gives every source a URL, a fetch date, a SHA-256 and quoted licence evidence", () => {
    for (const packDir of packDirs) {
      const rows = JSON.parse(
        readFileSync(join(REPO_ROOT, "scripts", "packs", packDir, "sources.json"), "utf8"),
      );
      expect(rows.length).toBeGreaterThanOrEqual(7);
      for (const row of rows) {
        expect(row.url).toMatch(/^https:\/\//);
        expect(row.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(row.licence).toBe("MPL-2.0");
        expect(row.licenceEvidence.url).toMatch(/^https:\/\//);
        expect(row.licenceEvidence.quote.length).toBeGreaterThan(0);
      }
    }
  });
});
