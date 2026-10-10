import { copyFileSync, existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import type { DownloadOutcome, DownloadService } from "../../../main/download/service.js";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { createZimHost, setZimHost, type ZimHost } from "../../../main/zim/host.js";
import { readLibraries } from "../../../main/zim/libraries.js";
import type { WikiReadResult, WikiSearchResult, WikiView } from "../shared/ipc.js";
import { WIKI_EXPORT_VERSION, parseWikiExport } from "./imex.js";
import { register } from "./register.js";

/**
 * The WIKI module through the kit (ADR-090): its ops, what it refuses on bad
 * input, the visit it records, and the archive section it round-trips.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app — a typo in an
 * op name or a payload the validators refuse is a rejected promise here, rather
 * than a surprise on the first click. The archive half uses the host's own
 * `collectExports`/`assertImportable`/`applyImports`, which are the three methods
 * `main/restore.ts` calls.
 *
 * **Why the file on the other side is the real fixture.** The module's whole job
 * is to say what a ZIM file contains, so a stubbed reader would prove nothing:
 * this suite registers openZIM's Belarusian Wikibooks pack — the same file
 * `main/zim/reader.test.ts` reads — into a throwaway library index and then asks
 * the module for its main page, a title search and a bookmark. Everything else is
 * real too: a real encrypted database, the real migrations, the real store, and
 * the real ZIM service with only its network and its dialog faked.
 */

const TRUSTED = { trusted: true };

const FIXTURE = fileURLToPath(
  new URL("../../../main/zim/fixtures/wikibooks_be_all_nopic_2017-02.zim", import.meta.url),
);

const NOW = "2026-10-10T08:00:00.000Z";

/** The name the fixture's own `M/Title` would have to beat, and the id derived from it. */
const FIXTURE_STEM = "wikibooks_be_all_nopic_2017-02";
const FIXTURE_LIBRARY_ID = "wikibooks-be-all-nopic-2017-02";

/**
 * One DATABASE for the whole file, and a fresh library directory per test.
 *
 * The store scopes every statement by `profile_id`, so a profile per test is as
 * isolating as a database per test — and `openDatabase` is the expensive part,
 * because it runs all 88 migrations. What must NOT be shared is the library
 * index, which is a device-level file: each test gets its own `userData`
 * directory, so one test's imported ZIM is invisible to the next.
 */
let root: string;
let dir: string;
let db: NexusDatabase;
let zim: ZimHost | null = null;
/** What the file dialog answers. Mutable, so one case can point it at a copy. */
let pickPath = FIXTURE;

/** The service with its wire and its dialog faked, and its library index pointed at this suite's temp directory. */
function harness(): { host: ModuleHost; downloads: DownloadService & { started: string[] } } {
  const downloads = fakeDownloads();
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => Date.parse(NOW),
  };
  zim = createZimHost({
    userData: dir,
    // „downloads", so a download's checks are the ones under test rather than a
    // refusal about the mode.
    mode: () => "downloads",
    isAllowedUrl: (url) => url.startsWith("https://mirror.download.kiwix.org/"),
    http: {
      async get() {
        // The wire is never touched here: the one host this fake refuses is the
        // catalogue's, which is what a case asks about.
        return { status: 404, body: "" };
      },
    },
    downloads,
    freeSpaceBytes: async () => Number.MAX_SAFE_INTEGER,
    pickZimFile: async () => pickPath,
    now: () => Date.parse(NOW),
  });
  setZimHost(zim);
  const host = new ModuleHost(platform);
  register(host);
  return { host, downloads };
}

