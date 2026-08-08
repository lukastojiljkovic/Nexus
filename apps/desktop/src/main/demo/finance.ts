/**
 * FIN demo data: one Belgrade student's year of money, written through the same
 * public store API `apps/desktop/src/main/index.ts` gives the renderer — see
 * `context.ts`'s file doc for why that indistinguishability is the whole point.
 *
 * **The arithmetic this file was designed to**, so the numbers below can be
 * checked by hand rather than trusted on faith:
 *
 *  - Monthly income ≈ 82 000 RSD: „Plata" 62 000 + „Stipendija" 20 000, both
 *    posted by recurring rules.
 *  - Monthly expense ≈ 77 000–78 000 RSD: ≈ 41 800 RSD of fixed recurring
 *    items (Kirija 30 000, Režije 4 000, Telefon i internet 2 000, Teretana
 *    2 200, mesečna prevozna karta 3 600) plus ≈ 35 000 RSD of day-to-day
 *    spending whose EXPECTED monthly total is: Namirnice ≈ 15 700 (≈ 108
 *    grocery runs over 10 months at 700–2200 RSD each), Kafa i izlasci ≈ 8 300
 *    (weekend-heavy, ≈ 55 outings at 400–2600 RSD), Odeća ≈ 3 000, Pokloni
 *    ≈ 1 530, Ostalo ≈ 1 100, Zdravlje ≈ 1 800, Knjige i kursevi ≈ 1 260,
 *    Putovanja ≈ 2 050 (two trips), and ≈ 600 of taxi/ride-share beyond the
 *    monthly transit pass.
 *  - That leaves a thin ≈ 4 000–5 000 RSD/month margin — believable for a
 *    student with a part-time job, not a spreadsheet with money to spare. A
 *    handful of transfers move some of it into RSD savings; the rest rides
 *    out the month's variance, which is exactly why some months land the
 *    budgets below in the green and some don't.
 *  - The cash wallet is funded, not just drained: a monthly ≈ 7 000–9 000 RSD
 *    ATM withdrawal from the current account is the only thing that ever puts
 *    money INTO it, sized to roughly match what the cash-tagged groceries,
 *    coffee, „Ostalo" and trip-pocket-money spending draws back out — a
 *    wallet holds what its owner put into it, never a running negative.
 *
 * Every instant comes from `ctx` and every choice from `demoRandom("finance")`
 * — nothing here reads the wall clock or `Math.random`.
 */

import type { DayKey, RecurrenceRule } from "@nexus/core";
import {
  FinAccountStore,
  FinCategoryStore,
  FinRecurringStore,
  FinTransactionStore,
  type CreateFinRecurringInput,
} from "@nexus/db";
import {
  demoAt,
  demoDay,
  demoRandom,
  type DatabaseHandle,
  type DemoContext,
  type DemoRandom,
} from "./context.js";

/** How far back the ledger reaches — ≈ 10 months, ending on `ctx.today`. */
const HISTORY_DAYS = 300;

/** RSD minor units for a whole-dinar amount (ISO-4217 gives RSD 2 decimal places, same as EUR). */
function rsd(dinars: number): number {
  return Math.round(dinars) * 100;
}

/** EUR minor units (cents) for a whole-euro amount. */
function eur(euros: number): number {
  return Math.round(euros) * 100;
}

/** `ctx.now`-derived instants, turned into the ISO-8601 date-time string every store's `now` wants. */
function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const GROCERY_STORES = ["Maxi", "Idea", "Univerexport", "Lidl", "Roda", "Aman"] as const;
const COFFEE_SPOTS = [
  "Kafić u kraju",
  "Splav na Savi",
  "Picerija",
  "Kineski restoran",
  "Burger mesto",
  "Poslastičarnica",
] as const;
const CLOTHING_SHOPS = ["Zara", "H&M", "Sport Vision", "New Yorker", "Buvljak"] as const;
const HEALTH_PAYEES = ["Apoteka Benu", "Dom zdravlja", "Stomatološka ordinacija"] as const;
const BOOK_PAYEES = ["Delfi knjižare", "Vulkan izdavaštvo", "Onlajn kurs"] as const;
const GIFT_PAYEES = ["Rođendanski poklon", "Poklon za slavu", "Novogodišnji poklon"] as const;
const MISC_PAYEES = ["Frizer", "Praonica veša", "Pošta", "Fotokopirnica"] as const;

