import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_MS,
  MAX_RECORDING_LABEL_LENGTH,
  MAX_RECORDING_MARKERS,
  MAX_RECORDING_NOTES_LENGTH,
  MAX_RECORDING_TAG_LENGTH,
  MAX_RECORDING_TAGS,
  MAX_RECORDING_TITLE_LENGTH,
  MAX_RECORDING_TRANSCRIPT_LENGTH,
  NexusDatabase,
  RecorderNotFoundError,
  RecorderStore,
  RecorderValidationError,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { CreateRecordingInput } from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:30:00.000Z";
const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-recorder-"));
  db = openDatabase({ path: join(dir, "recorder.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(name = "P"): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

function store(profileId = createProfile()): RecorderStore {
  return new RecorderStore(db.raw, profileId);
}

/** An audio memo with every optional field omitted — the default shape. */
function audioMemo(overrides: Partial<CreateRecordingInput> = {}): CreateRecordingInput {
  return {
    kind: "audio",
    mime: "audio/webm;codecs=opus",
    durationMs: 65_000,
    sizeBytes: 1_000_000,
    sha256: SHA,
    ...overrides,
  };
}

describe("RecorderStore.create", () => {
  it("stores an audio memo and returns it with the defaults filled in", () => {
    const recorder = store();
    const recording = recorder.create(audioMemo(), NOW);

    expect(recording).toMatchObject({
      kind: "audio",
      title: "",
      createdAt: NOW,
      durationMs: 65_000,
      mime: "audio/webm;codecs=opus",
      sizeBytes: 1_000_000,
      sha256: SHA,
      tags: [],
      notes: "",
      isDiary: false,
      diaryDate: null,
      transcript: "",
      updatedAt: NOW,
    });
    expect(recorder.listActive()).toEqual([recording]);
  });

  it("stores a video diary with tags, notes, a transcript and a diary date", () => {
    const recorder = store();
    const recording = recorder.create(
      {
        kind: "video",
        title: "Utisci sa puta",
        mime: "video/webm;codecs=vp9,opus",
        durationMs: 3_600_000,
        sizeBytes: 250_000_000,
        sha256: OTHER_SHA,
        tags: ["put", "porodica"],
        notes: "Snimljeno na terasi.",
        isDiary: true,
        diaryDate: "2026-06-02",
        transcript: "Danas smo krenuli…",
      },
      NOW,
    );

    expect(recording).toMatchObject({
      kind: "video",
      title: "Utisci sa puta",
      isDiary: true,
      diaryDate: "2026-06-02",
      tags: ["put", "porodica"],
      notes: "Snimljeno na terasi.",
      transcript: "Danas smo krenuli…",
    });
  });

  it("trims the title, the tags and the label-bearing text, and leaves an empty title empty", () => {
    const recorder = store();
    const recording = recorder.create(
      audioMemo({
        title: "   ",
        tags: ["  posao  ", "posao", " ideje "],
        notes: "  beleška  ",
        transcript: "  tekst  ",
      }),
      NOW,
    );

    expect(recording.title).toBe("");
    expect(recording.tags).toEqual(["posao", "ideje"]);
    expect(recording.notes).toBe("beleška");
    expect(recording.transcript).toBe("tekst");
  });

  it("refuses a diary date that is not a real calendar day", () => {
    const recorder = store();
    expect(() =>
      recorder.create(audioMemo({ isDiary: true, diaryDate: "2026-02-30" }), NOW),
    ).toThrow(RecorderValidationError);
  });

  it.each([
    ["an unknown kind", { kind: "hologram" }],
    ["a mime outside the closed list", { mime: "video/mp4" }],
    ["a mime that is not a recording container at all", { mime: "" }],
    ["an audio mime on a video recording", { kind: "video", mime: "audio/webm;codecs=opus" }],
    ["a video mime on an audio recording", { mime: "video/webm;codecs=vp8,opus" }],
    ["a zero duration", { durationMs: 0 }],
    ["a negative duration", { durationMs: -1 }],
    ["a fractional duration", { durationMs: 1_500.5 }],
    ["a duration past the cap", { durationMs: MAX_RECORDING_DURATION_MS + 1 }],
    ["a zero size", { sizeBytes: 0 }],
    ["a negative size", { sizeBytes: -1 }],
    ["a fractional size", { sizeBytes: 1_000.5 }],
    ["a size past the cap", { sizeBytes: MAX_RECORDING_BYTES + 1 }],
    ["a sha256 that is not 64 lowercase hex characters", { sha256: "A".repeat(64) }],
    ["a short sha256", { sha256: "abc" }],
    ["an over-long title", { title: "x".repeat(MAX_RECORDING_TITLE_LENGTH + 1) }],
    ["more tags than the cap", { tags: Array.from({ length: MAX_RECORDING_TAGS + 1 }, (_, i) => `t${i}`) }],
    ["an over-long tag", { tags: ["x".repeat(MAX_RECORDING_TAG_LENGTH + 1)] }],
    ["a blank tag", { tags: ["   "] }],
    ["notes past the cap", { notes: "x".repeat(MAX_RECORDING_NOTES_LENGTH + 1) }],
    ["a transcript past the cap", { transcript: "x".repeat(MAX_RECORDING_TRANSCRIPT_LENGTH + 1) }],
    ["a diary flag with no date to file it under", { isDiary: true }],
    ["a diary date on a recording that is not a diary", { diaryDate: "2026-06-02" }],
  ])("refuses %s", (_label, overrides) => {
    const recorder = store();
    // The cast is the point: these are the shapes an untrusted caller can send,
    // and the store is what refuses them.
    expect(() => recorder.create(audioMemo(overrides as never), NOW)).toThrow(
      RecorderValidationError,
    );
  });

  it("refuses a malformed `now` — main stamps the clock, the renderer never does", () => {
    const recorder = store();
    expect(() => recorder.create(audioMemo(), "juče")).toThrow(RecorderValidationError);
  });
});

describe("RecorderStore.listActive", () => {
  it("answers newest first, with the id breaking a same-instant tie", () => {
    const recorder = store();
    const first = recorder.create(audioMemo(), NOW);
    const second = recorder.create(audioMemo(), LATER);

    expect(recorder.listActive().map((row) => row.id)).toEqual([second.id, first.id]);
  });

  it("keeps one profile's recordings out of another's list", () => {
    const mine = store();
    const theirs = store();
    mine.create(audioMemo(), NOW);

    expect(mine.listActive()).toHaveLength(1);
    expect(theirs.listActive()).toEqual([]);
  });
});

describe("RecorderStore.update", () => {
  it("patches the editable fields and stamps `updatedAt`", () => {
    const recorder = store();
    const created = recorder.create(audioMemo(), NOW);

    const updated = recorder.update(
      created.id,
      {
        title: "Sastanak",
        tags: ["posao"],
        notes: "kratka beleška",
        transcript: "prepis",
        isDiary: true,
        diaryDate: "2026-06-03",
      },
      LATER,
    );

    expect(updated).toMatchObject({
      id: created.id,
      title: "Sastanak",
      tags: ["posao"],
      notes: "kratka beleška",
      transcript: "prepis",
      isDiary: true,
      diaryDate: "2026-06-03",
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(recorder.listActive()[0]).toEqual(updated);
  });

  it("leaves the media alone: the kind, mime, duration, size and hash are the recording itself", () => {
    const recorder = store();
    const created = recorder.create(audioMemo(), NOW);

    const updated = recorder.update(
      created.id,
      { kind: "video", mime: "video/webm;codecs=vp8,opus", durationMs: 1, sizeBytes: 2, sha256: OTHER_SHA } as never,
      LATER,
    );

    expect(updated).toMatchObject({
      kind: "audio",
      mime: "audio/webm;codecs=opus",
      durationMs: 65_000,
      sizeBytes: 1_000_000,
      sha256: SHA,
    });
  });

  it("clears the diary only when the date is cleared with it", () => {
    const recorder = store();
    const created = recorder.create(
      audioMemo({ isDiary: true, diaryDate: "2026-06-02" }),
      NOW,
    );

    expect(() => recorder.update(created.id, { isDiary: false }, LATER)).toThrow(
      RecorderValidationError,
    );
    const cleared = recorder.update(
      created.id,
      { isDiary: false, diaryDate: null },
      LATER,
    );
    expect(cleared.isDiary).toBe(false);
    expect(cleared.diaryDate).toBeNull();
  });

  it("refuses a diary flag that would date itself with nothing", () => {
    const recorder = store();
    const created = recorder.create(audioMemo(), NOW);
    expect(() => recorder.update(created.id, { isDiary: true }, LATER)).toThrow(
      RecorderValidationError,
    );
  });

  it("refuses an unknown recording", () => {
    const recorder = store();
    expect(() => recorder.update("nope", { title: "x" }, LATER)).toThrow(RecorderNotFoundError);
  });
});

describe("RecorderStore soft delete and restore", () => {
  it("hides a deleted recording, keeps its markers, and brings both back on restore", () => {
    const recorder = store();
    const created = recorder.create(audioMemo(), NOW);
    const marker = recorder.addMarker(created.id, { atMs: 5_000, label: "uvod" }, NOW);

    recorder.softDelete(created.id, LATER);
    expect(recorder.listActive()).toEqual([]);
    expect(() => recorder.listMarkers(created.id)).toThrow(RecorderNotFoundError);

    recorder.restore(created.id, LATER);
    expect(recorder.listActive()).toHaveLength(1);
    expect(recorder.listMarkers(created.id)).toEqual([marker]);
  });

  it("refuses to delete what is not live, and to restore what is not deleted", () => {
    const recorder = store();
    const created = recorder.create(audioMemo(), NOW);

    expect(() => recorder.softDelete("nope", LATER)).toThrow(RecorderNotFoundError);
    expect(() => recorder.restore(created.id, LATER)).toThrow(RecorderNotFoundError);
    recorder.softDelete(created.id, LATER);
    expect(() => recorder.softDelete(created.id, LATER)).toThrow(RecorderNotFoundError);
    recorder.restore(created.id, LATER);
    expect(() => recorder.restore(created.id, LATER)).toThrow(RecorderNotFoundError);
  });
});

describe("RecorderStore markers", () => {
  it("stores markers inside the duration and answers them oldest first", () => {
    const recorder = store();
    const created = recorder.create(audioMemo({ durationMs: 60_000 }), NOW);

    const end = recorder.addMarker(created.id, { atMs: 60_000, label: "kraj" }, NOW);
    const start = recorder.addMarker(created.id, { atMs: 0, label: "  početak  " }, NOW);
    const middle = recorder.addMarker(created.id, { atMs: 30_000, label: "sredina" }, LATER);

    expect(start).toMatchObject({ atMs: 0, label: "početak", createdAt: NOW, updatedAt: NOW });
    expect(recorder.listMarkers(created.id)).toEqual([start, middle, end]);
  });

  it.each([
    ["a millisecond past the end", { atMs: 60_001, label: "x" }],
    ["a negative offset", { atMs: -1, label: "x" }],
    ["a fractional offset", { atMs: 1_000.5, label: "x" }],
    ["a blank label", { atMs: 1_000, label: "   " }],
    ["an over-long label", { atMs: 1_000, label: "x".repeat(MAX_RECORDING_LABEL_LENGTH + 1) }],
  ])("refuses %s", (_label, input) => {
    const recorder = store();
    const created = recorder.create(audioMemo({ durationMs: 60_000 }), NOW);
    expect(() => recorder.addMarker(created.id, input as never, NOW)).toThrow(
      RecorderValidationError,
    );
  });

  it("refuses a marker on a recording this profile does not have live", () => {
    const recorder = store();
    expect(() => recorder.addMarker("nope", { atMs: 0, label: "x" }, NOW)).toThrow(
      RecorderNotFoundError,
    );

    const mine = store();
    const theirs = store();
    const foreign = theirs.create(audioMemo(), NOW);
    expect(() => mine.addMarker(foreign.id, { atMs: 0, label: "x" }, NOW)).toThrow(
      RecorderNotFoundError,
    );
  });

  it("bounds how many markers one recording may carry", () => {
    const recorder = store();
    const created = recorder.create(audioMemo({ durationMs: 1_000_000 }), NOW);
    for (let index = 0; index < MAX_RECORDING_MARKERS; index += 1) {
      recorder.addMarker(created.id, { atMs: index, label: `m${index}` }, NOW);
    }

    expect(() => recorder.addMarker(created.id, { atMs: 0, label: "one too many" }, NOW)).toThrow(
      RecorderValidationError,
    );
  });

  it("moves and relabels a marker, re-validating it against the recording's duration", () => {
    const recorder = store();
    const created = recorder.create(audioMemo({ durationMs: 60_000 }), NOW);
    const marker = recorder.addMarker(created.id, { atMs: 10_000, label: "prvi" }, NOW);

    const moved = recorder.updateMarker(
      created.id,
      marker.id,
      { atMs: 20_000, label: "drugi" },
      LATER,
    );
    expect(moved).toMatchObject({
      id: marker.id,
      atMs: 20_000,
      label: "drugi",
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(() =>
      recorder.updateMarker(created.id, marker.id, { atMs: 60_001 }, LATER),
    ).toThrow(RecorderValidationError);
    expect(() => recorder.updateMarker(created.id, "nope", { label: "x" }, LATER)).toThrow(
      RecorderNotFoundError,
    );
  });

  it("removes a marker once and refuses to remove it twice", () => {
    const recorder = store();
    const created = recorder.create(audioMemo(), NOW);
    const marker = recorder.addMarker(created.id, { atMs: 1_000, label: "x" }, NOW);

    expect(recorder.removeMarker(created.id, marker.id)).toEqual(marker);
    expect(recorder.listMarkers(created.id)).toEqual([]);
    expect(() => recorder.removeMarker(created.id, marker.id)).toThrow(RecorderNotFoundError);
  });
});

describe("RecorderStore.exportData and importData", () => {
  it("round-trips every field, id and marker into a fresh database", () => {
    const source = store();
    source.create(audioMemo({ notes: "beleška", tags: ["posao"] }), NOW);
    const diary = source.create(
      {
        kind: "video",
        title: "Dan",
        mime: "video/webm;codecs=vp9,opus",
        durationMs: 120_000,
        sizeBytes: 30_000_000,
        sha256: OTHER_SHA,
        isDiary: true,
        diaryDate: "2026-06-02",
        transcript: "prepis",
      },
      LATER,
    );
    source.addMarker(diary.id, { atMs: 30_000, label: "sredina" }, LATER);

    const exported = source.exportData();
    // The real second half of this flow is another machine: a fresh database,
    // where the archive's ids are free to be themselves. Reusing an archive in
    // the SAME database is a restore of that profile, not a copy into another
    // one, because an id is unique across the whole file.
    const targetDir = mkdtempSync(join(tmpdir(), "nexus-recorder-import-"));
    const targetDb = openDatabase({ path: join(targetDir, "target.db") });
    try {
      const profileId = uuidv7();
      targetDb.raw
        .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
        .run(profileId, "personal", "Q", NOW);
      const target = new RecorderStore(targetDb.raw, profileId);

      expect(target.importData(exported)).toEqual({ recordings: 2, markers: 1 });
      // The rows are identical apart from which profile they live in, which is
      // by definition the importing one — so the comparison is over the archive
      // shape, where the profile is not a field.
      expect(target.exportData()).toEqual(exported);
      expect(target.listMarkers(diary.id)).toEqual(source.listMarkers(diary.id));
    } finally {
      targetDb.close();
      rmSync(targetDir, { recursive: true, force: true });
    }

    // The archive value is plain JSON: what it looks like after a JSON round
    // trip is what it is before one.
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
  });

  it("carries only live recordings — a soft-deleted one is not in the archive", () => {
    const recorder = store();
    const kept = recorder.create(audioMemo(), NOW);
    const thrownAway = recorder.create(audioMemo(), LATER);
    recorder.softDelete(thrownAway.id, LATER);

    const exported = recorder.exportData();
    expect(exported.recordings.map((row) => row.id)).toEqual([kept.id]);
  });

  it("replaces what the profile had, rather than adding to it", () => {
    const recorder = store();
    const kept = recorder.create(audioMemo(), NOW);
    const exported = recorder.exportData();
    recorder.create(audioMemo({ sha256: OTHER_SHA }), LATER);

    recorder.importData(exported);

    expect(recorder.listActive().map((row) => row.id)).toEqual([kept.id]);
  });

  it("refuses an unknown version before writing anything", () => {
    const recorder = store();
    const existing = recorder.create(audioMemo(), NOW);

    expect(() => recorder.importData({ version: 2, recordings: [], markers: [] })).toThrow(
      RecorderValidationError,
    );
    expect(recorder.listActive()).toEqual([existing]);
  });

  it("validates the WHOLE value before writing anything", () => {
    const source = store();
    source.create(audioMemo(), NOW);
    const exported = source.exportData();

    const recorder = store();
    const existing = recorder.create(audioMemo({ sha256: OTHER_SHA }), LATER);
    const broken = {
      ...exported,
      // A valid first row and a second row whose mime no MediaRecorder produces.
      recordings: [
        ...exported.recordings,
        { ...exported.recordings[0]!, id: "second", mime: "video/mp4" },
      ],
    };

    expect(() => recorder.importData(broken)).toThrow(RecorderValidationError);
    expect(recorder.listActive()).toEqual([existing]);
  });

  it.each([
    ["a marker beyond its recording's duration", { markers: [{ id: "m", recordingId: "R", atMs: 999_999, label: "x", createdAt: NOW, updatedAt: NOW }] }],
    ["a marker naming a recording the value does not carry", { markers: [{ id: "m", recordingId: "ghost", atMs: 0, label: "x", createdAt: NOW, updatedAt: NOW }] }],
    ["a recording whose sha256 is malformed", { recordings: [{ id: "R", kind: "audio", title: "", createdAt: NOW, durationMs: 1_000, mime: "audio/webm;codecs=opus", sizeBytes: 1, sha256: "nope", tags: [], notes: "", isDiary: false, diaryDate: null, transcript: "", updatedAt: NOW }] }],
    ["a value whose recordings are not a list", { recordings: "nope" }],
  ])("refuses %s", (_label, patch) => {
    const recorder = store();
    const exported = recorder.exportData();
    const base = {
      ...exported,
      recordings: [
        // A real row the archive has to accept, so only the patched half can fail.
        {
          id: "R",
          kind: "audio",
          title: "",
          createdAt: NOW,
          durationMs: 60_000,
          mime: "audio/webm;codecs=opus",
          sizeBytes: 1_000,
          sha256: SHA,
          tags: [],
          notes: "",
          isDiary: false,
          diaryDate: null,
          transcript: "",
          updatedAt: NOW,
        },
      ],
      markers: [] as unknown[],
      ...patch,
    };

    expect(() => recorder.importData(base)).toThrow(RecorderValidationError);
    expect(recorder.listActive()).toEqual([]);
  });
});
