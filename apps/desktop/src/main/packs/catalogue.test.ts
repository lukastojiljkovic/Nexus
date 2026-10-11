import { createHash, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";

import { packRefusalCode } from "./errors.js";
import { PACK_CATALOGUE_SIGNATURE_CONTEXT, PACK_SIGNATURE_CONTEXT, verifyCatalogueSignature } from "./verify.js";
import { parsePackCatalogue } from "./catalogue.js";
import { makeKey } from "./fixtures.js";

/**
 * The catalogue document (ADR-103): what is accepted, and every refusal the
 * acceptance names.
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

/** One `files` entry, with a real hash of the bytes the download would fetch. */
function file(path: string, contents: string, host = "github.com") {
  return {
    path,
    url: `https://${host}/lukastojiljkovic/nexus-packs/releases/download/pack/${path}`,
    size: Buffer.byteLength(contents, "utf8"),
    sha256: sha256(contents),
  };
}

const CONTENT = "the whole thing, as a ZIM";

/** A catalogue entry with everything the format defines; `overrides` breaks one field per test. */
function entry(overrides: Record<string, unknown> = {}) {
  const files = [
    file("pack.json", "{\"format\":1}"),
    file("pack.json.sig", "signature bytes"),
    file("wikipedia.zim", CONTENT),
  ];
  return {
    id: "wikipedia-sr",
    version: "2026.10.0",
    kind: "zim",
    title: { sr: "Vikipedija na srpskom", en: "Wikipedia in Serbian" },
    description: { sr: "Ceo ZIM.", en: "The whole ZIM." },
    size: files.reduce((sum, listed) => sum + listed.size, 0),
    licence: {
      spdx: "CC-BY-SA-4.0",
      attribution: "Wikipedia contributors",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    source: { name: "Kiwix", url: "https://www.kiwix.org/" },
    notice: "safety",
    files,
    ...overrides,
  };
}

function document(packs: readonly unknown[]): unknown {
  return { format: 1, packs };
}

function refusalOf(value: unknown): string | null {
  try {
    parsePackCatalogue(value, HOSTS);
    return null;
  } catch (error) {
    return packRefusalCode(error);
  }
}

describe("a catalogue the format defines", () => {
  it("parses, with the safety notice and both languages of copy", () => {
    const parsed = parsePackCatalogue(document([entry()]), HOSTS);
    expect(parsed.format).toBe(1);
    expect(parsed.packs).toHaveLength(1);
    const pack = parsed.packs[0];
    expect(pack?.id).toBe("wikipedia-sr");
    expect(pack?.notice).toBe("safety");
    expect(pack?.title).toEqual({ sr: "Vikipedija na srpskom", en: "Wikipedia in Serbian" });
    expect(pack?.files.map((listed) => listed.path)).toEqual([
      "pack.json",
      "pack.json.sig",
      "wikipedia.zim",
    ]);
    // The stated size is the download's total, so it is the sum of the files.
    expect(pack?.size).toBe(pack?.files.reduce((sum, listed) => sum + listed.size, 0));
  });

  it("reads an entry with no notice as no notice, not as an unknown one", () => {
    const parsed = parsePackCatalogue(document([entry({ notice: undefined })]), HOSTS);
    expect(parsed.packs[0]?.notice).toBeNull();
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
  it("refuses a file address on a host the download list does not hold", () => {
    const files = entry().files.map((listed) =>
      listed.path === "wikipedia.zim" ? file("wikipedia.zim", CONTENT, "evil.example") : listed,
    );
    expect(refusalOf(document([entry({ files })]))).toBe("catalogue-host");
  });

  it("refuses an http address even on an allowed host", () => {
    const files = entry().files.map((listed) =>
      listed.path === "wikipedia.zim"
        ? { ...listed, url: listed.url.replace("https://", "http://") }
        : listed,
    );
    expect(refusalOf(document([entry({ files })]))).toBe("catalogue-host");
  });

  it("refuses an unknown field, at the top level and inside an entry", () => {
    expect(refusalOf({ format: 1, packs: [entry()], extra: true })).toBe("catalogue-unreadable");
    expect(refusalOf(document([entry({ minAppVersion: "1.0.0" })]))).toBe("catalogue-unreadable");
  });

  it("refuses a notice this build does not know", () => {
    expect(refusalOf(document([entry({ notice: "warning" })]))).toBe("notice-invalid");
  });

  it("refuses a stated size that is not the sum of the files", () => {
    expect(refusalOf(document([entry({ size: entry().size + 1 })]))).toBe("catalogue-entry");
  });

  it("refuses an entry that does not pin the manifest and its signature", () => {
    const files = entry().files.filter((listed) => listed.path !== "pack.json.sig");
    const size = files.reduce((sum, listed) => sum + listed.size, 0);
    expect(refusalOf(document([entry({ files, size })]))).toBe("catalogue-entry");
  });

  it("refuses the same path twice", () => {
    const files = [...entry().files, file("wikipedia.zim", "other bytes")];
    const size = files.reduce((sum, listed) => sum + listed.size, 0);
    expect(refusalOf(document([entry({ files, size })]))).toBe("catalogue-entry");
  });

  it("refuses the same pack id twice", () => {
    expect(refusalOf(document([entry(), entry()]))).toBe("catalogue-entry");
  });

  it("refuses a format this build does not read", () => {
    expect(refusalOf({ format: 2, packs: [entry()] })).toBe("format-unknown");
  });

  it("refuses an empty catalogue", () => {
    expect(refusalOf({ format: 1, packs: [] })).toBe("catalogue-unreadable");
  });
});
