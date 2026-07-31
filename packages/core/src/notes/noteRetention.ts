/**
 * Tiered age thinning for a note's version history (NOTE-008 / ADR-015) — the
 * rule that decides WHICH checkpoints of a note survive, given only their
 * capture times and the caller's clock. Pure and clock-parameterized like every
 * other rule in `@nexus/core`: no clock, no IO, no database, so the schedule can
 * be read (and tested) as a table of cases rather than inferred from SQL.
 *
 * The rule it replaces was a flat window — keep the newest N, drop the rest —
 * and a flat window is not a history. A note edited hard for one afternoon
 * pushed out every checkpoint from the months before it; a note edited twice a
 * year kept two checkpoints two years apart. What a history is actually asked
 * for is dense detail near the present and a thinning-but-unbroken trail behind
 * it, so that is what the tiers describe:
 *
 * - **every** checkpoint from the last 24 hours,
 * - **one per hour** for the last 7 days,
 * - **one per day** for the last 30 days,
 * - **one per week** beyond that.
 *
 * Two rules sit on top of the tiers:
 *
 * - **The newest in a bucket wins.** It is the state that actually persisted
 *   through that hour/day/week — the others are keystrokes on the way to it.
 *   (It is also what makes the schedule idempotent: see below.)
 * - **The oldest surviving checkpoint is never dropped.** "Where this note
 *   started" is the row a history is most often opened for, and a schedule that
 *   eventually eats it is a schedule that quietly deletes the past. It is the
 *   anchor, and it survives every tier and the cap alike.
 *
 * **Determinism and idempotence.** Buckets are keyed by *age* (`now - capturedAt`)
 * floored to the tier's width and namespaced by tier index, so the same input
 * and the same `now` always produce the same answer, and re-running the schedule
 * over its own survivors with the same clock drops nothing: each bucket already
 * holds at most one row, and that row is already the newest of its bucket.
 *
 * **The cap is a backstop, not the schedule.** `maxKept` (the note store's
 * `MAX_NOTE_VERSIONS`) bounds how many rows may survive at all; the tiers decide
 * which. In practice **the tiers are what bind** — at main's ~10-minute capture
 * cadence a note's tier survivors sit well under the cap until its history is
 * both long and dense — and when the cap does bind it does NOT truncate the
 * tail (that would restore the very defect this replaces: one busy afternoon
 * eating a year of history). Instead the whole schedule is *coarsened* a rung
 * at a time — every tier's span halved, every tier's bucket doubled — and
 * re-applied, so pressure is paid by fine recent detail rather than by the old
 * trail. Each rung is a strict coarsening of the one below it (spans only
 * shrink, widths only double, and every width is an exact multiple of the
 * finer ones), which is what keeps the result idempotent no matter how many
 * rungs were climbed.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * One rung of the retention schedule: every checkpoint younger than `maxAgeMs`
 * that no earlier tier claimed is bucketed `bucketMs` wide, and one survives
 * per bucket. `bucketMs === 0` means "no bucketing" — every checkpoint is its
 * own bucket, i.e. keep them all.
 */
export interface NoteVersionRetentionTier {
  /** Exclusive upper bound on age, in ms; the final tier's is infinite so every checkpoint lands somewhere. */
  maxAgeMs: number;
  /** Bucket width in ms, or 0 for "keep every checkpoint in this tier". */
  bucketMs: number;
}

/** The schedule, finest first. Checkpoints are matched against it in order. */
export const NOTE_VERSION_RETENTION_TIERS: readonly NoteVersionRetentionTier[] = [
  { maxAgeMs: MS_PER_DAY, bucketMs: 0 },
  { maxAgeMs: 7 * MS_PER_DAY, bucketMs: MS_PER_HOUR },
  { maxAgeMs: 30 * MS_PER_DAY, bucketMs: MS_PER_DAY },
  { maxAgeMs: Number.POSITIVE_INFINITY, bucketMs: 7 * MS_PER_DAY },
];

/**
 * A tier whose span has been coarsened below this is dropped outright (span 0
 * matches nothing), rather than lingering as a sub-minute "keep everything"
 * band no capture cadence could ever populate.
 */
const MIN_TIER_SPAN_MS = MS_PER_MINUTE;

