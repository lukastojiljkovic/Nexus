import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecurrenceRule } from "@nexus/core";
import {
  FinAccountNotFoundError,
  FinAccountStore,
  FinCategoryNotFoundError,
  FinCategoryStore,
  FinRecurringNotFoundError,
  FinRecurringStore,
  FinRecurringValidationError,
  FinTransactionStore,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-02-01T10:00:00.000Z";

/** „Petog u mesecu, zauvek" — the shape a subscription almost always has. */
const MONTHLY_5TH: RecurrenceRule = {
  freq: { kind: "monthly-date", interval: 1, day: 5 },
  end: { kind: "never" },
};

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fin-recurring-"));
  db = openDatabase({ path: join(dir, "fin.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

interface Fixture {
  profileId: string;
  accounts: FinAccountStore;
  categories: FinCategoryStore;
  transactions: FinTransactionStore;
  recurring: FinRecurringStore;
  rsd: string;
  eur: string;
  zabava: string;
  plata: string;
}

function fixture(): Fixture {
  const profileId = createProfile();
  const accounts = new FinAccountStore(db.raw, profileId);
  const categories = new FinCategoryStore(db.raw, profileId);
  return {
    profileId,
    accounts,
    categories,
    transactions: new FinTransactionStore(db.raw, profileId),
    recurring: new FinRecurringStore(db.raw, profileId),
    rsd: accounts.create(
      { name: "Tekući", kind: "current", currency: "RSD", openingBalance: 1000_00 },
      NOW,
    ).id,
    eur: accounts.create({ name: "Devizni", kind: "savings", currency: "EUR" }, NOW).id,
    zabava: categories.create({ name: "Zabava", kind: "expense" }, NOW).id,
    plata: categories.create({ name: "Plata", kind: "income" }, NOW).id,
  };
}

/** The subscription every test starts from unless it needs another shape. */
function netflix(f: Fixture, overrides: Record<string, unknown> = {}) {
  return f.recurring.create(
    {
      accountId: f.rsd,
      categoryId: f.zabava,
      name: "Netflix",
      amount: -1190,
      recurrence: MONTHLY_5TH,
      startDate: "2026-01-05",
      reminderDays: 2,
      ...overrides,
    },
    NOW,
  );
}

describe("FinRecurringStore — CRUD", () => {
  it("creates a subscription, canonicalizes its rule and opens its cursor on the start date", () => {
    const f = fixture();
    const created = netflix(f);

    expect(created).toMatchObject({
      profileId: f.profileId,
      accountId: f.rsd,
      categoryId: f.zabava,
      name: "Netflix",
      amount: -1190,
      payee: null,
      note: null,
      startDate: "2026-01-05",
      nextRun: "2026-01-05",
      reminderDays: 2,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(created.recurrence).toEqual(MONTHLY_5TH);
    expect(f.recurring.listActive()).toEqual([created]);
  });

  it("stores the rule in the SAME canonical JSON migration 018 stores one in", () => {
    const f = fixture();
    const created = f.recurring.create(
      {
        accountId: f.rsd,
        name: "Teretana",
        amount: -3000,
        // Deliberately unsorted: the engine's own canonical form is what must
        // land in the column, not what the caller happened to send.
        recurrence: { freq: { kind: "weekly", interval: 2, days: [3, 0] }, end: { kind: "never" } },
        startDate: "2026-02-02",
      },
      NOW,
    );

    const stored = db.raw
      .prepare("SELECT recurrence FROM fin_recurring WHERE id = ?")
      .get(created.id) as { recurrence: string };
    expect(JSON.parse(stored.recurrence)).toEqual({
      freq: { kind: "weekly", interval: 2, days: [0, 3] },
      end: { kind: "never" },
    });
    expect(created.recurrence).toEqual({
      freq: { kind: "weekly", interval: 2, days: [0, 3] },
      end: { kind: "never" },
    });
  });

  it("refuses a rule that is not a rule, a zero amount, an empty name and a bad start date", () => {
    const f = fixture();
    const base = {
      accountId: f.rsd,
      name: "X",
      amount: -100,
      recurrence: MONTHLY_5TH,
      startDate: "2026-01-05",
    };
    expect(() =>
      f.recurring.create({ ...base, recurrence: { freq: { kind: "nikad" } } as never }, NOW),
    ).toThrow(FinRecurringValidationError);
    expect(() => f.recurring.create({ ...base, amount: 0 }, NOW)).toThrow(
      FinRecurringValidationError,
    );
    expect(() => f.recurring.create({ ...base, amount: 12.5 }, NOW)).toThrow(
      FinRecurringValidationError,
    );
    expect(() => f.recurring.create({ ...base, name: "   " }, NOW)).toThrow(
      FinRecurringValidationError,
    );
    expect(() => f.recurring.create({ ...base, startDate: "2026-02-30" }, NOW)).toThrow(
      FinRecurringValidationError,
    );
    expect(() => f.recurring.create({ ...base, reminderDays: 400 }, NOW)).toThrow(
      FinRecurringValidationError,
    );
    expect(() => f.recurring.create({ ...base, reminderDays: 1.5 }, NOW)).toThrow(
      FinRecurringValidationError,
    );
  });

  it("resolves the account and category through THIS profile's scope", () => {
    const f = fixture();
    const other = fixture();
    expect(() =>
      f.recurring.create(
        {
          accountId: other.rsd,
          name: "Tuđe",
          amount: -100,
          recurrence: MONTHLY_5TH,
          startDate: "2026-01-05",
        },
        NOW,
      ),
    ).toThrow(FinAccountNotFoundError);
    expect(() =>
      f.recurring.create(
        {
          accountId: f.rsd,
          categoryId: other.zabava,
          name: "Tuđe",
          amount: -100,
          recurrence: MONTHLY_5TH,
          startDate: "2026-01-05",
        },
        NOW,
      ),
    ).toThrow(FinCategoryNotFoundError);
  });

  it("updates fields, and re-anchors the cursor when the schedule itself changes", () => {
    const f = fixture();
    const created = netflix(f);
    const later = "2026-03-01T09:00:00.000Z";

    const renamed = f.recurring.update(created.id, { name: "Netflix Standard" }, later);
    expect(renamed).toMatchObject({ name: "Netflix Standard", nextRun: "2026-01-05" });

    // A new start date is a new series: the cursor follows it rather than
    // keeping a position in a schedule that no longer exists — and it lands on
    // the first date the RULE actually places, which under „5-og u mesecu"
    // anchored on 10 April is 5 May, never the 10th.
    const moved = f.recurring.update(created.id, { startDate: "2026-04-10" }, later);
    expect(moved).toMatchObject({ startDate: "2026-04-10", nextRun: "2026-05-05" });

    const reruled = f.recurring.update(
      created.id,
      { recurrence: { freq: { kind: "yearly", interval: 1 }, end: { kind: "never" } } },
      later,
    );
    expect(reruled.nextRun).toBe("2026-04-10");
  });

  it("opens the cursor on the first date the RULE places, never on the raw start date", () => {
    const f = fixture();
    // „Prva naplata 10. januara, mesečno 5-og": January's own 5th is behind the
    // anchor and is dropped, exactly as it would be for a recurring event.
    const skewed = netflix(f, { startDate: "2026-01-10" });
    expect(skewed.nextRun).toBe("2026-02-05");
    expect(f.recurring.generateDue(NOW, "2026-01-31")).toBe(0);

    // A series whose end is behind its own start places nothing at all — a
    // cursor of null, the same "nothing left" a spent series carries.
    const spent = netflix(f, {
      name: "Ništa",
      recurrence: {
        freq: { kind: "monthly-date", interval: 1, day: 5 },
        end: { kind: "until", date: "2025-12-01" },
      },
    });
    expect(spent.nextRun).toBeNull();
  });

  it("soft-deletes and restores, and refuses both for another profile's row", () => {
    const f = fixture();
    const other = fixture();
    const created = netflix(f);

    expect(() => other.recurring.softDelete(created.id, NOW)).toThrow(FinRecurringNotFoundError);
    f.recurring.softDelete(created.id, NOW);
    expect(f.recurring.listActive()).toEqual([]);
    f.recurring.restore(created.id, NOW);
    expect(f.recurring.listActive().map((row) => row.id)).toEqual([created.id]);
  });

  it("orders the list sr-Latn by name — Šoping after Ručak, which BINARY would not", () => {
    const f = fixture();
    const shared = { amount: -100, recurrence: MONTHLY_5TH, startDate: "2026-01-05" };
    netflix(f, { name: "Šoping", ...shared });
    netflix(f, { name: "Ručak", ...shared });
    netflix(f, { name: "Zdravlje", ...shared });
    expect(f.recurring.listActive().map((row) => row.name)).toEqual([
      "Ručak",
      "Šoping",
      "Zdravlje",
    ]);
  });
});

describe("FinRecurringStore — generation", () => {
  it("charges every occurrence up to today and stops there — never into the future", () => {
    const f = fixture();
    const created = netflix(f);

    const written = f.recurring.generateDue(NOW, "2026-03-20");

    expect(written).toBe(3); // 05.01, 05.02, 05.03
    const rows = f.transactions.listActive();
    expect(rows.map((row) => row.date)).toEqual(["2026-03-05", "2026-02-05", "2026-01-05"]);
    // Every generated row is an ORDINARY transaction: same account, same
    // category, same signed minor units the template carries.
    expect(rows[0]).toMatchObject({
      accountId: f.rsd,
      categoryId: f.zabava,
      amount: -1190,
      payee: "Netflix",
      recurringId: created.id,
    });
    // The cursor now points at the first occurrence that has NOT happened.
    expect(f.recurring.listActive()[0]?.nextRun).toBe("2026-04-05");
  });

  it("is idempotent: a second pass on the same day writes nothing", () => {
    const f = fixture();
    netflix(f);

    expect(f.recurring.generateDue(NOW, "2026-03-20")).toBe(3);
    expect(f.recurring.generateDue(NOW, "2026-03-20")).toBe(0);
    expect(f.recurring.generateDue(NOW, "2026-03-20")).toBe(0);
    expect(f.transactions.listActive()).toHaveLength(3);
  });

  it("cannot double-charge even when the cursor is wound back — the index refuses it", () => {
    const f = fixture();
    const created = netflix(f);
    f.recurring.generateDue(NOW, "2026-03-20");

    // Exactly what a hand-edited file or a half-restored archive looks like:
    // rows that exist, and a cursor that thinks they do not.
    db.raw.prepare("UPDATE fin_recurring SET next_run = '2026-01-05' WHERE id = ?").run(created.id);

    expect(f.recurring.generateDue(NOW, "2026-03-20")).toBe(0);
    expect(f.transactions.listActive()).toHaveLength(3);
    expect(f.recurring.listActive()[0]?.nextRun).toBe("2026-04-05");
  });

  it("does NOT resurrect a generated charge the user deleted", () => {
    const f = fixture();
    netflix(f);
    f.recurring.generateDue(NOW, "2026-01-20");
    const [charge] = f.transactions.listActive();
    expect(charge).toBeDefined();

    f.transactions.softDelete(charge!.id, NOW);
    expect(f.recurring.generateDue(NOW, "2026-01-20")).toBe(0);
    expect(f.transactions.listActive()).toEqual([]);
    // The row is still on disk holding its day — that is what makes the delete
    // stick rather than be argued with a minute later.
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM fin_transactions").get() as { n: number }).n,
    ).toBe(1);
  });

  it("leaves a generated charge fully editable and deletable as an ordinary row", () => {
    const f = fixture();
    netflix(f);
    f.recurring.generateDue(NOW, "2026-01-20");
    const [charge] = f.transactions.listActive();

    const edited = f.transactions.update(
      charge!.id,
      { amount: -1290, payee: "Netflix (poskupelo)" },
      NOW,
    );
    expect(edited).toMatchObject({ amount: -1290, payee: "Netflix (poskupelo)" });

    f.transactions.softDelete(charge!.id, NOW);
    f.transactions.restore(charge!.id, NOW);
    expect(f.transactions.listActive()).toHaveLength(1);
  });

  it("closes a series that has run out and never charges past its end", () => {
    const f = fixture();
    netflix(f, {
      name: "Kurs",
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 5 }, end: { kind: "count", total: 2 } },
    });

    expect(f.recurring.generateDue(NOW, "2026-06-01")).toBe(2);
    expect(f.recurring.listActive()[0]?.nextRun).toBeNull();
    expect(f.recurring.generateDue(NOW, "2026-12-01")).toBe(0);
  });

  it("skips a subscription that has been soft-deleted, and one whose start is still ahead", () => {
    const f = fixture();
    const deleted = netflix(f, { name: "Ukinuto" });
    netflix(f, { name: "Kasnije", startDate: "2027-01-05" });
    f.recurring.softDelete(deleted.id, NOW);

    expect(f.recurring.generateDue(NOW, "2026-03-20")).toBe(0);
    expect(f.transactions.listActive()).toEqual([]);
  });

  it("generates for THIS profile only", () => {
    const f = fixture();
    const other = fixture();
    netflix(other);

    expect(f.recurring.generateDue(NOW, "2026-03-20")).toBe(0);
    expect(other.recurring.generateDue(NOW, "2026-03-20")).toBe(3);
  });

  it("counts a generated charge in the derived balance and in the month's spending", () => {
    const f = fixture();
    netflix(f);
    f.recurring.generateDue(NOW, "2026-02-20");

    const balance = f.accounts.listBalances().find((row) => row.accountId === f.rsd);
    expect(balance?.minorUnits).toBe(1000_00 - 1190 * 2);
    expect(f.transactions.spendByCategory({ from: "2026-02-01", to: "2026-02-28" })).toEqual([
      { categoryId: f.zabava, currency: "RSD", minorUnits: 1190 },
    ]);
  });

  it("refuses a `now` that is not an ISO instant and a `today` that is not a real day", () => {
    const f = fixture();
    netflix(f);
    expect(() => f.recurring.generateDue("juče", "2026-03-20")).toThrow(FinRecurringValidationError);
    expect(() => f.recurring.generateDue(NOW, "2026-02-30")).toThrow(FinRecurringValidationError);
  });
});

describe("FinRecurringStore — upcoming renewals (read from the RULE, never from rows)", () => {
  it("lists the occurrences inside a window, soonest first, across subscriptions", () => {
    const f = fixture();
    const netflixRow = netflix(f);
    const gym = netflix(f, {
      name: "Teretana",
      accountId: f.eur,
      categoryId: null,
      amount: -30_00,
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 20 }, end: { kind: "never" } },
      startDate: "2026-01-20",
      reminderDays: null,
    });

    expect(f.recurring.upcoming({ from: "2026-03-01", to: "2026-04-06" })).toEqual([
      {
        recurringId: netflixRow.id,
        date: "2026-03-05",
        name: "Netflix",
        accountId: f.rsd,
        currency: "RSD",
        categoryId: f.zabava,
        amount: -1190,
      },
      {
        recurringId: gym.id,
        date: "2026-03-20",
        name: "Teretana",
        accountId: f.eur,
        currency: "EUR",
        categoryId: null,
        amount: -30_00,
      },
      {
        recurringId: netflixRow.id,
        date: "2026-04-05",
        name: "Netflix",
        accountId: f.rsd,
        currency: "RSD",
        categoryId: f.zabava,
        amount: -1190,
      },
    ]);
  });

  it("stops at the series' own end and ignores soft-deleted subscriptions", () => {
    const f = fixture();
    const ending = netflix(f, {
      name: "Kurs",
      recurrence: {
        freq: { kind: "monthly-date", interval: 1, day: 5 },
        end: { kind: "until", date: "2026-02-05" },
      },
    });
    const gone = netflix(f, { name: "Ukinuto" });
    f.recurring.softDelete(gone.id, NOW);

    expect(f.recurring.upcoming({ from: "2026-01-01", to: "2026-06-30" })).toEqual([
      {
        recurringId: ending.id,
        date: "2026-01-05",
        name: "Kurs",
        accountId: f.rsd,
        currency: "RSD",
        categoryId: f.zabava,
        amount: -1190,
      },
      {
        recurringId: ending.id,
        date: "2026-02-05",
        name: "Kurs",
        accountId: f.rsd,
        currency: "RSD",
        categoryId: f.zabava,
        amount: -1190,
      },
    ]);
  });

  it("refuses a window that is not two real days, or one that runs backwards", () => {
    const f = fixture();
    expect(() => f.recurring.upcoming({ from: "2026-02-30", to: "2026-03-01" })).toThrow(
      FinRecurringValidationError,
    );
    expect(() => f.recurring.upcoming({ from: "2026-03-01", to: "2026-02-01" })).toThrow(
      FinRecurringValidationError,
    );
  });
});
