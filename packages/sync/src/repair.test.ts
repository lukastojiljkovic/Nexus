import { describe, expect, it } from "vitest";
import { hlcSend, hlcZero, type Hlc, type JsonValue, type RowState } from "@nexus/sync-crypto";
import { classify, type SyncCollection } from "./collections.js";
import { COLLECTION_COUPLED, deriveColumns } from "./projection.js";
import { repairCoupled, REPAIRED_TABLES } from "./repair.js";

const T1 = hlcSend(hlcZero("device-a"), 1_000);
const T2 = hlcSend(hlcZero("device-a"), 2_000);

/**
 * A `RowState` carrying just the stamps a repair reads.
 *
 * The values are irrelevant to every repair — they read the merged COLUMNS,
 * which is what the local row will hold — so the state is built from stamps
 * alone. That is not a shortcut: a repair that needed a value from the state
 * rather than from the columns would be reading around `deriveColumns`, and the
 * `tasks.completed_at` derivation happens between them.
 */
function stamps(fields: Record<string, Hlc>): RowState {
  return {
    version: 1,
    fields: Object.fromEntries(
      Object.entries(fields).map(([name, at]) => [name, { value: null, at }]),
    ),
    deleted: { value: false, at: T1 },
  };
}

const NO_STAMPS = stamps({});

/** `repairCoupled`, plus the assertion every repair owes: doing it twice changes nothing. */
function repair(
  table: string,
  columns: Record<string, JsonValue>,
  state: RowState = NO_STAMPS,
): Record<string, JsonValue> {
  const once = repairCoupled(table, columns, state);
  expect(repairCoupled(table, once, state)).toEqual(once);
  return once;
}

describe("repairCoupled — the ledger", () => {
  it("has a repair for every table with a coupled CHECK, and no others", () => {
    // Both directions on purpose. A repair missing from a listed table is a row
    // SQLite refuses; a repair for a table nobody listed is a rule bending a row
    // no constraint objects to, which is data loss with no cause.
    expect([...REPAIRED_TABLES].sort()).toEqual(Object.keys(COLLECTION_COUPLED).sort());
  });

  it("leaves a table with no coupled CHECK exactly as it was", () => {
    const columns = { status: "done", completed_at: "2026-08-16T00:00:00.000Z" };
    expect(repair("tasks", columns)).toBe(columns);
  });

  it("never introduces a column the merged row did not carry", () => {
    // Every column named in the ledger, fed in ONE AT A TIME with a value that
    // makes its pair illegal. A repair that answered by writing the missing half
    // would put a column into the UPDATE that no merge produced, and the apply
    // path would clear a local value nobody edited — data loss with no conflict
    // behind it. Driven off the ledger so a new coupled CHECK is covered the day
    // it is listed.
    for (const [table, checks] of Object.entries(COLLECTION_COUPLED)) {
      for (const column of new Set(checks.flatMap((check) => check.columns))) {
        const only: Record<string, JsonValue> = { [column]: "x" };
        expect(Object.keys(repairCoupled(table, only, NO_STAMPS))).toEqual([column]);
      }
    }
  });
});

