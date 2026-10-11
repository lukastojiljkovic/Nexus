import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_RECORDING_BYTES, MAX_RECORDING_TAGS, openDatabase, uuidv7 } from "@nexus/db";
import type { NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModuleBlobWrite, type ModulePlatform } from "../../../main/moduleIpc.js";
import { mediaAccessArmedAt } from "./mediaAccess.js";
import { register } from "./register.js";

/**
 * The RECORDER module through the kit (ADR-090): its ops, the bytes it hands to
 * the blob store, the media window it opens, and its archive section.
 *
 * **Why the tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's — so
 * going through `dispatch` tests what actually runs in the app.
 *
 * The blob store is a fake in exactly one way: it writes into a `Map` instead of
 * `<userData>/blobs`. Its sha256 is the real one, computed by `node:crypto`,
 * because the row this module writes names the bytes by that hash and a fake
 * digest would let a real mismatch through.
 */

const TRUSTED = { trusted: true };
const NOW = Date.parse("2026-10-10T20:00:00.000Z");
const AUDIO_MIME = "audio/webm;codecs=opus";
const VIDEO_MIME = "video/webm;codecs=vp9,opus";

let dir: string;
let db: NexusDatabase;
let clock = NOW;

interface Harness {
  readonly host: ModuleHost;
  /** The fake blob store's contents, by plaintext sha256. */
  readonly blobs: Map<string, Uint8Array>;
}

function harness(options: { withBlobs?: boolean } = {}): Harness {
  const blobs = new Map<string, Uint8Array>();
  const saveBlob = async (bytes: Uint8Array): Promise<ModuleBlobWrite> => {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const created = !blobs.has(sha256);
    blobs.set(sha256, bytes);
    return { sha256, created };
  };
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    ...(options.withBlobs === false ? {} : { saveBlob }),
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => clock,
  };
  const host = new ModuleHost(platform);
  register(host);
  return { host, blobs };
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