/**
 * How far the coarsening ladder may climb. It is a bound, not the exit: sixteen
 * rungs already reduce the schedule to its last tier alone with a bucket
 * spanning centuries — one survivor plus the anchor — so the loop ends on the
 * cap long before it ends on this.
 */
const MAX_COARSENING_ROUNDS = 32;

/** One checkpoint as the schedule sees it: an identity and a capture time. The bytes are none of its business. */
export interface NoteVersionCheckpoint {
  /** The checkpoint's identity — `note_versions.covered_seq` for `NoteStore`. */
  coveredSeq: number;
  /** When it was captured, epoch ms. */
  capturedAt: number;
}

export interface ThinNoteVersionsInput {
  /** The note's checkpoints, in any order. Never mutated. */
  checkpoints: readonly NoteVersionCheckpoint[];
  /** Epoch ms, the caller's clock. */
  now: number;
  /** The hard backstop on survivors (`MAX_NOTE_VERSIONS`). Values below 2 are read as 2 — the newest checkpoint and the anchor are both unconditional. */
  maxKept: number;
}

/** Both halves of the answer, each newest-capture-first, together covering the input exactly once. */
export interface ThinNoteVersionsResult {
  keep: readonly number[];
  drop: readonly number[];
}

/**
 * Decides which of a note's checkpoints survive. Reads no clock, touches no
 * input, and answers the same thing every time for the same `now`.
 */
export function thinNoteVersions(input: ThinNoteVersionsInput): ThinNoteVersionsResult {
  const newestFirst = [...input.checkpoints].sort(
    (a, b) => b.capturedAt - a.capturedAt || b.coveredSeq - a.coveredSeq,
  );
  const anchor = newestFirst.at(-1);
  if (anchor === undefined) return { keep: [], drop: [] };

  const cap = Math.max(2, Math.trunc(input.maxKept));
  let tiers = NOTE_VERSION_RETENTION_TIERS;
  let survivors = select(newestFirst, input.now, tiers, anchor);
  for (let round = 0; survivors.size > cap && round < MAX_COARSENING_ROUNDS; round += 1) {
    tiers = coarsen(tiers);
    survivors = select(newestFirst, input.now, tiers, anchor);
  }

  return {
    keep: newestFirst.filter((c) => survivors.has(c.coveredSeq)).map((c) => c.coveredSeq),
    drop: newestFirst.filter((c) => !survivors.has(c.coveredSeq)).map((c) => c.coveredSeq),
  };
}

/**
 * The tier pass: one survivor per bucket — the first claimant, which is the
 * newest because the input is sorted newest first — plus the anchor, which is
 * kept whether or not it won its own bucket.
 */
function select(
  newestFirst: readonly NoteVersionCheckpoint[],
  now: number,
  tiers: readonly NoteVersionRetentionTier[],
  anchor: NoteVersionCheckpoint,
): Set<number> {
  const claimed = new Set<string>();
  const survivors = new Set<number>([anchor.coveredSeq]);

  for (const checkpoint of newestFirst) {
    // A stamp from the future is "now", not "ancient": clamping keeps a skewed
    // clock from filing a fresh checkpoint under the coarsest tier.
    const age = Math.max(0, now - checkpoint.capturedAt);
    for (const [index, tier] of tiers.entries()) {
      if (age >= tier.maxAgeMs) continue;
      // The tier index namespaces the key so an hour bucket and a day bucket
      // can never collide on the same number.
      const bucket = tier.bucketMs === 0 ? checkpoint.coveredSeq : Math.floor(age / tier.bucketMs);
      const key = `${index}:${bucket}`;
      if (!claimed.has(key)) {
        claimed.add(key);
        survivors.add(checkpoint.coveredSeq);
      }
      break;
    }
  }
  return survivors;
}

/**
 * One rung coarser: every span halved (and dropped once it falls under
 * `MIN_TIER_SPAN_MS`), every bucket doubled. Both moves only ever merge buckets
 * that the finer schedule kept apart, which is what makes the ladder a
 * refinement chain and the result idempotent.
 */
function coarsen(tiers: readonly NoteVersionRetentionTier[]): readonly NoteVersionRetentionTier[] {
  return tiers.map((tier) => {
    const halved = tier.maxAgeMs / 2;
    return {
      maxAgeMs: halved < MIN_TIER_SPAN_MS ? 0 : halved,
      bucketMs: tier.bucketMs * 2,
    };
  });
}
