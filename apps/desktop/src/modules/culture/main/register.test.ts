import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CultureStore, openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { baseManifest, entry, makeKey, writePack } from "../../../main/packs/fixtures.js";
import { configureCultureServices } from "./services.js";
import { register } from "./register.js";

/**
 * The CULTURE module through the kit (ADR-090): its ops, the blob writes its
 * imports perform, the garbage collection its removals trigger, the arts guide's
 * pack read, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app.
 *
 * **Why the blob store is a fake and the database is real.** The real store
 * lives in `main/attachments.ts`, which owns key material and Electron's
 * protocol registry; what this module actually does with it is three calls, and
 * a fake that holds bytes in a Map tests those three exactly - including the one
 * that matters, that a removal only deletes when the refcount is zero. The count
 * the module is handed is main's union, which in production sums five stores;
 * here it is the culture store's own count plus a switchable "another table also
 * names this hash", which is the case a wrong implementation would destroy.
 */

const TRUSTED = { trusted: true };

/** A one-second silent WAVE with RIFF INFO tags, built the way `audio.test.ts` builds its fixtures. */
function wavFixture(): Uint8Array {
  const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);
  const u32 = (value: number): Uint8Array => {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, true);
    return out;
  };
  const chunk = (id: string, payload: Uint8Array): Uint8Array => {
    const padded =
      payload.byteLength % 2 === 0 ? payload : new Uint8Array([...payload, 0]);
    return new Uint8Array([...ascii(id), ...u32(payload.byteLength), ...padded]);
  };
  const format = new Uint8Array([1, 0, 1, 0, ...u32(8_000), ...u32(16_000), 2, 0, 16, 0]);
  const info = new Uint8Array([
    ...ascii("INFO"),
    ...chunk("INAM", ascii("Severni vetar")),
    // ASCII, because a RIFF INFO field is a single-byte string: `audio.test.ts`
    // states the same fact beside its fixture.
    ...chunk("IART", ascii("Test Izvodjac")),
  ]);
  const body = new Uint8Array([
    ...ascii("WAVE"),
    ...chunk("fmt ", format),
    ...chunk("LIST", info),
    ...chunk("data", new Uint8Array(16_000)),
  ]);
  return new Uint8Array([...ascii("RIFF"), ...u32(body.byteLength), ...body]);
}

/** A PNG's own eight magic bytes: enough for `sniffMime`, and not a picture anything decodes. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let dir: string;
/** The database every test works in, and the second one the archive round trip lands in. Opened ONCE per file: each migration run is the expensive part, and a fresh PROFILE per test is the isolation these cases need. */
let primary: NexusDatabase;
let fresh: NexusDatabase;
/** The database the harness is currently pointed at (the platform reads it at call time). */
let db: NexusDatabase;
let clock = Date.parse("2026-06-01T08:00:00.000Z");
let blobs: Map<string, Uint8Array>;
let extraHashHolds = 0;
let packKey: { publicKeyPem: string; privateKey: import("node:crypto").KeyObject };
let packsDir: string;
/** How many packs roots this file has made; each test gets its own so an install in one cannot be seen by the next. */
let packsRoots = 0;

function shaOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function harness(): ModuleHost {
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
  configureCultureServices({
    saveBlob: async (bytes) => {
      const sha256 = shaOf(bytes);
      const created = !blobs.has(sha256);
      blobs.set(sha256, bytes);
      return { sha256, created };
    },
    readBlob: async (sha256) => blobs.get(sha256) ?? null,
    deleteBlobIfOrphaned: async (sha256, refCount) => {
      if (refCount === 0) blobs.delete(sha256);
    },
    // Exactly main's shape: the module's own count, plus whatever else names
    // the hash.
    blobRefCount: (profileId, sha256) =>
      new CultureStore(db.raw, profileId).refCount(sha256) + extraHashHolds,
    packsRoot: () => packsDir,
    releasePublicKeyPem: () => packKey.publicKeyPem,
  });
  register(host);
  return host;
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

/** One whole visit as the wire declares it, so a test names only what it is about. */
function visitFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "exhibition",
    title: "Tesla: čovek budućnosti",
    venue: "Narodni muzej",
    city: "Beograd",
    date: "2026-06-01",
    startTime: null,
    rating: 8,
    notes: "Odlična postavka.",
    price: { minorUnits: 60_000, currency: "RSD" },
    companions: "Ana",
    ...overrides,
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-culture-module-"));
  primary = openDatabase({ path: join(dir, "culture.db") });
  fresh = openDatabase({ path: join(dir, "fresh.db") });
});