/** Bytes unique to a seed, so a second recording is a second blob. */
function bytesOf(seed: string): Uint8Array {
  return new TextEncoder().encode(seed);
}

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** One save payload, with the fields a test does not care about filled in. */
function savePayload(profileId: string, seed: string, overrides: Record<string, unknown> = {}) {
  return {
    profileId,
    kind: "audio",
    mime: AUDIO_MIME,
    durationMs: 65_000,
    bytes: bytesOf(seed),
    title: "",
    tags: [],
    notes: "",
    isDiary: false,
    diaryDate: null,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-recorder-module-"));
  db = openDatabase({ path: join(dir, "recorder.db") });
  clock = NOW;
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the recorder handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "recorder:list",
      "recorder:beginCapture",
      "recorder:save",
      "recorder:update",
      "recorder:remove",
      "recorder:restore",
      "recorder:setCountdown",
    ]);
  });

  it("refuses a message from anywhere but this app's window, before any handler runs", async () => {
    const { host } = harness();
    await expect(
      host.dispatch("recorder:list", { trusted: false }, { profileId: createProfile() }),
    ).rejects.toThrow(/did not come from this app/);
  });

  it("writes the bytes to the blob store, and a row that names them", async () => {
    const kit = harness();
    const profileId = createProfile();
    const bytes = bytesOf("prvi snimak");

    const view = await call<{
      entries: {
        id: string;
        kind: string;
        mime: string;
        sizeBytes: number;
        sha256: string;
        durationMs: number;
        createdAt: string;
      }[];
      storage: {
        audio: { count: number; sizeBytes: number; durationMs: number };
        video: { count: number; sizeBytes: number; durationMs: number };
        all: { count: number; sizeBytes: number; durationMs: number };
      };
      limitBytes: number;
    }>(kit.host, "recorder:save", savePayload(profileId, "prvi snimak", { bytes }));

    const [entry] = view.entries;
    expect(entry).toMatchObject({
      kind: "audio",
      mime: AUDIO_MIME,
      sizeBytes: bytes.byteLength,
      sha256: sha256Of(bytes),
      durationMs: 65_000,
      createdAt: new Date(NOW).toISOString(),
    });
    // The bytes really reached the store, under the hash the row names.
    expect(kit.blobs.get(sha256Of(bytes))).toEqual(bytes);
    // The page's hard limit is the store's own cap, sent rather than restated.
    expect(view.limitBytes).toBe(MAX_RECORDING_BYTES);
    expect(view.storage).toEqual({
      audio: { count: 1, sizeBytes: bytes.byteLength, durationMs: 65_000 },
      video: { count: 0, sizeBytes: 0, durationMs: 0 },
      all: { count: 1, sizeBytes: bytes.byteLength, durationMs: 65_000 },
    });
  });

  it("splits the library's cost by kind, on `recordingStorageSummary`'s own arithmetic", async () => {
    const kit = harness();
    const profileId = createProfile();
    const audio = bytesOf("audio");
    const video = bytesOf("video bytes");
    await call(kit.host, "recorder:save", savePayload(profileId, "a", { bytes: audio }));
    await call(
      kit.host,
      "recorder:save",
      savePayload(profileId, "v", {
        bytes: video,
        kind: "video",
        mime: VIDEO_MIME,
        durationMs: 12_000,
      }),
    );

    const view = await call<{
      storage: {
        audio: { count: number; sizeBytes: number; durationMs: number };
        video: { count: number; sizeBytes: number; durationMs: number };
        all: { count: number; sizeBytes: number; durationMs: number };
      };
    }>(kit.host, "recorder:list", { profileId });

    expect(view.storage.audio).toEqual({ count: 1, sizeBytes: audio.byteLength, durationMs: 65_000 });
    expect(view.storage.video).toEqual({ count: 1, sizeBytes: video.byteLength, durationMs: 12_000 });
    expect(view.storage.all.count).toBe(2);
    expect(view.storage.all.sizeBytes).toBe(audio.byteLength + video.byteLength);
  });

  it("refuses a payload the wire should never carry, before the store or the blob store sees it", async () => {
    const kit = harness();
    const profileId = createProfile();

    // A kind outside the closed list, a mime outside the closed list, and the
    // pair disagreeing — two answers to one question.
    await expect(
      call(kit.host, "recorder:save", savePayload(profileId, "x", { kind: "photo" })),
    ).rejects.toThrow(/"kind" must be one of/);
    await expect(
      call(kit.host, "recorder:save", savePayload(profileId, "x", { mime: "audio/mpeg" })),
    ).rejects.toThrow(/"mime" must be one of/);
    await expect(
      call(kit.host, "recorder:save", savePayload(profileId, "x", { mime: VIDEO_MIME })),
    ).rejects.toThrow(/is not a audio container/);
    // Bytes that are not bytes, empty bytes, and bytes past the store's cap.
    await expect(
      call(kit.host, "recorder:save", savePayload(profileId, "x", { bytes: "nope" })),
    ).rejects.toThrow(/"bytes" must be a Uint8Array/);
    await expect(
      call(kit.host, "recorder:save", savePayload(profileId, "x", { bytes: new Uint8Array(0) })),
    ).rejects.toThrow(/1\.\./);
    await expect(
      call(
        kit.host,
        "recorder:save",
        savePayload(profileId, "x", { bytes: new Uint8Array(MAX_RECORDING_BYTES + 1) }),
      ),
    ).rejects.toThrow(/1\.\./);
    // A duration the store could not hold, tags that are not a list, and too
    // many of them.
    await expect(
      call(kit.host, "recorder:save", savePayload(profileId, "x", { durationMs: 0 })),
    ).rejects.toThrow(/between 1 and 43200000/);
    await expect(
      call(kit.host, "recorder:save", savePayload(profileId, "x", { tags: "glas" })),
    ).rejects.toThrow(/"tags" must be an array/);
    await expect(
      call(
        kit.host,
        "recorder:save",
        savePayload(profileId, "x", {
          tags: Array.from({ length: MAX_RECORDING_TAGS + 1 }, (_, index) => `t${index}`),
        }),
      ),
    ).rejects.toThrow(new RegExp(`at most ${MAX_RECORDING_TAGS}`));
    // And an id that is not an id is refused as an id.
    await expect(
      call(kit.host, "recorder:remove", { profileId, id: "  padded  " }),
    ).rejects.toThrow(/not a well-formed id/);

    // Nothing was written anywhere: the refusal came before the bytes did.
    expect(kit.blobs.size).toBe(0);
    const view = await call<{ entries: unknown[] }>(kit.host, "recorder:list", { profileId });
    expect(view.entries).toEqual([]);
  });

  it("refuses to record at all when this build has no blob store open", async () => {
    const kit = harness({ withBlobs: false });
    const profileId = createProfile();

    await expect(call(kit.host, "recorder:save", savePayload(profileId, "x"))).rejects.toThrow(
      /no blob store open/,
    );
    const view = await call<{ entries: unknown[] }>(kit.host, "recorder:list", { profileId });
    expect(view.entries).toEqual([]);
  });
});

describe("the media window the recorder opens", () => {
  it("arms it on `beginCapture` and closes it when the session ends", async () => {
    const kit = harness();
    const profileId = createProfile();

    expect(mediaAccessArmedAt(clock)).toBe(false);
    const arm = await call<{ armedForMs: number }>(kit.host, "recorder:beginCapture", {
      profileId,
    });
    expect(arm.armedForMs).toBeGreaterThan(0);
    expect(mediaAccessArmedAt(clock)).toBe(true);

    // A lock, a switch or a quit: no session inherits a microphone grant.
    kit.host.sessionEnd();
    expect(mediaAccessArmedAt(clock)).toBe(false);
  });

  it("will not open the window for a payload that names no profile", async () => {
    const kit = harness();
    await expect(call(kit.host, "recorder:beginCapture", { profileId: "" })).rejects.toThrow(
      /must be a non-empty string/,
    );
    expect(mediaAccessArmedAt(clock)).toBe(false);
  });
});

