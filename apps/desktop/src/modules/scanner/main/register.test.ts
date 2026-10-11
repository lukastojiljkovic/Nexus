import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoteStore, openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { SCAN_TEXT_MAX_CHARS } from "../shared/ipc.js";
import { register } from "./register.js";

/**
 * The SCANNER module through the kit (ADR-090): its one op, the note that op
 * writes, and the refusals.
 *
 * **Why these tests drive the HOST rather than calling the handler.** Going
 * through `dispatch` is what the app does: the sender check, the channel
 * allowlist and the payload validators are all the host's, so a wrong op name
 * or a payload the validators refuse is a rejected promise here instead of a
 * surprise on the first click.
 *
 * Everything else is real: a real encrypted database, the real migrations, the
 * real note store and the real markdown parser. What the note looks like
 * afterwards is therefore not a claim about this module - it is a claim about
 * what a user who opens the notes module will find.
 */

const TRUSTED = { trusted: true };

let dir: string;
let db: NexusDatabase;
let clock = Date.parse("2026-06-01T08:00:00.000Z");

interface Harness {
  readonly host: ModuleHost;
}

function harness(): Harness {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => clock,
  };
  const host = new ModuleHost(platform);
  register(host);
  return { host };
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(clock).toISOString());
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-scanner-module-"));
  db = openDatabase({ path: join(dir, "scanner.db") });
  clock = Date.parse("2026-06-01T08:00:00.000Z");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the scanner handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual(["scanner:saveAsNote"]);
  });

  it("refuses a channel its contract does not declare", async () => {
    const { host } = harness();
    await expect(host.dispatch("scanner:list", TRUSTED, {})).rejects.toThrow(
      /No module answers channel "scanner:list"/,
    );
  });

  it("refuses a message that did not come from this app, before the handler runs", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await expect(
      host.dispatch("scanner:saveAsNote", { stranger: true }, { profileId, text: "x", title: "" }),
    ).rejects.toThrow(/did not come from this app/);
    // Nothing was written: the refusal happens before the handler is called.
    expect(new NoteStore(db.raw, profileId).list()).toEqual([]);
  });
});

describe("scanner:saveAsNote", () => {
  it("writes the recognised text as a note through the notes store's own create path", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const result = await call<{ noteId: string; title: string }>(host, "scanner:saveAsNote", {
      profileId,
      text: "Prvi red\nDrugi red",
      title: "",
    });

    // The title is the notes module's own rule applied to this text: an empty
    // caller title falls back to the document's first BLOCK, and markdown's
    // blocks are paragraphs - two adjacent lines are one paragraph with a soft
    // break in it, exactly as they are in an imported `.md` file. So the title
    // reads as the whole first paragraph, and so does the searchable plaintext
    // (the line break itself survives in the document - see
    // `mergeNoteState`, which renders a soft break as a space in plaintext
    // only).
    expect(result.title).toBe("Prvi red Drugi red");

    const notes = new NoteStore(db.raw, profileId);
    const [note] = notes.list();
    expect(note?.id).toBe(result.noteId);
    expect(note?.title).toBe("Prvi red Drugi red");
    // `compactNow` folded the update into the snapshot, which is the note's
    // searchable body - the reason a scanned note is findable immediately.
    expect(notes.storedPlaintext(result.noteId)).toBe("Prvi red Drugi red");
  });

  it("materialises the caller's title as the document's leading heading", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const result = await call<{ noteId: string; title: string }>(host, "scanner:saveAsNote", {
      profileId,
      text: "Ukupno: 1.234,50\nHvala na poseti.",
      title: "  Prijem  ",
    });

    expect(result.title).toBe("Prijem");
    const notes = new NoteStore(db.raw, profileId);
    // The caller's title is materialised as the document's leading H1, so it
    // survives the first edit; the two scanned lines are one paragraph below it.
    expect(notes.storedPlaintext(result.noteId)).toBe(
      "Prijem\nUkupno: 1.234,50 Hvala na poseti.",
    );
  });

  it("keeps two scans of one profile as two separate notes", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const first = await call<{ noteId: string }>(host, "scanner:saveAsNote", {
      profileId,
      text: "prvi snimak",
      title: "Snimak 1",
    });
    const second = await call<{ noteId: string }>(host, "scanner:saveAsNote", {
      profileId,
      text: "drugi snimak",
      title: "Snimak 2",
    });

    expect(second.noteId).not.toBe(first.noteId);
    expect(new NoteStore(db.raw, profileId).list()).toHaveLength(2);
  });

  it("refuses an empty body, a body that is only whitespace, and a body over the cap", async () => {
    const { host } = harness();
    const profileId = createProfile();

    for (const text of ["", "   \n  ", "x".repeat(SCAN_TEXT_MAX_CHARS + 1)]) {
      await expect(
        call(host, "scanner:saveAsNote", { profileId, text, title: "" }),
      ).rejects.toThrow(/Invalid IPC payload/);
    }
    // A refusal leaves no half-made note behind.
    expect(new NoteStore(db.raw, profileId).list()).toEqual([]);
  });

  it("refuses a payload whose fields are not the shapes the contract declares", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const bad = [
      { profileId, text: 42, title: "" },
      { profileId, text: "ok", title: 42 },
      { profileId: "  padded  ", text: "ok", title: "" },
      { profileId, text: "ok", title: "t".repeat(201) },
    ];
    for (const payload of bad) {
      await expect(call(host, "scanner:saveAsNote", payload)).rejects.toThrow(
        /Invalid IPC payload/,
      );
    }
  });
});
