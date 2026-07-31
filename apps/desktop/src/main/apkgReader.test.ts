import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { ZipFile } from "yazl";

import {
  ApkgReadError,
  DEFAULT_APKG_LIMITS,
  parseMediaEntriesJson,
  parseMediaEntriesProto,
  readApkg,
  type ApkgLimits,
} from "./apkgReader.js";
import type { ApkgReadErrorCode } from "../shared/ipc.js";

/**
 * Every fixture below is BUILT, never checked in: a real zip written by `yazl`
 * carrying a real SQLite image written by `better-sqlite3` in memory and
 * serialized out. That is the only way to be sure the reader is being tested
 * against what Anki actually produces rather than against a mock of our own
 * expectations — the schema statements here are transcribed from Anki's own
 * schema 11 and 18, and a query the reader gets wrong fails here rather than on
 * somebody's deck.
 */

/** Anki's field separator inside `notes.flds`. */
const US = String.fromCharCode(0x1f);

interface FixtureNote {
  id: number;
  mid: number;
  fields: string[];
  tags?: string;
}

interface FixtureCard {
  id: number;
  nid: number;
  ord: number;
  did: number;
  odid?: number;
  reps?: number;
  queue?: number;
}

interface Fixture {
  models?: Record<string, unknown>;
  decks?: Record<string, unknown>;
  notes?: FixtureNote[];
  cards?: FixtureCard[];
}

const BASIC_MODEL = {
  id: 10,
  name: "Basic",
  type: 0,
  tmpls: [{ name: "Card 1", ord: 0 }],
  flds: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }],
};

const CLOZE_MODEL = {
  id: 20,
  name: "Cloze",
  type: 1,
  tmpls: [{ name: "Cloze", ord: 0 }],
  flds: [{ name: "Text", ord: 0 }, { name: "Back Extra", ord: 1 }],
};

/** A schema-11 collection database, as bytes — the shape a legacy-compatible Anki export writes. */
function buildSchema11(fixture: Fixture): Buffer {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE col (
      id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL,
      scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL,
      usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL,
      models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL
    );
    CREATE TABLE notes (
      id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL,
      usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL,
      csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL
    );
    CREATE TABLE cards (
      id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL,
      mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL,
      due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
      lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL,
      flags integer NOT NULL, data text NOT NULL
    );
  `);
  const models = fixture.models ?? { "10": BASIC_MODEL };
  const decks = fixture.decks ?? { "1": { id: 1, name: "Biologija" } };
  db.prepare(
    "INSERT INTO col VALUES (1, 1700000000, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')",
  ).run(JSON.stringify(models), JSON.stringify(decks));

  const insertNote = db.prepare(
    "INSERT INTO notes VALUES (?, ?, ?, 0, 0, ?, ?, '', 0, 0, '')",
  );
  for (const note of fixture.notes ?? []) {
    insertNote.run(note.id, `guid-${note.id}`, note.mid, note.tags ?? "", note.fields.join(US));
  }
  const insertCard = db.prepare(
    "INSERT INTO cards VALUES (?, ?, ?, ?, 0, 0, 0, ?, 0, 0, 0, ?, 0, 0, 0, ?, 0, '')",
  );
  for (const card of fixture.cards ?? []) {
    insertCard.run(card.id, card.nid, card.did, card.ord, card.queue ?? 0, card.reps ?? 0, card.odid ?? 0);
  }
  const bytes = db.serialize();
  db.close();
  return bytes;
}

/**
 * A schema-18 collection: `col` with EMPTY `models`/`decks`, and the four tables
 * that replaced them. Everything the reader claims to read off an 18 is here —
 * and `notetypes.config`, the protobuf blob it deliberately does not read, is
 * here too, so the refusal is provably a refusal and not a missing table.
 */
function buildSchema18(): Buffer {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE col (
      id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL,
      scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL,
      usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL,
      models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL
    );
    CREATE TABLE notetypes (
      id integer NOT NULL PRIMARY KEY, name text NOT NULL, mtime_secs integer NOT NULL,
      usn integer NOT NULL, config blob NOT NULL
    );
    CREATE TABLE templates (
      ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL,
      mtime_secs integer NOT NULL, usn integer NOT NULL, config blob NOT NULL,
      PRIMARY KEY (ntid, ord)
    );
    CREATE TABLE fields (
      ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, config blob NOT NULL,
      PRIMARY KEY (ntid, ord)
    );
    CREATE TABLE decks (
      id integer PRIMARY KEY NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL,
      usn integer NOT NULL, common blob NOT NULL, kind blob NOT NULL
    );
    CREATE TABLE notes (
      id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL,
      usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL,
      csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL
    );
    CREATE TABLE cards (
      id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL,
      mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL,
      due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
      lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL,
      flags integer NOT NULL, data text NOT NULL
    );
  `);
  db.exec("INSERT INTO col VALUES (1, 1700000000, 0, 0, 18, 0, 0, 0, '', '', '', '', '')");
  // `config` here is a real (tiny) NotetypeConfig: field 1 (`kind`) = 1, i.e.
  // CLOZE. It is READABLE as bytes and completely opaque without a protobuf
  // schema — which is exactly the fact the refusal exists for.
  db.prepare("INSERT INTO notetypes VALUES (?, ?, 0, 0, ?)").run(
    20,
    "Cloze",
    Buffer.from([0x08, 0x01]),
  );
  db.prepare("INSERT INTO notetypes VALUES (?, ?, 0, 0, ?)").run(
    10,
    "Basic",
    Buffer.from([0x08, 0x00]),
  );
  db.prepare("INSERT INTO templates VALUES (?, 0, ?, 0, 0, ?)").run(10, "Card 1", Buffer.alloc(0));
  db.prepare("INSERT INTO fields VALUES (?, 0, ?, ?)").run(10, "Front", Buffer.alloc(0));
  db.prepare("INSERT INTO fields VALUES (?, 1, ?, ?)").run(10, "Back", Buffer.alloc(0));
  db.prepare("INSERT INTO decks VALUES (?, ?, 0, 0, ?, ?)").run(
    1,
    `Fakultet${US}Biologija`,
    Buffer.alloc(0),
    Buffer.alloc(0),
  );
  const bytes = db.serialize();
  db.close();
  return bytes;
}