/** The two fixed offsets (days before `ctx.today`) where a short trip starts. */
const TRIP_START_OFFSETS: readonly number[] = [-200, -70];
/** The three offsets where a gift arrives, in euros, from family abroad. */
const GIFT_INCOME_OFFSETS: readonly number[] = [-270, -150, -30];

interface DemoFinAccounts {
  currentId: string;
  cashId: string;
  savingsRsdId: string;
  savingsEurId: string;
  cardId: string;
}

interface DemoFinCategories {
  plata: string;
  stipendija: string;
  pokloniIncome: string;
  kirija: string;
  namirnice: string;
  prevoz: string;
  kafa: string;
  rezije: string;
  telefon: string;
  zdravlje: string;
  odeca: string;
  knjige: string;
  teretana: string;
  pokloniExpense: string;
  putovanja: string;
  stednja: string;
  ostalo: string;
}

/** Seeds the FIN module: accounts, categories, subscriptions, a year of transactions, and budgets. */
export function seedDemoFinance(db: DatabaseHandle, ctx: DemoContext): void {
  const rnd = demoRandom("finance");
  const accounts = seedAccounts(db, ctx);
  const categories = seedCategories(db, ctx);
  seedRecurring(db, ctx, accounts, categories);
  seedTransactions(db, ctx, rnd, accounts, categories);
  seedBudgets(db, ctx, categories);
}

/**
 * Five accounts, opened at plausible starting balances the transaction history
 * below then carries forward. The credit card opens at zero — its balance is
 * entirely what the seeded purchases and payments make of it.
 */
function seedAccounts(db: DatabaseHandle, ctx: DemoContext): DemoFinAccounts {
  const store = new FinAccountStore(db, ctx.profileId);
  const now = iso(ctx.now);

  const current = store.create(
    { name: "Tekući račun", kind: "current", currency: "RSD", openingBalance: rsd(14_500) },
    now,
  );
  const cash = store.create(
    { name: "Keš", kind: "cash", currency: "RSD", openingBalance: rsd(3_000) },
    now,
  );
  const savingsRsd = store.create(
    { name: "Štedni račun", kind: "savings", currency: "RSD", openingBalance: rsd(38_000) },
    now,
  );
  const savingsEur = store.create(
    { name: "Devizna štednja", kind: "savings", currency: "EUR", openingBalance: eur(320) },
    now,
  );
  const card = store.create(
    { name: "Kreditna kartica", kind: "card", currency: "RSD", openingBalance: 0 },
    now,
  );

  return {
    currentId: current.id,
    cashId: cash.id,
    savingsRsdId: savingsRsd.id,
    savingsEurId: savingsEur.id,
    cardId: card.id,
  };
}

/**
 * Seventeen categories: three income (salary, stipend, gifts received) and
 * fourteen expense. „Pokloni" is created under BOTH kinds on purpose — gifts
 * given and gifts received are two ordinary categories that happen to share a
 * name, which is exactly the example `FinCategoryStore`'s own doc comment
 * gives for why the uniqueness index carries `kind`.
 */
