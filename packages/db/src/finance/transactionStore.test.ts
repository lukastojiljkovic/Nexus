import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FinAccountNotFoundError,
  FinAccountStore,
  FinCategoryNotFoundError,
  FinCategoryStore,
  FinTransactionNotFoundError,
  FinTransactionStore,
  FinTransactionValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-02-01T10:00:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fin-transactions-"));
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
  rsd: string;
  savings: string;
  eur: string;
  hrana: string;
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
    rsd: accounts.create(
      { name: "Tekući", kind: "current", currency: "RSD", openingBalance: 1000_00 },
      NOW,
    ).id,
    savings: accounts.create({ name: "Štednja", kind: "savings", currency: "RSD" }, NOW).id,
    eur: accounts.create({ name: "Devizni", kind: "savings", currency: "EUR" }, NOW).id,
    hrana: categories.create({ name: "Hrana", kind: "expense" }, NOW).id,
    plata: categories.create({ name: "Plata", kind: "income" }, NOW).id,
  };
}

describe("FinTransactionStore — CRUD", () => {
  it("creates a transaction and reads it back", () => {
    const f = fixture();
    const created = f.transactions.create(
      {
        accountId: f.rsd,
        categoryId: f.hrana,
        date: "2026-02-02",
        amount: -12_50,
        payee: "  Maxi  ",
        note: "  nedeljna kupovina  ",
      },
      NOW,
    );

    expect(created).toEqual({
      id: created.id,
      profileId: f.profileId,
      accountId: f.rsd,
      counterAccountId: null,
      categoryId: f.hrana,
      date: "2026-02-02",
      amount: -1250,
      payee: "Maxi",
      note: "nedeljna kupovina",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(f.transactions.listActive()).toEqual([created]);
  });

  it("collapses a blank payee or note to null", () => {
    const f = fixture();
    const created = f.transactions.create(
      { accountId: f.rsd, date: "2026-02-02", amount: -100, payee: "   ", note: "" },
      NOW,
    );
    expect({ payee: created.payee, note: created.note }).toEqual({ payee: null, note: null });
  });

  it("refuses a date that is not a real bare calendar day", () => {
    const f = fixture();
    for (const date of ["2026-02-30", "2026-2-2", "2026-02-02T10:00:00Z", "juce", ""]) {
      expect(() => f.transactions.create({ accountId: f.rsd, date, amount: -100 }, NOW)).toThrow(
        FinTransactionValidationError,
      );
    }
  });

  it("refuses an amount that is not a non-zero safe integer of minor units", () => {
    const f = fixture();
    for (const amount of [0, 12.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() =>
        f.transactions.create({ accountId: f.rsd, date: "2026-02-02", amount }, NOW),
      ).toThrow(FinTransactionValidationError);
    }
  });

  it("refuses an account or a category belonging to another profile", () => {
    const f = fixture();
    const other = new FinTransactionStore(db.raw, createProfile());

    expect(() => other.create({ accountId: f.rsd, date: "2026-02-02", amount: -100 }, NOW)).toThrow(
      FinAccountNotFoundError,
    );

    const mine = new FinAccountStore(db.raw, createProfile());
    const theirAccount = mine.create({ name: "T", kind: "cash", currency: "RSD" }, NOW).id;
    expect(() =>
      f.transactions.create({ accountId: theirAccount, date: "2026-02-02", amount: -100 }, NOW),
    ).toThrow(FinAccountNotFoundError);
    expect(() =>
      f.transactions.create(
        { accountId: f.rsd, categoryId: uuidv7(), date: "2026-02-02", amount: -100 },
        NOW,
      ),
    ).toThrow(FinCategoryNotFoundError);
  });

  it("accepts a REFUND: money coming back under the expense category it went out of", () => {
    const f = fixture();
    // A returned purchase is not income and not a new category — it is the same
    // label with the other sign, and refusing it would force the user to either
    // lose the label or invent „Povraćaj". The kind classifies; the sign carries
    // the direction.
    expect(() =>
      f.transactions.create(
        { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-06", amount: 3_00 },
        NOW,
      ),
    ).not.toThrow();
  });

  it("updates a partial patch and re-stamps updatedAt", () => {
    const f = fixture();
    const created = f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-02", amount: -12_50 },
      NOW,
    );
    const later = "2026-03-01T00:00:00.000Z";

    const updated = f.transactions.update(created.id, { amount: -20_00, payee: "Idea" }, later);
    expect(updated).toEqual({ ...created, amount: -2000, payee: "Idea", updatedAt: later });

    // An omitted key leaves the category alone; an explicit null clears it.
    expect(f.transactions.update(created.id, { date: "2026-02-03" }, later).categoryId).toBe(
      f.hrana,
    );
    expect(f.transactions.update(created.id, { categoryId: null }, later).categoryId).toBeNull();
  });

  it("soft-deletes and restores", () => {
    const f = fixture();
    const created = f.transactions.create(
      { accountId: f.rsd, date: "2026-02-02", amount: -100 },
      NOW,
    );

    f.transactions.softDelete(created.id, NOW);
    expect(f.transactions.listActive()).toEqual([]);
    expect(() => f.transactions.softDelete(created.id, NOW)).toThrow(FinTransactionNotFoundError);

    f.transactions.restore(created.id, NOW);
    expect(f.transactions.listActive().map((row) => row.id)).toEqual([created.id]);
  });
});

describe("FinTransactionStore — transfers are ONE row", () => {
  it("stores a transfer as a single row naming both sides", () => {
    const f = fixture();
    const transfer = f.transactions.create(
      { accountId: f.rsd, counterAccountId: f.savings, date: "2026-02-04", amount: -300_00 },
      NOW,
    );

    expect(transfer.counterAccountId).toBe(f.savings);
    expect(f.transactions.listActive()).toHaveLength(1);
  });

  it("refuses a transfer whose two sides are the same account", () => {
    const f = fixture();
    expect(() =>
      f.transactions.create(
        { accountId: f.rsd, counterAccountId: f.rsd, date: "2026-02-04", amount: -100 },
        NOW,
      ),
    ).toThrow(FinTransactionValidationError);
  });

  it("refuses a transfer across two currencies — there is no FX in this app", () => {
    const f = fixture();
    expect(() =>
      f.transactions.create(
        { accountId: f.rsd, counterAccountId: f.eur, date: "2026-02-04", amount: -100 },
        NOW,
      ),
    ).toThrow(FinTransactionValidationError);
    // And the refusal says WHY, so nobody reads it as a missing feature.
    expect(() =>
      f.transactions.create(
        { accountId: f.rsd, counterAccountId: f.eur, date: "2026-02-04", amount: -100 },
        NOW,
      ),
    ).toThrow(/exchange rate/i);
  });

  it("refuses a category on a transfer — it is neither income nor expense", () => {
    const f = fixture();
    expect(() =>
      f.transactions.create(
        {
          accountId: f.rsd,
          counterAccountId: f.savings,
          categoryId: f.hrana,
          date: "2026-02-04",
          amount: -100,
        },
        NOW,
      ),
    ).toThrow(FinTransactionValidationError);
  });

  it("re-checks both transfer rules when an update introduces the counter account", () => {
    const f = fixture();
    const created = f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-02", amount: -100 },
      NOW,
    );

    // The row still carries a category, so making it a transfer must refuse.
    expect(() => f.transactions.update(created.id, { counterAccountId: f.savings }, NOW)).toThrow(
      FinTransactionValidationError,
    );
    expect(() =>
      f.transactions.update(created.id, { counterAccountId: f.eur, categoryId: null }, NOW),
    ).toThrow(FinTransactionValidationError);
    expect(() =>
      f.transactions.update(created.id, { counterAccountId: f.savings, categoryId: null }, NOW),
    ).not.toThrow();
  });
});

describe("FinTransactionStore — spend per category, per currency", () => {
  it("sums a period's expenses per category and currency, excluding transfers", () => {
    const f = fixture();
    const eurFood = f.categories.create({ name: "Restorani", kind: "expense" }, NOW).id;

    f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-02", amount: -12_00 },
      NOW,
    );
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-20", amount: -8_00 },
      NOW,
    );
    f.transactions.create(
      { accountId: f.eur, categoryId: eurFood, date: "2026-02-10", amount: -30_00 },
      NOW,
    );
    // Outside the window, a transfer, and an income row: none of the three is spend.
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-03-02", amount: -99_00 },
      NOW,
    );
    f.transactions.create(
      { accountId: f.rsd, counterAccountId: f.savings, date: "2026-02-15", amount: -500_00 },
      NOW,
    );
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.plata, date: "2026-02-05", amount: 1000_00 },
      NOW,
    );

    expect(f.transactions.spendByCategory({ from: "2026-02-01", to: "2026-02-28" })).toEqual([
      { categoryId: eurFood, currency: "EUR", minorUnits: 3000 },
      { categoryId: f.hrana, currency: "RSD", minorUnits: 2000 },
    ]);
  });

  it("nets a refund off the line it was refunded on", () => {
    const f = fixture();
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-02", amount: -12_00 },
      NOW,
    );
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-06", amount: 3_00 },
      NOW,
    );

    expect(f.transactions.spendByCategory({ from: "2026-02-01", to: "2026-02-28" })).toEqual([
      { categoryId: f.hrana, currency: "RSD", minorUnits: 900 },
    ]);
  });

  it("counts an uncategorized expense under a null category rather than dropping it", () => {
    const f = fixture();
    f.transactions.create({ accountId: f.rsd, date: "2026-02-02", amount: -7_00 }, NOW);

    expect(f.transactions.spendByCategory({ from: "2026-02-01", to: "2026-02-28" })).toEqual([
      { categoryId: null, currency: "RSD", minorUnits: 700 },
    ]);
  });

  /**
   * The invariant the whole module leans on, tested ALONE rather than as one
   * row among others: a transfer carries NO category, so the only thing keeping
   * it out of the uncategorized line is `fin_flows` — the view it is absent
   * from. A later change that pointed either aggregate at `fin_transactions`
   * would still pass every other test in this file and quietly turn every
   * transfer into spending.
   */
  it("never counts a transfer as spending — not even as an uncategorized line", () => {
    const f = fixture();
    f.transactions.create(
      { accountId: f.rsd, counterAccountId: f.savings, date: "2026-02-15", amount: -500_00 },
      NOW,
    );

    const period = { from: "2026-02-01", to: "2026-02-28" };
    expect(f.transactions.spendByCategory(period)).toEqual([]);
    // Nor as income on the receiving side, which the same view forecloses.
    expect(f.transactions.incomeByCurrency(period)).toEqual([]);
  });

  it("puts the uncategorized line last within its currency", () => {
    const f = fixture();
    f.transactions.create({ accountId: f.rsd, date: "2026-02-02", amount: -7_00 }, NOW);
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-02", amount: -1_00 },
      NOW,
    );

    expect(
      f.transactions
        .spendByCategory({ from: "2026-02-01", to: "2026-02-28" })
        .map((row) => row.categoryId),
    ).toEqual([f.hrana, null]);
  });

  it("ignores soft-deleted rows and refuses a backwards or malformed period", () => {
    const f = fixture();
    const tx = f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-02", amount: -7_00 },
      NOW,
    );
    f.transactions.softDelete(tx.id, NOW);

    expect(f.transactions.spendByCategory({ from: "2026-02-01", to: "2026-02-28" })).toEqual([]);
    expect(() => f.transactions.spendByCategory({ from: "2026-02-28", to: "2026-02-01" })).toThrow(
      FinTransactionValidationError,
    );
    expect(() => f.transactions.spendByCategory({ from: "juce", to: "2026-02-01" })).toThrow(
      FinTransactionValidationError,
    );
  });

  it("keeps another profile's rows out of every read", () => {
    const f = fixture();
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-02", amount: -7_00 },
      NOW,
    );
    const other = new FinTransactionStore(db.raw, createProfile());

    expect(other.listActive()).toEqual([]);
    expect(other.spendByCategory({ from: "2026-02-01", to: "2026-02-28" })).toEqual([]);
    expect(other.incomeByCurrency({ from: "2026-02-01", to: "2026-02-28" })).toEqual([]);
  });
});

