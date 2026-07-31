import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";

import { createArchiveWriter, DATA_FILES, type ArchiveKdfParams } from "@nexus/core";
import { deriveArchiveKey, generateSalt } from "@nexus/core/auth";

import {
  ArchiveReadError,
  DEFAULT_ARCHIVE_LIMITS,
  inspectArchiveFile,
  openArchive,
  type ArchiveLimits,
  type ArchiveReadErrorCode,
} from "./archiveReader.js";

/**
 * Cheap Argon2id parameters — the minimum `validateKdfParams`
 * (`archiveContainer.ts`) accepts — so sealing test fixtures into `NXA1`
 * containers stays fast while `deriveArchiveKey` is still exercised for
 * real, end to end, at least once.
 */
const CHEAP_KDF: ArchiveKdfParams = {
  algorithm: "argon2id",
  memoryKiB: 8192,
  iterations: 1,
  parallelism: 1,
};

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function textEntry(content: string): Buffer {
  return Buffer.from(content, "utf8");
}

/** Builds a real zip byte stream via `yazl` — the same writer the export path uses (`main/imex.ts`). Every entry is small, so `addBuffer` for all of them is fine. */
async function buildZip(entries: ReadonlyArray<{ path: string; content: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipfile = new ZipFile();
    for (const entry of entries) zipfile.addBuffer(entry.content, entry.path);
    const chunks: Buffer[] = [];
    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);
    zipfile.end();
  });
}

/**
 * Seals a zip byte stream into an `NXA1` container under `passphrase`,
 * chunking it exactly the way `main/imex.ts`'s `ArchiveFramer` chunks a real
 * export: full `chunkBytes` frames while a full one remains, then ONE final
 * frame for whatever is left — even nothing.
 *
 * The chunking is not incidental. A fixture small enough to fit in a single
 * frame never crosses a frame boundary, so it would exercise none of what
 * `openArchivePlaintext` exists to do; see the multi-frame round-trip test
 * below, which is the only place `yauzl` seeking across frames is proven
 * end to end.
 */
async function sealAsNxa1(zipBytes: Buffer, passphrase: string): Promise<Buffer> {
  const salt = generateSalt();
  const key = await deriveArchiveKey(passphrase, salt, CHEAP_KDF);
  const writer = await createArchiveWriter({ key, salt, kdf: CHEAP_KDF });
  const parts: Buffer[] = [Buffer.from(writer.headerBlock)];
  let offset = 0;
  while (zipBytes.length - offset >= writer.chunkBytes) {
    const frame = await writer.seal(zipBytes.subarray(offset, offset + writer.chunkBytes), false);
    parts.push(Buffer.from(frame));
    offset += writer.chunkBytes;
  }
  parts.push(Buffer.from(await writer.seal(zipBytes.subarray(offset), true)));
  return Buffer.concat(parts);
}

interface FullFixture {
  entries: Array<{ path: string; content: Buffer }>;
  blobSha: string;
  blobContent: Buffer;
}

/** One of every "yes" row in ADR-022's archive layout table: manifest, all five NDJSON files, a note `.ydoc`, a note-version `.ydoc`, and one valid blob. This module never parses manifest/NDJSON content, so their bodies are trivial placeholders. */
function buildFullFixture(): FullFixture {
  const blobContent = Buffer.from("hello blob bytes", "utf8");
  const blobSha = sha256Hex(blobContent);
  const dataFileEntries = DATA_FILES.map((path) => ({ path, content: textEntry("") }));
  const entries: Array<{ path: string; content: Buffer }> = [
    { path: "manifest.json", content: textEntry('{"schemaVersion":"1.0.0"}') },
    ...dataFileEntries,
    { path: "data/notes/note-1.ydoc", content: Buffer.from([1, 2, 3, 4]) },
    { path: "data/note-versions/note-1/3.ydoc", content: Buffer.from([5, 6, 7]) },
    { path: `blobs/${blobSha}`, content: blobContent },
  ];
  return { entries, blobSha, blobContent };
}

/** Runs `run`, asserts it rejects with `ArchiveReadError`, and asserts its `code`. */
async function expectArchiveError(run: () => Promise<unknown>, code: ArchiveReadErrorCode): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ArchiveReadError);
  expect((caught as ArchiveReadError).code).toBe(code);
}

