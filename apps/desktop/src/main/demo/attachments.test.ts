import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, inflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AttachmentIndexStore,
  NexusDatabase,
  openDatabase,
  TaskListStore,
  uuidv7,
} from "@nexus/db";
import { sniffMime } from "@nexus/core";

import { createDemoContext } from "./context.js";
import { seedDemoAttachments, type DemoAttachmentIo } from "./attachments.js";
import { seedDemoNotes } from "./notes.js";
import { seedDemoStudy } from "./study.js";
import { seedDemoTasks } from "./tasks.js";

/**
 * Two things this file is here to hold, and neither is a row count.
 *
 * The first is the LINK between a fixture and the owner it hangs off: the
 * catalogue in `attachments.ts` names a note and a task by title and a subject
 * by name, all three copied out of other seeders, and nothing in the type
 * system connects those strings to anything. `requireOwnerId` refuses rather
 * than skips precisely so a renamed owner fails here — because the failure it
 * prevents is the quiet one this slice exists to close: a DOKUMENTI that
 * photographs its empty state, in every size, in both themes, forever.
 *
 * The second is the FIXTURES' arithmetic. A PNG whose CRCs do not verify, or
 * whose `IDAT` does not inflate to a whole number of scanlines, is a file
 * Chromium draws as a broken image; a PDF whose `/Length` or `startxref` is off
 * by a byte is a file that renders or not depending on how forgiving the viewer
 * is. Neither shows up as an error anywhere — the attachment path sniffs magic
 * bytes and asks no further questions — so both are re-derived here with the
 * formats' own rules.
 *
 * The bytes are read back THROUGH the index row rather than through a second
 * export of the fixtures, so what is checked is the file as it was seeded.
 */

const NOW = Date.UTC(2026, 8, 22, 9, 0, 0);

let dir: string;
let db: NexusDatabase;
let profileId: string;
let sink: ReturnType<typeof recordingSink>;

/**
 * Stands in for `main/attachments.ts`'s blob store: hashes what it is given
 * with `createHash("sha256")` — the same call, so the hash a row carries is the
 * hash the real store would have produced — and keeps the bytes, which is what
 * lets a test resolve a row back to the exact file it names.
 */
function recordingSink(): { io: DemoAttachmentIo; bytesByHash: Map<string, Uint8Array> } {
  const bytesByHash = new Map<string, Uint8Array>();
  return {
    bytesByHash,
    io: {
      saveBlob: async (bytes) => {
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        bytesByHash.set(sha256, bytes);
        return sha256;
      },
    },
  };
}

/** A profile of the shape `beforeEach` makes, with nothing seeded into it — the bare row a missing owner is. */
function createBareProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "Bez podataka", new Date(NOW).toISOString());
  return id;
}

/** The seeded rows, newest first — what „Datoteke" itself reads. */
function entries() {
  return new AttachmentIndexStore(db.raw, profileId).list().entries;
}