describe("editing and the undo the page offers", () => {
  it("writes a title, tags, notes and the diary pair, and keeps the media untouched", async () => {
    const kit = harness();
    const profileId = createProfile();
    const bytes = bytesOf("dnevnik");
    const created = await call<{ entries: { id: string }[] }>(
      kit.host,
      "recorder:save",
      savePayload(profileId, "dnevnik", { bytes }),
    );
    const id = created.entries[0]?.id ?? "";

    const view = await call<{
      entries: {
        title: string;
        tags: string[];
        notes: string;
        isDiary: boolean;
        diaryDate: string | null;
        sha256: string;
        sizeBytes: number;
      }[];
    }>(kit.host, "recorder:update", {
      profileId,
      id,
      title: "Šetnja",
      tags: ["glas", "napolju"],
      notes: "Vetar u mikrofonu.",
      isDiary: true,
      diaryDate: "2026-10-11",
    });

    expect(view.entries[0]).toMatchObject({
      title: "Šetnja",
      tags: ["glas", "napolju"],
      notes: "Vetar u mikrofonu.",
      isDiary: true,
      diaryDate: "2026-10-11",
      // The media is deliberately absent from a patch — the row's own hash and
      // size stand, because re-encoding would be a NEW recording.
      sha256: sha256Of(bytes),
      sizeBytes: bytes.byteLength,
    });
  });

  it("refuses half a diary pair, and leaves the row exactly as it was", async () => {
    const kit = harness();
    const profileId = createProfile();
    const created = await call<{ entries: { id: string }[] }>(
      kit.host,
      "recorder:save",
      savePayload(profileId, "x"),
    );
    const id = created.entries[0]?.id ?? "";
    await call(kit.host, "recorder:update", {
      profileId,
      id,
      title: "Kafa",
      tags: [],
      notes: "",
      isDiary: true,
      diaryDate: "2026-10-11",
    });

    // A date that is not a calendar day, and a flag with no date at all.
    await expect(
      call(kit.host, "recorder:update", {
        profileId,
        id,
        title: "Kafa",
        tags: [],
        notes: "",
        isDiary: true,
        diaryDate: "2026-02-31",
      }),
    ).rejects.toThrow(/diaryDate/);
    await expect(
      call(kit.host, "recorder:update", {
        profileId,
        id,
        title: "Kafa",
        tags: [],
        notes: "",
        isDiary: true,
        diaryDate: null,
      }),
    ).rejects.toThrow(/must be a non-empty string/);

    const after = await call<{ entries: { title: string; diaryDate: string | null }[] }>(
      kit.host,
      "recorder:list",
      { profileId },
    );
    expect(after.entries[0]).toEqual(
      expect.objectContaining({ title: "Kafa", diaryDate: "2026-10-11" }),
    );
  });

  it("soft-deletes a recording and brings it back, its blob reference intact", async () => {
    const kit = harness();
    const profileId = createProfile();
    const created = await call<{ entries: { id: string }[] }>(
      kit.host,
      "recorder:save",
      savePayload(profileId, "undo"),
    );
    const id = created.entries[0]?.id ?? "";

    const removed = await call<{ entries: unknown[] }>(kit.host, "recorder:remove", {
      profileId,
      id,
    });
    expect(removed.entries).toEqual([]);
    // The bytes are still there: a soft delete is an UPDATE, and the undo the
    // page offers is about to point at them again.
    expect(kit.blobs.size).toBe(1);

    const restored = await call<{ entries: { id: string }[] }>(kit.host, "recorder:restore", {
      profileId,
      id,
    });
    expect(restored.entries.map((entry) => entry.id)).toEqual([id]);
  });
});

