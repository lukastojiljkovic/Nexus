import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COLLECTION_COUPLED,
  COLLECTION_DERIVED,
  SYNC_MAP,
  classify,
  fieldColumns,
  parentFields,
  repairCoupled,
} from "@nexus/sync";
import { hlcSend, hlcZero, type Hlc, type JsonValue, type RowState } from "@nexus/sync-crypto";
import { openDatabase, RESTORE_WIPE_TABLES } from "../index.js";
import type { NexusDatabase } from "../index.js";

/**
 * The guard that makes `@nexus/sync`'s collection map a DERIVATION rather than a
 * second opinion.
 *
 * ADR-082's first decision was that the set of user content is derived from
 * `RESTORE_WIPE_TABLES` and never written out again — because a table added in
 * six months would be caught by the restore guard and sail straight past sync,
 * and nothing would look wrong (DC-07, DC-08). The map itself cannot live beside
 * that list: `@nexus/db` is SQLite and therefore Node-only, while the map has to
 * be readable in a browser tab. So the map is declared portably in
 * `@nexus/sync`, and this file is what keeps it honest — it reads the real
 * schema and the real list and fails until the two agree.
 *
 * It goes further than "the tables match", because a table list is the easy
 * half. The map claims a SHAPE for every table it calls a field of its parent,
 * and those claims are checked against the columns that actually exist: a
 * classification nothing can falsify is an opinion, not a decision.
 */

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-syncmap-"));
  db = openDatabase({ path: join(dir, "map.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

function columns(table: string): ColumnInfo[] {
  return db.raw.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

/**
 * A column that carries the user's DATA, as opposed to one that only says which
 * rows this row joins or when it was written. Anything ending `_id`, the primary
 * key itself, and the two bookkeeping timestamps are structure; everything else
 * is something a person typed or chose.
 */
function dataColumns(table: string): string[] {
  return columns(table)
    .filter((column) => column.pk === 0)
    .map((column) => column.name)
    .filter((name) => !name.endsWith("_id") && name !== "id")
    .filter((name) => name !== "created_at" && name !== "updated_at");
}

describe("the sync map against the real schema", () => {
  it("classifies exactly the tables RESTORE_WIPE_TABLES calls content — no more, no fewer", () => {
    const mapped = new Set(SYNC_MAP.map((entry) => entry.table));
    const content = new Set<string>(RESTORE_WIPE_TABLES);

    // Reported as two named lists rather than a set comparison, because the
    // whole point of this test is that its failure tells you what to do.
    const missing = [...content].filter((table) => !mapped.has(table));
    const extra = [...mapped].filter((table) => !content.has(table));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("names only tables that exist", () => {
    const live = new Set(
      (
        db.raw
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((row) => row.name),
    );
    const ghosts = SYNC_MAP.map((entry) => entry.table).filter((table) => !live.has(table));
    expect(ghosts).toEqual([]);
  });

  it("gives every parent-field a parent column that is really there, and really NOT NULL", () => {
    for (const entry of parentFields()) {
      const column = columns(entry.table).find((each) => each.name === entry.parentColumn);
      // NOT NULL because a row that can exist without its parent is not a field
      // OF that parent — it is an orphan waiting to happen.
      expect({ table: entry.table, column: column?.name, notnull: column?.notnull }).toEqual({
        table: entry.table,
        column: entry.parentColumn,
        notnull: 1,
      });
    }
  });

  it("proves every table it calls a join really carries no data of its own", () => {
    for (const entry of parentFields()) {
      if (entry.form !== "join") continue;
      // If this fails, the table has grown a column somebody types into — and a
      // row with data of its own is a row a user can point at, which by ADR-082
      // §2 makes it a collection rather than a field.
      expect({ table: entry.table, data: dataColumns(entry.table) }).toEqual({
        table: entry.table,
        data: [],
      });
    }
  });

  it("proves every table it calls an ordered child really is an array inside its parent", () => {
    for (const entry of parentFields()) {
      if (entry.form !== "ordered-child") continue;
      const position = columns(entry.table).find((each) => each.name === "position");
      // An integer `position`, deliberately NOT the fractional rank migration 062
      // gave the hand-orderable scopes: this one indexes its parent's array, and
      // the array is replaced whole, so there are never two writers to merge.
      expect({
        table: entry.table,
        type: position?.type,
        notnull: position?.notnull,
      }).toEqual({ table: entry.table, type: "INTEGER", notnull: 1 });
    }
  });

  it("gives every collection the identity its primary key actually has", () => {
    for (const entry of SYNC_MAP) {
      if (entry.kind !== "collection") continue;
      const key = columns(entry.table)
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name);
      // `profile_id` is dropped from the identity deliberately: which profile a
      // row belongs to is already decided by the content key that opened it, and
      // putting it on the wire would be saying the same thing twice. Everything
      // else in the key IS the object id — including, for six collections,
      // nothing at all, because the profile's key was the whole of it.
      const expected = key.filter((name) => name !== "profile_id");
      expect({ table: entry.table, identity: [...entry.identity] }).toEqual({
        table: entry.table,
        identity: expected,
      });
    }
  });

  it("names the six per-profile singletons and no others", () => {
    // Recorded as a list rather than a count, so a seventh has to be a decision
    // somebody made rather than a number that quietly changed. Their object id
    // is the EMPTY key, which the transport has to handle for real.
    const singletons = SYNC_MAP.filter(
      (entry) => entry.kind === "collection" && entry.identity.length === 0,
    ).map((entry) => entry.table);
    expect(singletons.sort()).toEqual([
      "calendar_settings",
      "dashboard_settings",
      "fit_body_profile",
      "fit_targets",
      "ntf_settings",
      "study_settings",
    ]);
  });

  it("says how every collection reaches its profile, and is right about it", () => {
    for (const entry of SYNC_MAP) {
      if (entry.kind !== "collection") continue;
      const hasColumn = columns(entry.table).some((column) => column.name === "profile_id");
      // Exactly one of the two, never both and never neither. A table with the
      // column AND a declared path would have two answers to "whose row is
      // this"; a table with neither has none, and migration 063's trigger would
      // have had nothing to write.
      expect({ table: entry.table, hasColumn, declared: entry.profileVia !== undefined }).toEqual({
        table: entry.table,
        hasColumn,
        declared: !hasColumn,
      });

      if (entry.profileVia === undefined) continue;
      const foreignKeys = db.raw.prepare(`PRAGMA foreign_key_list(${entry.table})`).all() as {
        table: string;
        from: string;
      }[];
      // The declared path has to be a real foreign key, or it is a sentence
      // about a join the database would refuse to perform.
      expect({
        table: entry.table,
        via: `${entry.profileVia.key}->${entry.profileVia.parent}`,
        real: foreignKeys.some(
          (key) => key.from === entry.profileVia?.key && key.table === entry.profileVia.parent,
        ),
      }).toEqual({
        table: entry.table,
        via: `${entry.profileVia.key}->${entry.profileVia.parent}`,
        real: true,
      });
      // And the parent must itself carry `profile_id`, or the join lands one
      // table short of an answer.
      expect({
        parent: entry.profileVia.parent,
        carriesProfile: columns(entry.profileVia.parent).some(
          (column) => column.name === "profile_id",
        ),
      }).toEqual({ parent: entry.profileVia.parent, carriesProfile: true });
    }
  });

  it("proves no table it calls a collection is secretly a join row", () => {
    const jointish = SYNC_MAP.filter((entry) => entry.kind === "collection")
      .map((entry) => entry.table)
      .filter((table) => dataColumns(table).length === 0);
    // A row that is nothing but a pair of ids has no identity of its own to
    // merge, and syncing it as an object is how orphans are made.
    expect(jointish).toEqual([]);
  });

  it("subtracts only columns that are really there — a stale exclusion silently syncs the column", () => {
    for (const [table, derived] of Object.entries(COLLECTION_DERIVED)) {
      const present = new Set(columns(table).map((column) => column.name));
      const ghosts = Object.keys(derived).filter((column) => !present.has(column));
      // A derived entry naming a column that no longer exists is worse than
      // useless: the column it MEANT to exclude has been renamed, and is now
      // travelling as an ordinary field with nothing saying it should not.
      expect({ table, ghosts }).toEqual({ table, ghosts: [] });
    }
  });

  it("keeps the universal exclusions honest against every collection that has them", () => {
    for (const entry of SYNC_MAP) {
      if (entry.kind !== "collection") continue;
      const present = new Set(columns(entry.table).map((column) => column.name));
      const fields = fieldColumns(entry, [...present]);
      // Whatever else changes, these three never travel: the profile is decided
      // by the key that opened the row, `updated_at` is a shadow of the merge
      // itself, and `deleted_at` is a shadow of the tombstone field.
      for (const forbidden of ["profile_id", "updated_at", "deleted_at"]) {
        expect({ table: entry.table, forbidden, sent: fields.includes(forbidden) }).toEqual({
          table: entry.table,
          forbidden,
          sent: false,
        });
      }
      // And a collection with nothing left to say is a classification mistake.
      expect({ table: entry.table, empty: fields.length === 0 }).toEqual({
        table: entry.table,
        empty: false,
      });
    }
  });

  it("leaves every device-local and sealed table out, which is how they stay off the wire", () => {
    for (const table of [
      "backup_settings",
      "search_history",
      "meta",
      "profiles",
      "private_notes",
      "private_note_versions",
      "private_settings",
    ]) {
      expect({ table, classified: classify(table) !== undefined }).toEqual({
        table,
        classified: false,
      });
    }
  });
});

/**
 * The second half of the same idea, one layer down.
 *
 * The block above proves the map names the right TABLES. This proves it knows
 * which of their COLUMNS cannot be merged one at a time. A table-level CHECK
 * that reads two synced columns is a rule field-level LWW cannot see: each
 * column takes the newer stamp on its own, and the pair can land in a
 * combination the database refuses — at which point the merged row cannot be
 * written at all, which is a worse outcome than being wrong.
 *
 * `COLLECTION_COUPLED` is the ledger of those pairs and `@nexus/sync`'s header
 * on it says what is still owed. What this test adds is that the ledger cannot
 * fall behind the schema: a migration that introduces a coupled CHECK fails
 * here, on the day it is written, rather than months later as a row that
 * silently never applies on one device.
 */
/**
 * Every top-level `CHECK (...)` in a CREATE TABLE, scanned by balanced parens.
 *
 * Module scope because two blocks below need it for opposite reasons: one reads
 * the constraints to prove the ledger is complete, the other replays them
 * verbatim to prove the repair satisfies them.
 */
function checkExpressions(table: string): string[] {
  const row = db.raw
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string | null } | undefined;
  const sql = row?.sql ?? "";
  const out: string[] = [];
  const opener = /\bCHECK\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(sql)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth--;
    }
    out.push(sql.slice(match.index + match[0].length, i - 1).replace(/\s+/g, " ").trim());
  }
  return out;
}

/** The synced field columns one CHECK reads. String literals are blanked first,
 *  so `metric IN ('reps', …)` is not read as naming the `reps` column. */
function coupledColumns(table: string, fields: ReadonlySet<string>, check: string): string[] {
  const bare = check.replace(/'[^']*'/g, "''");
  return columns(table)
    .map((column) => column.name)
    .filter((name) => fields.has(name))
    .filter((name) => new RegExp("\\b" + name + "\\b").test(bare));
}

/** The CHECKs of `table` that read two synced columns — the repair's whole remit. */
function coupledChecks(table: string): string[] {
  const entry = classify(table);
  if (entry === undefined || entry.kind !== "collection") return [];
  const fields = new Set(fieldColumns(entry, columns(table).map((column) => column.name)));
  return checkExpressions(table).filter(
    (check) => coupledColumns(table, fields, check).length >= 2,
  );
}

describe("coupled CHECKs against the real schema", () => {
  it("lists every CHECK that ties two synced columns together, and nothing that does not", () => {
    const found: string[] = [];
    for (const entry of SYNC_MAP) {
      if (entry.kind !== "collection") continue;
      const fields = new Set(fieldColumns(entry, columns(entry.table).map((c) => c.name)));
      for (const check of checkExpressions(entry.table)) {
        const coupled = coupledColumns(entry.table, fields, check);
        if (coupled.length >= 2) found.push(`${entry.table}: ${coupled.join(" + ")}`);
      }
    }

    const ledger = Object.entries(COLLECTION_COUPLED).flatMap(([table, entries]) =>
      entries.map((entry) => `${table}: ${entry.columns.join(" + ")}`),
    );
    // Both directions. A CHECK missing from the ledger is a merge that can
    // produce an unwritable row with nothing recording it; a ledger entry with
    // no CHECK behind it is a rule that was relaxed, and the note explaining a
    // constraint that no longer exists is how the next reader is misled.
    expect(found.slice().sort()).toEqual(ledger.slice().sort());
  });

  it("names real columns, and explains each pair concretely enough to act on", () => {
    for (const [table, entries] of Object.entries(COLLECTION_COUPLED)) {
      const present = new Set(columns(table).map((column) => column.name));
      for (const entry of entries) {
        const ghosts = entry.columns.filter((column) => !present.has(column));
        expect({ table, ghosts }).toEqual({ table, ghosts: [] });
        expect(entry.columns.length).toBeGreaterThanOrEqual(2);
        // The ledger is read by whoever builds the repair, so „two columns are
        // coupled" is not an entry — the illegal combination has to be stated.
        expect({ table, columns: entry.columns, explained: entry.why.length > 80 }).toEqual({
          table,
          columns: entry.columns,
          explained: true,
        });
      }
    }
  });
});

/**
 * The third layer: the repair, held against the CHECKs themselves.
 *
 * `@nexus/sync`'s own `repair.test.ts` proves the repair does what its author
 * intended. It cannot prove SQLite AGREES — every expectation in it was typed by
 * the same person who typed the rule, from the same reading of the same
 * migration, and a misread CHECK produces a repair and a test that are wrong
 * together. That is DC-14's real trap: the failure does not appear on the device
 * that computed the row, it appears months later as one row that will not apply.
 *
 * So this block runs no fixtures and asserts no expected values. It lifts each
 * CHECK's text VERBATIM out of `sqlite_master`, rebuilds it as a temporary table
 * carrying nothing but that CHECK, and lets SQLite answer twice per scenario:
 * the merged row is refused, and the repaired row is taken. Both halves matter —
 * without the first, a scenario that was never illegal would pass by doing
 * nothing, which is the cheapest way to hold a green test that checks nothing.
 *
 * **One CHECK per probe, and the answer is the CHECK's own text.** The first
 * version of this block put every constraint on one probe table and asked only
 * „refused: yes or no", and it failed on `focus_sessions` and `fin_transactions`
 * for a reason that had nothing to do with any merge: the probe drops NOT NULL
 * and DEFAULT but keeps the CHECKs, so `paused_seconds` arrived NULL and
 * `typeof(paused_seconds) = 'integer'` refused it. Both halves of the scenario
 * then „passed" the illegality assertion and failed the repair assertion, and a
 * boolean cannot tell those two stories apart. Asking each constraint separately
 * makes the failure name the rule, and makes the scope explicit: the repair owes
 * an answer to the COUPLED checks and to nothing else, because every other
 * constraint is satisfied by a real value that a real row already carries.
 *
 * The probe drops the real table's NOT NULLs, FKs and defaults on purpose. They
 * are the apply path's problem, not the repair's; keeping them would mean
 * building a valid parent row for seven modules, and a scenario that failed to
 * insert for a missing account would read exactly like one the CHECK refused.
 */
describe("the coupled repair against the real CHECKs", () => {
  const T1 = hlcSend(hlcZero("device-a"), 1_000);
  const T2 = hlcSend(hlcZero("device-a"), 2_000);

  /** A stamps-only `RowState`, which is all any repair reads. */
  function stamps(fields: Record<string, Hlc>): RowState {
    return {
      version: 1,
      fields: Object.fromEntries(
        Object.entries(fields).map(([name, at]) => [name, { value: null, at }]),
      ),
      deleted: { value: false, at: T1 },
    };
  }

  /**
   * Which of `table`'s COUPLED CHECKs refuse this row, named by their own text.
   *
   * One temp table per constraint: `table`'s columns with no NOT NULL, no FK and
   * no default, plus exactly one CHECK copied unchanged. Names are quoted in the
   * column list so a constraint referring to a column whose name needs quoting
   * still resolves, and the CHECK text is never rewritten — SQLite is being asked
   * about the rule it actually enforces, not about a paraphrase of it.
   */
  function refusedBy(table: string, row: Readonly<Record<string, JsonValue>>): string[] {
    const names = columns(table).map((column) => column.name);
    const quoted = names.map((name) => `"${name}"`).join(", ");
    const values = names.map((name) => {
      const value = row[name];
      return value === undefined || value === null ? null : (value as string | number);
    });

    const out: string[] = [];
    for (const check of coupledChecks(table)) {
      db.raw.exec(`DROP TABLE IF EXISTS temp.probe`);
      db.raw.exec(`CREATE TABLE temp.probe (${quoted}, CHECK (${check}))`);
      try {
        db.raw
          .prepare(`INSERT INTO temp.probe VALUES (${names.map(() => "?").join(", ")})`)
          .run(...values);
      } catch (error) {
        // Only a CHECK counts. Anything else means the probe is wrong, and a
        // probe that fails for its own reasons reports every row as illegal.
        if (!String(error).includes("CHECK constraint failed")) throw error;
        out.push(check);
      } finally {
        db.raw.exec(`DROP TABLE temp.probe`);
      }
    }
    return out;
  }

  /**
   * One merge SQLite refuses, and the stamps the repair is entitled to read.
   *
   * `merged` carries only the columns the coupled CHECKs read. Every other column
   * of the table is bound NULL by the probe, which is safe precisely because the
   * probe asks nothing but those CHECKs — and listing more would suggest the
   * repair's answer depends on values it never looks at.
   */
  interface Scenario {
    readonly label: string;
    readonly merged: Record<string, JsonValue>;
    readonly state?: RowState;
  }

  const SCENARIOS: Readonly<Record<string, readonly Scenario[]>> = {
    cards: [
      {
        label: "a cloze card whose text was cleared on the other device",
        merged: { kind: "cloze", cloze_text: null, cloze_ordinal: 0, problem_steps: null },
      },
      {
        label: "a basic card that kept the other device's cloze text",
        merged: { kind: "basic", cloze_text: "Beograd", cloze_ordinal: 0, problem_steps: null },
        state: stamps({ kind: T1, cloze_text: T2 }),
      },
      {
        label: "a cloze card that kept the other device's worked steps",
        merged: { kind: "cloze", cloze_text: "Beograd", cloze_ordinal: 0, problem_steps: "1) …" },
      },
      {
        label: "a cloze card whose ordinal went negative",
        merged: { kind: "cloze", cloze_text: "Beograd", cloze_ordinal: -3, problem_steps: null },
      },
    ],
    focus_sessions: [
      {
        label: "a session whose two ends were corrected in opposite directions",
        merged: { started_at: "2026-08-16T10:40:00.000Z", ended_at: "2026-08-16T10:25:00.000Z" },
        state: stamps({ started_at: T2, ended_at: T1 }),
      },
      {
        label: "a session that merged into zero length",
        merged: { started_at: "2026-08-16T10:00:00.000Z", ended_at: "2026-08-16T10:00:00.000Z" },
        state: stamps({ started_at: T1, ended_at: T2 }),
      },
    ],
    calendar_settings: [
      {
        label: "a semester whose start was pushed past its end",
        merged: { semester_start: "2027-06-01", semester_end: "2027-01-31" },
        state: stamps({ semester_start: T2, semester_end: T1 }),
      },
    ],
    dashboard_settings: [
      {
        label: "a wallpaper cleared on one device and replaced on the other",
        merged: {
          background_hash: "9f2b",
          background_mime: null,
          background_size_bytes: 40_112,
        },
      },
      {
        label: "a wallpaper whose size survived the file",
        merged: { background_hash: null, background_mime: null, background_size_bytes: 40_112 },
      },
    ],
    fin_transactions: [
      {
        label: "a transfer re-pointed onto its own account",
        merged: { account_id: "acc-1", counter_account_id: "acc-1", category_id: null },
      },
      {
        label: "a transaction that became a transfer and got filed under a category",
        merged: { account_id: "acc-1", counter_account_id: "acc-2", category_id: "cat-9" },
        state: stamps({ counter_account_id: T2, category_id: T1 }),
      },
    ],
    habits: [
      {
        label: "a habit whose target was cleared while its unit was named",
        merged: { target: null, unit: "čaša" },
      },
    ],
    fit_measurements: [
      {
        label: "half a muscle reading",
        merged: { muscle_value: 34.2, muscle_unit: null },
      },
      {
        label: "the other half",
        merged: { muscle_value: null, muscle_unit: "kg" },
      },
    ],
  };

  it("has a scenario for every table in the ledger", () => {
    // Driven off the ledger, so a coupled CHECK added by a future migration is
    // not merely listed and repaired but PROVED, on the day it appears.
    expect(Object.keys(SCENARIOS).sort()).toEqual(Object.keys(COLLECTION_COUPLED).sort());
  });

  for (const [table, scenarios] of Object.entries(SCENARIOS)) {
    for (const scenario of scenarios) {
      it(`${table}: SQLite refuses ${scenario.label}, and takes the repair`, () => {
        const state = scenario.state ?? stamps({});
        // The scenario has to BE illegal, or the second half proves nothing.
        expect({ label: scenario.label, illegal: refusedBy(table, scenario.merged).length > 0 })
          .toEqual({ label: scenario.label, illegal: true });
        // Reported as the refusing CHECKs' own text, so a failure here says which
        // rule the repair misread rather than merely that one of them did.
        expect(refusedBy(table, repairCoupled(table, { ...scenario.merged }, state))).toEqual([]);
      });
    }
  }
});