function fakeDownloads(): DownloadService & { started: string[] } {
  const started: string[] = [];
  return {
    started,
    async start(request): Promise<DownloadOutcome> {
      started.push(request.id);
      return { outcome: "refused", id: request.id, problem: "mode" };
    },
    async resume(id): Promise<DownloadOutcome> {
      return { outcome: "refused", id, problem: "not-found" };
    },
    pause(): void {
      return;
    },
    async cancel(): Promise<void> {
      return;
    },
  };
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** Imports the fixture and answers the library id the module gave it. */
async function importFixture(host: ModuleHost, profileId: string): Promise<string> {
  const view = await call<WikiView>(host, "wiki:importFile", { profileId });
  expect(view.problem).toBeNull();
  return view.libraries[0]?.id ?? "";
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-wiki-module-"));
  db = openDatabase({ path: join(root, "wiki.db") });
});

beforeEach(() => {
  dir = mkdtempSync(join(root, "case-"));
  pickPath = FIXTURE;
});

afterEach(() => {
  zim?.closeAll();
  zim = null;
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("the wiki module's contract", () => {
  it("answers on exactly the channels its contract declares", async () => {
    const { host } = harness();
    const profileId = createProfile();
    expect(host.channels()).toEqual([
      "wiki:list",
      "wiki:catalogue",
      "wiki:importFile",
      "wiki:removeLibrary",
      "wiki:download",
      "wiki:cancelDownload",
      "wiki:read",
      "wiki:search",
      "wiki:bookmark",
      "wiki:unbookmark",
      "wiki:clearHistory",
    ]);
    expect(await call<WikiView>(host, "wiki:list", { profileId })).toEqual({
      libraries: [],
      downloads: [],
      history: [],
      bookmarks: [],
      catalogue: null,
      problem: null,
    });
    await expect(call(host, "wiki:nonsense", { profileId })).rejects.toThrow(/No module answers/);
  });

  it("refuses a message that did not come from this app", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await expect(host.dispatch("wiki:list", { trusted: false }, { profileId })).rejects.toThrow(
      /did not come from this app/,
    );
  });

  it("refuses a payload that is not the shape the contract declares", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const bad: readonly (readonly [string, unknown])[] = [
      ["wiki:list", {}],
      ["wiki:list", { profileId: "" }],
      ["wiki:list", { profileId: 7 }],
      // `asId`'s own bound is `MAX_ID_LENGTH` (200), so this is one past it.
      ["wiki:list", { profileId: "a".repeat(201) }],
      ["wiki:catalogue", { profileId: null }],
      ["wiki:importFile", { profileId: undefined }],
      ["wiki:removeLibrary", { profileId, libraryId: "" }],
      ["wiki:download", { profileId, editionId: "" }],
      ["wiki:cancelDownload", { profileId, editionId: 3 }],
      ["wiki:read", { profileId, libraryId: "ok", zimPath: "" }],
      ["wiki:read", { profileId, libraryId: "ok", zimPath: `A/${"x".repeat(600)}` }],
      ["wiki:search", { profileId, libraryId: "ok", prefix: "" }],
      ["wiki:bookmark", { profileId, libraryId: "ok", zimPath: "A/x", title: "a".repeat(201) }],
      ["wiki:unbookmark", { profileId, bookmarkId: "" }],
      ["wiki:clearHistory", { profileId: [] }],
    ];
    for (const [channel, payload] of bad) {
      await expect(
        call(host, channel, payload),
        `${channel} with ${JSON.stringify(payload)}`,
      ).rejects.toThrow(/Invalid IPC payload/);
    }
    // A blank title is a WELL-FORMED string, so the wire lets it through and the
    // STORE refuses it — the split the kit states: the validators check the
    // shape, and semantics belong to the layer that owns the schema.
    await expect(
      call(host, "wiki:bookmark", { profileId, libraryId: "ok", zimPath: "A/x", title: "   " }),
    ).rejects.toThrow(/A title must be/);
  });
});

