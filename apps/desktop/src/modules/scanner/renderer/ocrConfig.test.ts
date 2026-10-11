import { describe, expect, it } from "vitest";
import {
  TESSDATA_PACK_ID,
  buildOcrOptions,
  isLocalOcrSource,
  languageArgument,
  packLanguagePath,
  type OcrAssetPaths,
} from "./ocrConfig.js";

/**
 * The OCR configuration, which is the whole of this module's network story.
 *
 * tesseract.js resolves its worker script, its WebAssembly core and its
 * language data against jsDelivr whenever one of those three options is left
 * unset - so "does this feature work with the network off" is not a property of
 * the library, it is a property of this config, and these are the assertions
 * that hold it: every path is local, all three are set, and a remote one is
 * refused rather than warned about.
 *
 * The asset URLs are what the packaged renderer produces (`file:` URLs beside
 * the built page, resolved from `location.href`); the dev-server case is the
 * one deliberate loopback exception and is asserted as such.
 */

/** What `ocrAssets.ts` resolves in the packaged app: the built page's own `ocr/` directory. */
const PACKAGED: OcrAssetPaths = {
  worker: "file:///C:/Nexus/resources/renderer/ocr/worker.min.js",
  core: "file:///C:/Nexus/resources/renderer/ocr/",
};

/** What it resolves under `pnpm dev`, where the page is served over http on loopback. */
const DEV: OcrAssetPaths = {
  worker: "http://localhost:5173/ocr/worker.min.js",
  core: "http://localhost:5173/ocr/",
};

describe("isLocalOcrSource", () => {
  it("accepts the app's own two schemes and the dev server's loopback origin", () => {
    for (const url of [
      "file:///C:/Nexus/resources/renderer/ocr/worker.min.js",
      "nx-pack://tessdata-fast/tessdata",
      "http://localhost:5173/ocr/",
      "http://127.0.0.1:5173/ocr/",
      "http://[::1]:5173/ocr/",
    ]) {
      expect(isLocalOcrSource(url), url).toBe(true);
    }
  });

  it("refuses every way off the machine, including the CDN tesseract.js would default to", () => {
    for (const url of [
      "https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js",
      "https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0",
      "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata",
      "http://localhost.example.com/ocr/worker.min.js",
      "data:text/javascript,importScripts('x')",
      "blob:http://localhost:5173/9f1e-4a2b",
      "zip://whatever",
    ]) {
      expect(isLocalOcrSource(url), url).toBe(false);
    }
  });

  it("refuses a relative path, because importScripts inside a worker resolves it against the wrong base", () => {
    expect(isLocalOcrSource("./ocr/worker.min.js")).toBe(false);
    expect(isLocalOcrSource("ocr/")).toBe(false);
  });
});

describe("buildOcrOptions", () => {
  it("sets all three paths to local values and leaves no default to fall back to", () => {
    const config = buildOcrOptions(PACKAGED, ["srp_latn", "eng"]);
    expect(config).toEqual({
      languages: "srp_latn+eng",
      workerPath: PACKAGED.worker,
      corePath: PACKAGED.core,
      langPath: `nx-pack://${TESSDATA_PACK_ID}/tessdata`,
      gzip: true,
      cacheMethod: "none",
      workerBlobURL: false,
    });
  });

  it("names no network scheme anywhere in the packaged configuration", () => {
    const config = buildOcrOptions(PACKAGED, ["srp", "srp_latn", "eng"]);
    for (const [key, value] of Object.entries(config)) {
      expect(String(value), key).not.toMatch(/^https?:\/\//);
    }
    expect(config.workerPath.startsWith("file:")).toBe(true);
    expect(config.corePath.startsWith("file:")).toBe(true);
    expect(config.langPath.startsWith("nx-pack:")).toBe(true);
  });

  it("reads the language models from the installed pack, not from the app's own folder", () => {
    const config = buildOcrOptions(PACKAGED, ["srp_latn"]);
    // The pack id is kebab-case (ADR-091) and it is the host of the URL, so a
    // pack id can never be mistaken for a folder inside another pack.
    expect(config.langPath).toBe("nx-pack://tessdata-fast/tessdata");
    expect(TESSDATA_PACK_ID).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(packLanguagePath("tessdata-fast")).toBe(config.langPath);
  });

  it("accepts the dev server's loopback URLs and nothing else about them", () => {
    expect(buildOcrOptions(DEV, ["eng"]).workerPath).toBe(DEV.worker);
  });

  it("refuses a remote worker, core or relative path instead of building a config that would fetch", () => {
    for (const assets of [
      {
        ...PACKAGED,
        worker: "https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js",
      },
      { ...PACKAGED, core: "https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0" },
      { ...PACKAGED, worker: "./ocr/worker.min.js" },
      { ...PACKAGED, core: "blob:file:///9f1e" },
    ]) {
      expect(() => buildOcrOptions(assets, ["eng"])).toThrow(/non-local/);
    }
  });
});

describe("languageArgument", () => {
  it("joins the chosen models in the order they were chosen", () => {
    expect(languageArgument(["srp", "srp_latn", "eng"])).toBe("srp+srp_latn+eng");
    expect(languageArgument(["eng", "srp_latn"])).toBe("eng+srp_latn");
  });

  it("drops a repeat rather than naming a model twice", () => {
    expect(languageArgument(["eng", "eng", "srp_latn"])).toBe("eng+srp_latn");
  });

  it("refuses an empty selection and a model this build does not ship", () => {
    expect(() => languageArgument([])).toThrow(/At least one language/);
    expect(() => languageArgument(["deu" as never])).toThrow(/Unknown tessdata language/);
  });
});
