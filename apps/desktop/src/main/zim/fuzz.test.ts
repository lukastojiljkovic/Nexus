import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ZimError } from "./errors.js";
import { ZimReader } from "./reader.js";
import { buildZim } from "./testing/zimBuilder.js";

/**
 * Hostile files, and what "fails cleanly" means here.
 *
 * A ZIM's every number is an offset into a file the app did not write, so the
 * reader is the boundary where a broken or hostile one has to become a refusal
 * rather than a hang, an unbounded allocation or a `RangeError` from
 * `Buffer.readUInt32LE`. This suite walks that boundary: it starts from a file
 * the builder wrote, breaks exactly one thing, and asserts that every entry
 * point — open, path lookup, title search, main page, blob read, checksum — either
 * answers or refuses with a `ZimError`.
 *
 * The mutations are chosen rather than random in the first block because each
 * one names a rule the reader has to hold, and the second block IS random —
 * because the classes of damage nobody thought of are the reason the first block
 * exists. Neither block asserts a particular refusal code for every case: a
 * corrupted pointer can legitimately land on `corrupt`, `out-of-range` or
 * `not-found`, and pinning one would be pinning an implementation detail rather
 * than the property. What IS asserted is that a refusal is a `ZimError` — an
 * error this app knows how to turn into a sentence.
 */

const body = new TextEncoder().encode("<html><body>hi</body></html>");

function sample(): Buffer {
  return buildZim({
    entries: [
      { namespace: "C", path: "article.html", title: "Article", mime: "text/html", cluster: 0, blob: 0 },
      { namespace: "I", path: "img/pix.png", title: "Pix", mime: "image/png", cluster: 1, blob: 0 },
      { namespace: "C", path: "old.html", title: "Old", target: 0 },
    ],
    clusters: [
      { blobs: [body], compression: "zstd" },
      { blobs: [new Uint8Array([1, 2, 3, 4])], compression: "none" },
    ],
    mainPage: 0,
    titleListing: true,
  });
}

