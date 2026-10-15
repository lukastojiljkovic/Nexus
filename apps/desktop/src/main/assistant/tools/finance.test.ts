import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FinAccountStore,
  FinCategoryStore,
  FinRecurringStore,
  FinTransactionStore,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { financeTools } from "./finance.js";

/**
 * The FINANCE tools over a real database.
 *
 * What this suite pins is the answer, not the wiring: every amount reads in its
 * own currency, a summary never adds two currencies together, a name resolves the
 * way the ledger's own fold does, and a write asks first and then writes exactly
 * the row the store writes for the same input.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-finance-"));
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

function accounts(): FinAccountStore {
  return new FinAccountStore(db.raw, profileId);
}

function categories(): FinCategoryStore {
  return new FinCategoryStore(db.raw, profileId);
}

function transactions(): FinTransactionStore {
  return new FinTransactionStore(db.raw, profileId);
}

function subscriptions(): FinRecurringStore {
  return new FinRecurringStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return financeTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function contextFor(
  locale: "sr" | "en",
  allow: boolean,
): { readonly context: ToolContext; readonly confirms: ConfirmRequest[] } {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

/** The no-break space `Intl` puts between an amount and its code in Serbian. */
const NBSP = " ";

/** A monthly rule on the 5th, valid for the rule engine. */
const MONTHLY_ON_FIFTH = {
  freq: { kind: "monthly-date", interval: 1, day: 5 },
  end: { kind: "never" },
} as const;

describe("finance.summary", () => {
  it("answers per currency and never adds two currencies together", async () => {
    const dinars = accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD", openingBalance: 100_000 }, NOW_ISO);
    const euros = accounts().create({ name: "Evro", kind: "savings", currency: "EUR", openingBalance: 5_000 }, NOW_ISO);
    const food = categories().create({ name: "Hrana", kind: "expense" }, NOW_ISO);
    const salary = categories().create({ name: "Plata", kind: "income" }, NOW_ISO);
    transactions().create({ accountId: dinars.id, categoryId: food.id, date: "2026-10-03", amount: -125_000 }, NOW_ISO);
    transactions().create({ accountId: dinars.id, categoryId: salary.id, date: "2026-10-02", amount: 50_000 }, NOW_ISO);
    transactions().create({ accountId: euros.id, date: "2026-10-04", amount: -1_000 }, NOW_ISO);

    const { context } = contextFor("sr", true);
    const result = await toolOf("finance.summary").run({}, context);

    expect(result.ok).toBe(true);
    const lines = result.content.split("\n");
    // One block per currency, each headed by its own code.
    expect(lines).toContain("EUR");
    expect(lines).toContain("RSD");
    // RSD: 1000,00 opening + 500,00 income − 1250,00 spent = 250,00; EUR: 50,00 − 10,00 = 40,00.
    expect(result.content).toContain(`250,00${NBSP}RSD`);
    expect(result.content).toContain(`40,00${NBSP}EUR`);
    // Each currency keeps its own spending line: nothing is totalled across them.
    expect(result.content).toContain(`1.250,00${NBSP}RSD`);
    expect(result.content).toContain(`10,00${NBSP}EUR`);
  });

  it("says plainly when the profile has no money yet", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("finance.summary").run({}, context);
    expect(result).toEqual({ ok: true, content: "This profile has no accounts or transactions yet." });
  });
});