afterAll(() => {
  primary.close();
  fresh.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db = primary;
  clock = Date.parse("2026-06-01T08:00:00.000Z");
  blobs = new Map();
  extraHashHolds = 0;
  packKey = makeKey();
  packsRoots += 1;
  packsDir = join(dir, `userData-${String(packsRoots)}`);
});

/** Points the harness at another database file and creates one profile in it, which is the only legal target an archive has. */
function switchToFreshDatabase(): string {
  db = fresh;
  return createProfile();
}

describe("the culture handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const host = harness();
    expect(host.channels()).toEqual([
      "culture:list",
      "culture:createVisit",
      "culture:updateVisit",
      "culture:removeVisit",
      "culture:addVisitPhoto",
      "culture:removeVisitPhoto",
      "culture:createVenue",
      "culture:updateVenue",
      "culture:removeVenue",
      "culture:createPlan",
      "culture:updatePlan",
      "culture:removePlan",
      "culture:completePlan",
      "culture:importTrack",
      "culture:updateTrack",
      "culture:removeTrack",
      "culture:recordPlay",
      "culture:readTrackBytes",
      "culture:createEntry",
      "culture:updateEntry",
      "culture:removeEntry",
      "culture:createPlaylist",
      "culture:renamePlaylist",
      "culture:removePlaylist",
      "culture:addPlaylistTrack",
      "culture:movePlaylistItem",
      "culture:removePlaylistItem",
      "culture:setPromptPastPlans",
      "culture:listArt",
    ]);
  });

  it("answers an empty read with nothing and the module's shipped preference", async () => {
    const host = harness();
    const profileId = createProfile();
    const view = await call<{
      visits: unknown[];
      venues: unknown[];
      plans: unknown[];
      tracks: unknown[];
      entries: unknown[];
      playlists: unknown[];
      settings: { promptPastPlans: boolean };
    }>(host, "culture:list", { profileId });
    expect(view.visits).toEqual([]);
    expect(view.venues).toEqual([]);
    expect(view.plans).toEqual([]);
    expect(view.tracks).toEqual([]);
    expect(view.entries).toEqual([]);
    expect(view.playlists).toEqual([]);
    expect(view.settings).toEqual({ promptPastPlans: true });
  });

  it("remembers the place a visit was at, without asking the page for it", async () => {
    const host = harness();
    const profileId = createProfile();
    const view = await call<{
      visits: { venueId: string | null }[];
      venues: { id: string; name: string; city: string | null; kind: string }[];
    }>(host, "culture:createVisit", { profileId, ...visitFields() });
    expect(view.venues).toHaveLength(1);
    expect(view.venues[0]).toMatchObject({
      name: "Narodni muzej",
      city: "Beograd",
      kind: "exhibition",
    });
    expect(view.visits[0]?.venueId).toBe(view.venues[0]?.id);
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const host = harness();
    const profileId = createProfile();

    // A field that is structurally fine but semantically empty is refused by
    // the STORE, which is the second boundary (SEC-EL-02) - and the message
    // names the field and its bound.
    await expect(
      call(host, "culture:createVisit", { profileId, ...visitFields({ title: "" }) }),
    ).rejects.toThrow(/must be 1-200 characters/);
    await expect(
      call(host, "culture:createVisit", { profileId, ...visitFields({ rating: 11 }) }),
    ).rejects.toThrow(/between 1 and 10/);
    await expect(
      call(host, "culture:createVisit", { profileId, ...visitFields({ date: "2026-02-30" }) }),
    ).rejects.toThrow(/bare date/);
    await expect(
      call(host, "culture:createPlan", {
        profileId,
        kind: "theatre",
        title: "Hamlet",
        venue: "Narodno pozorište",
        city: null,
        date: "2026-07-01",
        startTime: null,
        link: "file:///etc/passwd",
        notes: "",
      }),
    ).rejects.toThrow(/http\(s\)/);
    await expect(call(host, "culture:removeVisit", { profileId, id: "  padded  " })).rejects.toThrow(
      /not a well-formed id/,
    );
    await expect(
      call(host, "culture:addVisitPhoto", {
        profileId,
        id: uuidv7(),
        fileName: "karta.txt",
        bytes: new TextEncoder().encode("nije slika"),
      }),
    ).rejects.toThrow(/PNG, JPEG, GIF, WebP or PDF/);
    expect(blobs.size).toBe(0);
  });

  /**
   * A payload that is not an object fails at the FIRST property read, which is
   * the kit's own shape rather than this module's omission: the payload's type
   * is the contract (`shared/ipc.ts`) and every FIELD is validated by name
   * above, while a `null` payload reaches no handler body at all. The property
   * that matters is that it cannot WRITE anything, which is what this asserts.
   */
  it("fails closed on a payload that is not an object at all, writing nothing", async () => {
    const host = harness();
    const profileId = createProfile();
    await expect(call(host, "culture:list", null)).rejects.toThrow();
    await expect(call(host, "culture:updateVisit", null)).rejects.toThrow();
    // A patch that is not an object is refused BY NAME, because the patch
    // readers are the ones that read a nested value.
    await expect(
      call(host, "culture:updateVisit", { profileId, id: uuidv7(), fields: "nije objekat" }),
    ).rejects.toThrow(/Invalid IPC payload/);
    const after = await call<{ visits: unknown[] }>(host, "culture:list", { profileId });
    expect(after.visits).toEqual([]);
  });
});

