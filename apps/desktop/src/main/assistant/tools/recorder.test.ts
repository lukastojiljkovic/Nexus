import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, RecorderStore, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import { recorderTools } from "./recorder.js";

/**
 * The RECORDER tool over a real database.
 *
 * What it pins is the day rule: the module groups recordings by the first ten
 * characters of the stored instant, so „what did I record yesterday" means the
 * instant's own date part and not a local-zone conversion — the heading a user
 * is looking at and this answer must name the same day.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();
/** The day before the fixed clock, which is what the „yesterday" case asks for. */
const YESTERDAY_ISO = new Date(2026, 9, 9, 21, 30, 0).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-recorder-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function store(): RecorderStore {
  return new RecorderStore(db.raw, profileId);
}

function context(locale: "sr" | "en"): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

function tool(): Tool {
  const found = recorderTools({ profileDb: (id, open) => open(db.raw, id) }).find(
    (entry) => entry.name === "recorder.list",
  );
  if (found === undefined) throw new Error('Test setup: no tool "recorder.list".');
  return found;
}

/** One voice memo of 65 seconds, tagged, made at the instant given. */
function seedMemo(title: string, createdAt: string): void {
  store().create(
    {
      kind: "audio",
      title,
      mime: "audio/webm;codecs=opus",
      durationMs: 65_000,
      sizeBytes: 24_000,
      sha256: "a".repeat(64),
      tags: ["glas"],
    },
    createdAt,
  );
}

describe("recorder.list", () => {
  it("reads a memo with its day, its time, its length and its tags", async () => {
    seedMemo("Ideja", NOW_ISO);
    const result = await tool().run({}, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: ["Snimci (1):", "- Ideja — 10. oktobar 2026, 09:00 (zvuk, 1 min 5 s, oznake: glas)"].join(
        "\n",
      ),
    });
  });

  it("keeps to one day when the user names one", async () => {
    seedMemo("Juče", YESTERDAY_ISO);
    seedMemo("Danas", NOW_ISO);

    const yesterday = await tool().run({ day: "2026-10-09" }, context("en"));
    expect(yesterday).toEqual({
      ok: true,
      content: ["Recordings (1):", "- Juče — 9 October 2026, 21:30 (sound, 1 min 5 s, tags: glas)"].join(
        "\n",
      ),
    });

    const none = await tool().run({ day: "2026-10-01" }, context("en"));
    expect(none).toEqual({ ok: true, content: "There is no recording from 1 October 2026." });
  });

  it("folds the query, and says when there is nothing at all", async () => {
    seedMemo("Šetnja", NOW_ISO);
    const folded = await tool().run({ query: "setnja" }, context("en"));
    expect(folded).toEqual({
      ok: true,
      content: ["Recordings (1):", "- Šetnja — 10 October 2026, 09:00 (sound, 1 min 5 s, tags: glas)"].join(
        "\n",
      ),
    });

    const none = await tool().run({ query: "planina" }, context("sr"));
    expect(none).toEqual({
      ok: true,
      content: "Nijedan snimak ne odgovara pretrazi „planina“.",
    });
  });

  it("names a recording with no title by the moment it was made", async () => {
    seedMemo("", NOW_ISO);
    const result = await tool().run({}, context("en"));
    expect(result.content).toBe(
      ["Recordings (1):", "- 10 October 2026, 09:00 (sound, 1 min 5 s, tags: glas)"].join("\n"),
    );
  });
});
