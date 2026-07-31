import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FinAccountNotFoundError,
  FinAccountStore,
  FinAccountValidationError,
  FinTransactionStore,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-02-01T10:00:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fin-accounts-"));
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

function fixture(): { profileId: string; accounts: FinAccountStore } {
  const profileId = createProfile();
  return { profileId, accounts: new FinAccountStore(db.raw, profileId) };
}

describe("FinAccountStore — CRUD", () => {
  it("creates an account and reads it back", () => {
    const { accounts, profileId } = fixture();
    const created = accounts.create(
      { name: "  Tekući  ", kind: "current", currency: "RSD", openingBalance: 125_00 },
      NOW,
    );

    expect(created).toEqual({
      id: created.id,
      profileId,
      name: "Tekući",
      kind: "current",
      currency: "RSD",
      openingBalance: 12500,
      archived: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(accounts.listActive()).toEqual([created]);
  });

  it("defaults the opening balance to zero", () => {
    const { accounts } = fixture();
    expect(accounts.create({ name: "Gotovina", kind: "cash", currency: "RSD" }, NOW).openingBalance)
      .toBe(0);
  });

  it("upper-cases nothing — a currency must arrive as a valid ISO-4217 code", () => {
    const { accounts } = fixture();
    expect(() =>
      accounts.create({ name: "A", kind: "cash", currency: "rsd" }, NOW),
    ).toThrow(FinAccountValidationError);
    expect(() =>
      accounts.create({ name: "A", kind: "cash", currency: "EURO" }, NOW),
    ).toThrow(FinAccountValidationError);
    expect(() =>
      accounts.create({ name: "A", kind: "cash", currency: "R1D" }, NOW),
    ).toThrow(FinAccountValidationError);
  });

  it("refuses an opening balance that is not a safe integer of minor units", () => {
    const { accounts } = fixture();
    for (const openingBalance of [12.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() =>
        accounts.create({ name: "A", kind: "cash", currency: "RSD", openingBalance }, NOW),
      ).toThrow(FinAccountValidationError);
    }
  });

  it("refuses an empty name, an unknown kind and a malformed clock", () => {
    const { accounts } = fixture();
    expect(() => accounts.create({ name: "   ", kind: "cash", currency: "RSD" }, NOW)).toThrow(
      FinAccountValidationError,
    );
    expect(() =>
      accounts.create(
        { name: "A", kind: "kripto" as unknown as "cash", currency: "RSD" },
        NOW,
      ),
    ).toThrow(FinAccountValidationError);
    expect(() =>
      accounts.create({ name: "A", kind: "cash", currency: "RSD" }, "juče"),
    ).toThrow(FinAccountValidationError);
  });

  it("updates a partial field patch and re-stamps updatedAt", () => {
    const { accounts } = fixture();
    const created = accounts.create({ name: "Tekući", kind: "current", currency: "RSD" }, NOW);
    const later = "2026-03-01T08:00:00.000Z";

    const updated = accounts.update(created.id, { name: "Glavni", archived: true }, later);
    expect(updated).toEqual({ ...created, name: "Glavni", archived: true, updatedAt: later });
    // The untouched fields really are untouched.
    expect(updated.currency).toBe("RSD");
    expect(updated.kind).toBe("current");
  });

  it("soft-deletes and restores, and keeps a deleted account out of the live list", () => {
    const { accounts } = fixture();
    const created = accounts.create({ name: "Tekući", kind: "current", currency: "RSD" }, NOW);

    accounts.softDelete(created.id, NOW);
    expect(accounts.listActive()).toEqual([]);
    expect(() => accounts.update(created.id, { name: "X" }, NOW)).toThrow(FinAccountNotFoundError);

    accounts.restore(created.id, NOW);
    expect(accounts.listActive().map((row) => row.id)).toEqual([created.id]);
  });

  it("keeps another profile's accounts invisible", () => {
    const { accounts } = fixture();
    const created = accounts.create({ name: "Tekući", kind: "current", currency: "RSD" }, NOW);
    const other = new FinAccountStore(db.raw, createProfile());

    expect(other.listActive()).toEqual([]);
    expect(() => other.update(created.id, { name: "X" }, NOW)).toThrow(FinAccountNotFoundError);
    expect(() => other.softDelete(created.id, NOW)).toThrow(FinAccountNotFoundError);
  });
});

describe("FinAccountStore — derived balances (never stored)", () => {
  it("derives a balance as the opening balance plus this account's transactions", () => {
    const { profileId, accounts } = fixture();
    const transactions = new FinTransactionStore(db.raw, profileId);
    const account = accounts.create(
      { name: "Tekući", kind: "current", currency: "RSD", openingBalance: 100_00 },
      NOW,
    );

    transactions.create({ accountId: account.id, date: "2026-02-02", amount: -25_00 }, NOW);
    transactions.create({ accountId: account.id, date: "2026-02-03", amount: 5_00 }, NOW);

    expect(accounts.listBalances()).toEqual([
      { accountId: account.id, currency: "RSD", minorUnits: 100_00 - 25_00 + 5_00 },
    ]);
  });

  it("counts a transfer once on each side, from its ONE row", () => {
    const { profileId, accounts } = fixture();
    const transactions = new FinTransactionStore(db.raw, profileId);
    const from = accounts.create(
      { name: "Tekući", kind: "current", currency: "RSD", openingBalance: 100_00 },
      NOW,
    );
    const to = accounts.create(
      { name: "Štednja", kind: "savings", currency: "RSD", openingBalance: 0 },
      NOW,
    );

    transactions.create(
      { accountId: from.id, counterAccountId: to.id, date: "2026-02-04", amount: -30_00 },
      NOW,
    );

    const byId = new Map(accounts.listBalances().map((row) => [row.accountId, row.minorUnits]));
    expect(byId.get(from.id)).toBe(70_00);
    expect(byId.get(to.id)).toBe(30_00);
  });

  it("ignores soft-deleted transactions in the derivation", () => {
    const { profileId, accounts } = fixture();
    const transactions = new FinTransactionStore(db.raw, profileId);
    const account = accounts.create(
      { name: "Tekući", kind: "current", currency: "RSD", openingBalance: 100_00 },
      NOW,
    );
    const tx = transactions.create(
      { accountId: account.id, date: "2026-02-02", amount: -25_00 },
      NOW,
    );

    transactions.softDelete(tx.id, NOW);
    expect(accounts.listBalances()[0]?.minorUnits).toBe(100_00);
  });

  it("reports a balance for an archived account and none for a soft-deleted one", () => {
    const { accounts } = fixture();
    const archived = accounts.create(
      { name: "Stari", kind: "card", currency: "RSD", openingBalance: 10_00 },
      NOW,
    );
    const trashed = accounts.create({ name: "Greška", kind: "cash", currency: "RSD" }, NOW);
    accounts.update(archived.id, { archived: true }, NOW);
    accounts.softDelete(trashed.id, NOW);

    expect(accounts.listBalances().map((row) => row.accountId)).toEqual([archived.id]);
  });
});

describe("FinAccountStore — totals are per currency, never across them", () => {
  it("groups the totals by currency", () => {
    const { profileId, accounts } = fixture();
    const transactions = new FinTransactionStore(db.raw, profileId);
    const rsd = accounts.create(
      { name: "Tekući", kind: "current", currency: "RSD", openingBalance: 100_00 },
      NOW,
    );
    accounts.create(
      { name: "Devizni", kind: "savings", currency: "EUR", openingBalance: 50_00 },
      NOW,
    );
    transactions.create({ accountId: rsd.id, date: "2026-02-02", amount: -20_00 }, NOW);

    // Sorted by currency code so the answer is stable for a caller drawing it.
    expect(accounts.totalsByCurrency()).toEqual([
      { currency: "EUR", minorUnits: 50_00 },
      { currency: "RSD", minorUnits: 80_00 },
    ]);
  });

  it("leaves an archived account out of the net-worth totals but a zero-balance one in", () => {
    const { accounts } = fixture();
    accounts.create({ name: "Prazan", kind: "cash", currency: "RSD", openingBalance: 0 }, NOW);
    const archived = accounts.create(
      { name: "Stari", kind: "card", currency: "RSD", openingBalance: 999_00 },
      NOW,
    );
    accounts.update(archived.id, { archived: true }, NOW);

    expect(accounts.totalsByCurrency()).toEqual([{ currency: "RSD", minorUnits: 0 }]);
  });

  it("has no method that could return a single cross-currency number", () => {
    const { accounts } = fixture();
    // The structural half of "no FX": every total-shaped read answers with a
    // per-currency collection, so a caller cannot accidentally ask for a sum
    // across currencies — there is no such call to make.
    for (const method of ["total", "netWorth", "balance", "sum"]) {
      expect(method in accounts).toBe(false);
    }
    expect(Array.isArray(accounts.totalsByCurrency())).toBe(true);
  });
});