describe("finance.transactions", () => {
  it("filters by a folded payee query and caps the list, saying so", async () => {
    const account = accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    for (let day = 1; day <= 3; day += 1) {
      transactions().create(
        { accountId: account.id, date: `2026-10-0${day}`, amount: -1_000 * day, payee: day === 2 ? "Đuveč Bazar" : "Maxi" },
        NOW_ISO,
      );
    }
    const { context } = contextFor("sr", true);
    const matched = await toolOf("finance.transactions").run({ query: "djuvec" }, context);
    expect(matched.ok).toBe(true);
    expect(matched.content).toContain("Đuveč Bazar");
    expect(matched.content).not.toContain("Maxi");

    const capped = await toolOf("finance.transactions").run({ limit: 2 }, context);
    expect(capped.content).toContain("Transakcije (3):");
    expect(capped.content).toContain("Prikazano je samo prvih 2 stavki.");
  });

  it("refuses an unknown account by name, with the accounts that exist", async () => {
    accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    const { context } = contextFor("en", true);
    const result = await toolOf("finance.transactions").run({ account: "Savings" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("No account named “Savings”. This profile's accounts: Tekući račun.");
  });
});

describe("finance.budgets", () => {
  it("answers limit, spent and what is left, in the budget's currency", async () => {
    const account = accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    const food = categories().create({ name: "Hrana", kind: "expense" }, NOW_ISO);
    categories().setBudget({ categoryId: food.id, currency: "RSD", amount: 1_500_000 }, NOW_ISO);
    transactions().create({ accountId: account.id, categoryId: food.id, date: "2026-10-03", amount: -400_000 }, NOW_ISO);

    const { context } = contextFor("en", true);
    const result = await toolOf("finance.budgets").run({}, context);
    // English puts the code first: "RSD 15,000.00".
    expect(result.content).toContain(`- Hrana (RSD): limit RSD${NBSP}15,000.00, spent RSD${NBSP}4,000.00, left RSD${NBSP}11,000.00`);
  });
});

describe("finance.subscriptions", () => {
  it("lists a paused subscription but charges it in no window", async () => {
    const account = accounts().create({ name: "Kartica", kind: "card", currency: "RSD" }, NOW_ISO);
    subscriptions().create(
      { accountId: account.id, name: "Netflix", amount: -120_000, recurrence: { ...MONTHLY_ON_FIFTH, freq: { kind: "monthly-date", interval: 1, day: 12 } }, startDate: "2026-10-12" },
      NOW_ISO,
    );
    const paused = subscriptions().create(
      { accountId: account.id, name: "Teretana", amount: -300_000, recurrence: { ...MONTHLY_ON_FIFTH, freq: { kind: "monthly-date", interval: 1, day: 11 } }, startDate: "2026-10-11" },
      NOW_ISO,
    );
    subscriptions().pause(paused.id, NOW_ISO);

    const { context } = contextFor("en", true);
    const result = await toolOf("finance.subscriptions").run({ days: 7 }, context);
    expect(result.ok).toBe(true);
    const [listed, renewals = ""] = result.content.split("Charges in the next 7 days:");
    expect(listed).toContain("Teretana");
    expect(listed).toContain("paused");
    expect(renewals).toContain("2026-10-12 Netflix");
    expect(renewals).not.toContain("Teretana");
  });
});

describe("finance.record", () => {
  it("records an expense in minor units, asks first, and lands on the ledger", async () => {
    const account = accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    const food = categories().create({ name: "Hrana", kind: "expense" }, NOW_ISO);
    const { context, confirms } = contextFor("sr", true);

    const result = await toolOf("finance.record").run(
      { account: "tekuci racun", amount: 12.5, kind: "expense", category: "hrana", date: "2026-10-12" },
      context,
    );

    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.summary).toContain(`12,50${NBSP}RSD`);
    expect(result.ok).toBe(true);
    expect(result.navigateTo).toEqual({ module: "finance" });
    const [row] = transactions().listActive();
    expect(row?.amount).toBe(-1_250);
    expect(row?.categoryId).toBe(food.id);
    expect(row?.accountId).toBe(account.id);
  });

  it("writes nothing when the user declines", async () => {
    accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    const { context } = contextFor("en", false);
    const result = await toolOf("finance.record").run({ account: "Tekući račun", amount: 5, kind: "income" }, context);
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(transactions().listActive()).toHaveLength(0);
  });

  it("refuses a decimal the currency cannot hold, and never rounds it", async () => {
    accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("finance.record").run({ account: "Tekući račun", amount: 12.345, kind: "expense" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("at most 2 decimal places");
    expect(confirms).toHaveLength(0);
  });

  it("refuses a category of the other kind, listing the ones it may use", async () => {
    accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    categories().create({ name: "Plata", kind: "income" }, NOW_ISO);
    categories().create({ name: "Hrana", kind: "expense" }, NOW_ISO);
    const { context } = contextFor("en", true);
    const result = await toolOf("finance.record").run(
      { account: "Tekući račun", amount: 10, kind: "expense", category: "Plata" },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Categories for this kind: Hrana.");
  });

  it("moves money between two accounts of one currency as one signed transfer row", async () => {
    const checking = accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    const savings = accounts().create({ name: "Štednja", kind: "savings", currency: "RSD" }, NOW_ISO);
    const { context } = contextFor("en", true);
    const result = await toolOf("finance.record").run(
      { account: "Tekući račun", counterAccount: "Štednja", amount: 50, date: "2026-10-12" },
      context,
    );
    expect(result.ok).toBe(true);
    const [row] = transactions().listActive();
    expect(row?.amount).toBe(-5_000);
    expect(row?.accountId).toBe(checking.id);
    expect(row?.counterAccountId).toBe(savings.id);
  });

  it("refuses a transfer across currencies and a transfer with a kind or a category", async () => {
    accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    accounts().create({ name: "Evro", kind: "savings", currency: "EUR" }, NOW_ISO);
    const { context, confirms } = contextFor("en", true);
    const across = await toolOf("finance.record").run({ account: "Tekući račun", counterAccount: "Evro", amount: 5 }, context);
    expect(across.content).toContain("cannot cross currencies");
    const withKind = await toolOf("finance.record").run({ account: "Tekući račun", counterAccount: "Evro", amount: 5, kind: "expense" }, context);
    expect(withKind.content).toContain("leave “kind” out");
    expect(confirms).toHaveLength(0);
  });

  it("refuses an ambiguous account name with the candidates and their ids", async () => {
    const first = accounts().create({ name: "Račun", kind: "current", currency: "RSD" }, NOW_ISO);
    accounts().create({ name: "racun", kind: "cash", currency: "RSD" }, NOW_ISO);
    const { context } = contextFor("en", true);
    const result = await toolOf("finance.record").run({ account: "RACUN", amount: 5, kind: "income" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("“RACUN” matches more than one account:");
    expect(result.content).toContain(`Račun (${first.id})`);
    expect(result.content).toContain("racun (");
  });
});

describe("finance.budget", () => {
  it("sets a budget in the one currency the accounts share, and clears it", async () => {
    accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    const food = categories().create({ name: "Hrana", kind: "expense" }, NOW_ISO);
    const { context, confirms } = contextFor("en", true);

    const set = await toolOf("finance.budget").run({ action: "set", category: "hrana", amount: 15_000 }, context);
    expect(set.ok).toBe(true);
    expect(confirms[0]?.summary).toContain("15,000.00");
    expect(categories().listBudgets()).toEqual([
      expect.objectContaining({ categoryId: food.id, currency: "RSD", amount: 1_500_000 }),
    ]);

    const cleared = await toolOf("finance.budget").run({ action: "clear", category: "Hrana" }, context);
    expect(cleared.ok).toBe(true);
    expect(categories().listBudgets()).toHaveLength(0);
  });

  it("asks which currency when the accounts use several and none is named", async () => {
    accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    accounts().create({ name: "Evro", kind: "savings", currency: "EUR" }, NOW_ISO);
    categories().create({ name: "Hrana", kind: "expense" }, NOW_ISO);
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("finance.budget").run({ action: "set", category: "Hrana", amount: 100 }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("The currencies of this profile's accounts: EUR, RSD.");
    expect(confirms).toHaveLength(0);
  });

  it("refuses an income category, since only an expense can carry a budget", async () => {
    accounts().create({ name: "Tekući račun", kind: "current", currency: "RSD" }, NOW_ISO);
    categories().create({ name: "Plata", kind: "income" }, NOW_ISO);
    const { context } = contextFor("en", true);
    const result = await toolOf("finance.budget").run({ action: "set", category: "Plata", amount: 100 }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("No category named “Plata”");
  });
});

describe("finance.subscription", () => {
  it("maps each cadence to the rule the page's picker builds, and stores the sign of its kind", async () => {
    const account = accounts().create({ name: "Kartica", kind: "card", currency: "RSD" }, NOW_ISO);
    const { context } = contextFor("en", true);
    const cadences = [
      { every: "day", name: "Daily", kind: "daily" },
      { every: "week", name: "Weekly", kind: "weekly" },
      { every: "month", name: "Monthly", kind: "monthly-date" },
      { every: "year", name: "Yearly", kind: "yearly" },
    ] as const;
    for (const cadence of cadences) {
      const result = await toolOf("finance.subscription").run(
        { name: cadence.name, account: "Kartica", amount: 1200, kind: "expense", every: cadence.every, start: "2026-10-12" },
        context,
      );
      expect(result.ok).toBe(true);
    }
    const byName = new Map(subscriptions().listActive().map((row) => [row.name, row] as const));
    expect(byName.get("Weekly")?.recurrence.freq).toEqual({ kind: "weekly", interval: 1, days: [0] });
    expect(byName.get("Monthly")?.recurrence.freq).toEqual({ kind: "monthly-date", interval: 1, day: 12 });
    expect(byName.get("Daily")?.amount).toBe(-120_000);
    expect(byName.get("Monthly")?.accountId).toBe(account.id);
  });

  it("names what a new subscription still needs, and writes nothing", async () => {
    accounts().create({ name: "Kartica", kind: "card", currency: "RSD" }, NOW_ISO);
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("finance.subscription").run({ name: "Gym", account: "Kartica" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("A new subscription also needs: amount, kind, cadence.");
    expect(confirms).toHaveLength(0);
  });

  it("edits an existing subscription by name, keeping its direction unless told otherwise", async () => {
    const account = accounts().create({ name: "Kartica", kind: "card", currency: "RSD" }, NOW_ISO);
    const row = subscriptions().create(
      { accountId: account.id, name: "Spotify", amount: -99_000, recurrence: MONTHLY_ON_FIFTH, startDate: "2026-10-05" },
      NOW_ISO,
    );
    const { context, confirms } = contextFor("sr", true);
    const result = await toolOf("finance.subscription").run({ name: "spotify", amount: 1290 }, context);
    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toContain("iznos");
    expect(subscriptions().listActive().find((entry) => entry.id === row.id)?.amount).toBe(-129_000);
  });

  it("refuses a schedule change on an existing subscription, which belongs to the page", async () => {
    const account = accounts().create({ name: "Kartica", kind: "card", currency: "RSD" }, NOW_ISO);
    subscriptions().create(
      { accountId: account.id, name: "Spotify", amount: -99_000, recurrence: MONTHLY_ON_FIFTH, startDate: "2026-10-05" },
      NOW_ISO,
    );
    const { context } = contextFor("en", true);
    const result = await toolOf("finance.subscription").run({ name: "Spotify", every: "week" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("schedule is changed on the Finance page");
  });
});

describe("finance.pause", () => {
  it("pauses a subscription, and resumes it, only after the user says yes", async () => {
    const account = accounts().create({ name: "Kartica", kind: "card", currency: "RSD" }, NOW_ISO);
    const row = subscriptions().create(
      { accountId: account.id, name: "Netflix", amount: -120_000, recurrence: MONTHLY_ON_FIFTH, startDate: "2026-10-05" },
      NOW_ISO,
    );
    const { context, confirms } = contextFor("en", true);
    const paused = await toolOf("finance.pause").run({ name: "Netflix", action: "pause" }, context);
    expect(paused.ok).toBe(true);
    expect(subscriptions().listActive().find((entry) => entry.id === row.id)?.pausedAt).not.toBeNull();
    expect(confirms[0]?.summary).toContain("Netflix");

    const again = await toolOf("finance.pause").run({ name: "Netflix", action: "pause" }, context);
    expect(again.content).toContain("already paused; nothing changed");
    expect(confirms).toHaveLength(1);

    const resumed = await toolOf("finance.pause").run({ name: "Netflix", action: "resume" }, context);
    expect(resumed.ok).toBe(true);
    expect(subscriptions().listActive().find((entry) => entry.id === row.id)?.pausedAt).toBeNull();
  });

  it("leaves a subscription as it was when the user declines", async () => {
    const account = accounts().create({ name: "Kartica", kind: "card", currency: "RSD" }, NOW_ISO);
    subscriptions().create(
      { accountId: account.id, name: "Netflix", amount: -120_000, recurrence: MONTHLY_ON_FIFTH, startDate: "2026-10-05" },
      NOW_ISO,
    );
    const { context } = contextFor("en", false);
    const result = await toolOf("finance.pause").run({ name: "Netflix", action: "pause" }, context);
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(subscriptions().listActive()[0]?.pausedAt).toBeNull();
  });
});