/** The one seeded file of a given mime, with the bytes the sink was handed. */
function bytesOfMime(mime: string): Uint8Array {
  const entry = entries().find((candidate) => candidate.mime === mime);
  if (entry === undefined) throw new Error(`seedDemoAttachments seeded no ${mime} file`);
  const bytes = sink.bytesByHash.get(entry.sha256);
  if (bytes === undefined) throw new Error(`${entry.fileName} names a hash nothing stored`);
  return bytes;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexus-demo-attachments-"));
  db = openDatabase({ path: join(dir, "demo.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Demo", new Date(NOW).toISOString());

  // The three owner kinds the catalogue points at, in the order `seedDemoProfile`
  // runs them.
  const ctx = createDemoContext(profileId, NOW);
  new TaskListStore(db.raw, profileId).ensureInbox(new Date(NOW).toISOString());
  seedDemoTasks(db.raw, ctx);
  seedDemoNotes(db.raw, ctx);
  seedDemoStudy(db.raw, ctx);

  sink = recordingSink();
  await seedDemoAttachments(db.raw, ctx, sink.io);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("seedDemoAttachments", () => {
  it("hangs a file off a note, a task and a subject", () => {
    const seeded = entries();
    expect([...new Set(seeded.map((entry) => entry.ownerKind))].sort()).toEqual([
      "note",
      "subject",
      "task",
    ]);
    // Every row names its owner — the title is the owner store's, never blank.
    expect(seeded.every((entry) => entry.ownerTitle.length > 0)).toBe(true);
  });

  it("stores the bytes of every row it writes, under the hash the row names", () => {
    const seeded = entries();
    expect(seeded.length).toBeGreaterThanOrEqual(3);
    for (const entry of seeded) {
      const bytes = sink.bytesByHash.get(entry.sha256);
      expect(bytes, `${entry.fileName} names a hash nothing stored`).toBeDefined();
      // The size is the FILE's, not a number typed beside it — the list's
      // column, the card's meta line and the proportion bars all draw this.
      expect(entry.sizeBytes).toBe(bytes!.byteLength);
    }
  });

  it("claims only a mime its bytes actually sniff as", () => {
    const seeded = entries();
    for (const entry of seeded) {
      // Not a formality: the mime decides which family chip and bar a file
      // lands in, whether the grid draws an `<img>`, and which extension
      // „Otvori" hands the OS. A row that got this wrong is the one defect
      // this sweep can only photograph, never report.
      expect(sniffMime(sink.bytesByHash.get(entry.sha256)!), entry.fileName).toBe(entry.mime);
    }
    // More than one family, or „Šta zauzima prostor" has a single bar to draw.
    expect(new Set(seeded.map((entry) => entry.mime)).size).toBeGreaterThan(1);
  });

  it("dates every file in the past, and each one distinctly", () => {
    const seeded = entries();
    const stamps = seeded.map((entry) => Date.parse(entry.createdAt));
    expect(stamps.every((stamp) => Number.isFinite(stamp) && stamp < NOW)).toBe(true);
    expect(new Set(stamps).size).toBe(seeded.length);
  });

  it("names an owner this profile does not have rather than seeding nothing", async () => {
    // `canvas.ts` omits a card whose row is gone, and that is right for a card.
    // For a file it would mean an empty DOKUMENTI and a green build, which is
    // the state this whole slice exists to fix — so this path throws.
    const bare = createBareProfile();
    await expect(
      seedDemoAttachments(db.raw, createDemoContext(bare, NOW), recordingSink().io),
    ).rejects.toThrow(/no note titled/);
  });
});

describe("the fixtures", () => {
  it("the image is a PNG Chromium can decode: chunks, CRCs and scanlines", () => {
    const chunks = pngChunks(bytesOfMime("image/png"));
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);

    const header = chunks[0]!.body;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const width = view.getUint32(0);
    const height = view.getUint32(4);
    expect(header[8]).toBe(8); // bit depth
    expect(header[9]).toBe(2); // colour type 2 — truecolour, which is what the builder writes

    const scanlines = inflateSync(chunks[1]!.body);
    expect(scanlines.byteLength).toBe(height * (1 + width * 3));
    for (let row = 0; row < height; row += 1) {
      expect(scanlines[row * (1 + width * 3)]).toBe(0); // the filter byte, "none", on every row
    }
  });

  it("the PDFs' xref, object count and stream length agree with their own bytes", () => {
    const text = new TextDecoder().decode(bytesOfMime("application/pdf"));
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);

    // The declared /Length is the COUNTED length of what sits between `stream`
    // and `endstream` — the first thing a hand-written PDF gets wrong, and the
    // one PDFium does not forgive.
    const declaredLength = /\/Length (\d+) >>\nstream\n/.exec(text);
    expect(declaredLength).not.toBeNull();
    const stream = text.slice(
      text.indexOf("stream\n") + "stream\n".length,
      text.indexOf("\nendstream"),
    );
    expect(stream.length).toBe(Number(declaredLength![1]));

    // The xref table lists one entry per object plus the free head, and
    // `startxref` points AT it: an offset that has to be counted, never guessed.
    const objectCount = [...text.matchAll(/^\d+ 0 obj$/gm)].length;
    expect(text).toContain(`xref\n0 ${String(objectCount + 1)}\n`);
    const startxref = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
    expect(startxref).not.toBeNull();
    expect(text.slice(Number(startxref![1]), Number(startxref![1]) + 4)).toBe("xref");
  });

  it("the text fixtures are UTF-8, so their diacritics survive the round trip", () => {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytesOfMime("text/plain"));
    expect(text).toContain("č");
    // A BOM would decode as a visible character in the preview pane —
    // `docPreview.ts` strips one, which is the reason not to write one.
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });
});

/**
 * Walks a PNG chunk by chunk, and THROWS on a bad length or a bad CRC rather
 * than reporting one — the rule the app's own decoders keep: bytes this cannot
 * walk are not a fixture whose CRC is slightly wrong, they are bytes no decoder
 * renders.
 */
function pngChunks(bytes: Uint8Array): { type: string; body: Uint8Array }[] {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) {
    throw new Error("not a PNG: the signature is missing");
  }

  const chunks: { type: string; body: Uint8Array }[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = signature.length;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    const declared = view.getUint32(offset + 8 + length);
    const actual = crc32(bytes.subarray(offset + 4, offset + 8 + length)) >>> 0;
    if (declared !== actual) {
      throw new Error(`the ${type} chunk's CRC is ${String(declared)}, not ${String(actual)}`);
    }
    chunks.push({ type, body });
    offset += 12 + length;
  }
  return chunks;
}
