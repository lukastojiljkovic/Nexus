/**
 * Making a merged row legal for the local schema (DC-14).
 *
 * ─── The problem, in one sentence ───────────────────────────────────────────
 *
 * Field-level LWW decides every column on its own, and eleven table-level CHECKs
 * over synced collections read TWO columns together. Two honest edits on two
 * devices therefore merge into a row SQLite refuses to write — and „refuses to
 * write" is worse than „wrong", because the row cannot be applied at all and the
 * device it fails on is the one that looks broken. `COLLECTION_COUPLED` in
 * `projection.ts` is the ledger of every such pair, checked against the real
 * schema in both directions by `@nexus/db`'s `collectionGuard.test.ts`.
 *
 * ─── The repair fixes the PROJECTION, never the `RowState` ──────────────────
 *
 * This is the decision the whole file rests on, and it is what makes the repair
 * safe rather than merely legal.
 *
 * `sync_row_state` keeps the merged state exactly as `mergeRows` produced it:
 * both columns, both values, both real stamps. What gets repaired is the row
 * written into the module table — a legal *view* of that state. Three things
 * follow, and all three are load-bearing:
 *
 *  - **No new stamps.** A repair that stamped a field would be a write, and a
 *    write echoes: the journal would push it back, the peer would merge it, and
 *    two devices inventing two stamps for „the same" repair diverge forever.
 *    Here the repair produces no state at all, so there is nothing to push.
 *  - **Nothing is lost.** The column the repair hides is still in the state with
 *    its stamp. Switch a card back to `cloze` and its text is there again,
 *    because it never went anywhere. A repair that edited the state would have
 *    destroyed the loser's edit permanently, on every device, for a conflict the
 *    user never saw.
 *  - **A real fix always wins.** When the user actually resolves it, that is an
 *    ordinary edit with an ordinary stamp, newer than both, and the repair stops
 *    firing because the state is legal.
 *
 * ─── Determinism is the requirement, not the goal ──────────────────────────
 *
 * Every device must compute the SAME repaired row from the same merged state, or
 * the two of them diverge over a row neither can fix. So every decision here
 * reads only two things: the merged values, and the per-field HLC stamps through
 * `compareHlc`, which is a total order (wall clock, then counter, then node id)
 * and therefore cannot tie. Nothing reads the local clock, the device, or which
 * side happened to arrive first.
 *
 * ─── „Newest wins" is not the rule, because it cannot always be honoured ────
 *
 * The tempting general rule is „the newer-stamped column wins and the other
 * gives way". It is right where both directions are reachable — a transfer that
 * also has a category, a semester whose two dates crossed. It is wrong wherever
 * honouring the newer column would require INVENTING the user's data: a card
 * whose `kind` says `cloze` with no cloze text needs text nobody wrote, and
 * there is no honest value to put there. In those cases the pair collapses the
 * only way that invents nothing, which is usually to null.
 *
 * So the repairs are written per table rather than per CHECK. `cards` has three
 * CHECKs that all read `kind`, and repairing them independently lets one undo
 * another; one function that settles `kind` first and then projects the three
 * dependents is both correct and shorter.
 *
 * Exactly one repair invents anything: `focus_sessions` needs `ended_at >
 * started_at` STRICTLY, so a session that merged into zero or negative length
 * gets one millisecond. It is marked at its call site, and a one-millisecond
 * session reads as the repair artefact it is rather than as a plausible number.
 */

import { compareHlc, type JsonValue, type RowState } from "@nexus/sync-crypto/web";

/** A repair: the projected columns in, the legal columns out. Pure. */
export type CoupledRepair = (
  columns: Record<string, JsonValue>,
  state: RowState,
) => Record<string, JsonValue>;

/**
 * Which of two fields carries the newer stamp.
 *
 * A field absent from the state has never been set and is treated as oldest —
 * `mergeRows` only ever produces fields somebody wrote, so absence means „no
 * writer has an opinion", which must not beat one who does. Comparing by
 * `compareHlc` rather than by wall time is the point: two devices in the same
 * millisecond are still totally ordered by counter and node id, and a tie would
 * be exactly the case where the two of them repair a row differently.
 */
function newer(state: RowState, left: string, right: string): string {
  const a = state.fields[left];
  const b = state.fields[right];
  if (a === undefined) return right;
  if (b === undefined) return left;
  return compareHlc(a.at, b.at) >= 0 ? left : right;
}