describe("repairCoupled — cards", () => {
  const cloze = { kind: "cloze", cloze_text: "Beograd", cloze_ordinal: 0, problem_steps: null };
  const basic = { kind: "basic", cloze_text: null, cloze_ordinal: null, problem_steps: "1) …" };

  it("leaves a legal cloze card and a legal basic card alone", () => {
    expect(repair("cards", { ...cloze })).toEqual(cloze);
    expect(repair("cards", { ...basic })).toEqual(basic);
  });

  it("demotes a cloze card whose text was cleared, because text cannot be invented", () => {
    // `(kind='cloze') = (cloze_text IS NOT NULL)`, and the ordinal follows: a
    // basic card may not keep one.
    expect(repair("cards", { ...cloze, cloze_text: null })).toEqual({
      kind: "basic",
      cloze_text: null,
      cloze_ordinal: null,
      problem_steps: null,
    });
  });

  it("demotes a cloze card whose ordinal was cleared", () => {
    expect(repair("cards", { ...cloze, cloze_ordinal: null })).toMatchObject({
      kind: "basic",
      cloze_text: null,
    });
  });

  it("hides cloze text on a card whose kind says basic — even when the text is newer", () => {
    // The anchor is `kind`, not the newest stamp, and the newer edit is not lost:
    // it stays in the state, so switching the card back to cloze brings it back.
    const state = stamps({ kind: T1, cloze_text: T2 });
    expect(repair("cards", { ...basic, cloze_text: "Beograd" }, state)).toEqual(basic);
  });

  it("drops worked steps from a cloze card", () => {
    // `problem_steps IS NULL OR (kind = 'basic' AND length(problem_steps) > 0)`.
    expect(repair("cards", { ...cloze, problem_steps: "1) …" })).toEqual(cloze);
  });

  it("treats an empty steps string as no steps", () => {
    // `length(problem_steps) > 0` — and an empty string is what a cleared
    // textarea sends, so this refusal is reachable without any merge at all.
    expect(repair("cards", { ...basic, problem_steps: "" })).toMatchObject({
      problem_steps: null,
    });
  });

  it("clamps a negative ordinal rather than letting a peer's row be refused", () => {
    expect(repair("cards", { ...cloze, cloze_ordinal: -3 })).toMatchObject({
      kind: "cloze",
      cloze_ordinal: 0,
    });
  });

  it("does not touch the state it was given", () => {
    // The whole design in one assertion: the repair produces no state, so there
    // is nothing to push, nothing to echo and nothing for two devices to
    // disagree about.
    const state = stamps({ kind: T1, cloze_text: T2 });
    const before = JSON.stringify(state);
    repair("cards", { ...basic, cloze_text: "Beograd" }, state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("repairCoupled — focus_sessions", () => {
  const session = { started_at: "2026-08-16T10:00:00.000Z", ended_at: "2026-08-16T10:25:00.000Z" };

  it("leaves a session that ended after it began alone", () => {
    expect(repair("focus_sessions", { ...session })).toEqual(session);
  });

  it("moves the older-stamped end when the start was corrected later", () => {
    const state = stamps({ started_at: T2, ended_at: T1 });
    expect(
      repair("focus_sessions", { ...session, started_at: "2026-08-16T10:40:00.000Z" }, state),
    ).toEqual({
      started_at: "2026-08-16T10:40:00.000Z",
      ended_at: "2026-08-16T10:40:00.001Z",
    });
  });

  it("moves the older-stamped start when the end was corrected later", () => {
    const state = stamps({ started_at: T1, ended_at: T2 });
    expect(
      repair("focus_sessions", { ...session, ended_at: "2026-08-16T09:00:00.000Z" }, state),
    ).toEqual({
      started_at: "2026-08-16T08:59:59.999Z",
      ended_at: "2026-08-16T09:00:00.000Z",
    });
  });

  it("repairs equal times too, because the CHECK is strict", () => {
    const state = stamps({ started_at: T1, ended_at: T2 });
    const out = repair("focus_sessions", { ...session, ended_at: session.started_at }, state);
    expect(Date.parse(out["ended_at"] as string)).toBeGreaterThan(
      Date.parse(out["started_at"] as string),
    );
  });

  it("breaks a same-millisecond tie by node id rather than leaving it undecided", () => {
    // Two devices writing in the same millisecond is the case where „newest
    // wins" would have no answer — and it is exactly the case where the two of
    // them must not compute different rows. `compareHlc` is a total order, so
    // there is an answer, and the state is identical on both devices, so it is
    // the same answer.
    const tie = stamps({
      started_at: hlcSend(hlcZero("device-a"), 5_000),
      ended_at: hlcSend(hlcZero("device-z"), 5_000),
    });
    const out = repair("focus_sessions", { ...session, ended_at: session.started_at }, tie);
    expect(out["started_at"]).toBe("2026-08-16T09:59:59.999Z");
  });

  it("leaves a row whose times are not times, because no CHECK can refuse it either", () => {
    const columns = { started_at: null, ended_at: null };
    expect(repair("focus_sessions", columns)).toBe(columns);
  });
});

describe("repairCoupled — calendar_settings", () => {
  const semester = { semester_start: "2026-10-01", semester_end: "2027-01-31" };

  it("leaves a semester whose dates are in order alone", () => {
    expect(repair("calendar_settings", { ...semester })).toEqual(semester);
  });

  it("leaves a half-set semester alone, because null is legal here", () => {
    expect(repair("calendar_settings", { ...semester, semester_end: null })).toEqual({
      semester_start: "2026-10-01",
      semester_end: null,
    });
  });

  it("clears the older-stamped date when the two cross", () => {
    // Cleared rather than moved: null is a state the settings screen already
    // draws and the user already knows how to fix, and a date silently shifted
    // to pass an inequality is a wrong date nobody would notice.
    const startNewer = stamps({ semester_start: T2, semester_end: T1 });
    expect(
      repair("calendar_settings", { ...semester, semester_start: "2027-06-01" }, startNewer),
    ).toEqual({ semester_start: "2027-06-01", semester_end: null });

    const endNewer = stamps({ semester_start: T1, semester_end: T2 });
    expect(
      repair("calendar_settings", { ...semester, semester_start: "2027-06-01" }, endNewer),
    ).toEqual({ semester_start: null, semester_end: "2027-01-31" });
  });
});

describe("repairCoupled — dashboard_settings", () => {
  const wallpaper = {
    background_hash: "9f2b",
    background_mime: "image/webp",
    background_size_bytes: 40_112,
  };
  const none = { background_hash: null, background_mime: null, background_size_bytes: null };

  it("leaves a complete wallpaper and no wallpaper alone", () => {
    expect(repair("dashboard_settings", { ...wallpaper })).toEqual(wallpaper);
    expect(repair("dashboard_settings", { ...none })).toEqual(none);
  });

  it("clears all three columns when any one of them went missing", () => {
    // Three columns holding one fact, so they are repaired as one. Two of these
    // are the CHECK's own halves; the third is a hash naming a file with no size,
    // which passes nothing.
    expect(repair("dashboard_settings", { ...wallpaper, background_mime: null })).toEqual(none);
    expect(repair("dashboard_settings", { ...wallpaper, background_hash: null })).toEqual(none);
    expect(repair("dashboard_settings", { ...wallpaper, background_size_bytes: null })).toEqual(
      none,
    );
  });

  it("treats a zero-byte wallpaper as no wallpaper", () => {
    // `background_size_bytes IS NULL OR background_size_bytes > 0` — the third
    // CHECK over the same three columns, and the one a merge reaches by taking a
    // cleared size from one device and a live hash from the other.
    expect(repair("dashboard_settings", { ...wallpaper, background_size_bytes: 0 })).toEqual(none);
  });
});

describe("repairCoupled — fin_transactions", () => {
  const transfer = { account_id: "acc-1", counter_account_id: "acc-2", category_id: null };

  it("leaves a legal transfer and a legal categorised entry alone", () => {
    expect(repair("fin_transactions", { ...transfer })).toEqual(transfer);
    const entry = { account_id: "acc-1", counter_account_id: null, category_id: "cat-9" };
    expect(repair("fin_transactions", { ...entry })).toEqual(entry);
  });

  it("clears a counter-account that came to equal its own account", () => {
    // One legal move only: a transfer to itself counts twice in every balance,
    // and `account_id` is NOT NULL so the other direction does not exist.
    expect(repair("fin_transactions", { ...transfer, counter_account_id: "acc-1" })).toEqual({
      account_id: "acc-1",
      counter_account_id: null,
      category_id: null,
    });
  });

  it("lets the newer of the transfer and the category decide", () => {
    const counterNewer = stamps({ counter_account_id: T2, category_id: T1 });
    expect(
      repair("fin_transactions", { ...transfer, category_id: "cat-9" }, counterNewer),
    ).toMatchObject({ counter_account_id: "acc-2", category_id: null });

    const categoryNewer = stamps({ counter_account_id: T1, category_id: T2 });
    expect(
      repair("fin_transactions", { ...transfer, category_id: "cat-9" }, categoryNewer),
    ).toMatchObject({ counter_account_id: null, category_id: "cat-9" });
  });

  it("keeps the category when the self-transfer repair already settled the pair", () => {
    // Order matters, and this is the assertion that proves it: clearing the
    // self-referential counter-account makes the second CHECK pass by itself, so
    // the category — which is now the row's only claim — must survive even though
    // its stamp is older.
    const counterNewer = stamps({ counter_account_id: T2, category_id: T1 });
    expect(
      repair(
        "fin_transactions",
        { account_id: "acc-1", counter_account_id: "acc-1", category_id: "cat-9" },
        counterNewer,
      ),
    ).toEqual({ account_id: "acc-1", counter_account_id: null, category_id: "cat-9" });
  });
});

describe("repairCoupled — habits", () => {
  it("leaves a measured habit and a plain tick alone", () => {
    const measured = { target: 8, unit: "čaša" };
    expect(repair("habits", { ...measured })).toEqual(measured);
    const tick = { target: null, unit: null };
    expect(repair("habits", { ...tick })).toEqual(tick);
  });

  it("keeps a target that lost its unit — a bare number is still a target", () => {
    expect(repair("habits", { target: 8, unit: null })).toEqual({ target: 8, unit: null });
  });

  it("clears a unit that lost its target — a unit with nothing to measure is not one", () => {
    expect(repair("habits", { target: null, unit: "čaša" })).toEqual({ target: null, unit: null });
  });
});

describe("repairCoupled — fit_measurements", () => {
  it("leaves a whole reading and no reading alone", () => {
    const reading = { muscle_value: 34.2, muscle_unit: "kg" };
    expect(repair("fit_measurements", { ...reading })).toEqual(reading);
    const empty = { muscle_value: null, muscle_unit: null };
    expect(repair("fit_measurements", { ...empty })).toEqual(empty);
  });

  it("clears both halves when only one arrived", () => {
    // Half a reading is not a smaller reading: „18" is not a body-fat figure
    // until something says percent or kilograms, and „percent" measures nothing.
    const both = { muscle_value: null, muscle_unit: null };
    expect(repair("fit_measurements", { muscle_value: 34.2, muscle_unit: null })).toEqual(both);
    expect(repair("fit_measurements", { muscle_value: null, muscle_unit: "kg" })).toEqual(both);
  });
});

describe("deriveColumns applies the repair", () => {
  // The repair is only worth anything if the one function that turns a merged
  // state into local columns runs it. Reaching it through `deriveColumns` — with
  // a real collection, real field stamps and the derived columns in place — is
  // what proves no caller can get an illegal row out of this package.
  const CARDS = classify("cards") as SyncCollection;

  it("hides the losing half of a coupled pair and derives the universal columns", () => {
    const state: RowState = {
      version: 3,
      fields: {
        kind: { value: "basic", at: T1 },
        cloze_text: { value: "Beograd", at: T2 },
        cloze_ordinal: { value: 0, at: T2 },
      },
      deleted: { value: false, at: T1 },
    };

    expect(deriveColumns(CARDS, state)).toEqual({
      kind: "basic",
      cloze_text: null,
      cloze_ordinal: null,
      updated_at: "1970-01-01T00:00:02.000Z",
      deleted_at: null,
    });
  });
});