describe("the blobs this module stores", () => {
  it("writes a ticket's bytes, serves them, and collects them when the last row goes", async () => {
    const host = harness();
    const profileId = createProfile();
    const created = await call<{ visits: { id: string }[] }>(host, "culture:createVisit", {
      profileId,
      ...visitFields(),
    });
    const visitId = created.visits[0]?.id ?? "";
    const sha256 = shaOf(PNG);

    const withPhoto = await call<{ visits: { photos: { id: string; fileName: string; mime: string }[] }[] }>(
      host,
      "culture:addVisitPhoto",
      { profileId, id: visitId, fileName: "karta.png", bytes: PNG },
    );
    expect(withPhoto.visits[0]?.photos[0]).toMatchObject({
      fileName: "karta.png",
      // Sniffed from the bytes, never taken from the name the renderer wrote.
      mime: "image/png",
    });
    expect(blobs.has(sha256)).toBe(true);

    // Another table names the same hash: the file must survive this removal.
    extraHashHolds = 1;
    const removed = await call<{ visits: { photos: unknown[] }[] }>(host, "culture:removeVisitPhoto", {
      profileId,
      id: visitId,
      photoId: withPhoto.visits[0]?.photos[0]?.id ?? "",
    });
    expect(removed.visits[0]?.photos).toEqual([]);
    expect(blobs.has(sha256)).toBe(true);

    // Nothing else names it now, so a fresh attach and removal takes the file.
    extraHashHolds = 0;
    const again = await call<{ visits: { photos: { id: string }[] }[] }>(
      host,
      "culture:addVisitPhoto",
      { profileId, id: visitId, fileName: "karta.png", bytes: PNG },
    );
    await call(host, "culture:removeVisitPhoto", {
      profileId,
      id: visitId,
      photoId: again.visits[0]?.photos[0]?.id ?? "",
    });
    expect(blobs.has(sha256)).toBe(false);
  });

  it("keeps a soft-deleted visit's ticket, because the row still names it", async () => {
    const host = harness();
    const profileId = createProfile();
    const created = await call<{ visits: { id: string }[] }>(host, "culture:createVisit", {
      profileId,
      ...visitFields(),
    });
    await call(host, "culture:addVisitPhoto", {
      profileId,
      id: created.visits[0]?.id ?? "",
      fileName: "karta.png",
      bytes: PNG,
    });
    await call(host, "culture:removeVisit", { profileId, id: created.visits[0]?.id ?? "" });
    expect(blobs.has(shaOf(PNG))).toBe(true);
  });

  it("imports a track's tags from its bytes, plays them back, and counts the play", async () => {
    const host = harness();
    const profileId = createProfile();
    const imported = await call<{
      tracks: { id: string; title: string; artist: string | null; durationMs: number; mime: string }[];
    }>(host, "culture:importTrack", {
      profileId,
      fileName: "sever.flac",
      bytes: wavFixture(),
    });
    const track = imported.tracks[0];
    expect(track).toMatchObject({
      title: "Severni vetar",
      artist: "Test Izvodjac",
      durationMs: 1_000,
      // The container decides the mime, not the name: a `.flac` holding a WAVE
      // is a WAVE.
      mime: "audio/wav",
    });
    expect(blobs.has(shaOf(wavFixture()))).toBe(true);

    const bytes = await call<{ mime: string; bytes: Uint8Array }>(host, "culture:readTrackBytes", {
      profileId,
      id: track?.id ?? "",
    });
    expect(bytes.mime).toBe("audio/wav");
    expect(Array.from(bytes.bytes.slice(0, 4))).toEqual([0x52, 0x49, 0x46, 0x46]);

    const played = await call<{ tracks: { playCount: number; lastPlayedAt: string | null }[] }>(
      host,
      "culture:recordPlay",
      { profileId, id: track?.id ?? "" },
    );
    expect(played.tracks[0]?.playCount).toBe(1);
    expect(played.tracks[0]?.lastPlayedAt).toBe("2026-06-01T08:00:00.000Z");
  });

  it("refuses a file that is not one of the five audio containers, and writes nothing", async () => {
    const host = harness();
    const profileId = createProfile();
    await expect(
      call(host, "culture:importTrack", {
        profileId,
        fileName: "lazni.mp3",
        bytes: new TextEncoder().encode("ovo nije muzika"),
      }),
    ).rejects.toThrow(/audio formats this library holds/);
    expect(blobs.size).toBe(0);
  });
});