describe("archiveReader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nexus-archive-reader-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function fixturePath(name: string): string {
    return join(tmpDir, name);
  }

  describe("round trip", () => {
    it("reads a plain zip back exactly", async () => {
      const { entries, blobSha, blobContent } = buildFullFixture();
      const zipBytes = await buildZip(entries);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, null);
      try {
        expect(archive.encrypted).toBe(false);
        expect(archive.files.get("manifest.json")).toBe('{"schemaVersion":"1.0.0"}');
        for (const path of DATA_FILES) {
          expect(archive.files.get(path)).toBe("");
        }
        expect(archive.ydocs.get("data/notes/note-1.ydoc")).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(archive.ydocs.get("data/note-versions/note-1/3.ydoc")).toEqual(new Uint8Array([5, 6, 7]));
        expect(archive.blobNames.has(blobSha)).toBe(true);
        expect(archive.corruptBlobNames.size).toBe(0);
        expect(await archive.readBlob(blobSha)).toEqual(new Uint8Array(blobContent));
      } finally {
        await archive.close();
      }
    });

    it("reads the identical content sealed as NXA1 back exactly, given the right passphrase", async () => {
      const { entries, blobSha, blobContent } = buildFullFixture();
      const zipBytes = await buildZip(entries);
      const sealed = await sealAsNxa1(zipBytes, "correct horse battery staple");
      const filePath = fixturePath("archive.nexus");
      await writeFile(filePath, sealed);

      const archive = await openArchive(filePath, "correct horse battery staple");
      try {
        expect(archive.encrypted).toBe(true);
        expect(archive.files.get("manifest.json")).toBe('{"schemaVersion":"1.0.0"}');
        for (const path of DATA_FILES) {
          expect(archive.files.get(path)).toBe("");
        }
        expect(archive.ydocs.get("data/notes/note-1.ydoc")).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(archive.ydocs.get("data/note-versions/note-1/3.ydoc")).toEqual(new Uint8Array([5, 6, 7]));
        expect(archive.blobNames.has(blobSha)).toBe(true);
        expect(await archive.readBlob(blobSha)).toEqual(new Uint8Array(blobContent));
      } finally {
        await archive.close();
      }
    });

    it("reads an NXA1 archive whose payload spans several frames", async () => {
      // Incompressible, so the zip stays roughly this size and the container
      // really does end up with three frames (1 MiB + 1 MiB + the remainder)
      // rather than one. This is the only test that proves `yauzl` seeking —
      // the central directory at the very end, then entry data near the very
      // start — works ACROSS frame boundaries, which is the entire reason
      // `openArchivePlaintext` gives random access instead of a stream.
      const bigBlob = randomBytes(2_500_000);
      const bigSha = sha256Hex(bigBlob);
      const zipBytes = await buildZip([
        { path: "manifest.json", content: textEntry('{"schemaVersion":"1.0.0"}') },
        { path: `blobs/${bigSha}`, content: bigBlob },
      ]);
      expect(zipBytes.length).toBeGreaterThan(2 * 1_048_576);

      const sealed = await sealAsNxa1(zipBytes, "multi-frame passphrase");
      const filePath = fixturePath("big.nexus");
      await writeFile(filePath, sealed);

      const archive = await openArchive(filePath, "multi-frame passphrase");
      try {
        expect(archive.encrypted).toBe(true);
        expect(archive.files.get("manifest.json")).toBe('{"schemaVersion":"1.0.0"}');
        expect(archive.blobNames.has(bigSha)).toBe(true);
        expect(Buffer.from(await archive.readBlob(bigSha)).equals(bigBlob)).toBe(true);
      } finally {
        await archive.close();
      }
    });

    it("decodes a non-ASCII (Serbian) text entry as UTF-8, not latin1", async () => {
      const content = "Beleška — čćžšđ";
      const zipBytes = await buildZip([{ path: "manifest.json", content: textEntry(content) }]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, null);
      try {
        expect(archive.files.get("manifest.json")).toBe(content);
      } finally {
        await archive.close();
      }
    });
  });

  describe("detection and passphrases", () => {
    it("inspectArchiveFile reports encrypted: true for an NXA1 file", async () => {
      const zipBytes = await buildZip([{ path: "manifest.json", content: textEntry("{}") }]);
      const sealed = await sealAsNxa1(zipBytes, "pw");
      const filePath = fixturePath("archive.nexus");
      await writeFile(filePath, sealed);

      await expect(inspectArchiveFile(filePath)).resolves.toEqual({ encrypted: true });
    });

    it("inspectArchiveFile reports encrypted: false for a plain zip", async () => {
      const zipBytes = await buildZip([{ path: "manifest.json", content: textEntry("{}") }]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      await expect(inspectArchiveFile(filePath)).resolves.toEqual({ encrypted: false });
    });

    it("inspectArchiveFile does not throw on a 2-byte junk file", async () => {
      const filePath = fixturePath("junk.bin");
      await writeFile(filePath, Buffer.from([0x00, 0x01]));

      await expect(inspectArchiveFile(filePath)).resolves.toEqual({ encrypted: false });
    });

    it("fails as passphrase-required when an NXA1 archive is opened with passphrase null", async () => {
      const zipBytes = await buildZip([{ path: "manifest.json", content: textEntry("{}") }]);
      const sealed = await sealAsNxa1(zipBytes, "pw");
      const filePath = fixturePath("archive.nexus");
      await writeFile(filePath, sealed);

      await expectArchiveError(() => openArchive(filePath, null), "passphrase-required");
    });

    it("fails as passphrase-wrong when an NXA1 archive is opened with the wrong passphrase", async () => {
      const zipBytes = await buildZip([{ path: "manifest.json", content: textEntry("{}") }]);
      const sealed = await sealAsNxa1(zipBytes, "right-passphrase");
      const filePath = fixturePath("archive.nexus");
      await writeFile(filePath, sealed);

      await expectArchiveError(() => openArchive(filePath, "wrong-passphrase"), "passphrase-wrong");
    });

    it("fails as not-an-archive for a file that is neither a zip nor an NXA1 container", async () => {
      const filePath = fixturePath("junk.bin");
      await writeFile(filePath, Buffer.from("this is not an archive at all, just some text"));

      await expectArchiveError(() => openArchive(filePath, null), "not-an-archive");
    });

    it("still opens a plain zip given a passphrase, reporting encrypted: false", async () => {
      const zipBytes = await buildZip([{ path: "manifest.json", content: textEntry("{}") }]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, "nobody asked for this passphrase");
      try {
        expect(archive.encrypted).toBe(false);
        expect(archive.files.get("manifest.json")).toBe("{}");
      } finally {
        await archive.close();
      }
    });
  });

  describe("the allowlist", () => {
    it("ignores every non-allowlisted entry without ever storing it", async () => {
      const zipBytes = await buildZip([
        { path: "manifest.json", content: textEntry("{}") },
        { path: "notes/Moja beleška.md", content: textEntry("# hi") },
        { path: "tables/tasks.csv", content: textEntry("id,title\n") },
        { path: "README.txt", content: textEntry("hello") },
        { path: "data/notes/deep/nested.ydoc", content: Buffer.from([9, 9, 9]) },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, null);
      try {
        expect(archive.files.has("notes/Moja beleška.md")).toBe(false);
        expect(archive.files.has("tables/tasks.csv")).toBe(false);
        expect(archive.files.has("README.txt")).toBe(false);
        expect(archive.ydocs.has("data/notes/deep/nested.ydoc")).toBe(false);
        expect(archive.files.size).toBe(1); // manifest.json only
        expect(archive.ydocs.size).toBe(0);
      } finally {
        await archive.close();
      }
    });

    it("ignores a blobs/ entry whose name is not exactly 64 lowercase hex characters", async () => {
      const content = Buffer.from("some content", "utf8");
      const upperName = sha256Hex(content).toUpperCase();
      const shortName = sha256Hex(content).slice(0, 63);
      const zipBytes = await buildZip([
        { path: "manifest.json", content: textEntry("{}") },
        { path: `blobs/${upperName}`, content },
        { path: `blobs/${shortName}`, content },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, null);
      try {
        expect(archive.blobNames.size).toBe(0);
        expect(archive.corruptBlobNames.size).toBe(0);
      } finally {
        await archive.close();
      }
    });
  });

  describe("blobs", () => {
    it("reports a blob whose bytes do not hash to its name as corrupt, without failing the open", async () => {
      const realContent = Buffer.from("real content", "utf8");
      const wrongName = sha256Hex(Buffer.from("something else entirely"));
      const zipBytes = await buildZip([
        { path: "manifest.json", content: textEntry("{}") },
        { path: `blobs/${wrongName}`, content: realContent },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, null);
      try {
        expect(archive.corruptBlobNames.has(wrongName)).toBe(true);
        expect(archive.blobNames.has(wrongName)).toBe(false);
      } finally {
        await archive.close();
      }
    });

    it("readBlob rejects for a name that is not a verified blob", async () => {
      const zipBytes = await buildZip([{ path: "manifest.json", content: textEntry("{}") }]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, null);
      try {
        await expect(archive.readBlob("0".repeat(64))).rejects.toThrow();
      } finally {
        await archive.close();
      }
    });

    it("readBlob rejects after close()", async () => {
      const { entries, blobSha } = buildFullFixture();
      const zipBytes = await buildZip(entries);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, null);
      await archive.close();

      await expect(archive.readBlob(blobSha)).rejects.toThrow();
    });
  });

  // ADR-057 §6: the decrypted private attachments, in their own namespace.
  // Presence-only — a private blob has no content address to verify against —
  // and the entry name must be exactly the lowercase UUID `main`'s own sealed
  // store names files by; anything else under `private-blobs/` is skipped.
  describe("private blobs (ADR-057 §6)", () => {
    const PRIVATE_ID = "0a1b2c3d-1111-4222-8333-abcdefabcdef";

    it("records a private-blob entry by id and reads its bytes on demand", async () => {
      const content = Buffer.from("private attachment bytes", "utf8");
      const zipBytes = await buildZip([
        { path: "manifest.json", content: textEntry("{}") },
        { path: `private-blobs/${PRIVATE_ID}`, content },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, null);
      try {
        expect(archive.privateBlobNames).toEqual(new Set([PRIVATE_ID]));
        expect(Buffer.from(await archive.readPrivateBlob(PRIVATE_ID))).toEqual(content);
      } finally {
        await archive.close();
      }
    });

    it("skips a non-UUID name under private-blobs/ and rejects readPrivateBlob for it — and after close()", async () => {
      const zipBytes = await buildZip([
        { path: "manifest.json", content: textEntry("{}") },
        { path: "private-blobs/..strange", content: Buffer.from("nope") },
        { path: `private-blobs/${PRIVATE_ID.toUpperCase()}`, content: Buffer.from("nope") },
        { path: `private-blobs/${PRIVATE_ID}`, content: Buffer.from("da") },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, null);
      try {
        expect(archive.privateBlobNames).toEqual(new Set([PRIVATE_ID]));
        await expect(archive.readPrivateBlob("..strange")).rejects.toThrow();
      } finally {
        await archive.close();
      }
      await expect(archive.readPrivateBlob(PRIVATE_ID)).rejects.toThrow();
    });

    it("caps one private-blob entry at maxPrivateBlobBytes — its OWN bound, wider than the public blob cap", async () => {
      const content = Buffer.alloc(64, 1);
      const zipBytes = await buildZip([
        { path: "manifest.json", content: textEntry("{}") },
        { path: `private-blobs/${PRIVATE_ID}`, content },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxPrivateBlobBytes: 63 };
      await expectArchiveError(() => openArchive(filePath, null, limits), "too-large");

      // The PUBLIC blob cap does not gate a private entry: tighter than the
      // entry's size on the wrong axis still opens.
      const publicTight: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxBlobBytes: 1 };
      const archive = await openArchive(filePath, null, publicTight);
      try {
        expect(archive.privateBlobNames.has(PRIVATE_ID)).toBe(true);
      } finally {
        await archive.close();
      }
    });
  });

  describe("limits", () => {
    it("rejects more entries than maxEntries, but the default limits accept the same fixture", async () => {
      const zipBytes = await buildZip([
        { path: "manifest.json", content: textEntry("{}") },
        { path: "data/tasks.ndjson", content: textEntry("") },
        { path: "data/calendar.ndjson", content: textEntry("") },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxEntries: 2 };
      await expectArchiveError(() => openArchive(filePath, null, limits), "too-large");

      const archive = await openArchive(filePath, null);
      await archive.close();
    });

    it("rejects an entry larger than maxEntryBytes, but the default limits accept the same fixture", async () => {
      const bigContent = Buffer.alloc(1000, 0x41);
      const zipBytes = await buildZip([{ path: "manifest.json", content: bigContent }]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxEntryBytes: 500 };
      await expectArchiveError(() => openArchive(filePath, null, limits), "too-large");

      const archive = await openArchive(filePath, null);
      await archive.close();
    });

    it("rejects when opened entries' total exceeds maxTotalBytes, but the default limits accept the same fixture", async () => {
      const zipBytes = await buildZip([
        { path: "manifest.json", content: Buffer.alloc(300, 0x41) },
        { path: "data/tasks.ndjson", content: Buffer.alloc(300, 0x42) },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxTotalBytes: 500 };
      await expectArchiveError(() => openArchive(filePath, null, limits), "too-large");

      const archive = await openArchive(filePath, null);
      await archive.close();
    });

    it("rejects when text+.ydoc bytes exceed maxResidentBytes, but the default limits accept the same fixture", async () => {
      const zipBytes = await buildZip([
        { path: "manifest.json", content: Buffer.alloc(300, 0x41) },
        { path: "data/notes/note-1.ydoc", content: Buffer.alloc(300, 0x42) },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxResidentBytes: 500 };
      await expectArchiveError(() => openArchive(filePath, null, limits), "too-large");

      const archive = await openArchive(filePath, null);
      await archive.close();
    });

    it("rejects a blob larger than maxBlobBytes, but the default limits accept the same fixture", async () => {
      const blobContent = Buffer.alloc(100, 0x43);
      const blobSha = sha256Hex(blobContent);
      const zipBytes = await buildZip([
        { path: "manifest.json", content: textEntry("{}") },
        { path: `blobs/${blobSha}`, content: blobContent },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxBlobBytes: 50 };
      await expectArchiveError(() => openArchive(filePath, null, limits), "too-large");

      const archive = await openArchive(filePath, null);
      await archive.close();
    });
  });

  describe("damaged input", () => {
    it("rejects an archive carrying two entries with the same allowlisted name", async () => {
      const zipBytes = await buildZip([
        { path: "manifest.json", content: textEntry('{"a":1}') },
        { path: "manifest.json", content: textEntry('{"a":2}') },
      ]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      await expectArchiveError(() => openArchive(filePath, null), "damaged");
    });

    it("rejects a truncated NXA1 file", async () => {
      const zipBytes = await buildZip([{ path: "manifest.json", content: textEntry("{}") }]);
      const sealed = await sealAsNxa1(zipBytes, "pw");
      const truncated = sealed.subarray(0, sealed.length - 5);
      const filePath = fixturePath("archive.nexus");
      await writeFile(filePath, truncated);

      await expectArchiveError(() => openArchive(filePath, "pw"), "damaged");
    });

    it("reports a decrypted-but-unreadable NXA1 payload as damaged, never as not-an-archive", async () => {
      // The container is perfectly well formed and the passphrase is correct —
      // every frame authenticates — so the file IS one of ours; only the zip
      // inside it is unreadable. Answering "not an archive" here would deny
      // the one thing the user just proved by typing the right passphrase.
      const sealed = await sealAsNxa1(Buffer.from("this was never a zip", "utf8"), "pw");
      const filePath = fixturePath("inner-garbage.nexus");
      await writeFile(filePath, sealed);

      await expectArchiveError(() => openArchive(filePath, "pw"), "damaged");
    });

    it("rejects a zip with its end-of-central-directory record chopped off", async () => {
      // Incompressible padding so the zip stays comfortably larger than the
      // 200 bytes chopped off — the point is a mid/late-file truncation that
      // destroys the EOCD record, not an empty or near-empty file.
      const padding = randomBytes(2000);
      const zipBytes = await buildZip([{ path: "manifest.json", content: padding }]);
      expect(zipBytes.length).toBeGreaterThan(500);
      const chopped = zipBytes.subarray(0, zipBytes.length - 200);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, chopped);

      // A destroyed end-of-central-directory record is indistinguishable, to
      // this reader, from a file that was never a zip at all — both are
      // simply "no readable zip structure here" — so this deliberately
      // reports "not-an-archive", not "damaged".
      await expectArchiveError(() => openArchive(filePath, null), "not-an-archive");
    });
  });

  describe("resource lifetime", () => {
    it("releases the file handle on close, so the archive file can be deleted", async () => {
      const zipBytes = await buildZip([{ path: "manifest.json", content: textEntry("{}") }]);
      const filePath = fixturePath("archive.nexus.zip");
      await writeFile(filePath, zipBytes);

      const archive = await openArchive(filePath, null);
      await archive.close();

      await expect(unlink(filePath)).resolves.toBeUndefined();
    });

    it("releases the file handle after a failed open (wrong passphrase)", async () => {
      const zipBytes = await buildZip([{ path: "manifest.json", content: textEntry("{}") }]);
      const sealed = await sealAsNxa1(zipBytes, "right-one");
      const filePath = fixturePath("archive.nexus");
      await writeFile(filePath, sealed);

      await expectArchiveError(() => openArchive(filePath, "wrong-one"), "passphrase-wrong");

      await expect(unlink(filePath)).resolves.toBeUndefined();
    });
  });
});
