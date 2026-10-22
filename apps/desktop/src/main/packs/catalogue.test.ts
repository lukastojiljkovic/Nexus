import { createHash, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";

import { packRefusalCode } from "./errors.js";
import { PACK_CATALOGUE_SIGNATURE_CONTEXT, PACK_SIGNATURE_CONTEXT, verifyCatalogueSignature } from "./verify.js";
import { catalogueContentFiles, catalogueMetadataFiles, parsePackCatalogue } from "./catalogue.js";
import { baseManifest, entry as manifestFile, makeKey } from "./fixtures.js";
import { parsePackManifest } from "./manifest.js";

/**
 * The catalogue document (ADR-103, format 2): what is accepted, every refusal
 * the acceptance names, and the agreement it demands between an entry and the
 * manifest a download then fetches.
 *
 * The signature is checked here with `node:crypto` directly rather than through
 * the app's wrapper, for `scripts/pack-sign.test.mjs`'s reason: a test that
 * verifies the app with the app proves only that the app agrees with itself.
 * What the test does assert about the wrapper is the CONTEXT — that a signature
 * made for a manifest does not verify as a catalogue's and the other way round,
 * which is the one thing a third document needs and the one thing nothing else
 * in the tree can check.
 */

/** The compiled-in list, abbreviated: these tests use its shape, not its contents. */
const HOSTS: readonly string[] = ["github.com", "release-assets.githubusercontent.com"];

/** A detached signature by `key` over `context` followed by `bytes`, spelled here rather than by the app. */
function signBytes(key: KeyObject, context: string, bytes: Uint8Array): Buffer {
  return sign(null, Buffer.concat([Buffer.from(context, "utf8"), Buffer.from(bytes)]), key);
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

const MANIFEST_BYTES = '{"format":1}';
const SIGNATURE_BYTES = "signature bytes";
const CONTENT = "the whole thing, as a ZIM";
const ASSETS = "https://github.com/lukastojiljkovic/nexus-packs/releases/download/wikipedia-sr-2026.10.0/";

/** A catalogue entry with everything the format defines; `overrides` breaks one field per test. */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "wikipedia-sr",
    version: "2026.10.0",
    kind: "zim",
    title: { sr: "Vikipedija na srpskom", en: "Wikipedia in Serbian" },
    description: { sr: "Ceo ZIM.", en: "The whole ZIM." },
    size: MANIFEST_BYTES.length + SIGNATURE_BYTES.length + CONTENT.length,
    fileCount: 3,
    licence: {
      spdx: "CC-BY-SA-4.0",
      attribution: "Wikipedia contributors",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    source: { name: "Kiwix", url: "https://www.kiwix.org/" },
    notice: "safety",
    minAppVersion: "2.5.0",
    assets: ASSETS,
    manifest: { size: MANIFEST_BYTES.length, sha256: sha256(MANIFEST_BYTES) },
    signature: { size: SIGNATURE_BYTES.length, sha256: sha256(SIGNATURE_BYTES) },
    ...overrides,
  };
}

function document(packs: readonly unknown[]): unknown {
  return { format: 2, packs };
}

function refusalOf(value: unknown): string | null {
  try {
    parsePackCatalogue(value, HOSTS);
    return null;
  } catch (error) {
    return packRefusalCode(error);
  }
}

/** The manifest the entry describes, parsed as a download would parse it, with `overrides` on top. */
function manifestOf(overrides: Record<string, unknown> = {}) {
  return parsePackManifest(
    baseManifest([manifestFile("wikipedia.zim", CONTENT)], { version: "2026.10.0", kind: "zim", ...overrides }),
  );
}

function parsedEntry(overrides: Record<string, unknown> = {}) {
  const pack = parsePackCatalogue(document([entry(overrides)]), HOSTS).packs[0];
  if (pack === undefined) throw new Error("the fixture entry did not parse");
  return pack;
}

/** The refusal code a call throws, or `null` when it does not throw. */
function refusalFrom(call: () => unknown): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return packRefusalCode(error);
  }
}

describe("a catalogue the format defines", () => {
  it("parses, with the safety notice, both languages of copy and the floor", () => {
    const parsed = parsePackCatalogue(document([entry()]), HOSTS);
    expect(parsed.format).toBe(2);
    expect(parsed.packs).toHaveLength(1);
    const pack = parsed.packs[0];
    expect(pack?.id).toBe("wikipedia-sr");
    expect(pack?.notice).toBe("safety");
    expect(pack?.title).toEqual({ sr: "Vikipedija na srpskom", en: "Wikipedia in Serbian" });
    expect(pack?.minAppVersion).toBe("2.5.0");
    expect(pack?.fileCount).toBe(3);
  });

  it("reads an entry with no notice as no notice, not as an unknown one", () => {
    expect(parsedEntry({ notice: undefined }).notice).toBeNull();
  });

  it("addresses the manifest and its signature under the assets base, pinned by the entry", () => {
    expect(catalogueMetadataFiles(parsedEntry())).toEqual([
      {
        path: "pack.json",
        url: `${ASSETS}wikipedia-sr__pack.json`,
        size: MANIFEST_BYTES.length,
        sha256: sha256(MANIFEST_BYTES),
      },
      {
        path: "pack.json.sig",
        url: `${ASSETS}wikipedia-sr__pack.json.sig`,
        size: SIGNATURE_BYTES.length,
        sha256: sha256(SIGNATURE_BYTES),
      },
    ]);
  });
});