/** Runs `probe` against a file written from `bytes`, and answers what it threw. */
function probe(bytes: Buffer, run: (reader: ZimReader) => void): unknown {
  const directory = mkdtempSync(join(tmpdir(), "nx-zim-fuzz-"));
  const filePath = join(directory, "broken.zim");
  writeFileSync(filePath, bytes);
  let reader: ZimReader | null = null;
  try {
    reader = ZimReader.open(filePath);
    run(reader);
    return null;
  } catch (error) {
    return error;
  } finally {
    reader?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Everything the reader can be asked, so a broken number is reached whichever path it is in. */
function exercise(reader: ZimReader): void {
  reader.mainPage();
  reader.entryByPath("C/article.html");
  reader.entryByPath("I/img/pix.png");
  reader.entryByPath("X/listing/titleOrdered/v1");
  reader.entryByTitle("Article");
  reader.titlesFrom("A", 3);
  reader.hasFullTextIndex();
  // Both clusters are read, because the two paths through `clusterOf` are
  // different code: the article is in the zstd cluster and the image in the
  // uncompressed one.
  for (const path of ["C/article.html", "I/img/pix.png"]) {
    const entry = reader.entryByPath(path);
    if (entry !== null) reader.blob(entry);
  }
  reader.checksumMatches();
}

function expectCleanRefusal(failure: unknown): void {
  expect(failure).toBeInstanceOf(ZimError);
}

describe("a ZIM with one broken number", () => {
  const cases: readonly { readonly name: string; readonly break: (bytes: Buffer) => void }[] = [
    { name: "the magic number", break: (b) => b.writeUInt32LE(0, 0) },
    { name: "the major version", break: (b) => b.writeUInt16LE(99, 4) },
    { name: "the entry count", break: (b) => b.writeUInt32LE(0xffffffff, 24) },
    { name: "the cluster count", break: (b) => b.writeUInt32LE(0xffffffff, 28) },
    { name: "the URL pointer list position", break: (b) => b.writeBigUInt64LE(1n, 32) },
    { name: "the title pointer list position", break: (b) => b.writeBigUInt64LE(BigInt(b.length - 2), 40) },
    { name: "the cluster pointer list position", break: (b) => b.writeBigUInt64LE(2n, 48) },
    { name: "the MIME list position", break: (b) => b.writeBigUInt64LE(BigInt(b.length - 20), 56) },
    { name: "the main page index", break: (b) => b.writeUInt32LE(9999, 64) },
    { name: "the checksum position, past the file", break: (b) => b.writeBigUInt64LE(BigInt(b.length + 1), 72) },
    { name: "the checksum position, inside the header", break: (b) => b.writeBigUInt64LE(40n, 72) },
    { name: "a cluster pointer, past the data", break: (b) => b.writeBigUInt64LE(BigInt(b.length - 8), 48) },
  ];

  for (const scenario of cases) {
    it(`refuses cleanly with ${scenario.name} changed`, () => {
      const bytes = sample();
      scenario.break(bytes);
      const failure = probe(bytes, exercise);
      if (failure !== null) expectCleanRefusal(failure);
    });
  }
});

describe("a ZIM whose clusters and entries are damaged", () => {
  it("refuses an unknown cluster compression code", () => {
    const bytes = sample();
    // Every cluster starts with its info byte; 0x07 is a compression nibble the
    // format has never defined.
    const { clusters } = locate(bytes);
    bytes.writeUInt8(0x07, clusters[0] ?? 0);
    expectCleanRefusal(probe(bytes, exercise));
  });

  it("refuses an LZMA cluster by name", () => {
    const bytes = sample();
    const { clusters } = locate(bytes);
    bytes.writeUInt8(0x04, clusters[0] ?? 0);
    const failure = probe(bytes, exercise);
    expect(failure).toBeInstanceOf(ZimError);
    expect((failure as ZimError).problem).toBe("compression");
  });

  it("refuses an offset table whose first entry is zero", () => {
    const bytes = sample();
    const { clusters } = locate(bytes);
    // The uncompressed cluster is the second one; its payload begins after the
    // info byte and its first four bytes are the table's own length.
    bytes.writeUInt32LE(0, (clusters[1] ?? 0) + 1);
    const failure = probe(bytes, exercise);
    if (failure !== null) expectCleanRefusal(failure);
  });

  it("refuses an offset table that claims the whole payload", () => {
    const bytes = sample();
    const { clusters } = locate(bytes);
    bytes.writeUInt32LE(0xffffff, (clusters[1] ?? 0) + 1);
    const failure = probe(bytes, exercise);
    if (failure !== null) expectCleanRefusal(failure);
  });

  it("refuses a blob number the cluster does not have", () => {
    const bytes = sample();
    const { direntOffsets } = locate(bytes);
    // The URL pointer list is sorted, and the first entry of the built file is
    // `C/article.html`; its blob number is at header offset 12.
    const offset = direntOffsets[0] ?? 0;
    bytes.writeUInt32LE(0xffff, offset + 12);
    const failure = probe(bytes, exercise);
    if (failure !== null) expectCleanRefusal(failure);
  });

  it("refuses a cluster number the file does not have", () => {
    const bytes = sample();
    const { direntOffsets } = locate(bytes);
    const offset = direntOffsets[0] ?? 0;
    bytes.writeUInt32LE(0xffff, offset + 8);
    const failure = probe(bytes, exercise);
    if (failure !== null) expectCleanRefusal(failure);
  });

  it("refuses a directory entry that points at the trailer", () => {
    const bytes = sample();
    const { urlPtrPos } = locate(bytes);
    // Overwrite the URL pointer list's first pointer
    // with the position of the 16 checksum bytes, where no dirent can begin.
    const checksumPos = Number(bytes.readBigUInt64LE(72));
    bytes.writeBigUInt64LE(BigInt(checksumPos - 1), urlPtrPos);
    const failure = probe(bytes, exercise);
    if (failure !== null) expectCleanRefusal(failure);
  });
});

describe("a ZIM truncated at every scale", () => {
  it("answers or refuses at every length, and never over-reads", () => {
    const whole = sample();
    const lengths = [0, 1, 40, 79, 80, 84, 120, 200, 260, 400, Math.floor(whole.length / 2), whole.length - 1];
    for (const length of lengths) {
      const failure = probe(whole.subarray(0, length), exercise);
      if (failure !== null) expectCleanRefusal(failure);
    }
  });
});

describe("a ZIM with one byte flipped", () => {
  it("never throws anything but a ZimError", () => {
    // A deterministic walk rather than a seeded random one: byte `i` stepped
    // through the header and the pointer lists, so a failure names a position.
    const whole = sample();
    for (let at = 0; at < 200; at += 1) {
      const bytes = Buffer.from(whole);
      bytes[at % bytes.length] = (bytes[at % bytes.length] ?? 0) ^ 0xff;
      const failure = probe(bytes, exercise);
      if (failure !== null) expectCleanRefusal(failure);
    }
  });
});

/**
 * The three positions a mutation needs: the cluster pointer list, the entries
 * it points at, and the clusters themselves.
 *
 * Read out of the file the builder wrote rather than hard-coded, so a change to
 * the builder moves these with it instead of silently pointing the mutations at
 * the wrong bytes.
 */
function locate(bytes: Buffer): {
  clusters: number[];
  urlPtrPos: number;
  direntOffsets: number[];
} {
  const clusterPtrPos = Number(bytes.readBigUInt64LE(48));
  const clusterCount = bytes.readUInt32LE(28);
  const clusters: number[] = [];
  for (let index = 0; index < clusterCount; index += 1) {
    clusters.push(Number(bytes.readBigUInt64LE(clusterPtrPos + index * 8)));
  }
  const urlPtrPos = Number(bytes.readBigUInt64LE(32));
  const entryCount = bytes.readUInt32LE(24);
  const direntOffsets: number[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    direntOffsets.push(Number(bytes.readBigUInt64LE(urlPtrPos + index * 8)));
  }
  return { clusters, urlPtrPos, direntOffsets };
}