describe("the wiki module over a real ZIM file", () => {
  it("imports the fixture and reports what the file actually is", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const view = await call<WikiView>(host, "wiki:importFile", { profileId });
    expect(view.problem).toBeNull();
    expect(view.libraries).toHaveLength(1);
    const library = view.libraries[0];
    expect(library?.id).toBe(FIXTURE_LIBRARY_ID);
    expect(library?.bytes).toBe(152_865);
    // The title falls back to the FILE NAME, and this fixture is what proves the
    // fallback matters: its `M/Title` lives in cluster 0, which is LZMA, and this
    // build refuses to decompress that by design (ADR-098). A reader that threw
    // instead of answering „the file does not say" would break the library list.
    expect(library?.title).toBe(FIXTURE_STEM);
    // A file the user picked was verified by nothing, and the view says so in the
    // same field a downloaded pack answers „checksum" in.
    expect(library?.integrity).toBe("none");
    expect(library?.language).toBeNull();
    expect(library?.hasFullTextIndex).toBe(false);
    expect(library?.present).toBe(true);
  });

  it("opens the main page, answers the frame's address, and records the visit", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const libraryId = await importFixture(host, profileId);
    const read = await call<WikiReadResult>(host, "wiki:read", { profileId, libraryId, zimPath: null });
    expect(read.article?.zimPath).toBe("A/Першая_старонка.html");
    expect(read.article?.title).toBe("Першая старонка");
    expect(read.article?.html).toBe(true);
    expect(read.article?.url).toBe(
      `nx-zim://${FIXTURE_LIBRARY_ID}/A/%D0%9F%D0%B5%D1%80%D1%88%D0%B0%D1%8F_%D1%81%D1%82%D0%B0%D1%80%D0%BE%D0%BD%D0%BA%D0%B0.html`,
    );
    expect(read.view.history.map((row) => row.zimPath)).toEqual(["A/Першая_старонка.html"]);
    expect(read.view.history[0]?.visitedAt).toBe(NOW);
    // The same place opened again moves the row rather than adding one.
    const again = await call<WikiReadResult>(host, "wiki:read", {
      profileId,
      libraryId,
      zimPath: "A/Першая_старонка.html",
    });
    expect(again.view.history).toHaveLength(1);
  });

  it("follows a redirect and refuses a page the file does not have", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const libraryId = await importFixture(host, profileId);
    // `A/index.htm` is a REDIRECT entry in this file; what opens is its target.
    const redirected = await call<WikiReadResult>(host, "wiki:read", {
      profileId,
      libraryId,
      zimPath: "A/index.htm",
    });
    expect(redirected.article?.zimPath).toBe("A/Першая_старонка.html");
    const missing = await call<WikiReadResult>(host, "wiki:read", {
      profileId,
      libraryId,
      zimPath: "A/nothing-here.html",
    });
    expect(missing.article).toBeNull();
    expect(missing.view.problem).toBe("not-found");
    // A page that did not open is not a place the user has been.
    expect(missing.view.history).toHaveLength(1);
  });

  it("answers nothing for a library this machine does not have, rather than throwing", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const libraryId = await importFixture(host, profileId);
    const read = await call<WikiReadResult>(host, "wiki:read", {
      profileId,
      // A shape the wire admits (an id) that no library answers to — which is
      // the difference between a payload the validators refuse (SEC-EL-02) and a
      // request about something that is simply not here.
      libraryId: "no-such-library",
      zimPath: null,
    });
    expect(read.article).toBeNull();
    expect(read.view.problem).toBe("not-found");
    expect(read.view.libraries[0]?.id).toBe(libraryId);
  });

  it("searches the fixture's titles by prefix, in the file's own order", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const libraryId = await importFixture(host, profileId);
    const answer = await call<WikiSearchResult>(host, "wiki:search", {
      profileId,
      libraryId,
      prefix: "Італьянская мова/Урок 1",
    });
    // Byte order, not locale order: „Урок 1" is followed by „Урок 10" and only
    // then by „Урок 2".
    expect(answer.hits.map((hit) => hit.title)).toEqual([
      "Італьянская мова/Урок 1",
      "Італьянская мова/Урок 10",
    ]);
    expect(answer.hits[0]?.mime).toBe("text/html");
    const none = await call<WikiSearchResult>(host, "wiki:search", {
      profileId,
      libraryId,
      prefix: "zzzz",
    });
    expect(none.hits).toEqual([]);
    // A search in a library this machine does not have answers nothing rather
    // than throwing: it is the op a keystroke calls.
    const nowhere = await call<WikiSearchResult>(host, "wiki:search", {
      profileId,
      libraryId: "no-such-library",
      prefix: "A",
    });
    expect(nowhere.hits).toEqual([]);
  });

  it("keeps a page, removes the mark, and forgets a library without deleting its file", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const libraryId = await importFixture(host, profileId);
    const kept = await call<WikiView>(host, "wiki:bookmark", {
      profileId,
      libraryId,
      zimPath: "A/Кава.html",
      title: "Кава",
    });
    expect(kept.bookmarks.map((row) => row.title)).toEqual(["Кава"]);
    const mark = kept.bookmarks[0]?.id ?? "";
    // Keeping the same page twice is one mark, not two.
    const again = await call<WikiView>(host, "wiki:bookmark", {
      profileId,
      libraryId,
      zimPath: "A/Кава.html",
      title: "Кава",
    });
    expect(again.bookmarks).toHaveLength(1);
    expect((await call<WikiView>(host, "wiki:unbookmark", { profileId, bookmarkId: mark })).bookmarks).toEqual([]);
    await expect(call(host, "wiki:unbookmark", { profileId, bookmarkId: mark })).rejects.toThrow(
      /No mark/,
    );
    expect((await call<WikiView>(host, "wiki:removeLibrary", { profileId, libraryId })).libraries).toEqual([]);
    // The index forgot it; the FILE is still where it was. A page that could
    // delete 119 GB on one click is a page that can delete the wrong 119 GB.
    expect(existsSync(FIXTURE)).toBe(true);
    expect(readLibraries(dir)).toEqual([]);
  });

  it("says a library's file has gone, rather than dropping the row", async () => {
    // A copy, so the shipped fixture is never touched.
    pickPath = join(dir, `${FIXTURE_STEM}.zim`);
    copyFileSync(FIXTURE, pickPath);
    const { host } = harness();
    const profileId = createProfile();
    const libraryId = await importFixture(host, profileId);
    unlinkSync(pickPath);
    const view = await call<WikiView>(host, "wiki:list", { profileId });
    expect(view.libraries[0]?.id).toBe(libraryId);
    expect(view.libraries[0]?.present).toBe(false);
  });

  it("refuses a file that is not a ZIM, and imports nothing", async () => {
    pickPath = join(dir, "not-a-zim.zim");
    // Any file that is not a ZIM will do; the database is the one large file this
    // suite already has, and it is emphatically not a ZIM.
    copyFileSync(join(root, "wiki.db"), pickPath);
    const { host } = harness();
    const profileId = createProfile();
    const view = await call<WikiView>(host, "wiki:importFile", { profileId });
    expect(view.problem).toBe("import");
    expect(view.libraries).toEqual([]);
  });

  it("reports a refused download without pretending anything arrived", async () => {
    const { host, downloads } = harness();
    const profileId = createProfile();
    const answer = await call<WikiView>(host, "wiki:download", {
      profileId,
      editionId: "wikipedia-sr-mini",
    });
    // The catalogue could not be read in this harness — its fake `http` answers
    // 404 — so the refusal is about the network, and nothing reached the wire.
    expect(answer.problem).toBe("network");
    expect(downloads.started).toEqual([]);
    expect(answer.downloads).toEqual([]);
    // An edition id nothing in the catalogue names is refused as such.
    const unknown = await call<WikiView>(host, "wiki:download", {
      profileId,
      editionId: "no-such-edition",
    });
    expect(unknown.problem).toBe("catalogue");
  });

  it("clears the history and leaves the marks alone", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const libraryId = await importFixture(host, profileId);
    await call<WikiView>(host, "wiki:bookmark", {
      profileId,
      libraryId,
      zimPath: "A/Кава.html",
      title: "Кава",
    });
    await call<WikiReadResult>(host, "wiki:read", { profileId, libraryId, zimPath: "A/Кава.html" });
    const cleared = await call<WikiView>(host, "wiki:clearHistory", { profileId });
    expect(cleared.history).toEqual([]);
    expect(cleared.bookmarks).toHaveLength(1);
  });
});

