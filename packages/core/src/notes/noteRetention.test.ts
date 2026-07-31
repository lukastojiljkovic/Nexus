import { describe, expect, it } from "vitest";
import { NOTE_VERSION_RETENTION_TIERS, thinNoteVersions } from "./noteRetention.js";
import type { NoteVersionCheckpoint } from "./noteRetention.js";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const NOW = Date.parse("2026-07-31T12:00:00.000Z");

/** The cap the note store passes (`MAX_NOTE_VERSIONS`); spelled out here so this suite never imports `@nexus/db`. */
const CAP = 50;

/**
 * A checkpoint `ageMs` old. `coveredSeq` is derived from the age so the
 * assertions can name rows by age alone: older row, lower seq — exactly the
 * monotonic relationship `note_versions` guarantees.
 */
function at(ageMs: number): NoteVersionCheckpoint {
  return { coveredSeq: 10_000_000 - Math.round(ageMs / MINUTE), capturedAt: NOW - ageMs };
}

/** The ages (newest first) that survived, so expectations read in the same units the schedule is written in. */
function keptAges(checkpoints: readonly NoteVersionCheckpoint[], maxKept = CAP): number[] {
  const { keep } = thinNoteVersions({ checkpoints, now: NOW, maxKept });
  const bySeq = new Map(checkpoints.map((c) => [c.coveredSeq, NOW - c.capturedAt]));
  return keep.map((seq) => bySeq.get(seq) ?? -1);
}