function seedCategories(db: DatabaseHandle, ctx: DemoContext): DemoFinCategories {
  const store = new FinCategoryStore(db, ctx.profileId);
  const now = iso(ctx.now);

  const income = (name: string): string => store.create({ name, kind: "income" }, now).id;
  const expense = (name: string): string => store.create({ name, kind: "expense" }, now).id;

  return {
    plata: income("Plata"),
    stipendija: income("Stipendija"),
    pokloniIncome: income("Pokloni"),
    kirija: expense("Kirija"),
    namirnice: expense("Namirnice"),
    prevoz: expense("Prevoz"),
    kafa: expense("Kafa i izlasci"),
    rezije: expense("Režije"),
    telefon: expense("Telefon i internet"),
    zdravlje: expense("Zdravlje"),
    odeca: expense("Odeća"),
    knjige: expense("Knjige i kursevi"),
    teretana: expense("Teretana"),
    pokloniExpense: expense("Pokloni"),
    putovanja: expense("Putovanja"),
    stednja: expense("Štednja"),
    ostalo: expense("Ostalo"),
  };
}

/**
 * Seven subscriptions covering every fixed monthly item in the arithmetic
 * above, each opened on `HISTORY_DAYS` ago and then charged forward to today
 * in one `generateDue` pass — the same mechanism a real profile's overnight
 * catch-up would run, so the ≈ 10 months of salary, stipend, rent, utilities,
 * phone, gym and transit-pass rows are indistinguishable from ones a person's
 * subscriptions actually posted.
 */
function seedRecurring(
  db: DatabaseHandle,
  ctx: DemoContext,
  accounts: DemoFinAccounts,
  categories: DemoFinCategories,
): void {
  const store = new FinRecurringStore(db, ctx.profileId);
  const now = iso(ctx.now);
  const startDate = demoDay(ctx, -HISTORY_DAYS);

  const monthly = (day: number): RecurrenceRule => ({
    freq: { kind: "monthly-date", interval: 1, day },
    end: { kind: "never" },
  });

  const rules: CreateFinRecurringInput[] = [
    {
      accountId: accounts.currentId,
      categoryId: categories.stipendija,
      name: "Stipendija",
      amount: rsd(20_000),
      recurrence: monthly(5),
      startDate,
    },
    {
      accountId: accounts.currentId,
      categoryId: categories.plata,
      name: "Plata",
      amount: rsd(62_000),
      recurrence: monthly(28),
      startDate,
    },
    {
      accountId: accounts.currentId,
      categoryId: categories.kirija,
      name: "Kirija",
      amount: -rsd(30_000),
      recurrence: monthly(1),
      startDate,
      reminderDays: 3,
    },
    {
      accountId: accounts.currentId,
      categoryId: categories.rezije,
      name: "Režije",
      amount: -rsd(4_000),
      recurrence: monthly(10),
      startDate,
    },
    {
      accountId: accounts.currentId,
      categoryId: categories.telefon,
      name: "Telefon i internet",
      amount: -rsd(2_000),
      recurrence: monthly(15),
      startDate,
      reminderDays: 2,
    },
    {
      accountId: accounts.currentId,
      categoryId: categories.teretana,
      name: "Teretana",
      amount: -rsd(2_200),
      recurrence: monthly(5),
      startDate,
    },
    {
      accountId: accounts.currentId,
      categoryId: categories.prevoz,
      name: "Mesečna karta",
      amount: -rsd(3_600),
      recurrence: monthly(1),
      startDate,
    },
  ];

  for (const rule of rules) store.create(rule, now);
  store.generateDue(now, ctx.today);
}

/**
 * The day-to-day ledger: groceries, going out, transport, and the irregular
 * categories, walked one calendar day at a time over `HISTORY_DAYS` so the
 * weekend-heavy „Kafa i izlasci" pattern and the once-a-month ATM withdrawal,
 * card payment and savings transfer fall on the right kind of day. `cardOwed`
 * is this function's own running tally of what the credit card is carrying —
 * not a store read — so a purchase and the payment that later covers it stay
 * in step regardless of what else got inserted in between.
 */