describe("the programme", () => {
  it("turns a past plan into a visit exactly once", async () => {
    const host = harness();
    const profileId = createProfile();
    const created = await call<{ plans: { id: string }[] }>(host, "culture:createPlan", {
      profileId,
      kind: "theatre",
      title: "Hamlet",
      venue: "Narodno pozorište",
      city: "Beograd",
      date: "2026-05-20",
      startTime: "19:30",
      link: "https://example.org/hamlet",
      notes: "",
    });
    const planId = created.plans[0]?.id ?? "";

    const completed = await call<{
      plans: { visitId: string | null }[];
      visits: { id: string; title: string; kind: string; venue: string; date: string; rating: number | null }[];
    }>(host, "culture:completePlan", { profileId, id: planId, fields: { rating: 9 } });
    const visit = completed.visits[0];
    expect(visit).toMatchObject({
      title: "Hamlet",
      kind: "theatre",
      venue: "Narodno pozorište",
      date: "2026-05-20",
      rating: 9,
    });
    expect(completed.plans[0]?.visitId).toBe(visit?.id);

    await expect(
      call(host, "culture:completePlan", { profileId, id: planId, fields: {} }),
    ).rejects.toThrow(/already become a visit/);
  });

  it("keeps the module's preference, and answers it back", async () => {
    const host = harness();
    const profileId = createProfile();
    const off = await call<{ settings: { promptPastPlans: boolean } }>(
      host,
      "culture:setPromptPastPlans",
      { profileId, promptPastPlans: false },
    );
    expect(off.settings).toEqual({ promptPastPlans: false });
    const read = await call<{ settings: { promptPastPlans: boolean } }>(host, "culture:list", {
      profileId,
    });
    expect(read.settings).toEqual({ promptPastPlans: false });
  });
});

