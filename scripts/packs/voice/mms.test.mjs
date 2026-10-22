import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkMeta } from "../../pack-sign.mjs";
import { descriptorFor } from "./build.mjs";
import {
  checkLicence,
  checkProof,
  conversionArgs,
  convertedDirFor,
  displayNames,
  isoOf,
  loadLanguages,
  mergeRecords,
  packIdFor,
  probeText,
  selectVoices,
  voiceMetadata,
  voicesIn,
} from "./mms.mjs";

/** Cut vocabularies, as a `vocab.json` lists its keys. */
const LATIN_VOCAB = ["<pad>", "<unk>", "|", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"];

const LICENCE_CARD = [
  "---",
  "license: cc-by-nc-4.0",
  "language: deu",
  "---",
  "",
  "This repository contains the **German (deu)** text-to-speech checkpoint.",
  "",
  "The model is licensed as **CC-BY-NC 4.0**.",
].join("\n");

const languages = await loadLanguages();

describe("pack ids and voice lists", () => {
  it("names a pack after its repository, with underscores replaced", () => {
    expect(packIdFor("facebook/mms-tts-deu")).toBe("mms-tts-deu");
    expect(packIdFor("facebook/mms-tts-azj-script_latin")).toBe("mms-tts-azj-script-latin");
  });

  it("refuses a repository that is not an MMS-TTS one", () => {
    expect(() => packIdFor("facebook/mms-tts")).toThrow(/facebook\/mms-tts"/);
    expect(() => packIdFor("Xenova/mms-tts-deu")).toThrow(/Xenova\/mms-tts-deu/);
  });

  it("reads the ISO code a voice serves from both kinds of repository", () => {
    expect(isoOf("facebook/mms-tts-deu")).toBe("deu");
    expect(isoOf("facebook/mms-tts-azj-script_latin")).toBe("azj");
  });

  it("builds every non-uroman voice of the table except English, each with the rows it serves", () => {
    const voices = voicesIn(languages);
    const repos = voices.map((voice) => voice.repo);
    expect(repos).not.toContain("facebook/mms-tts-eng");
    expect(repos).toContain("facebook/mms-tts-deu");
    expect(voices.every((voice) => voice.rows.every((row) => row.tts.repo === voice.repo && !row.tts.uroman))).toBe(true);
    expect(new Set(repos).size).toBe(repos.length);
    expect(voices.map((voice) => voice.id)).toEqual(voices.map((voice) => voice.id).sort());
  });

  it("serves a script split only the rows that the voice's script writes", () => {
    const taq = voicesIn(languages).find((voice) => voice.repo === "facebook/mms-tts-taq");
    expect(taq.rows.map((row) => row.code)).toEqual(["taq_Latn"]);
  });

  it("drops uroman rows and English from a list of rows", () => {
    const voices = voicesIn([
      { code: "kor_Hang", tag: "ko", tts: { repo: "facebook/mms-tts-kor", uroman: true } },
      { code: "eng_Latn", tag: "en", tts: { repo: "facebook/mms-tts-eng", uroman: false } },
      { code: "deu_Latn", tag: "de", tts: { repo: "facebook/mms-tts-deu", uroman: false } },
      { code: "srp_Cyrl", tag: "sr", tts: null },
    ]);
    expect(voices.map((voice) => voice.id)).toEqual(["mms-tts-deu"]);
  });

  it("selects voices by ISO code and refuses a code that has none", () => {
    const voices = voicesIn(languages);
    expect(selectVoices(voices, "deu,fra").map((voice) => voice.iso).sort()).toEqual(["deu", "fra"]);
    expect(selectVoices(voices, undefined)).toBe(voices);
    expect(() => selectVoices(voices, "deu,xxx")).toThrow(/"xxx"/);
  });
});

describe("conversion and proof", () => {
  it("runs the converter with both skip flags and the quantised q8 export", () => {
    expect(conversionArgs("facebook/mms-tts-deu", "C:\\out")).toEqual([
      "-m",
      "scripts.convert",
      "--quantize",
      "--modes",
      "q8",
      "--skip_validation",
      "--skip_onnxslim",
      "--model_id",
      "facebook/mms-tts-deu",
      "--output_parent_dir",
      "C:\\out",
    ]);
  });

  it("places a converted voice at its repository's path under the converter's output", () => {
    expect(convertedDirFor("facebook/mms-tts-deu").endsWith(join("facebook", "mms-tts-deu"))).toBe(true);
  });

  it("probes with the first 24 letters of the vocabulary, in groups of four", () => {
    expect(probeText(LATIN_VOCAB)).toBe("abcd efgh ijkl mnop qrst uvwx");
    expect(probeText(["<pad>", "|"])).toBe("");
  });

  it("accepts a proof of at least 0.2 s at an RMS of 0.005", () => {
    expect(() => checkProof({ seconds: 0.2, rms: 0.005, ms: 1 }, "facebook/mms-tts-deu")).not.toThrow();
  });

  it("refuses a proof that is too short, too quiet or silent", () => {
    expect(() => checkProof({ seconds: 0.19, rms: 0.2, ms: 1 }, "r")).toThrow(/at least 0.2 s/);
    expect(() => checkProof({ seconds: 1, rms: 0.004, ms: 1 }, "r")).toThrow(/RMS 0.005/);
    expect(() => checkProof({ seconds: 0, rms: 0, ms: 1 }, "r")).toThrow(/mms: r/);
  });
});

describe("licence evidence", () => {
  it("accepts a card that declares CC-BY-NC 4.0 in its front matter and in its text", () => {
    expect(() => checkLicence(LICENCE_CARD, "facebook/mms-tts-deu")).not.toThrow();
  });

  it("accepts a card that opens with a blank line, as the Hub serves its cards", () => {
    expect(() => checkLicence(`\n${LICENCE_CARD}`, "facebook/mms-tts-deu")).not.toThrow();
  });

  it("refuses a card whose front matter declares another licence", () => {
    const card = LICENCE_CARD.replace("license: cc-by-nc-4.0", "license: mit");
    expect(() => checkLicence(card, "facebook/mms-tts-deu")).toThrow(/facebook\/mms-tts-deu/);
  });

  it("refuses a card whose text does not state the licence", () => {
    const card = LICENCE_CARD.replace("The model is licensed as **CC-BY-NC 4.0**.", "");
    expect(() => checkLicence(card, "facebook/mms-tts-deu")).toThrow(/CC-BY-NC 4.0/);
  });
});

describe("pack metadata and descriptor", () => {
  const [german] = voicesIn(languages).filter((voice) => voice.repo === "facebook/mms-tts-deu");

  it("names a voice from its first row in both locales", () => {
    const names = displayNames(german.rows[0]);
    expect(names.en).toBe("German");
    expect(names.srLatn.length).toBeGreaterThan(0);
  });

  it("writes metadata that the signing tool accepts, with the voice's own copy and licence", () => {
    const metadata = voiceMetadata(german);
    expect(() => checkMeta(metadata)).not.toThrow();
    expect(metadata).toMatchObject({
      id: "mms-tts-deu",
      version: "2026.10.0",
      kind: "model",
      minAppVersion: "2.5.0",
      title: { en: "Voice — German" },
      licence: { spdx: "CC-BY-NC-4.0", url: "https://huggingface.co/facebook/mms-tts-deu" },
      source: { name: "facebook/mms-tts-deu", url: "https://huggingface.co/facebook/mms-tts-deu" },
    });
    expect(metadata.description.en).toBe("Reads translations aloud in this language.");
  });

  it("describes a VITS voice with its languages, rate and upstream revision", () => {
    const descriptor = descriptorFor(
      {
        id: "mms-tts-deu",
        kind: "tts",
        engine: "vits",
        languages: ["de"],
        sampleRate: 16000,
        repo: "facebook/mms-tts-deu",
        revision: "0123456789abcdef0123456789abcdef01234567",
      },
      { model_type: "vits", sampling_rate: 16000 },
    );
    expect(descriptor).toEqual({
      format: 1,
      kind: "tts",
      engine: "vits",
      languages: ["de"],
      sampleRate: 16000,
      upstream: { repo: "facebook/mms-tts-deu", revision: "0123456789abcdef0123456789abcdef01234567" },
    });
  });

  it("merges built voices into the record by id, sorted", () => {
    const merged = mergeRecords(
      [{ id: "mms-tts-fra" }, { id: "mms-tts-deu", old: true }],
      [{ id: "mms-tts-deu" }, { id: "mms-tts-ell" }],
    );
    expect(merged).toEqual([{ id: "mms-tts-deu" }, { id: "mms-tts-ell" }, { id: "mms-tts-fra" }]);
  });
});