/** A real zip byte stream via `yazl` — the same writer the export path uses. */
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

/** One protobuf `MediaEntry` submessage: `{ name = 1, size = 2, sha1 = 3 }`. */
function mediaEntryBytes(name: string, size: number): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  return Buffer.concat([
    Buffer.from([0x0a, nameBytes.length]),
    nameBytes,
    Buffer.from([0x10, size]),
    Buffer.from([0x1a, 2, 0xab, 0xcd]),
  ]);
}

/** A whole `MediaEntries` message: `repeated MediaEntry entries = 1`. */
function mediaEntriesBytes(entries: ReadonlyArray<{ name: string; size: number }>): Buffer {
  return Buffer.concat(
    entries.map((entry) => {
      const body = mediaEntryBytes(entry.name, entry.size);
      return Buffer.concat([Buffer.from([0x0a, body.length]), body]);
    }),
  );
}

async function expectApkgError(run: () => Promise<unknown>, code: ApkgReadErrorCode): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ApkgReadError);
  expect((caught as ApkgReadError).code).toBe(code);
}

describe("apkgReader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "nexus-apkg-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeApkg(
    entries: ReadonlyArray<{ path: string; content: Buffer }>,
    name = "deck.apkg",
  ): Promise<string> {
    const path = join(tmpDir, name);
    await writeFile(path, await buildZip(entries));
    return path;
  }

  /** The everyday case: one legacy collection, two decks, a basic and a cloze note. */
  async function writeFullFixture(): Promise<string> {
    const collection = buildSchema11({
      models: { "10": BASIC_MODEL, "20": CLOZE_MODEL },
      decks: {
        "1": { id: 1, name: "Fakultet::Biologija" },
        "2": { id: 2, name: "Prazan" },
      },
      notes: [
        { id: 100, mid: 10, fields: ["<b>Prednja</b>", "Zadnja"], tags: " ispit biologija " },
        { id: 200, mid: 20, fields: ["Reka je {{c1::Sava}}.", ""] },
      ],
      cards: [
        { id: 1000, nid: 100, ord: 0, did: 1, reps: 4, queue: 2 },
        { id: 1001, nid: 200, ord: 0, did: 1, queue: -1 },
      ],
    });
    return writeApkg([
      { path: "collection.anki2", content: collection },
      { path: "media", content: Buffer.from('{"0":"cell.jpg","1":"beat.mp3"}', "utf8") },
      // A media FILE, which the reader must never open.
      { path: "0", content: Buffer.alloc(64, 7) },
    ]);
  }

  describe("a legacy (schema 11) collection", () => {
    it("reads decks, notetypes, notes and cards, and counts the media it leaves behind", async () => {
      const parsed = await readApkg(await writeFullFixture());

      expect(parsed.decks).toEqual([
        { id: 1, name: "Fakultet::Biologija" },
        { id: 2, name: "Prazan" },
      ]);
      expect(parsed.notetypes).toEqual(
        expect.arrayContaining([
          { id: 10, name: "Basic", kind: "basic", templateCount: 1 },
          { id: 20, name: "Cloze", kind: "cloze", templateCount: 1 },
        ]),
      );
      expect(parsed.notes[0]).toEqual({
        id: 100,
        notetypeId: 10,
        fields: ["<b>Prednja</b>", "Zadnja"],
        tags: ["ispit", "biologija"],
      });
      expect(parsed.notes[1]?.fields).toEqual(["Reka je {{c1::Sava}}.", ""]);
      expect(parsed.cards).toEqual([
        { noteId: 100, ord: 0, deckId: 1, reps: 4, suspended: false },
        { noteId: 200, ord: 0, deckId: 1, reps: 0, suspended: true },
      ]);
      expect(parsed.mediaCount).toBe(2);
    });

    it("reads a card's ORIGINAL deck when it currently sits in a filtered one", async () => {
      const path = await writeApkg([
        {
          path: "collection.anki2",
          content: buildSchema11({
            decks: { "1": { id: 1, name: "Dom" }, "9": { id: 9, name: "Filtrirano" } },
            notes: [{ id: 100, mid: 10, fields: ["a", "b"] }],
            cards: [{ id: 1000, nid: 100, ord: 0, did: 9, odid: 1 }],
          }),
        },
      ]);
      expect((await readApkg(path)).cards[0]?.deckId).toBe(1);
    });

    it("prefers .anki21 over .anki2 when both are present", async () => {
      const path = await writeApkg([
        {
          path: "collection.anki2",
          content: buildSchema11({ decks: { "1": { id: 1, name: "Stari" } } }),
        },
        {
          path: "collection.anki21",
          content: buildSchema11({ decks: { "1": { id: 1, name: "Noviji" } } }),
        },
      ]);
      expect((await readApkg(path)).decks[0]?.name).toBe("Noviji");
    });

    it("works with no media manifest at all", async () => {
      const path = await writeApkg([
        { path: "collection.anki2", content: buildSchema11({}) },
      ]);
      expect((await readApkg(path)).mediaCount).toBe(0);
    });

    it("reads a protobuf media manifest as well as a JSON one", async () => {
      const path = await writeApkg([
        { path: "collection.anki2", content: buildSchema11({}) },
        {
          path: "media",
          content: mediaEntriesBytes([
            { name: "cell.jpg", size: 12 },
            { name: "beat.mp3", size: 34 },
            { name: "dijagram.png", size: 56 },
          ]),
        },
      ]);
      expect((await readApkg(path)).mediaCount).toBe(3);
    });

    it("reads a zstd-compressed collection through the same path", async () => {
      // A `.anki21b`-shaped entry whose database is nonetheless schema 11 — the
      // reader sniffs the zstd frame rather than trusting the entry's name.
      const path = await writeApkg([
        {
          path: "collection.anki21b",
          content: Buffer.from(zstdCompressSync(buildSchema11({ notes: [], cards: [] }))),
        },
      ]);
      expect((await readApkg(path)).decks[0]?.name).toBe("Biologija");
    });
  });

  describe("a schema-18 collection", () => {
    it("is refused BY NAME, having read everything schema 18 does yield", async () => {
      const path = await writeApkg([
        { path: "collection.anki21b", content: Buffer.from(zstdCompressSync(buildSchema18())) },
      ]);
      let caught: unknown;
      try {
        await readApkg(path);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ApkgReadError);
      const error = caught as ApkgReadError;
      expect(error.code).toBe("unsupported-schema");
      // The refusal states what WAS readable — two notetype names, one deck
      // name, one template, two fields — and why that is still not enough.
      expect(error.message).toContain("schema 18");
      expect(error.message).toContain("2 notetype name(s)");
      expect(error.message).toContain("1 deck name(s)");
      expect(error.message).toContain("1 template name(s)");
      expect(error.message).toContain("2 field name(s)");
      expect(error.message).toContain("protobuf config");
    });
  });

  describe("refusals", () => {
    it("refuses a file that is not a zip", async () => {
      const path = join(tmpDir, "nope.apkg");
      await writeFile(path, Buffer.from("ovo nije zip", "utf8"));
      await expectApkgError(() => readApkg(path), "not-an-apkg");
    });

    it("refuses an empty file", async () => {
      const path = join(tmpDir, "empty.apkg");
      await writeFile(path, Buffer.alloc(0));
      await expectApkgError(() => readApkg(path), "not-an-apkg");
    });

    it("refuses a zip with no collection in it", async () => {
      const path = await writeApkg([{ path: "readme.txt", content: Buffer.from("zdravo") }]);
      await expectApkgError(() => readApkg(path), "no-collection");
    });

    it("refuses two entries claiming the same collection name", async () => {
      // `yazl` will happily write the same name twice, which is exactly the
      // shape of a file built so a preview and an apply see different bytes.
      const collection = buildSchema11({});
      const path = await writeApkg([
        { path: "collection.anki2", content: collection },
        { path: "collection.anki2", content: collection },
      ]);
      await expectApkgError(() => readApkg(path), "damaged");
    });

    it("refuses a collection that is not a SQLite database", async () => {
      const path = await writeApkg([
        { path: "collection.anki2", content: Buffer.alloc(4096, 0x41) },
      ]);
      await expectApkgError(() => readApkg(path), "damaged");
    });

    it("refuses a SQLite database with no `col` row", async () => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE nesto (a integer)");
      const bytes = db.serialize();
      db.close();
      const path = await writeApkg([{ path: "collection.anki2", content: bytes }]);
      await expectApkgError(() => readApkg(path), "damaged");
    });

    it("refuses a schema older than 11", async () => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE col (ver integer, models text, decks text)");
      db.exec("INSERT INTO col VALUES (9, '{}', '{}')");
      const bytes = db.serialize();
      db.close();
      const path = await writeApkg([{ path: "collection.anki2", content: bytes }]);
      await expectApkgError(() => readApkg(path), "unsupported-schema");
    });
  });

  describe("limits", () => {
    /** Every limit test re-reads the SAME fixture under the defaults, to prove it was the limit that fired and not the fixture. */
    async function expectLimit(
      path: string,
      limits: Partial<ApkgLimits>,
      code: ApkgReadErrorCode,
    ): Promise<void> {
      await expectApkgError(() => readApkg(path, { ...DEFAULT_APKG_LIMITS, ...limits }), code);
      await expect(readApkg(path, DEFAULT_APKG_LIMITS)).resolves.toBeDefined();
    }

    it("refuses a file past the file cap", async () => {
      await expectLimit(await writeFullFixture(), { maxFileBytes: 8 }, "too-large");
    });

    it("refuses a zip past the entry cap", async () => {
      await expectLimit(await writeFullFixture(), { maxEntries: 2 }, "too-large");
    });

    it("refuses a collection past the resident cap", async () => {
      await expectLimit(await writeFullFixture(), { maxCollectionBytes: 1024 }, "too-large");
    });

    it("refuses more notes than the note cap", async () => {
      await expectLimit(await writeFullFixture(), { maxNotes: 1 }, "too-large");
    });

    it("refuses more cards than the card cap", async () => {
      await expectLimit(await writeFullFixture(), { maxCards: 1 }, "too-large");
    });

    it("refuses a field past the per-field cap", async () => {
      await expectLimit(await writeFullFixture(), { maxFieldBytes: 4 }, "too-large");
    });

    it("refuses a media manifest past the entry cap", async () => {
      await expectLimit(await writeFullFixture(), { maxMediaEntries: 1 }, "too-large");
    });

    it("refuses a zstd stream that decompresses past the resident cap", async () => {
      const path = await writeApkg([
        {
          path: "collection.anki21b",
          content: Buffer.from(zstdCompressSync(buildSchema11({}))),
        },
      ]);
      await expectApkgError(
        () => readApkg(path, { ...DEFAULT_APKG_LIMITS, maxCollectionBytes: 1024 }),
        "too-large",
      );
    });
  });
});