describe("thinNoteVersions — the tiered retention schedule (ADR-015 / NOTE-008)", () => {
  it("returns nothing for no checkpoints", () => {
    expect(thinNoteVersions({ checkpoints: [], now: NOW, maxKept: CAP })).toEqual({
      keep: [],
      drop: [],
    });
  });

  it("keeps a lone checkpoint, whatever its age", () => {
    for (const age of [0, 3 * DAY, 400 * DAY]) {
      const only = at(age);
      expect(thinNoteVersions({ checkpoints: [only], now: NOW, maxKept: CAP })).toEqual({
        keep: [only.coveredSeq],
        drop: [],
      });
    }
  });

  it("keeps EVERY checkpoint from the last 24 hours, however dense", () => {
    const checkpoints = Array.from({ length: 40 }, (_, i) => at(i * 30 * MINUTE));

    expect(keptAges(checkpoints)).toEqual(checkpoints.map((c) => NOW - c.capturedAt));
  });

  it("thins to one per hour between 24 hours and 7 days, keeping the newest of each hour", () => {
    // Three checkpoints inside the same hour bucket, one in the next.
    const checkpoints = [
      at(25 * HOUR),
      at(25 * HOUR + 20 * MINUTE),
      at(25 * HOUR + 40 * MINUTE),
      at(26 * HOUR),
      at(90 * DAY), // the anchor, so the hour-bucket assertions are not distorted by it
    ];

    expect(keptAges(checkpoints)).toEqual([25 * HOUR, 26 * HOUR, 90 * DAY]);
  });

  it("thins to one per day between 7 and 30 days", () => {
    const checkpoints = [
      at(8 * DAY),
      at(8 * DAY + 6 * HOUR),
      at(8 * DAY + 18 * HOUR),
      at(9 * DAY),
      at(90 * DAY),
    ];

    expect(keptAges(checkpoints)).toEqual([8 * DAY, 9 * DAY, 90 * DAY]);
  });

  it("thins to one per week beyond 30 days", () => {
    const checkpoints = [at(35 * DAY), at(40 * DAY), at(100 * DAY)];

    // 35d and 40d share the sixth week bucket; the newer of the two survives.
    expect(keptAges(checkpoints)).toEqual([35 * DAY, 100 * DAY]);
  });

  it("crosses every tier at once without letting one tier's bucket numbers collide with another's", () => {
    const checkpoints = [
      at(1 * HOUR),
      at(2 * HOUR), // both inside 24h — both survive
      at(30 * HOUR),
      at(30 * HOUR + 30 * MINUTE), // one hour bucket
      at(10 * DAY),
      at(10 * DAY + 3 * HOUR), // one day bucket
      at(60 * DAY),
      at(62 * DAY), // one week bucket
      at(300 * DAY),
    ];

    expect(keptAges(checkpoints)).toEqual([
      1 * HOUR,
      2 * HOUR,
      30 * HOUR,
      10 * DAY,
      60 * DAY,
      300 * DAY,
    ]);
  });

  it("never drops the oldest surviving checkpoint, even when a newer sibling wins its bucket", () => {
    // 200d and 202d fall in the same week bucket; without the anchor rule the
    // note's very first checkpoint would lose it to the newer one.
    const checkpoints = [at(1 * HOUR), at(200 * DAY), at(202 * DAY)];

    expect(keptAges(checkpoints)).toEqual([1 * HOUR, 200 * DAY, 202 * DAY]);
  });

  it("keeps the anchor even when the cap forces the schedule to coarsen", () => {
    const recent = Array.from({ length: 200 }, (_, i) => at(i * 5 * MINUTE));
    const anchor = at(500 * DAY);
    const { keep } = thinNoteVersions({
      checkpoints: [...recent, anchor],
      now: NOW,
      maxKept: CAP,
    });

    expect(keep).toContain(anchor.coveredSeq);
    expect(keep.length).toBeLessThanOrEqual(CAP);
  });

  it("orders keep and drop newest first, and every checkpoint lands in exactly one of them", () => {
    const checkpoints = [at(0), at(26 * HOUR), at(26 * HOUR + 10 * MINUTE), at(9 * DAY), at(80 * DAY)];
    const { keep, drop } = thinNoteVersions({ checkpoints, now: NOW, maxKept: CAP });

    expect([...keep].sort((a, b) => b - a)).toEqual(keep);
    expect([...drop].sort((a, b) => b - a)).toEqual(drop);
    expect([...keep, ...drop].sort((a, b) => b - a)).toEqual(
      checkpoints.map((c) => c.coveredSeq).sort((a, b) => b - a),
    );
  });

  it("is deterministic: the same input and clock give byte-identical results", () => {
    const checkpoints = [at(0), at(3 * HOUR), at(26 * HOUR), at(27 * HOUR), at(9 * DAY), at(80 * DAY)];
    const first = thinNoteVersions({ checkpoints, now: NOW, maxKept: CAP });
    const second = thinNoteVersions({ checkpoints: [...checkpoints], now: NOW, maxKept: CAP });

    expect(second).toEqual(first);
  });

  it("is idempotent: thinning the survivors again with the same clock drops nothing", () => {
    const checkpoints = [
      ...Array.from({ length: 60 }, (_, i) => at(i * 20 * MINUTE)),
      ...Array.from({ length: 40 }, (_, i) => at(2 * DAY + i * 90 * MINUTE)),
      ...Array.from({ length: 20 }, (_, i) => at(10 * DAY + i * 8 * HOUR)),
      ...Array.from({ length: 30 }, (_, i) => at(40 * DAY + i * 3 * DAY)),
    ];

    const first = thinNoteVersions({ checkpoints, now: NOW, maxKept: CAP });
    const survivors = checkpoints.filter((c) => first.keep.includes(c.coveredSeq));
    const second = thinNoteVersions({ checkpoints: survivors, now: NOW, maxKept: CAP });

    expect(second.drop).toEqual([]);
    expect(second.keep).toEqual(first.keep);
  });

  it("never returns more than maxKept", () => {
    const checkpoints = Array.from({ length: 400 }, (_, i) => at(i * 11 * MINUTE));

    expect(thinNoteVersions({ checkpoints, now: NOW, maxKept: CAP }).keep.length).toBeLessThanOrEqual(
      CAP,
    );
  });

  it("coarsens the schedule under the cap instead of truncating its tail — a dense day never eats the months", () => {
    // 60 checkpoints across one working day is already past the cap on its own.
    const burst = Array.from({ length: 60 }, (_, i) => at(i * 20 * MINUTE));
    const old = [at(40 * DAY), at(100 * DAY), at(300 * DAY)];

    const kept = keptAges([...burst, ...old]);

    expect(kept).toContain(40 * DAY);
    expect(kept).toContain(100 * DAY);
    expect(kept).toContain(300 * DAY);
    expect(kept.length).toBeLessThanOrEqual(CAP);
    // The burst is what gave ground: it is no longer kept in full.
    expect(kept.filter((age) => age < DAY).length).toBeLessThan(burst.length);
  });

  it("coarsens all the way down to the newest plus the anchor when the cap leaves no room", () => {
    const newest = at(0);
    const middle = Array.from({ length: 28 }, (_, i) => at((i + 1) * 3 * DAY));
    const anchor = at(29 * 3 * DAY);

    const { keep } = thinNoteVersions({
      checkpoints: [newest, ...middle, anchor],
      now: NOW,
      maxKept: 2,
    });

    expect(keep).toEqual([newest.coveredSeq, anchor.coveredSeq]);
  });

  it("treats a maxKept below 2 as 2 — the newest and the anchor are both unconditional", () => {
    const newest = at(0);
    const middle = at(5 * DAY);
    const anchor = at(400 * DAY);

    expect(
      thinNoteVersions({ checkpoints: [newest, middle, anchor], now: NOW, maxKept: 0 }).keep,
    ).toEqual([newest.coveredSeq, anchor.coveredSeq]);
  });

  it("treats a checkpoint stamped in the future as present rather than ancient", () => {
    const future = { coveredSeq: 99, capturedAt: NOW + 5 * DAY };
    const checkpoints = [future, at(0), at(300 * DAY)];

    const { keep } = thinNoteVersions({ checkpoints, now: NOW, maxKept: CAP });
    expect(keep).toContain(99);
    expect(keep).toHaveLength(3);
  });

  it("does not mutate its input", () => {
    const checkpoints = [at(0), at(26 * HOUR), at(27 * HOUR), at(300 * DAY)];
    const before = structuredClone(checkpoints);

    thinNoteVersions({ checkpoints, now: NOW, maxKept: CAP });

    expect(checkpoints).toEqual(before);
  });

  it("publishes the schedule the brief names: everything for a day, hourly for a week, daily for a month, weekly after", () => {
    expect(NOTE_VERSION_RETENTION_TIERS.map((tier) => [tier.maxAgeMs, tier.bucketMs])).toEqual([
      [DAY, 0],
      [7 * DAY, HOUR],
      [30 * DAY, DAY],
      [Number.POSITIVE_INFINITY, 7 * DAY],
    ]);
  });
});