/** `null` and `undefined` alike — a column the projection never carried is absent, not empty. */
function absent(value: JsonValue | undefined): boolean {
  return value === null || value === undefined;
}

/**
 * Assign — but never INTRODUCE a column the row did not already carry.
 *
 * `deriveColumns` builds its output from the fields the merged state actually
 * holds, so a repair that wrote `problem_steps: null` onto a row without that
 * field would not be repairing anything; it would be adding a column to the
 * UPDATE, and the apply path would clear a value nobody merged. Every repair
 * assigns through here, so the class cannot be reintroduced one repair at a time.
 */
function set(out: Record<string, JsonValue>, name: string, value: JsonValue): void {
  if (name in out) out[name] = value;
}

/** An ISO instant as milliseconds, or `null` for anything that is not one. */
function instant(value: JsonValue | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const REPAIRS: Readonly<Record<string, CoupledRepair>> = {
  /**
   * Three CHECKs, all reading `kind`, so one function settles `kind` and then
   * projects the other three columns onto it:
   *
   *   (kind = 'cloze') = (cloze_text IS NOT NULL)
   *   (kind = 'cloze') = (cloze_ordinal IS NOT NULL) AND (cloze_ordinal >= 0)
   *   problem_steps IS NULL OR (kind = 'basic' AND length(problem_steps) > 0)
   *
   * `kind` is the anchor rather than the newest stamp because the other three
   * columns are meaningless except relative to it — „cloze text" on a basic card
   * is not a smaller truth, it is not a truth. And a card can only BE a cloze if
   * it has both the text and the ordinal, neither of which can be invented, so a
   * `kind` of `cloze` missing either falls back to `basic`.
   */
  cards(columns, _state) {
    const out = { ...columns };
    const hasText = !absent(out["cloze_text"]);
    const hasOrdinal = !absent(out["cloze_ordinal"]);
    const cloze = out["kind"] === "cloze" && hasText && hasOrdinal;

    set(out, "kind", cloze ? "cloze" : "basic");
    if (cloze) {
      const ordinal = out["cloze_ordinal"];
      // `>= 0` is part of the same CHECK. A negative ordinal cannot arrive from
      // this app, but it can arrive from a peer, and the row would be refused
      // for a reason that has nothing to do with the merge.
      set(out, "cloze_ordinal", typeof ordinal === "number" ? Math.max(0, Math.trunc(ordinal)) : 0);
      set(out, "problem_steps", null);
    } else {
      set(out, "cloze_text", null);
      set(out, "cloze_ordinal", null);
      // `length(problem_steps) > 0` — an empty string is refused, and an empty
      // string is what a cleared textarea sends.
      const steps = out["problem_steps"];
      set(out, "problem_steps", typeof steps === "string" && steps.length > 0 ? steps : null);
    }
    return out;
  },

  /**
   * `ended_at > started_at`, strictly.
   *
   * Both are times a user set, so neither can be dropped to null — the columns
   * are NOT NULL and a session with no end is not a session. The newer stamp is
   * honoured and the older one moves the smallest legal distance: **one
   * millisecond**, the only invention in this file. A session that reads as one
   * millisecond long is visibly an artefact, which is the intent; a repair that
   * guessed a plausible duration would bury the conflict instead of showing it.
   */
  focus_sessions(columns, state) {
    const started = instant(columns["started_at"]);
    const ended = instant(columns["ended_at"]);
    if (started === null || ended === null || ended > started) return columns;

    const out = { ...columns };
    if (newer(state, "ended_at", "started_at") === "ended_at") {
      set(out, "started_at", new Date(ended - 1).toISOString());
    } else {
      set(out, "ended_at", new Date(started + 1).toISOString());
    }
    return out;
  },

  /**
   * `semester_start IS NULL OR semester_end IS NULL OR semester_start <=
   * semester_end`.
   *
   * Unlike a focus session, null is LEGAL here, which makes the honest repair
   * available: the older-stamped date is cleared rather than moved. „The
   * semester has no end date yet" is a state the product already draws and the
   * user already knows how to fix; a date silently shifted to make an inequality
   * pass is a date they would have to notice was wrong.
   */
  calendar_settings(columns, state) {
    const start = columns["semester_start"];
    const end = columns["semester_end"];
    // Both are `TEXT` dates in `YYYY-MM-DD`, which SQLite compares as strings and
    // so does this. Anything that is not a string is not a date the CHECK can
    // refuse either, and guessing at one would be the invention this file avoids.
    if (typeof start !== "string" || typeof end !== "string" || start <= end) return columns;

    const out = { ...columns };
    set(
      out,
      newer(state, "semester_start", "semester_end") === "semester_start"
        ? "semester_end"
        : "semester_start",
      null,
    );
    return out;
  },

  /**
   * The wallpaper is three columns holding ONE fact, bound by two CHECKs:
   *
   *   (background_hash IS NULL) = (background_mime IS NULL)
   *   (background_hash IS NULL) = (background_size_bytes IS NULL)
   *
   * so they are repaired together, anchored on the hash — the column that names
   * the actual file. A hash whose mime or size went missing describes a file
   * nothing can render, and a mime or size with no hash describes no file at
   * all. Both collapse to „no wallpaper", which is a state the settings card
   * draws and the user can fix in one click, and the state still holds every
   * value for the moment the other device's half arrives.
   */
  dashboard_settings(columns, _state) {
    const out = { ...columns };
    const size = out["background_size_bytes"];
    const complete =
      !absent(out["background_hash"]) &&
      !absent(out["background_mime"]) &&
      typeof size === "number" &&
      // `background_size_bytes IS NULL OR background_size_bytes > 0` — the third
      // CHECK on the same three columns, and a zero-byte wallpaper is no file.
      size > 0;
    if (complete) return columns;

    set(out, "background_hash", null);
    set(out, "background_mime", null);
    set(out, "background_size_bytes", null);
    return out;
  },

  /**
   * Two CHECKs that meet on `counter_account_id`:
   *
   *   counter_account_id IS NULL OR counter_account_id <> account_id
   *   counter_account_id IS NULL OR category_id IS NULL
   *
   * The first has only one legal move — a transfer from an account to itself
   * would count twice in every balance, and `account_id` is NOT NULL — so the
   * counter-account is cleared and the row becomes an ordinary entry.
   *
   * The second is a genuine either/or: a transfer has no category, and a
   * categorised row is not a transfer. Both directions are reachable without
   * inventing anything, so the newer stamp decides, and the order matters — the
   * first repair can clear the counter-account and settle the second by itself.
   */
  fin_transactions(columns, state) {
    const out = { ...columns };
    if (!absent(out["counter_account_id"]) && out["counter_account_id"] === out["account_id"]) {
      set(out, "counter_account_id", null);
    }
    if (!absent(out["counter_account_id"]) && !absent(out["category_id"])) {
      set(
        out,
        newer(state, "counter_account_id", "category_id") === "counter_account_id"
          ? "category_id"
          : "counter_account_id",
        null,
      );
    }
    return out;
  },

  /**
   * `unit IS NULL OR target IS NOT NULL`.
   *
   * One-directional: a unit needs something to measure, and a target cannot be
   * invented — „5" of what, and why 5. So a unit left without a target is
   * cleared and the habit reads as the plain tick it has become. The target's
   * own edit is untouched in either direction.
   */
  habits(columns, _state) {
    if (absent(columns["unit"]) || !absent(columns["target"])) return columns;
    const out = { ...columns };
    set(out, "unit", null);
    return out;
  },

  /**
   * `(muscle_unit IS NULL) = (muscle_value IS NULL)`.
   *
   * A reading and its unit are one measurement: „18" is not a body-fat figure
   * until something says whether it is percent or kilograms, and „percent" alone
   * measures nothing. Half a reading is not a smaller reading, so both halves
   * go and the state keeps both for whichever device supplies the other.
   */
  fit_measurements(columns, _state) {
    const unit = absent(columns["muscle_unit"]);
    const value = absent(columns["muscle_value"]);
    if (unit === value) return columns;
    const out = { ...columns };
    set(out, "muscle_unit", null);
    set(out, "muscle_value", null);
    return out;
  },
};

/**
 * The legal form of one merged row's columns for `table`, or the columns
 * unchanged where that table has no coupled CHECK.
 *
 * Called by `deriveColumns`, so every path that turns a `RowState` into local
 * columns goes through it and no caller can forget. Idempotent by construction:
 * repairing an already-legal row returns it untouched, which is what lets the
 * apply path re-derive a row without walking it further from the state.
 */
export function repairCoupled(
  table: string,
  columns: Record<string, JsonValue>,
  state: RowState,
): Record<string, JsonValue> {
  const repair = REPAIRS[table];
  return repair === undefined ? columns : repair(columns, state);
}

/** The tables that have one. Exported so a test can hold it against the ledger. */
export const REPAIRED_TABLES: readonly string[] = Object.keys(REPAIRS);