function seedTransactions(
  db: DatabaseHandle,
  ctx: DemoContext,
  rnd: DemoRandom,
  accounts: DemoFinAccounts,
  categories: DemoFinCategories,
): void {
  const store = new FinTransactionStore(db, ctx.profileId);
  const now = iso(ctx.now);
  let cardOwed = 0;

  const spend = (
    accountId: string,
    categoryId: string,
    date: DayKey,
    amountDinars: number,
    payee: string,
  ): void => {
    store.create({ accountId, categoryId, date, amount: -rsd(amountDinars), payee }, now);
  };
  const spendOnCard = (
    categoryId: string,
    date: DayKey,
    amountDinars: number,
    payee: string,
  ): void => {
    cardOwed += amountDinars;
    spend(accounts.cardId, categoryId, date, amountDinars, payee);
  };
  const transferOut = (
    fromAccountId: string,
    toAccountId: string,
    date: DayKey,
    amountDinars: number,
  ): void => {
    store.create(
      { accountId: fromAccountId, counterAccountId: toAccountId, date, amount: -rsd(amountDinars) },
      now,
    );
  };

  for (let offset = -HISTORY_DAYS; offset <= 0; offset += 1) {
    const date = demoDay(ctx, offset);

    // A short trip: bus/plane on the day itself, the stay on the card the next
    // day, pocket money in cash the day after — three legs, one occasion.
    if (TRIP_START_OFFSETS.includes(offset)) {
      spend(
        accounts.currentId, categories.putovanja, date,
        rnd.int(1_800, 3_200), "Autobuska/avio karta",
      );
      spendOnCard(
        categories.putovanja, demoDay(ctx, offset + 1),
        rnd.int(3_500, 8_000), "Booking.com",
      );
      spend(
        accounts.cashId, categories.putovanja, demoDay(ctx, offset + 2),
        rnd.int(1_200, 2_800), "Putni troškovi",
      );
    }

    // A gift in euros, straight into the EUR savings account — never a
    // transfer, so it can carry the „Pokloni" (income) category it earns.
    if (GIFT_INCOME_OFFSETS.includes(offset)) {
      store.create(
        {
          accountId: accounts.savingsEurId,
          categoryId: categories.pokloniIncome,
          date,
          amount: eur(rnd.int(40, 120)),
          payee: "Poklon od porodice",
        },
        now,
      );
    }

    const localNoon = new Date(demoAt(ctx, offset, 12));
    const weekday = localNoon.getDay(); // 0 Sunday .. 6 Saturday
    const dayOfMonth = localNoon.getDate();
    const isGoingOutDay = weekday === 0 || weekday === 5 || weekday === 6;

    // Groceries: 2-4x a week, split between the current account and cash.
    if (rnd.chance(0.36)) {
      spend(
        rnd.chance(0.25) ? accounts.cashId : accounts.currentId,
        categories.namirnice,
        date,
        rnd.int(700, 2_200),
        rnd.of(GROCERY_STORES),
      );
    }

    // Coffee and eating out: clustered on the Friday-to-Sunday stretch.
    if (rnd.chance(isGoingOutDay ? 0.35 : 0.06)) {
      spend(
        rnd.chance(0.4) ? accounts.cashId : accounts.currentId,
        categories.kafa,
        date,
        rnd.int(400, 2_600),
        rnd.of(COFFEE_SPOTS),
      );
    }

    // Transport beyond the monthly pass — the odd taxi or ride-share.
    if (rnd.chance(0.035)) {
      spend(accounts.currentId, categories.prevoz, date, rnd.int(250, 900), "Taksi/prevoz");
    }

    // Health: irregular, mostly a pharmacy run, occasionally a dentist or doctor.
    if (rnd.chance(0.03)) {
      spend(
        accounts.currentId, categories.zdravlje, date,
        rnd.int(500, 3_500), rnd.of(HEALTH_PAYEES),
      );
    }

    // Clothing: irregular, about half the time on the card.
    if (rnd.chance(0.03)) {
      const amountDinars = rnd.int(1_200, 5_500);
      const payee = rnd.of(CLOTHING_SHOPS);
      if (rnd.chance(0.5)) spendOnCard(categories.odeca, date, amountDinars, payee);
      else spend(accounts.currentId, categories.odeca, date, amountDinars, payee);
    }

    // Books and courses: rarer, occasionally an online course on the card.
    if (rnd.chance(0.02)) {
      const amountDinars = rnd.int(700, 3_500);
      const payee = rnd.of(BOOK_PAYEES);
      if (rnd.chance(0.3)) spendOnCard(categories.knjige, date, amountDinars, payee);
      else spend(accounts.currentId, categories.knjige, date, amountDinars, payee);
    }

    // Gifts given — a different category id than the gifts-received one above.
    if (rnd.chance(0.03)) {
      spend(
        accounts.currentId, categories.pokloniExpense, date,
        rnd.int(600, 2_800), rnd.of(GIFT_PAYEES),
      );
    }

    // Everything else small and one-off: haircut, laundromat, post office.
    if (rnd.chance(0.035)) {
      const amountDinars = rnd.int(300, 1_800);
      const payee = rnd.of(MISC_PAYEES);
      if (rnd.chance(0.2)) {
        spendOnCard(categories.ostalo, date, amountDinars, payee);
      } else {
        const accountId = rnd.chance(0.3) ? accounts.cashId : accounts.currentId;
        spend(accountId, categories.ostalo, date, amountDinars, payee);
      }
    }

    // Once a month: an ATM withdrawal — the ONLY thing that ever puts money
    // INTO the cash wallet. Without it every cash purchase above only ever
    // drains the account, which is not what a wallet is: a real one holds
    // what its owner put into it, refilled from the current account exactly
    // like this.
    if (dayOfMonth === 8) {
      transferOut(accounts.currentId, accounts.cashId, date, rnd.int(7_000, 9_000));
    }

    // Once a month: pay down whatever the card owes — in full most of the
    // time, sometimes only most of it, which is what a real revolving balance
    // looks like.
    if (dayOfMonth === 22 && cardOwed > 0) {
      const fraction = rnd.int(60, 100) / 100;
      const paymentDinars = Math.min(cardOwed, Math.round((cardOwed * fraction) / 10) * 10);
      if (paymentDinars > 0) {
        transferOut(accounts.currentId, accounts.cardId, date, paymentDinars);
        cardOwed -= paymentDinars;
      }
    }

    // Once a month, and not every month: whatever margin the month left over,
    // some of it moves into RSD savings.
    if (dayOfMonth === 25 && rnd.chance(0.65)) {
      transferOut(accounts.currentId, accounts.savingsRsdId, date, rnd.int(2_000, 6_000));
    }
  }
}

/**
 * Budgets on the six categories whose monthly total genuinely varies — never
 * on a category a recurring rule charges the same fixed amount every month,
 * where a budget could only ever read as constantly green or constantly red.
 * Each limit sits close to that category's own designed monthly average (see
 * the file doc), so the transaction history crosses it some months and not
 * others — „Putovanja" most dramatically, since two trip months blow straight
 * through a limit that eight ordinary months never approach.
 */
function seedBudgets(db: DatabaseHandle, ctx: DemoContext, categories: DemoFinCategories): void {
  const store = new FinCategoryStore(db, ctx.profileId);
  const now = iso(ctx.now);

  const budgets: ReadonlyArray<readonly [string, number]> = [
    [categories.namirnice, 15_500],
    [categories.kafa, 8_000],
    [categories.prevoz, 4_000],
    [categories.odeca, 3_000],
    [categories.zdravlje, 1_800],
    [categories.putovanja, 2_200],
  ];

  for (const [categoryId, amountDinars] of budgets) {
    store.setBudget({ categoryId, currency: "RSD", amount: rsd(amountDinars) }, now);
  }
}