describe("FinTransactionStore — income per currency", () => {
  it("sums a period's income per currency and answers with a LIST, never one number", () => {
    const f = fixture();
    const eurIncome = f.categories.create({ name: "Honorar", kind: "income" }, NOW).id;

    f.transactions.create(
      { accountId: f.rsd, categoryId: f.plata, date: "2026-02-05", amount: 1000_00 },
      NOW,
    );
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.plata, date: "2026-02-25", amount: 200_00 },
      NOW,
    );
    f.transactions.create(
      { accountId: f.eur, categoryId: eurIncome, date: "2026-02-10", amount: 300_00 },
      NOW,
    );
    // Outside the window, and an expense: neither is this month's income.
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.plata, date: "2026-03-05", amount: 999_00 },
      NOW,
    );
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.hrana, date: "2026-02-02", amount: -12_00 },
      NOW,
    );

    expect(f.transactions.incomeByCurrency({ from: "2026-02-01", to: "2026-02-28" })).toEqual([
      { currency: "EUR", minorUnits: 30000 },
      { currency: "RSD", minorUnits: 120000 },
    ]);
  });

  /**
   * The partition this method and `spendByCategory` make between them: an
   * income category is income, everything else on the view — an expense
   * category or NO category — is the spending side. Nothing is counted twice
   * and nothing falls between them.
   */
  it("leaves the uncategorized rows to the spending side rather than claiming them", () => {
    const f = fixture();
    f.transactions.create({ accountId: f.rsd, date: "2026-02-02", amount: 40_00 }, NOW);

    const period = { from: "2026-02-01", to: "2026-02-28" };
    expect(f.transactions.incomeByCurrency(period)).toEqual([]);
    // Sign carries direction: an unlabelled arrival nets OFF the uncategorized
    // spending line, exactly as a refund does on its own category.
    expect(f.transactions.spendByCategory(period)).toEqual([
      { categoryId: null, currency: "RSD", minorUnits: -4000 },
    ]);
  });

  it("nets a clawback off the income it was clawed back from", () => {
    const f = fixture();
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.plata, date: "2026-02-05", amount: 1000_00 },
      NOW,
    );
    f.transactions.create(
      { accountId: f.rsd, categoryId: f.plata, date: "2026-02-20", amount: -150_00 },
      NOW,
    );

    expect(f.transactions.incomeByCurrency({ from: "2026-02-01", to: "2026-02-28" })).toEqual([
      { currency: "RSD", minorUnits: 85000 },
    ]);
  });

  it("ignores soft-deleted rows and refuses a backwards or malformed period", () => {
    const f = fixture();
    const tx = f.transactions.create(
      { accountId: f.rsd, categoryId: f.plata, date: "2026-02-05", amount: 1000_00 },
      NOW,
    );
    f.transactions.softDelete(tx.id, NOW);

    expect(f.transactions.incomeByCurrency({ from: "2026-02-01", to: "2026-02-28" })).toEqual([]);
    expect(() => f.transactions.incomeByCurrency({ from: "2026-02-28", to: "2026-02-01" })).toThrow(
      FinTransactionValidationError,
    );
    expect(() => f.transactions.incomeByCurrency({ from: "juce", to: "2026-02-01" })).toThrow(
      FinTransactionValidationError,
    );
  });
});