describe("the content a verified manifest lists", () => {
  it("is every manifest file, at its asset address, pinned by the manifest", () => {
    expect(catalogueContentFiles(parsedEntry(), manifestOf())).toEqual([
      {
        path: "wikipedia.zim",
        url: `${ASSETS}wikipedia-sr__wikipedia.zim`,
        size: CONTENT.length,
        sha256: sha256(CONTENT),
      },
    ]);
  });

  it("is refused when the manifest is another pack or another version", () => {
    expect(refusalFrom(() => catalogueContentFiles(parsedEntry(), manifestOf({ id: "wikipedia-en" })))).toBe(
      "catalogue-entry",
    );
    expect(refusalFrom(() => catalogueContentFiles(parsedEntry(), manifestOf({ version: "2026.9.0" })))).toBe(
      "catalogue-entry",
    );
  });

  it("is refused when the entry's file count or size is not the manifest's", () => {
    expect(refusalFrom(() => catalogueContentFiles(parsedEntry({ fileCount: 4 }), manifestOf()))).toBe(
      "catalogue-entry",
    );
    expect(refusalFrom(() => catalogueContentFiles(parsedEntry({ size: entry().size + 1 }), manifestOf()))).toBe(
      "catalogue-entry",
    );
  });
});

describe("the signature", () => {
  const key = makeKey();
  const bytes = Buffer.from(JSON.stringify(document([entry()])), "utf8");

  it("accepts the release key's signature under the catalogue's context", () => {
    const signature = signBytes(key.privateKey, PACK_CATALOGUE_SIGNATURE_CONTEXT, bytes);
    expect(
      verifyCatalogueSignature({ catalogueBytes: bytes, signatureBytes: signature, publicKeyPem: key.publicKeyPem }),
    ).toBe(true);
  });

  it("refuses a tampered document", () => {
    const signature = signBytes(key.privateKey, PACK_CATALOGUE_SIGNATURE_CONTEXT, bytes);
    const tampered = Buffer.concat([bytes, Buffer.from(" ", "utf8")]);
    expect(
      verifyCatalogueSignature({
        catalogueBytes: tampered,
        signatureBytes: signature,
        publicKeyPem: key.publicKeyPem,
      }),
    ).toBe(false);
  });

  it("refuses a PACK signature presented as a catalogue one", () => {
    const asManifest = signBytes(key.privateKey, PACK_SIGNATURE_CONTEXT, bytes);
    expect(
      verifyCatalogueSignature({
        catalogueBytes: bytes,
        signatureBytes: asManifest,
        publicKeyPem: key.publicKeyPem,
      }),
    ).toBe(false);
  });
});

describe("what it refuses", () => {
  it("refuses an assets base on a host the download list does not hold", () => {
    expect(refusalOf(document([entry({ assets: "https://evil.example/packs/" })]))).toBe("catalogue-host");
  });

  it("refuses an http base even on an allowed host", () => {
    expect(refusalOf(document([entry({ assets: ASSETS.replace("https://", "http://") })]))).toBe("catalogue-host");
  });

  it("refuses a base that does not end in a slash, or carries a query or a fragment", () => {
    expect(refusalOf(document([entry({ assets: ASSETS.slice(0, -1) })]))).toBe("catalogue-entry");
    expect(refusalOf(document([entry({ assets: `${ASSETS}?x=1` })]))).toBe("catalogue-entry");
    expect(refusalOf(document([entry({ assets: `${ASSETS}#top` })]))).toBe("catalogue-entry");
  });

  it("refuses an unknown field, at the top level and inside an entry", () => {
    expect(refusalOf({ format: 2, packs: [entry()], extra: true })).toBe("catalogue-unreadable");
    expect(refusalOf(document([entry({ files: [] })]))).toBe("catalogue-unreadable");
  });

  it("refuses an entry with no floor", () => {
    expect(refusalOf(document([entry({ minAppVersion: undefined })]))).not.toBeNull();
  });

  it("refuses a notice this build does not know", () => {
    expect(refusalOf(document([entry({ notice: "warning" })]))).toBe("notice-invalid");
  });

  it("refuses a pinned file without a whole digest", () => {
    expect(refusalOf(document([entry({ manifest: { size: 13, sha256: "abc" } })]))).toBe("catalogue-entry");
  });

  it("refuses a size smaller than the two pinned files, and a file count under two", () => {
    expect(refusalOf(document([entry({ size: 3 })]))).toBe("catalogue-entry");
    expect(refusalOf(document([entry({ fileCount: 1 })]))).toBe("catalogue-entry");
  });

  it("refuses the same pack id twice", () => {
    expect(refusalOf(document([entry(), entry()]))).toBe("catalogue-entry");
  });

  it("refuses a format this build does not read, the published format 1 included", () => {
    expect(refusalOf({ format: 1, packs: [entry()] })).toBe("format-unknown");
  });

  it("refuses an empty catalogue", () => {
    expect(refusalOf({ format: 2, packs: [] })).toBe("catalogue-unreadable");
  });
});