describe("the arts guide", () => {
  /** Installs one dataset pack under the fixture packs root. */
  function installArtPack(options: {
    id: string;
    version?: string;
    contents: Readonly<Record<string, string | Uint8Array>>;
  }): void {
    const version = options.version ?? "1.0.0";
    writePack({
      dir: join(packsDir, "packs", options.id, version),
      key: packKey.privateKey,
      manifest: baseManifest(
        Object.entries(options.contents).map(([path, body]) => entry(path, body)),
        { id: options.id, version, kind: "dataset" },
      ),
      contents: options.contents,
    });
  }

  it("reads an installed dataset pack, and names a pack it cannot read", async () => {
    const host = harness();
    const work = {
      id: "portrait-1",
      title: "Portret",
      artist: "Nepoznati autor",
      date: "1850",
      museum: "Narodni muzej",
      credit: "Narodni muzej, Beograd",
      licence: "CC0-1.0",
      image: "images/portret.jpg",
      width: 800,
      height: 1000,
    };
    installArtPack({
      id: "art-test",
      contents: {
        "art.json": `${JSON.stringify({ layout: 1, works: [work] })}\n`,
        "images/portret.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      },
    });
    installArtPack({ id: "broken-pack", contents: { "art.json": "nije json" } });

    const art = await call<{
      works: { id: string; packId: string; version: string; image: string }[];
      packs: { id: string }[];
      skipped: string[];
    }>(host, "culture:listArt", {});
    expect(art.works).toEqual([
      expect.objectContaining({ id: "portrait-1", packId: "art-test", version: "1.0.0" }),
    ]);
    expect(art.works[0]?.image).toBe("images/portret.jpg");
    expect(art.packs.map((each) => each.id)).toEqual(["art-test"]);
    expect(art.skipped).toEqual(["broken-pack"]);
  });

  it("answers with nothing when no pack is installed", async () => {
    const host = harness();
    expect(await call(host, "culture:listArt", {})).toEqual({
      works: [],
      packs: [],
      skipped: [],
    });
  });
});

describe("the culture archive section", () => {
  it("round-trips every list, the links between them, and the preference", async () => {
    const host = harness();
    const source = createProfile();

    const visit = await call<{ visits: { id: string }[] }>(host, "culture:createVisit", {
      profileId: source,
      ...visitFields(),
    });
    await call(host, "culture:addVisitPhoto", {
      profileId: source,
      id: visit.visits[0]?.id ?? "",
      fileName: "karta.png",
      bytes: PNG,
    });
    const plan = await call<{ plans: { id: string }[] }>(host, "culture:createPlan", {
      profileId: source,
      kind: "concert",
      title: "Koncert",
      venue: "Sava centar",
      city: "Beograd",
      date: "2026-05-30",
      startTime: null,
      link: null,
      notes: "",
    });
    await call(host, "culture:completePlan", {
      profileId: source,
      id: plan.plans[0]?.id ?? "",
      fields: {},
    });
    const track = await call<{ tracks: { id: string }[] }>(host, "culture:importTrack", {
      profileId: source,
      fileName: "sever.wav",
      bytes: wavFixture(),
    });
    await call(host, "culture:recordPlay", { profileId: source, id: track.tracks[0]?.id ?? "" });
    await call(host, "culture:createEntry", {
      profileId: source,
      artist: "Test Izvođač",
      title: "Severni vetar",
      kind: "track",
      date: "2026-06-01",
      rating: 9,
      notes: "Ceo dan na repeat.",
      trackId: track.tracks[0]?.id ?? null,
    });
    const list = await call<{ playlists: { id: string }[] }>(host, "culture:createPlaylist", {
      profileId: source,
      name: "Za put",
    });
    await call(host, "culture:addPlaylistTrack", {
      profileId: source,
      id: list.playlists[0]?.id ?? "",
      trackId: track.tracks[0]?.id ?? "",
    });
    await call(host, "culture:setPromptPastPlans", { profileId: source, promptPastPlans: false });

    const sections = host.collectExports([source]);
    expect(sections.map((section) => section.moduleId)).toEqual(["culture"]);
    const payload = sections[0]?.payload as {
      version: number;
      venues: unknown[];
      visits: unknown[];
      plans: unknown[];
      tracks: unknown[];
      entries: unknown[];
      playlists: unknown[];
      settings: { promptPastPlans: boolean };
    };
    expect(payload.version).toBe(1);
    // Two visits and the places they were at: the exhibition, and the one the
    // plan became.
    expect(payload.venues).toHaveLength(2);
    expect(payload.visits).toHaveLength(2);
    expect(payload.plans).toHaveLength(1);
    expect(payload.tracks).toHaveLength(1);
    expect(payload.entries).toHaveLength(1);
    expect(payload.playlists).toHaveLength(1);
    expect(payload.settings).toEqual({ promptPastPlans: false });

    // The same payload, applied to a profile in ANOTHER database - a fresh
    // install, which is the only target an archive can legally have: every row
    // id is a global primary key, so a copy of a profile's culture beside its
    // own source is refused by the schema itself (`CultureStore`'s own note).
    const target = switchToFreshDatabase();
    host.applyImports([sections[0]!], [target]);
    const restored = await call<{
      venues: { id: string }[];
      visits: { venueId: string | null; photos: unknown[] }[];
      plans: { visitId: string | null }[];
      tracks: { id: string; playCount: number }[];
      entries: { trackId: string | null }[];
      playlists: { items: unknown[] }[];
      settings: { promptPastPlans: boolean };
    }>(host, "culture:list", { profileId: target });
    expect(restored.venues).toHaveLength(2);
    expect(restored.visits).toHaveLength(2);
    expect(restored.visits.every((row) => row.venueId !== null)).toBe(true);
    expect(restored.visits.some((row) => row.photos.length === 1)).toBe(true);
    expect(restored.plans[0]?.visitId).not.toBeNull();
    expect(restored.tracks[0]?.playCount).toBe(1);
    expect(restored.entries[0]?.trackId).toBe(restored.tracks[0]?.id);
    expect(restored.playlists[0]?.items).toHaveLength(1);
    expect(restored.settings).toEqual({ promptPastPlans: false });
  });

  it("refuses a section it does not understand, leaving the profile exactly as it found it", async () => {
    const host = harness();
    const profileId = createProfile();
    await call(host, "culture:createVisit", { profileId, ...visitFields() });

    const empty = {
      version: 1,
      venues: [],
      visits: [],
      plans: [],
      tracks: [],
      entries: [],
      playlists: [],
      settings: { promptPastPlans: true },
    };
    const dangling = {
      ...empty,
      visits: [{ ...visitFields(), id: uuidv7(), venueId: "nema-ovog-mesta", photos: [] }],
    };
    // Three shapes a later build (or a hand-edited archive) could produce: a
    // version this module does not know, a section missing its members, and a
    // link that names a place the value does not carry.
    for (const payload of [{ version: 99 }, { version: 1 }, dangling]) {
      expect(() => host.applyImports([{ moduleId: "culture", payload }], [profileId])).toThrow();
      const after = await call<{ visits: { title: string }[] }>(host, "culture:list", {
        profileId,
      });
      expect(after.visits.map((visit) => visit.title)).toEqual(["Tesla: čovek budućnosti"]);
    }
  });

  it("empties the archived state when the section names no culture entry", async () => {
    const host = harness();
    const profileId = createProfile();
    await call(host, "culture:createVisit", { profileId, ...visitFields() });
    await call(host, "culture:setPromptPastPlans", { profileId, promptPastPlans: false });

    // What a restore of an archive written before CULTURE hands over: no section
    // at all, which for a profile replaced whole means empty - and the module's
    // SHIPPED preference, not the one this profile happened to hold.
    host.applyImports([], [profileId]);

    const after = await call<{
      visits: unknown[];
      venues: unknown[];
      settings: { promptPastPlans: boolean };
    }>(host, "culture:list", { profileId });
    expect(after.visits).toEqual([]);
    expect(after.venues).toEqual([]);
    expect(after.settings).toEqual({ promptPastPlans: true });
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const host = harness();
    expect(host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