describe("the recorder archive section", () => {
  it("carries every recording's index — hash, size, duration and mime — and writes it back whole", async () => {
    const kit = harness();
    const source = createProfile();
    const bytes = bytesOf("arhiva");
    await call(
      kit.host,
      "recorder:save",
      savePayload(source, "arhiva", {
        bytes,
        title: "Kafa",
        tags: ["glas"],
        isDiary: true,
        diaryDate: "2026-10-11",
      }),
    );

    const [section] = kit.host.collectExports([source]);
    expect(section?.moduleId).toBe("recorder");
    // The section IS the index: the sha256 that names the bytes and the size
    // they take travel with the row, which is what makes them countable — by
    // `blobRefCount` in main, and by the manifest's blob list on the way out.
    const payload = section?.payload as {
      version: number;
      recordings: { sha256: string; sizeBytes: number; durationMs: number; mime: string }[];
      markers: unknown[];
      settings: { countdown: boolean };
    };
    expect(payload.version).toBe(2);
    expect(payload.settings).toEqual({ countdown: false });
    expect(payload.recordings).toEqual([
      expect.objectContaining({
        sha256: sha256Of(bytes),
        sizeBytes: bytes.byteLength,
        durationMs: 65_000,
        mime: AUDIO_MIME,
      }),
    ]);

    // The restore is the profile's OWN archive over itself — `RestoreStore`'s
    // T1b, and the reason it is the shape tested here: the rows carry their ids,
    // so a section can only land in a fresh install or over the profile it came
    // from, and the wipe inside `importData` is what frees those ids first.
    kit.host.applyImports([section!], [source]);

    const restored = await call<{
      entries: {
        title: string;
        tags: string[];
        sha256: string;
        sizeBytes: number;
        isDiary: boolean;
        diaryDate: string | null;
      }[];
      storage: { all: { count: number; sizeBytes: number } };
    }>(kit.host, "recorder:list", { profileId: source });
    expect(restored.entries).toHaveLength(1);
    expect(restored.entries[0]).toMatchObject({
      title: "Kafa",
      tags: ["glas"],
      sha256: sha256Of(bytes),
      sizeBytes: bytes.byteLength,
      isDiary: true,
      diaryDate: "2026-10-11",
    });
    expect(restored.storage.all).toEqual({ count: 1, sizeBytes: bytes.byteLength, durationMs: 65_000 });
    // The bytes themselves never travel in the section: they are the blob
    // store's, and the row's `sha256` is what makes them findable — which is
    // what `blobRefCount` in main sums for this module.
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "recorder:save", savePayload(profileId, "x", { title: "Kafa" }));

    // Four shapes a later build (or a hand-edited archive) could produce: a
    // version this module does not know, stage 1's payload (which carried no
    // `settings`), a recording that is not one, and a marker past the end of the
    // recording it names.
    for (const payload of [
      { version: 99, recordings: [], markers: [], settings: { countdown: false } },
      { version: 2, recordings: [], markers: [] },
      {
        version: 2,
        recordings: [{ id: "R", kind: "photo" }],
        markers: [],
        settings: { countdown: false },
      },
      {
        version: 2,
        recordings: [
          {
            id: "R",
            kind: "audio",
            title: "",
            createdAt: new Date(NOW).toISOString(),
            durationMs: 1_000,
            mime: AUDIO_MIME,
            sizeBytes: 10,
            sha256: "a".repeat(64),
            tags: [],
            notes: "",
            isDiary: false,
            diaryDate: null,
            transcript: "",
            updatedAt: new Date(NOW).toISOString(),
          },
        ],
        markers: [
          { id: "m", recordingId: "R", atMs: 5_000, label: "kraj", createdAt: NOW, updatedAt: NOW },
        ],
        settings: { countdown: false },
      },
    ]) {
      expect(() => kit.host.applyImports([{ moduleId: "recorder", payload }], [profileId])).toThrow();
      const after = await call<{ entries: { title: string }[] }>(kit.host, "recorder:list", {
        profileId,
      });
      expect(after.entries.map((entry) => entry.title)).toEqual(["Kafa"]);
    }
  });

  it("empties the archived state when the section names no recorder entry", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "recorder:save", savePayload(profileId, "x"));

    // An archive with no recorder entry is what a restore of a pre-1.42 archive
    // hands over, and a restore replaces the profile whole.
    kit.host.applyImports([], [profileId]);

    const after = await call<{ entries: unknown[] }>(kit.host, "recorder:list", { profileId });
    expect(after.entries).toEqual([]);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const kit = harness();
    expect(kit.host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });

  it("carries the module's own preference, and writes it back on a restore", async () => {
    const kit = harness();
    const source = createProfile();
    await call(kit.host, "recorder:setCountdown", { profileId: source, countdown: true });
    const view = await call<{ settings: { countdown: boolean } }>(kit.host, "recorder:list", {
      profileId: source,
    });
    expect(view.settings).toEqual({ countdown: true });

    const [section] = kit.host.collectExports([source]);
    const payload = section?.payload as { settings: { countdown: boolean } };
    expect(payload.settings).toEqual({ countdown: true });

    kit.host.applyImports([section!], [source]);
    const restored = await call<{ settings: { countdown: boolean } }>(kit.host, "recorder:list", {
      profileId: source,
    });
    expect(restored.settings).toEqual({ countdown: true });
  });

  it("says nothing at all for a profile that has never recorded", () => {
    const kit = harness();
    expect(kit.host.collectExports([createProfile()])).toEqual([]);
  });
});