describe("the wiki module's archive section", () => {
  it("exports its marks through the kit, and a restore puts them back", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const libraryId = await importFixture(host, profileId);
    for (const [zimPath, title] of [
      ["A/Кава.html", "Кава"],
      ["A/Чај.html", "Чај"],
    ] as const) {
      await call<WikiView>(host, "wiki:bookmark", { profileId, libraryId, zimPath, title });
    }

    // The three methods `main/restore.ts` calls, in the order it calls them.
    const section = host.collectExports([profileId]);
    expect(section).toHaveLength(1);
    expect(section[0]?.moduleId).toBe("wiki");
    expect(section[0]?.payload).toEqual({
      version: WIKI_EXPORT_VERSION,
      // Ordered by title in the Serbian collator's order, which the store owns.
      bookmarks: [
        { libraryId, zimPath: "A/Кава.html", title: "Кава" },
        { libraryId, zimPath: "A/Чај.html", title: "Чај" },
      ],
    });
    host.assertImportable(section);

    // A profile holding something else entirely: the section REPLACES it.
    const mark = (await call<WikiView>(host, "wiki:list", { profileId })).bookmarks[0]?.id ?? "";
    await call<WikiView>(host, "wiki:unbookmark", { profileId, bookmarkId: mark });
    host.applyImports(section, [profileId]);
    const restored = await call<WikiView>(host, "wiki:list", { profileId });
    expect(restored.bookmarks.map((row) => row.title)).toEqual(["Кава", "Чај"]);
    // A restore replaces a profile whole, so the section's silence about the
    // reading log means empty rather than „leave it".
    expect(restored.history).toEqual([]);
  });

  it("refuses a payload this build cannot read, and writes nothing", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const libraryId = await importFixture(host, profileId);
    await call<WikiView>(host, "wiki:bookmark", {
      profileId,
      libraryId,
      zimPath: "A/Кава.html",
      title: "Кава",
    });
    const bad = [{ moduleId: "wiki", payload: { version: 99, bookmarks: [] } }];
    expect(() => host.assertImportable(bad)).toThrow(/another version/);
    expect((await call<WikiView>(host, "wiki:list", { profileId })).bookmarks).toHaveLength(1);
  });

  it("refuses the shapes its own parse will not take", () => {
    expect(() => parseWikiExport({ version: 99, bookmarks: [] })).toThrow(/another version/);
    expect(() => parseWikiExport({ version: WIKI_EXPORT_VERSION, bookmarks: "no" })).toThrow(
      /must be an array/,
    );
    expect(() =>
      parseWikiExport({
        version: WIKI_EXPORT_VERSION,
        bookmarks: [{ libraryId: "UPPER", zimPath: "A/x", title: "X" }],
      }),
    ).toThrow(/library id/);
    expect(() =>
      parseWikiExport({
        version: WIKI_EXPORT_VERSION,
        bookmarks: [
          { libraryId: "lib", zimPath: "A/x", title: "X" },
          { libraryId: "lib", zimPath: "A/x", title: "X" },
        ],
      }),
    ).toThrow(/twice/);
    expect(parseWikiExport({ version: WIKI_EXPORT_VERSION, bookmarks: [] })).toEqual({
      version: WIKI_EXPORT_VERSION,
      bookmarks: [],
    });
  });
});
