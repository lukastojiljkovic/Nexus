import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FinAccountStore,
  FinBudgetValidationError,
  FinCategoryNotFoundError,
  FinCategoryStore,
  FinCategoryValidationError,
  FinTransactionStore,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-02-01T10:00:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fin-categories-"));
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

function fixture(): { profileId: string; categories: FinCategoryStore } {
  const profileId = createProfile();
  return { profileId, categories: new FinCategoryStore(db.raw, profileId) };
}

describe("FinCategoryStore — flat categories with a kind", () => {
  it("creates a category, trimming its name", () => {
    const { categories, profileId } = fixture();
    const created = categories.create({ name: "  Hrana  ", kind: "expense" }, NOW);

    expect(created).toEqual({
      id: created.id,
      profileId,
      name: "Hrana",
      kind: "expense",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("lists categories sorted the way Serbian sorts them", () => {
    const { categories } = fixture();
    for (const name of ["Šoping", "Auto", "Čuvanje", "Zdravlje"]) {
      categories.create({ name, kind: "expense" }, NOW);
    }
    // sr-Latn tailoring: č sorts after c, š after s, and both before z.
    expect(categories.list().map((row) => row.name)).toEqual([
      "Auto",
      "Čuvanje",
      "Šoping",
      "Zdravlje",
    ]);
  });

  it("refuses a second category of the same name AND kind, but allows the other kind", () => {
    const { categories } = fixture();
    categories.create({ name: "Pokloni", kind: "expense" }, NOW);

    expect(() => categories.create({ name: "Pokloni", kind: "expense" }, NOW)).toThrow(
      FinCategoryValidationError,
    );
    // Gifts given and gifts received are two real categories.
    expect(() => categories.create({ name: "Pokloni", kind: "income" }, NOW)).not.toThrow();
  });

  it("refuses an empty name, an unknown kind and a malformed clock", () => {
    const { categories } = fixture();
    expect(() => categories.create({ name: " ", kind: "expense" }, NOW)).toThrow(
      FinCategoryValidationError,
    );
    expect(() =>
      categories.create({ name: "X", kind: "stednja" as unknown as "expense" }, NOW),
    ).toThrow(FinCategoryValidationError);
    expect(() => categories.create({ name: "X", kind: "expense" }, "juče")).toThrow(
      FinCategoryValidationError,
    );
  });

  it("renames a category and refuses a rename onto a taken name of the same kind", () => {
    const { categories } = fixture();
    const hrana = categories.create({ name: "Hrana", kind: "expense" }, NOW);
    categories.create({ name: "Prevoz", kind: "expense" }, NOW);

    categories.rename(hrana.id, "Namirnice", NOW);
    expect(categories.list().map((row) => row.name)).toEqual(["Namirnice", "Prevoz"]);
    // Renaming to its own current name is a no-op, not a collision.
    expect(() => categories.rename(hrana.id, "Namirnice", NOW)).not.toThrow();
    expect(() => categories.rename(hrana.id, "Prevoz", NOW)).toThrow(FinCategoryValidationError);
  });

  it("has no parentId anywhere — categories are flat by construction", () => {
    const { categories } = fixture();
    const created = categories.create({ name: "Hrana", kind: "expense" }, NOW);
    expect(Object.keys(created)).not.toContain("parentId");
  });

  it("deletes a category and leaves its transactions standing, uncategorized", () => {
    const { profileId, categories } = fixture();
    const accounts = new FinAccountStore(db.raw, profileId);
    const transactions = new FinTransactionStore(db.raw, profileId);
    const account = accounts.create({ name: "Tekući", kind: "current", currency: "RSD" }, NOW);
    const category = categories.create({ name: "Hrana", kind: "expense" }, NOW);
    const tx = transactions.create(
      { accountId: account.id, categoryId: category.id, date: "2026-02-02", amount: -12_00 },
      NOW,
    );

    categories.delete(category.id);
    expect(transactions.listActive().map((row) => ({ id: row.id, categoryId: row.categoryId })))
      .toEqual([{ id: tx.id, categoryId: null }]);
  });

  it("keeps another profile's categories invisible", () => {
    const { categories } = fixture();
    const created = categories.create({ name: "Hrana", kind: "expense" }, NOW);
    const other = new FinCategoryStore(db.raw, createProfile());

    expect(other.list()).toEqual([]);
    expect(() => other.rename(created.id, "X", NOW)).toThrow(FinCategoryNotFoundError);
    expect(() => other.delete(created.id)).toThrow(FinCategoryNotFoundError);
  });
});

describe("FinCategoryStore — budgets", () => {
  it("sets and re-sets a category's monthly allowance in one currency", () => {
    const { profileId, categories } = fixture();
    const category = categories.create({ name: "Hrana", kind: "expense" }, NOW);

    const budget = categories.setBudget(
      { categoryId: category.id, currency: "RSD", amount: 300_00 },
      NOW,
    );
    expect(budget).toEqual({
      id: budget.id,
      profileId,
      categoryId: category.id,
      currency: "RSD",
      amount: 30000,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const later = "2026-03-01T00:00:00.000Z";
    const raised = categories.setBudget(
      { categoryId: category.id, currency: "RSD", amount: 400_00 },
      later,
    );
    // The same allowance, raised — never a second row for the same currency.
    expect(raised.id).toBe(budget.id);
    expect(raised).toMatchObject({ amount: 40000, createdAt: NOW, updatedAt: later });
    expect(categories.listBudgets()).toEqual([raised]);
  });

  it("allows one allowance per currency, because there is no FX to fold them with", () => {
    const { categories } = fixture();
    const category = categories.create({ name: "Putovanja", kind: "expense" }, NOW);

    categories.setBudget({ categoryId: category.id, currency: "RSD", amount: 500_00 }, NOW);
    categories.setBudget({ categoryId: category.id, currency: "EUR", amount: 200_00 }, NOW);

    expect(categories.listBudgets().map((row) => [row.currency, row.amount])).toEqual([
      ["EUR", 20000],
      ["RSD", 50000],
    ]);
  });

  it("REFUSES a budget on an income category — a budget is a limit, not a target", () => {
    const { categories } = fixture();
    const plata = categories.create({ name: "Plata", kind: "income" }, NOW);

    expect(() =>
      categories.setBudget({ categoryId: plata.id, currency: "RSD", amount: 100_000_00 }, NOW),
    ).toThrow(FinBudgetValidationError);
  });

  it("refuses a non-positive or non-integer amount and a malformed currency", () => {
    const { categories } = fixture();
    const category = categories.create({ name: "Hrana", kind: "expense" }, NOW);

    for (const amount of [0, -1, 12.5, Number.NaN, 2 ** 53]) {
      expect(() =>
        categories.setBudget({ categoryId: category.id, currency: "RSD", amount }, NOW),
      ).toThrow(FinBudgetValidationError);
    }
    expect(() =>
      categories.setBudget({ categoryId: category.id, currency: "rsd", amount: 100 }, NOW),
    ).toThrow(FinBudgetValidationError);
  });

  it("refuses a budget against a category of another profile", () => {
    const { categories } = fixture();
    const category = categories.create({ name: "Hrana", kind: "expense" }, NOW);
    const other = new FinCategoryStore(db.raw, createProfile());

    expect(() =>
      other.setBudget({ categoryId: category.id, currency: "RSD", amount: 100 }, NOW),
    ).toThrow(FinCategoryNotFoundError);
  });

  it("drops a category's budgets when the category goes", () => {
    const { categories } = fixture();
    const category = categories.create({ name: "Hrana", kind: "expense" }, NOW);
    categories.setBudget({ categoryId: category.id, currency: "RSD", amount: 300_00 }, NOW);

    categories.delete(category.id);
    expect(categories.listBudgets()).toEqual([]);
  });

  it("clears one allowance without touching the category's other currency", () => {
    const { categories } = fixture();
    const category = categories.create({ name: "Putovanja", kind: "expense" }, NOW);
    categories.setBudget({ categoryId: category.id, currency: "RSD", amount: 500_00 }, NOW);
    categories.setBudget({ categoryId: category.id, currency: "EUR", amount: 200_00 }, NOW);

    categories.clearBudget(category.id, "RSD");
    expect(categories.listBudgets().map((row) => row.currency)).toEqual(["EUR"]);
  });
});
