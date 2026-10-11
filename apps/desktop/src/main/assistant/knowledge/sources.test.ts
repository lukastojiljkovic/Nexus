import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import type { NexusDatabase } from "@nexus/db";
import { entry, makeKey, writePack } from "../../packs/fixtures.js";
import { packVersionDir } from "../../packs/registry.js";
import { attachmentSource, manualSource, packSource, recordsSource, wikiHits } from "./sources.js";
import {
  NOW,
  fakeWiki,
  insertEvent,
  insertNote,
  insertNoteAttachment,
  insertPrivateNote,
  insertProfile,
  insertTask,
  tempDatabase,
} from "./testFixtures.js";

const NEVER = new AbortController().signal;

let db: NexusDatabase;
let dir: string;
let profileId: string;

beforeEach(() => {
  const created = tempDatabase();
  db = created.db;
  dir = created.dir;
  profileId = insertProfile(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("recordsSource", () => {
  it("yields a note with its title and its compacted plaintext", async () => {
    insertNote(db, {
      id: "n1",
      profileId,
      title: "Kupovina",
      plaintext: "Mleko, hleb i jaja.",
    });

    const batch = await recordsSource(db.raw, profileId, "note").collect(null, NEVER);

    expect(batch.documents).toEqual([
      {
        kind: "note",
        id: "n1",
        locale: "",
        title: "Kupovina",
        text: "Mleko, hleb i jaja.",
        marker: `${NOW}\u0000n1`,
      },
    ]);
    expect(batch.more).toBe(false);
    expect(batch.prune).toEqual({ mode: "entries", kinds: ["note"] });
    expect(batch.cursor).toBe(`${NOW}\u0000n1`);
  });

  it("reads tasks and events through the same projection", async () => {
    insertTask(db, { id: "t1", profileId, title: "Racun", description: "Struja za oktobar" });
    insertEvent(db, { id: "e1", profileId, title: "Sastanak", description: "Sa klijentom" });

    const tasks = await recordsSource(db.raw, profileId, "task").collect(null, NEVER);
    const events = await recordsSource(db.raw, profileId, "event").collect(null, NEVER);

    expect(tasks.documents.map((document) => document.text)).toEqual(["Struja za oktobar"]);
    expect(events.documents.map((document) => document.text)).toEqual(["Sa klijentom"]);
  });

  it("cannot see the private vault: its sealed table has no projection at all", async () => {
    insertNote(db, { id: "public", profileId, title: "Javna", plaintext: "Vidljivo." });
    insertPrivateNote(db, "sealed-1", profileId);

    const batch = await recordsSource(db.raw, profileId, "note").collect(null, NEVER);

    // The exclusion is a fact about migration 045, not a filter here: the sealed
    // table feeds no view, so there is no row for a filter to remove.
    const entries = db.raw
      .prepare("SELECT count(*) AS n FROM search_entries WHERE profile_id = ? AND kind = 'note'")
      .get(profileId) as { n: number };
    expect(entries.n).toBe(1);
    expect(batch.documents.map((document) => document.id)).toEqual(["public"]);
  });

  it("pages by (updated_at, entity_id) across a whole batch of ties, without losing or repeating one", async () => {
    // 201 tasks stamped in the SAME millisecond - the worst case a timestamp
    // cursor can meet, and the reason the cursor is the pair.
    const total = 201;
    for (let index = 1; index <= total; index += 1) {
      insertTask(db, {
        id: `t${String(index).padStart(3, "0")}`,
        profileId,
        title: `Zadatak ${String(index)}`,
        description: `opis ${String(index)}`,
      });
    }

    const source = recordsSource(db.raw, profileId, "task");
    const first = await source.collect(null, NEVER);
    expect(first.documents).toHaveLength(200);
    expect(first.more).toBe(true);

    const second = await source.collect(first.cursor, NEVER);
    expect(second.more).toBe(false);
    expect(second.documents.map((document) => document.id)).toEqual(["t201"]);

    const ids = [...first.documents, ...second.documents].map((document) => document.id);
    expect(new Set(ids).size).toBe(total);
    expect(ids[0]).toBe("t001");
  });

  it("answers nothing when the marker has already been reached", async () => {
    insertTask(db, { id: "t1", profileId, title: "Racun", description: "Struja" });
    const source = recordsSource(db.raw, profileId, "task");
    const first = await source.collect(null, NEVER);
    const second = await source.collect(first.cursor, NEVER);
    expect(second.documents).toEqual([]);
  });
});

describe("attachmentSource", () => {
  it("yields extracted text as a file, pointing at the record it hangs off", async () => {
    insertNote(db, { id: "n1", profileId, title: "Uputstvo", plaintext: "Nesto." });
    insertNoteAttachment(db, { id: "a1", noteId: "n1", fileName: "uputstvo.txt", text: "Korak prvi." });

    const source = attachmentSource(db.raw, profileId);
    const batch = await source.collect(null, NEVER);

    expect(batch.documents).toHaveLength(1);
    expect(batch.documents[0]).toMatchObject({
      kind: "file",
      id: "a1",
      locale: "",
      title: "uputstvo.txt",
      text: "Korak prvi.",
      location: { module: "notes", item: "n1" },
    });
    expect(batch.documents[0]?.marker).toMatch(/^[0-9a-f]{16}$/);
    expect(batch.prune).toEqual({ mode: "ids", kind: "file", ids: ["a1"] });

    // The second pass asks the fingerprint first and reads nothing.
    const again = await source.collect(batch.cursor, NEVER);
    expect(again.documents).toEqual([]);
  });

  it("ignores an attachment whose text was never extracted", async () => {
    insertNote(db, { id: "n1", profileId, title: "Uputstvo", plaintext: "Nesto." });
    db.raw
      .prepare(
        `INSERT INTO note_attachments (id, note_id, file_name, mime, size_bytes, sha256, created_at, extracted_text)
         VALUES ('a1', 'n1', 'slika.png', 'image/png', 10, ?, ?, NULL)`,
      )
      .run("0".repeat(64), NOW);

    const batch = await attachmentSource(db.raw, profileId).collect(null, NEVER);
    expect(batch.documents).toEqual([]);
  });

  it("ignores an attachment whose row is over the size cap, whatever text sits beside it", async () => {
    insertNote(db, { id: "n1", profileId, title: "Uputstvo", plaintext: "Nesto." });
    // 2 MB: past `attachmentText.ts`'s 1 MiB preview cap, so this row is not one
    // that module would have extracted - the eligibility rule is re-asked of the
    // row rather than inferred from the fact that a string is there.
    db.raw
      .prepare(
        `INSERT INTO note_attachments (id, note_id, file_name, mime, size_bytes, sha256, created_at, extracted_text)
         VALUES ('a1', 'n1', 'veliki.txt', 'text/plain', 2000000, ?, ?, 'tekst iz starije verzije')`,
      )
      .run("0".repeat(64), NOW);

    const batch = await attachmentSource(db.raw, profileId).collect(null, NEVER);
    expect(batch.documents).toEqual([]);
  });

  it("drops an attachment of a note that was soft-deleted", async () => {
    insertNote(db, { id: "n1", profileId, title: "Uputstvo", plaintext: "Nesto." });
    insertNoteAttachment(db, { id: "a1", noteId: "n1", fileName: "uputstvo.txt", text: "Korak prvi." });
    db.raw.prepare("UPDATE notes SET deleted_at = ? WHERE id = 'n1'").run(NOW);

    const batch = await attachmentSource(db.raw, profileId).collect(null, NEVER);
    expect(batch.documents).toEqual([]);
  });
});

describe("manualSource", () => {
  const pages = [
    {
      path: "assistant/manual/sr/podesavanja.md",
      text: [
        "---",
        "id: podesavanja",
        "title: Podesavanja",
        "location: { module: settings, settings: data }",
        "keywords: [opcije, podesavanja]",
        "---",
        "# Podesavanja",
        "",
        "Ovde se bira sta je ukljuceno.",
      ].join("\n"),
    },
    {
      path: "assistant/manual/en/settings.md",
      text: [
        "---",
        "id: settings",
        "title: Settings",
        "location:",
        "  module: settings",
        "---",
        "# Settings",
        "",
        "Here you choose what is on.",
      ].join("\n"),
    },
  ];

  it("reads both locales as separate documents, with the front matter as the citation", async () => {
    const batch = await manualSource(pages).collect(null, NEVER);

    expect(batch.documents).toHaveLength(2);
    // The inline map and the block map are the same location, spelled two ways.
    expect(batch.documents[0]).toMatchObject({
      kind: "app-manual",
      id: "sr/podesavanja",
      locale: "sr",
      title: "Podesavanja",
      text: "# Podesavanja\n\nOvde se bira sta je ukljuceno.",
      keywords: ["opcije", "podesavanja"],
      location: { module: "settings", settings: "data" },
    });
    expect(batch.documents[1]).toMatchObject({
      kind: "app-manual",
      id: "en/settings",
      locale: "en",
      title: "Settings",
      text: "# Settings\n\nHere you choose what is on.",
      location: { module: "settings" },
    });
    for (const document of batch.documents) {
      expect(document.marker).toMatch(/^[0-9a-f]{16}$/);
      expect(document.safety).toBeUndefined();
      expect(document.packId).toBeUndefined();
    }
    expect(batch.prune).toEqual({ mode: "ids", kind: "app-manual", ids: ["sr/podesavanja", "en/settings"] });
  });

  it("does nothing at all when the pages have not changed", async () => {
    const source = manualSource(pages);
    const first = await source.collect(null, NEVER);
    const second = await source.collect(first.cursor, NEVER);
    expect(second.documents).toEqual([]);
    expect(second.prune).toEqual({ mode: "none" });
  });

  it("re-indexes when one page changes", async () => {
    const source = manualSource(pages);
    const first = await source.collect(null, NEVER);
    const changed = manualSource([{ ...pages[0]!, text: `${pages[0]!.text}\n\nNovi red.` }, pages[1]!]);
    const second = await changed.collect(first.cursor, NEVER);
    expect(second.documents).toHaveLength(2);
  });

  it("falls back to the file's own name and heading when the front matter is missing", async () => {
    const batch = await manualSource([
      { path: "assistant/manual/sr/belecke.md", text: "# Belecke\n\nNesto." },
    ]).collect(null, NEVER);
    expect(batch.documents[0]?.id).toBe("sr/belecke");
    expect(batch.documents[0]?.title).toBe("Belecke");
    expect(batch.documents[0]?.location).toBeUndefined();
  });

  it("ignores a directory under manual/ that is not a locale", async () => {
    const batch = await manualSource([{ path: "assistant/manual/drafts/x.md", text: "# X" }]).collect(
      null,
      NEVER,
    );
    expect(batch.documents).toEqual([]);
  });
});

describe("packSource", () => {
  const article = "# Sta uciniti\n\nOstanite na mestu i pozovite pomoc.\n";
  const second = "# Dalje\n\nKada pomoc stigne.\n";
  function installContentPack(
    key: ReturnType<typeof makeKey>,
    options: { readonly content?: unknown; readonly id?: string } = {},
  ): void {
    const id = options.id ?? "prva-pomoc";
    const content = options.content ?? {
      format: 1,
      notice: "safety",
      articles: [{ path: "articles/sta-uciniti.md" }, { path: "articles/dalje.md" }],
    };
    const contents: Record<string, string> = {
      "content.json": `${JSON.stringify(content)}\n`,
      "articles/sta-uciniti.md": article,
      "articles/dalje.md": second,
    };
    writePack({
      dir: packVersionDir(dir, id, "1.0.0"),
      key: key.privateKey,
      manifest: {
        format: 1,
        id,
        version: "1.0.0",
        kind: "content",
        title: { sr: "Prva pomoc", en: "First aid" },
        description: { sr: "Osnove.", en: "The basics." },
        files: Object.entries(contents).map(([path, text]) => entry(path, text)),
        licence: {
          spdx: "CC-BY-SA-4.0",
          attribution: "Nexus",
          url: "https://example.test/licence",
        },
        source: { name: "Nexus", url: "https://example.test/" },
        minAppVersion: "1.0.0",
      },
      contents,
    });
  }

  it("indexes every article of an installed content pack, with the pack's notice", async () => {
    const key = makeKey();
    installContentPack(key);

    const batch = await packSource({ userData: dir, publicKeyPem: key.publicKeyPem }).collect(
      null,
      NEVER,
    );

    // In the order the pack's own content manifest lists them.
    expect(batch.documents.map((document) => document.id)).toEqual([
      "prva-pomoc/articles/sta-uciniti.md",
      "prva-pomoc/articles/dalje.md",
    ]);
    expect(batch.documents[0]).toMatchObject({
      kind: "pack",
      locale: "",
      title: "Sta uciniti",
      text: article,
      packId: "prva-pomoc",
      safety: true,
    });
    expect(batch.documents[1]).toMatchObject({
      title: "Dalje",
      text: second,
      safety: true,
    });
  });

  it("does not index a pack whose manifest is not signed by the pinned key", async () => {
    const installed = makeKey();
    const other = makeKey();
    installContentPack(installed);

    const batch = await packSource({ userData: dir, publicKeyPem: other.publicKeyPem }).collect(
      null,
      NEVER,
    );
    // `readInstalled` re-verifies each manifest: a folder whose signature does
    // not check out is not a pack this build lists, so it is not one it reads.
    expect(batch.documents).toEqual([]);
  });

  it("skips a pack whose content manifest this build does not read, and keeps reading the others", async () => {
    const key = makeKey();
    installContentPack(key, { id: "losa", content: { format: 2, articles: [] } });
    installContentPack(key, {
      id: "dobra",
      content: { format: 1, articles: [{ path: "articles/dalje.md" }] },
    });

    const batch = await packSource({ userData: dir, publicKeyPem: key.publicKeyPem }).collect(
      null,
      NEVER,
    );
    expect(batch.documents.map((document) => document.id)).toEqual(["dobra/articles/dalje.md"]);
  });

  it("indexes nothing when no release key is configured", async () => {
    const key = makeKey();
    installContentPack(key);
    const batch = await packSource({ userData: dir, publicKeyPem: null }).collect(null, NEVER);
    expect(batch.documents).toEqual([]);
    expect(batch.cursor).toBe("");
  });
});

describe("wikiHits", () => {
  it("reads the lead of the articles the reader offered, in the reader's order", async () => {
    const wiki = fakeWiki({
      titles: [
        { path: "A/Hipothermia", title: "Hipothermia" },
        { path: "A/Frostbite", title: "Frostbite" },
      ],
      articles: {
        "A/Hipothermia": "# Hipothermia\n\nHipotermija je stanje niske telesne temperature.\n\n## Uzroci\n\nHladnoca.",
        "A/Frostbite": "# Frostbite\n\nPromrzline su ostecenje tkiva.",
      },
    });

    const hits = await wikiHits(wiki, "hladno", NEVER);

    expect(hits).toEqual([
      {
        key: "w:A/Hipothermia",
        citation: { kind: "wiki", id: "A/Hipothermia", title: "Hipothermia", locator: "lead" },
        text: "Hipotermija je stanje niske telesne temperature.",
      },
      {
        key: "w:A/Frostbite",
        citation: { kind: "wiki", id: "A/Frostbite", title: "Frostbite", locator: "lead" },
        text: "Promrzline su ostecenje tkiva.",
      },
    ]);
  });

  it("skips a title whose article is not there rather than citing an empty passage", async () => {
    const wiki = fakeWiki({
      titles: [{ path: "A/Missing", title: "Missing" }],
      articles: {},
    });
    expect(await wikiHits(wiki, "nesto", NEVER)).toEqual([]);
  });
});