describe("parseMediaEntriesProto", () => {
  it("reads every entry's name and size", () => {
    const entries = parseMediaEntriesProto(
      mediaEntriesBytes([
        { name: "cell.jpg", size: 12 },
        { name: "beat.mp3", size: 34 },
      ]),
      100,
    );
    expect(entries).toEqual([
      { name: "cell.jpg", sizeBytes: 12 },
      { name: "beat.mp3", sizeBytes: 34 },
    ]);
  });

  it("reads an empty message as no entries", () => {
    expect(parseMediaEntriesProto(new Uint8Array(0), 100)).toEqual([]);
  });

  it("skips a field number it does not know, by length, rather than guessing", () => {
    const known = mediaEntriesBytes([{ name: "a.jpg", size: 1 }]);
    // Field 7, wire type 2, three bytes of payload — a future Anki addition.
    const unknown = Buffer.from([0x3a, 3, 1, 2, 3]);
    expect(parseMediaEntriesProto(Buffer.concat([unknown, known]), 100)).toEqual([
      { name: "a.jpg", sizeBytes: 1 },
    ]);
  });

  it("refuses a truncated varint", () => {
    // 0x80 sets the continuation bit and then the buffer ends.
    expect(() => parseMediaEntriesProto(Buffer.from([0x80]), 100)).toThrow(ApkgReadError);
  });

  it("refuses a length that runs past the end", () => {
    expect(() => parseMediaEntriesProto(Buffer.from([0x0a, 200, 1, 2]), 100)).toThrow(ApkgReadError);
  });

  it("refuses the removed group wire types", () => {
    expect(() => parseMediaEntriesProto(Buffer.from([0x0b, 1]), 100)).toThrow(ApkgReadError);
  });

  it("refuses more entries than the cap", () => {
    const bytes = mediaEntriesBytes([
      { name: "a", size: 1 },
      { name: "b", size: 2 },
      { name: "c", size: 3 },
    ]);
    let caught: unknown;
    try {
      parseMediaEntriesProto(bytes, 2);
    } catch (error) {
      caught = error;
    }
    expect((caught as ApkgReadError).code).toBe("too-large");
  });

  it("never loops on a varint that never terminates", () => {
    const forever = Buffer.alloc(64, 0x80);
    expect(() => parseMediaEntriesProto(forever, 100)).toThrow(ApkgReadError);
  });
});

describe("parseMediaEntriesJson", () => {
  it("reads the legacy name map", () => {
    expect(parseMediaEntriesJson('{"0":"cell.jpg","1":"beat.mp3"}', 100)).toEqual([
      { name: "cell.jpg", sizeBytes: 0 },
      { name: "beat.mp3", sizeBytes: 0 },
    ]);
  });

  it("refuses text that is not JSON, and JSON that is not an object", () => {
    expect(() => parseMediaEntriesJson("nije json", 100)).toThrow(ApkgReadError);
    expect(() => parseMediaEntriesJson('["a","b"]', 100)).toThrow(ApkgReadError);
    expect(() => parseMediaEntriesJson("null", 100)).toThrow(ApkgReadError);
  });

  it("refuses more entries than the cap", () => {
    let caught: unknown;
    try {
      parseMediaEntriesJson('{"0":"a","1":"b","2":"c"}', 2);
    } catch (error) {
      caught = error;
    }
    expect((caught as ApkgReadError).code).toBe("too-large");
  });
});
