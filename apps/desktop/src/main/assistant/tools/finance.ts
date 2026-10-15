/**
 * The FIN module (the ledger) through the assistant's eyes: where the money is,
 * where it went, what is due, and the writes a person actually asks for — record
 * a payment, set a budget, add or change a subscription, pause one.
 *
 * **Every read and write is the store the page calls.** `fin-transactions:create`
 * calls `FinTransactionStore.create`, `fin-recurring:pause` calls `pause`, and so
 * on. The sign rules are the page's own: an expense leaves its account as a
 * negative amount, an income arrives as a positive one, and a transfer is ONE row
 * signed from the account it leaves. The model speaks in „kind" and the store in
 * signs, so the translation is restated here, once.
 *
 * **Money never meets money in another currency.** An account carries its
 * currency and nothing converts, so every total is listed per currency: a summary
 * over RSD and EUR shows two blocks, never one invented sum.
 *
 * **Amounts go in as the user says them.** The schema takes major units (12.5),
 * because a small model writes that far more reliably than 1250 minor units.
 * `minorUnitsFromText`, the parser the ledger's amount field uses, turns it into
 * an integer of minor units, and refuses a fraction the currency cannot hold
 * rather than rounding it.
 *
 * **Names, not ids.** An account, a category or a subscription is named the usual
 * way: its id, or its name folded. A missing name is refused with the names that
 * exist; a shared one with the candidates. Nothing is guessed.
 */

import {
  FinAccountStore,
  FinCategoryStore,
  FinRecurringStore,
  FinTransactionStore,
  MAX_FIN_NOTE_LENGTH,
  MAX_FIN_PAYEE_LENGTH,
  MAX_FIN_RECURRING_NAME_LENGTH,
  MAX_FIN_REMINDER_DAYS,
  isCurrencyCode,
  type CreateFinRecurringInput,
  type CreateFinTransactionInput,
  type FinAccount,
  type FinPeriod,
  type FinRecurring,
  type FinTransaction,
  type FinUpcomingRenewal,
  type UpdateFinRecurringFields,
} from "@nexus/db";
import {
  MAX_RECURRENCE_INTERVAL,
  currencyMinorDigits,
  foldSearchText,
  formatMinorUnits,
  minorUnitsFromText,
  moneyFormatOptions,
  shiftDayKey,
  validateRecurrenceRule,
  type AssistantLocale,
  type AssistantText,
  type RecurrenceRule,
  type Tool,
} from "@nexus/core";
import {
  asArgs,
  asEnum,
  asNumber,
  asOptionalCount,
  asOptionalDay,
  asOptionalEnum,
  asOptionalNumber,
  asOptionalText,
  asText,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatDayShort,
  guard,
  localDay,
  numberFormat,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

/**
 * An amount of minor units as the ledger page writes it („12,34 RSD" / "RSD
 * 12.34"), through the split `@nexus/core` owns, so a tool result and a row
 * cannot disagree about the same money.
 */
function formatMoney(locale: AssistantLocale, minorUnits: number, currency: string): string {
  return formatMinorUnits(minorUnits, currency, numberFormat(locale, moneyFormatOptions(currency, true)));
}

export interface FinanceToolDeps {
  readonly profileDb: ProfileDb;
  readonly now: () => number;
}

const KINDS = ["expense", "income"] as const;
type EntryKind = (typeof KINDS)[number];

const EVERY = ["day", "week", "month", "year"] as const;
type Every = (typeof EVERY)[number];

const BUDGET_ACTIONS = ["set", "clear"] as const;
const PAUSE_ACTIONS = ["pause", "resume"] as const;

/** A list answers with this many rows when the model names no cap, and the most it may ask for. */
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

/** A subscription list looks this many days ahead unless the model names a window. */
const DEFAULT_RENEWAL_DAYS = 30;
const MAX_RENEWAL_DAYS = 366;

/** A name an argument may carry for an account, a category or a subscription. */
const MAX_NAME_CHARS = 60;

/** The calendar-day and currency shapes the schemas declare, as the task and calendar tools do. */
const DAY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const CURRENCY_PATTERN = "^[A-Z]{3}$";

// --- Wording -----------------------------------------------------------------

/** The two refusals a name lookup can end in, for one kind of row. */
interface NameRefusal {
  readonly unknown: AssistantPhrase<[name: string, known: string]>;
  readonly ambiguous: AssistantPhrase<[name: string, candidates: string]>;
}

const ACCOUNT_REFUSAL: NameRefusal = {
  unknown: {
    sr: (name, known) => `Nema računa „${name}“. Računi u ovom profilu: ${known}.`,
    en: (name, known) => `No account named “${name}”. This profile's accounts: ${known}.`,
  },
  ambiguous: {
    sr: (name, candidates) => `„${name}“ označava više računa: ${candidates}. Navedi id.`,
    en: (name, candidates) => `“${name}” matches more than one account: ${candidates}. Give the id.`,
  },
};

const CATEGORY_REFUSAL: NameRefusal = {
  unknown: {
    sr: (name, known) => `Nema kategorije „${name}“. Kategorije za ovu vrstu: ${known}.`,
    en: (name, known) => `No category named “${name}”. Categories for this kind: ${known}.`,
  },
  ambiguous: {
    sr: (name, candidates) => `„${name}“ označava više kategorija: ${candidates}. Navedi id.`,
    en: (name, candidates) => `“${name}” matches more than one category: ${candidates}. Give the id.`,
  },
};

const SUBSCRIPTION_REFUSAL: NameRefusal = {
  unknown: {
    sr: (name, known) => `Nema pretplate „${name}“. Pretplate u ovom profilu: ${known}.`,
    en: (name, known) => `No subscription named “${name}”. This profile's subscriptions: ${known}.`,
  },
  ambiguous: {
    sr: (name, candidates) => `„${name}“ označava više pretplata: ${candidates}. Navedi id.`,
    en: (name, candidates) => `“${name}” matches more than one subscription: ${candidates}. Give the id.`,
  },
};

const NONE: AssistantText = { sr: "nijedan", en: "none" };

/** The field a subscription edit changes, named for the confirmation. */
const FIELD = {
  name: { sr: "naziv", en: "name" },
  account: { sr: "račun", en: "account" },
  amount: { sr: "iznos", en: "amount" },
  kind: { sr: "vrsta", en: "kind" },
  category: { sr: "kategorija", en: "category" },
  payee: { sr: "primalac", en: "payee" },
  note: { sr: "beleška", en: "note" },
  reminder: { sr: "podsetnik", en: "reminder" },
  every: { sr: "učestalost", en: "cadence" },
} as const satisfies Record<string, AssistantText>;

/** How a subscription repeats, in words; an interval above one is appended as „(×N)". */
const CADENCE: Record<Every | "weekdays", AssistantText> = {
  day: { sr: "dnevno", en: "daily" },
  week: { sr: "nedeljno", en: "weekly" },
  month: { sr: "mesečno", en: "monthly" },
  year: { sr: "godišnje", en: "yearly" },
  weekdays: { sr: "radnim danima", en: "on weekdays" },
};

const LABEL = {
  balance: { sr: "Stanje", en: "Balance" },
  accounts: { sr: "Računi", en: "Accounts" },
  income: { sr: "Prihodi", en: "Income" },
  spending: { sr: "Potrošnja", en: "Spending" },
  uncategorized: { sr: "bez kategorije", en: "no category" },
  limit: { sr: "limit", en: "limit" },
  spent: { sr: "potrošeno", en: "spent" },
  left: { sr: "preostalo", en: "left" },
  next: { sr: "sledeća naplata", en: "next charge" },
  paused: { sr: "pauzirana", en: "paused" },
  finished: { sr: "završena", en: "finished" },
  to: { sr: "na", en: "to" },
} as const satisfies Record<string, AssistantText>;

const NO_MONEY: AssistantText = {
  sr: "Ovaj profil nema računa ni transakcija.",
  en: "This profile has no accounts or transactions yet.",
};

const NO_TRANSACTIONS: AssistantText = {
  sr: "Nema transakcija koje odgovaraju filteru.",
  en: "No transactions match that filter.",
};

const NO_BUDGETS: AssistantText = {
  sr: "Ovaj profil nema budžeta.",
  en: "This profile has no budgets.",
};

const NO_SUBSCRIPTIONS: AssistantText = {
  sr: "Ovaj profil nema pretplata.",
  en: "This profile has no subscriptions.",
};

const NO_RENEWALS: AssistantText = {
  sr: "Nijedna naplata nije na redu u tom periodu.",
  en: "No charge falls in that window.",
};

const SUMMARY_HEADING: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Novac od ${from} do ${to}:`,
  en: (from, to) => `Money from ${from} to ${to}:`,
};

const TRANSACTIONS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Transakcije (${count}):`,
  en: (count) => `Transactions (${count}):`,
};

const BUDGETS_HEADING: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Budžeti od ${from} do ${to}:`,
  en: (from, to) => `Budgets from ${from} to ${to}:`,
};

const SUBSCRIPTIONS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Pretplate (${count}):`,
  en: (count) => `Subscriptions (${count}):`,
};

const RENEWALS_HEADING: AssistantPhrase<[days: number]> = {
  sr: (days) => `Naplate u narednih ${days} dana:`,
  en: (days) => `Charges in the next ${days} days:`,
};

const TRUNCATED: AssistantPhrase<[shown: number]> = {
  sr: (shown) => `Prikazano je samo prvih ${shown} stavki.`,
  en: (shown) => `Showing only the first ${shown} entries.`,
};

const RECORD_EXPENSE_SUMMARY: AssistantPhrase<[money: string, account: string, category: string | null, day: string]> = {
  sr: (money, account, category, day) =>
    `Zapiši trošak ${money} na „${account}“${category === null ? "" : ` (${category})`}, ${day}.`,
  en: (money, account, category, day) =>
    `Record an expense of ${money} on “${account}”${category === null ? "" : ` (${category})`}, ${day}.`,
};

const RECORD_INCOME_SUMMARY: AssistantPhrase<[money: string, account: string, category: string | null, day: string]> = {
  sr: (money, account, category, day) =>
    `Zapiši prihod ${money} na „${account}“${category === null ? "" : ` (${category})`}, ${day}.`,
  en: (money, account, category, day) =>
    `Record income of ${money} on “${account}”${category === null ? "" : ` (${category})`}, ${day}.`,
};

const RECORD_TRANSFER_SUMMARY: AssistantPhrase<[money: string, from: string, to: string, day: string]> = {
  sr: (money, from, to, day) => `Prebaci ${money} sa „${from}“ na „${to}“, ${day}.`,
  en: (money, from, to, day) => `Move ${money} from “${from}” to “${to}”, ${day}.`,
};

const RECORDED_EXPENSE: AssistantPhrase<[money: string, account: string, id: string, day: string]> = {
  sr: (money, account, id, day) => `Zabeleženo: trošak ${money} na „${account}“ (${id}), ${day}.`,
  en: (money, account, id, day) => `Recorded an expense of ${money} on “${account}” (${id}), ${day}.`,
};

const RECORDED_INCOME: AssistantPhrase<[money: string, account: string, id: string, day: string]> = {
  sr: (money, account, id, day) => `Zabeleženo: prihod ${money} na „${account}“ (${id}), ${day}.`,
  en: (money, account, id, day) => `Recorded income of ${money} on “${account}” (${id}), ${day}.`,
};

const RECORDED_TRANSFER: AssistantPhrase<[money: string, from: string, to: string, id: string, day: string]> = {
  sr: (money, from, to, id, day) =>
    `Zabeleženo: prenos ${money} sa „${from}“ na „${to}“ (${id}), ${day}.`,
  en: (money, from, to, id, day) =>
    `Recorded a transfer of ${money} from “${from}” to “${to}” (${id}), ${day}.`,
};

const BUDGET_SET_SUMMARY: AssistantPhrase<[category: string, money: string]> = {
  sr: (category, money) => `Postavi budžet za „${category}“ na ${money} mesečno.`,
  en: (category, money) => `Set the budget for “${category}” to ${money} a month.`,
};

const BUDGET_CLEAR_SUMMARY: AssistantPhrase<[category: string, currency: string]> = {
  sr: (category, currency) => `Obriši budžet za „${category}“ (${currency}).`,
  en: (category, currency) => `Clear the budget for “${category}” (${currency}).`,
};

const BUDGET_SET_DONE: AssistantPhrase<[category: string, money: string]> = {
  sr: (category, money) => `Budžet za „${category}“ je ${money} mesečno.`,
  en: (category, money) => `The budget for “${category}” is ${money} a month.`,
};

const BUDGET_CLEAR_DONE: AssistantPhrase<[category: string, currency: string]> = {
  sr: (category, currency) => `Budžet za „${category}“ (${currency}) je obrisan.`,
  en: (category, currency) => `The budget for “${category}” (${currency}) was cleared.`,
};

const NO_BUDGET_TO_CLEAR: AssistantPhrase<[category: string, currency: string]> = {
  sr: (category, currency) => `Kategorija „${category}“ nema budžet u valuti ${currency}.`,
  en: (category, currency) => `The category “${category}” has no budget in ${currency}.`,
};

const CURRENCY_NEEDED: AssistantPhrase<[currencies: string]> = {
  sr: (currencies) => `Navedi valutu. Valute računa u ovom profilu: ${currencies}.`,
  en: (currencies) => `Name the currency. The currencies of this profile's accounts: ${currencies}.`,
};

const NO_ACCOUNT_FOR_CURRENCY: AssistantText = {
  sr: "Prvo dodaj račun: budžet se vezuje za valutu računa.",
  en: "Add an account first: a budget is tied to an account's currency.",
};

const AMOUNT_PRECISION: AssistantPhrase<[currency: string, digits: number]> = {
  sr: (currency, digits) => `Iznos nije valjan za ${currency}: najviše ${digits} decimale.`,
  en: (currency, digits) => `That amount does not fit ${currency}: at most ${digits} decimal places.`,
};

const AMOUNT_POSITIVE: AssistantText = {
  sr: "Iznos mora biti veći od nule.",
  en: "The amount must be greater than zero.",
};

const AMOUNT_NEEDED_FOR_SET: AssistantText = {
  sr: "Za postavljanje budžeta navedi iznos.",
  en: "Name the amount to set a budget.",
};

const AMOUNT_ONLY_FOR_SET: AssistantText = {
  sr: "Iznos se navodi samo kada se budžet postavlja.",
  en: "An amount is given only when a budget is set.",
};

const CURRENCY_FORMAT: AssistantText = {
  sr: "Valuta mora biti tri velika slova, kao RSD.",
  en: "The currency must be three upper-case letters, such as RSD.",
};

const TRANSFER_SAME_ACCOUNT: AssistantText = {
  sr: "Prenos mora ići između dva različita računa.",
  en: "A transfer must go between two different accounts.",
};

const TRANSFER_CURRENCY: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) =>
    `Prenos ne može preko valuta: jedan račun je u ${from}, drugi u ${to}. Upiši dve obične transakcije.`,
  en: (from, to) =>
    `A transfer cannot cross currencies: one account is in ${from}, the other in ${to}. Record two ordinary transactions.`,
};

const TRANSFER_NO_CATEGORY: AssistantText = {
  sr: "Prenos nema kategoriju: novac između tvojih računa nije ni prihod ni trošak.",
  en: "A transfer has no category: money between your own accounts is neither income nor expense.",
};

const TRANSFER_NO_KIND: AssistantText = {
  sr: "Prenos nema vrstu: izostavi „kind“ kada je navedeno „counterAccount“.",
  en: "A transfer has no kind: leave “kind” out when “counterAccount” is given.",
};

const KIND_NEEDED: AssistantText = {
  sr: "Navedi da li je to trošak (expense) ili prihod (income).",
  en: "Say whether it is an expense or an income.",
};

const MISSING_FIELDS: AssistantPhrase<[fields: string]> = {
  sr: (fields) => `Za novu pretplatu treba još: ${fields}.`,
  en: (fields) => `A new subscription also needs: ${fields}.`,
};

const SCHEDULE_ON_PAGE: AssistantText = {
  sr: "Raspored postojeće pretplate menja se na stranici Finansije; ovaj alat menja iznos, račun, vrstu i opis.",
  en: "A subscription's schedule is changed on the Finance page; this tool changes its amount, account, kind and description.",
};

const NOTHING_TO_CHANGE: AssistantText = {
  sr: "Nije naveden nijedan podatak za izmenu.",
  en: "No field was given to change.",
};

const RULE_INVALID: AssistantText = {
  sr: "Raspored pretplate nije valjan.",
  en: "The subscription's schedule is not valid.",
};

const SUBSCRIPTION_CREATE_SUMMARY: AssistantPhrase<[name: string, money: string, cadence: string, account: string, start: string]> = {
  sr: (name, money, cadence, account, start) =>
    `Napravi pretplatu „${name}“: ${money}, ${cadence}, sa „${account}“, od ${start}.`,
  en: (name, money, cadence, account, start) =>
    `Create the subscription “${name}”: ${money}, ${cadence}, from “${account}”, starting ${start}.`,
};

const SUBSCRIPTION_EDIT_SUMMARY: AssistantPhrase<[name: string, fields: string]> = {
  sr: (name, fields) => `Izmeni pretplatu „${name}“: ${fields}.`,
  en: (name, fields) => `Change the subscription “${name}”: ${fields}.`,
};

const SUBSCRIPTION_CREATED: AssistantPhrase<[name: string, id: string, start: string]> = {
  sr: (name, id, start) => `Napravljena pretplata „${name}“ (${id}), od ${start}.`,
  en: (name, id, start) => `Created the subscription “${name}” (${id}), from ${start}.`,
};

const SUBSCRIPTION_EDITED: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Izmenjena pretplata „${name}“ (${id}).`,
  en: (name, id) => `Changed the subscription “${name}” (${id}).`,
};

const PAUSE_SUMMARY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Pauziraj pretplatu „${name}“: neće se naplaćivati dok je ne nastaviš.`,
  en: (name) => `Pause the subscription “${name}”: it will not be charged until resumed.`,
};

const RESUME_SUMMARY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Nastavi pretplatu „${name}“ od danas, po njenom rasporedu.`,
  en: (name) => `Resume the subscription “${name}” from today, on its schedule.`,
};

const PAUSED_DONE: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Pretplata „${name}“ je pauzirana (${id}).`,
  en: (name, id) => `The subscription “${name}” is paused (${id}).`,
};

const RESUMED_DONE: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Pretplata „${name}“ je nastavljena (${id}).`,
  en: (name, id) => `The subscription “${name}” is resumed (${id}).`,
};

const ALREADY_PAUSED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Pretplata „${name}“ je već pauzirana; ništa nije promenjeno.`,
  en: (name) => `The subscription “${name}” is already paused; nothing changed.`,
};

const NOT_PAUSED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Pretplata „${name}“ nije pauzirana; ništa nije promenjeno.`,
  en: (name) => `The subscription “${name}” is not paused; nothing changed.`,
};

// --- Tools -------------------------------------------------------------------

export function financeTools(deps: FinanceToolDeps): readonly Tool[] {
  /** One profile's stores, built the way `main/index.ts` builds them for a handler. */
  function stores(profileId: string) {
    return deps.profileDb(profileId, (db, id) => ({
      accounts: new FinAccountStore(db, id),
      categories: new FinCategoryStore(db, id),
      transactions: new FinTransactionStore(db, id),
      recurring: new FinRecurringStore(db, id),
    }));
  }

  const summary: Tool = {
    name: "finance.summary",
    description: {
      sr: "Pregled novca: stanje računa, prihodi i potrošnja po kategorijama za period, odvojeno po valuti. Koristi ga kada korisnik pita koliko ima ili gde mu odlazi novac; podrazumevano je ovaj mesec.",
      en: "Summary of the money: account balances, income and spending by category for a period, one block per currency. Use it when the user asks how much they have or where their money goes; defaults to this month.",
    },
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", pattern: DAY_PATTERN, description: "First day, YYYY-MM-DD. Defaults to the first day of the month." },
        to: { type: "string", pattern: DAY_PATTERN, description: "Last day, YYYY-MM-DD. Defaults to the last day of the month." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const period = periodOf(asOptionalDay(args.from, "from"), asOptionalDay(args.to, "to"), localDay(deps.now()));
        const { accounts, categories, transactions } = stores(context.profileId);
        const live = accounts.listActive();
        const totals = accounts.totalsByCurrency();
        const spend = transactions.spendByCategory(period);
        const income = transactions.incomeByCurrency(period);
        if (totals.length === 0 && spend.length === 0 && income.length === 0) {
          return okResult(text(context.locale, NO_MONEY));
        }

        const names = new Map(categories.list().map((category) => [category.id, category.name] as const));
        const currencies = [
          ...new Set([
            ...totals.map((total) => total.currency),
            ...spend.map((line) => line.currency),
            ...income.map((total) => total.currency),
          ]),
        ].sort();

        const lines = [phrase(context.locale, SUMMARY_HEADING, period.from, period.to)];
        for (const currency of currencies) {
          const money = (minorUnits: number) => formatMoney(context.locale, minorUnits, currency);
          lines.push(currency);
          const total = totals.find((entry) => entry.currency === currency);
          if (total !== undefined) lines.push(`  ${text(context.locale, LABEL.balance)}: ${money(total.minorUnits)}`);
          const accountLines = accountBalances(live, currency, accounts.listBalances())
            .map((entry) => `${entry.name} ${money(entry.minorUnits)}`);
          if (accountLines.length > 0) lines.push(`  ${text(context.locale, LABEL.accounts)}: ${accountLines.join("; ")}`);
          const received = income.find((entry) => entry.currency === currency);
          if (received !== undefined) lines.push(`  ${text(context.locale, LABEL.income)}: ${money(received.minorUnits)}`);
          const lineSpend = spend.filter((line) => line.currency === currency);
          if (lineSpend.length > 0) {
            const sum = lineSpend.reduce((acc, line) => acc + line.minorUnits, 0);
            lines.push(`  ${text(context.locale, LABEL.spending)}: ${money(sum)}`);
            for (const line of lineSpend) {
              const name = line.categoryId === null ? text(context.locale, LABEL.uncategorized) : (names.get(line.categoryId) ?? "");
              lines.push(`    ${name}: ${money(line.minorUnits)}`);
            }
          }
        }
        return okResult(lines.join("\n"));
      }),
  };

  const transactions: Tool = {
    name: "finance.transactions",
    description: {
      sr: "Lista transakcija, uz pretragu po opisu i beleškama i filtere po periodu, računu i kategoriji. Koristi je kada korisnik pita šta je platio, kada ili gde.",
      en: "Lists transactions, searchable by payee or note and filtered by day range, account and category. Use it when the user asks what they paid, when, or where.",
    },
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: MAX_FIN_PAYEE_LENGTH, description: "Text to find in the payee or the note." },
        from: { type: "string", pattern: DAY_PATTERN, description: "First day, YYYY-MM-DD, inclusive." },
        to: { type: "string", pattern: DAY_PATTERN, description: "Last day, YYYY-MM-DD, inclusive." },
        account: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "An account's name or id." },
        category: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "A category's name or id." },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT, description: `How many to answer with. Defaults to ${DEFAULT_LIST_LIMIT}.` },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asOptionalText(args.query, "query", MAX_FIN_PAYEE_LENGTH);
        const from = asOptionalDay(args.from, "from");
        const to = asOptionalDay(args.to, "to");
        const accountName = asOptionalText(args.account, "account", MAX_NAME_CHARS);
        const categoryName = asOptionalText(args.category, "category", MAX_NAME_CHARS);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIST_LIMIT) ?? DEFAULT_LIST_LIMIT;

        const { accounts, categories, transactions: store } = stores(context.profileId);
        const accountList = accounts.listActive();
        const account = accountName === undefined ? undefined : resolveNamed(accountList, accountName, context.locale, ACCOUNT_REFUSAL);
        const category = categoryName === undefined ? undefined : resolveNamed(categories.list(), categoryName, context.locale, CATEGORY_REFUSAL);
        const needle = query === undefined ? undefined : foldSearchText(query);

        const rows = store
          .listActive()
          .filter((row) => from === undefined || row.date >= from)
          .filter((row) => to === undefined || row.date <= to)
          .filter((row) => account === undefined || row.accountId === account.id || row.counterAccountId === account.id)
          .filter((row) => category === undefined || row.categoryId === category.id)
          .filter((row) => needle === undefined || [row.payee, row.note].some((field) => field !== null && foldSearchText(field).includes(needle)))
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
        if (rows.length === 0) return okResult(text(context.locale, NO_TRANSACTIONS));

        const names = new Map(categories.list().map((entry) => [entry.id, entry.name] as const));
        const byId = new Map(accountList.map((entry) => [entry.id, entry] as const));
        const shown = rows.slice(0, limit);
        const content = [phrase(context.locale, TRANSACTIONS_HEADING, rows.length)];
        for (const row of shown) content.push(transactionLine(context.locale, row, names, byId));
        if (shown.length < rows.length) content.push(phrase(context.locale, TRUNCATED, shown.length));
        return okResult(content.join("\n"));
      }),
  };

  const budgets: Tool = {
    name: "finance.budgets",
    description: {
      sr: "Budžeti po kategoriji i valuti: limit, potrošeno i preostalo u periodu (podrazumevano ovaj mesec). Koristi je kada korisnik pita koliko još sme da potroši.",
      en: "Budgets per category and currency: the limit, what was spent and what is left in a period (this month by default). Use it when the user asks how much they may still spend.",
    },
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", pattern: DAY_PATTERN, description: "First day, YYYY-MM-DD. Defaults to the first day of the month." },
        to: { type: "string", pattern: DAY_PATTERN, description: "Last day, YYYY-MM-DD. Defaults to the last day of the month." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const period = periodOf(asOptionalDay(args.from, "from"), asOptionalDay(args.to, "to"), localDay(deps.now()));
        const { categories, transactions: store } = stores(context.profileId);
        const list = categories.listBudgets();
        if (list.length === 0) return okResult(text(context.locale, NO_BUDGETS));

        const spend = store.spendByCategory(period);
        const names = new Map(categories.list().map((entry) => [entry.id, entry.name] as const));
        const rows = list
          .map((budget) => ({
            budget,
            spent: spend
              .filter((line) => line.categoryId === budget.categoryId && line.currency === budget.currency)
              .reduce((sum, line) => sum + line.minorUnits, 0),
            name: names.get(budget.categoryId) ?? "",
          }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.budget.currency.localeCompare(b.budget.currency));

        const content = [phrase(context.locale, BUDGETS_HEADING, period.from, period.to)];
        for (const row of rows.slice(0, MAX_LIST_LIMIT)) {
          const money = (minorUnits: number) => formatMoney(context.locale, minorUnits, row.budget.currency);
          content.push(
            `- ${row.name} (${row.budget.currency}): ${text(context.locale, LABEL.limit)} ${money(row.budget.amount)}, ` +
              `${text(context.locale, LABEL.spent)} ${money(row.spent)}, ` +
              `${text(context.locale, LABEL.left)} ${money(row.budget.amount - row.spent)}`,
          );
        }
        if (rows.length > MAX_LIST_LIMIT) content.push(phrase(context.locale, TRUNCATED, MAX_LIST_LIMIT));
        return okResult(content.join("\n"));
      }),
  };

  const subscriptions: Tool = {
    name: "finance.subscriptions",
    description: {
      sr: "Pretplate i naplate koje dolaze u narednih nekoliko dana (podrazumevano 30). Pauzirane pretplate su u listi, ali nemaju naplatu. Koristi je kada korisnik pita na šta je pretplaćen ili šta dolazi uskoro.",
      en: "Subscriptions, with the charges due in the next days (30 by default). Paused ones are listed but have no charge. Use it when the user asks what they are subscribed to or what is due soon.",
    },
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: MAX_RENEWAL_DAYS, description: `How many days ahead to look. Defaults to ${DEFAULT_RENEWAL_DAYS}.` },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const days = asOptionalCount(args.days, "days", 1, MAX_RENEWAL_DAYS) ?? DEFAULT_RENEWAL_DAYS;
        const { accounts, recurring } = stores(context.profileId);
        const byId = new Map(accounts.listActive().map((entry) => [entry.id, entry] as const));
        // A subscription whose account is gone has no currency to be shown in, so it is not listed.
        const list = recurring.listActive().filter((entry) => byId.has(entry.accountId));
        if (list.length === 0) return okResult(text(context.locale, NO_SUBSCRIPTIONS));

        const today = localDay(deps.now());
        const renewals = recurring.upcoming({ from: today, to: shiftDayKey(today, days - 1) });

        const content = [phrase(context.locale, SUBSCRIPTIONS_HEADING, list.length)];
        for (const entry of list.slice(0, MAX_LIST_LIMIT)) {
          const account = byId.get(entry.accountId);
          if (account !== undefined) content.push(subscriptionLine(context.locale, entry, account));
        }
        if (list.length > MAX_LIST_LIMIT) content.push(phrase(context.locale, TRUNCATED, MAX_LIST_LIMIT));
        content.push(phrase(context.locale, RENEWALS_HEADING, days));
        if (renewals.length === 0) content.push(text(context.locale, NO_RENEWALS));
        for (const renewal of renewals.slice(0, MAX_LIST_LIMIT)) content.push(renewalLine(context.locale, renewal));
        if (renewals.length > MAX_LIST_LIMIT) content.push(phrase(context.locale, TRUNCATED, MAX_LIST_LIMIT));
        return okResult(content.join("\n"));
      }),
  };

  const record: Tool = {
    name: "finance.record",
    description: {
      sr: "Beleži jedan trošak, prihod ili prenos između tvojih računa na datum (podrazumevano danas). Koristi ga kada korisnik kaže da je nešto platio, dobio ili prebacio. Iznos je u običnim jedinicama valute, npr. 12.5.",
      en: "Records one expense, income or transfer between the user's own accounts, on a day (today by default). Use it when the user says they paid, received or moved money. The amount is in major units, such as 12.5.",
    },
    parameters: {
      type: "object",
      properties: {
        account: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The account the money belongs to, by name or id." },
        amount: { type: "number", minimum: 0, description: "The amount in major units, as the user says it (12.5 for 12,50). Positive." },
        kind: { type: "string", enum: [...KINDS], description: "expense or income. Leave it out for a transfer." },
        category: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "A category of the same kind, by name or id. Optional." },
        counterAccount: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "For a transfer: the account the money goes to." },
        date: { type: "string", pattern: DAY_PATTERN, description: "The day, YYYY-MM-DD. Defaults to today." },
        payee: { type: "string", minLength: 1, maxLength: MAX_FIN_PAYEE_LENGTH, description: "Who was paid, or who paid." },
        note: { type: "string", minLength: 1, maxLength: MAX_FIN_NOTE_LENGTH, description: "A short note, when the user gave one." },
      },
      required: ["account", "amount"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const accountName = asText(args.account, "account", MAX_NAME_CHARS);
        const amount = asNumber(args.amount, "amount", 0, Number.MAX_SAFE_INTEGER);
        if (amount === 0) throw new Error(text(context.locale, AMOUNT_POSITIVE));
        const kind = asOptionalEnum(args.kind, "kind", KINDS);
        const counterName = asOptionalText(args.counterAccount, "counterAccount", MAX_NAME_CHARS);
        const categoryName = asOptionalText(args.category, "category", MAX_NAME_CHARS);
        const day = asOptionalDay(args.date, "date") ?? localDay(deps.now());
        const payee = asOptionalText(args.payee, "payee", MAX_FIN_PAYEE_LENGTH);
        const note = asOptionalText(args.note, "note", MAX_FIN_NOTE_LENGTH);

        const { accounts, categories, transactions: store } = stores(context.profileId);
        const accountList = accounts.listActive();
        const account = resolveNamed(accountList, accountName, context.locale, ACCOUNT_REFUSAL);
        const magnitude = minorOf(amount, account.currency, context.locale);
        const detail = { ...(payee === undefined ? {} : { payee }), ...(note === undefined ? {} : { note }) };

        if (counterName !== undefined) {
          if (kind !== undefined) throw new Error(text(context.locale, TRANSFER_NO_KIND));
          if (categoryName !== undefined) throw new Error(text(context.locale, TRANSFER_NO_CATEGORY));
          const counter = resolveNamed(accountList, counterName, context.locale, ACCOUNT_REFUSAL);
          if (counter.id === account.id) throw new Error(text(context.locale, TRANSFER_SAME_ACCOUNT));
          if (counter.currency !== account.currency) {
            throw new Error(phrase(context.locale, TRANSFER_CURRENCY, account.currency, counter.currency));
          }
          const money = formatMoney(context.locale, magnitude, account.currency);
          const declined = await confirmOrDecline(
            context,
            "finance.record",
            "write",
            phrase(context.locale, RECORD_TRANSFER_SUMMARY, money, account.name, counter.name, formatDayShort(context.locale, day)),
          );
          if (declined !== null) return declined;
          const moved = store.create(
            { ...detail, accountId: account.id, counterAccountId: counter.id, date: day, amount: -magnitude },
            instantOf(deps.now()),
          );
          return okResult(
            phrase(context.locale, RECORDED_TRANSFER, money, account.name, counter.name, moved.id, moved.date),
            { navigateTo: { module: "finance" } },
          );
        }

        if (kind === undefined) throw new Error(text(context.locale, KIND_NEEDED));
        const category =
          categoryName === undefined
            ? undefined
            : resolveNamed(categories.list().filter((entry) => entry.kind === kind), categoryName, context.locale, CATEGORY_REFUSAL);
        const money = formatMoney(context.locale, magnitude, account.currency);
        const declined = await confirmOrDecline(
          context,
          "finance.record",
          "write",
          phrase(
            context.locale,
            kind === "income" ? RECORD_INCOME_SUMMARY : RECORD_EXPENSE_SUMMARY,
            money,
            account.name,
            category?.name ?? null,
            formatDayShort(context.locale, day),
          ),
        );
        if (declined !== null) return declined;
        const input: CreateFinTransactionInput = {
          ...detail,
          accountId: account.id,
          categoryId: category?.id ?? null,
          date: day,
          amount: kind === "income" ? magnitude : -magnitude,
        };
        const created = store.create(input, instantOf(deps.now()));
        return okResult(
          phrase(context.locale, kind === "income" ? RECORDED_INCOME : RECORDED_EXPENSE, money, account.name, created.id, created.date),
          { navigateTo: { module: "finance" } },
        );
      }),
  };

  const budget: Tool = {
    name: "finance.budget",
    description: {
      sr: "Postavlja ili briše mesečni budžet kategorije troška u jednoj valuti. Koristi ga kada korisnik kaže koliko sme da troši na nešto ili kada hoće da ukloni ograničenje.",
      en: "Sets or clears a category's monthly budget in one currency. Use it when the user says how much they may spend on something, or wants a limit removed.",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...BUDGET_ACTIONS], description: "set to set the limit, clear to remove it." },
        category: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "An expense category's name or id." },
        currency: { type: "string", pattern: CURRENCY_PATTERN, description: "The ISO code, such as RSD. Optional when the accounts use one currency." },
        amount: { type: "number", minimum: 0, description: "The monthly limit in major units. Required for set." },
      },
      required: ["action", "category"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", BUDGET_ACTIONS);
        const categoryName = asText(args.category, "category", MAX_NAME_CHARS);
        const named = asOptionalText(args.currency, "currency", 3)?.toUpperCase();
        if (named !== undefined && !isCurrencyCode(named)) throw new Error(text(context.locale, CURRENCY_FORMAT));
        const amount = asOptionalNumber(args.amount, "amount", 0, Number.MAX_SAFE_INTEGER);
        if (action === "set" && amount === undefined) throw new Error(text(context.locale, AMOUNT_NEEDED_FOR_SET));
        if (action === "clear" && amount !== undefined) throw new Error(text(context.locale, AMOUNT_ONLY_FOR_SET));

        const { accounts, categories } = stores(context.profileId);
        const category = resolveNamed(categories.list().filter((entry) => entry.kind === "expense"), categoryName, context.locale, CATEGORY_REFUSAL);
        const currency = budgetCurrency(named, accounts.listActive(), context.locale);

        if (action === "clear") {
          const exists = categories.listBudgets().some((entry) => entry.categoryId === category.id && entry.currency === currency);
          if (!exists) throw new Error(phrase(context.locale, NO_BUDGET_TO_CLEAR, category.name, currency));
          const declined = await confirmOrDecline(
            context,
            "finance.budget",
            "write",
            phrase(context.locale, BUDGET_CLEAR_SUMMARY, category.name, currency),
          );
          if (declined !== null) return declined;
          categories.clearBudget(category.id, currency);
          return okResult(phrase(context.locale, BUDGET_CLEAR_DONE, category.name, currency), { navigateTo: { module: "finance" } });
        }

        const limit = minorOf(amount ?? 0, currency, context.locale);
        const money = formatMoney(context.locale, limit, currency);
        const declined = await confirmOrDecline(
          context,
          "finance.budget",
          "write",
          phrase(context.locale, BUDGET_SET_SUMMARY, category.name, money),
        );
        if (declined !== null) return declined;
        categories.setBudget({ categoryId: category.id, currency, amount: limit }, instantOf(deps.now()));
        return okResult(phrase(context.locale, BUDGET_SET_DONE, category.name, money), { navigateTo: { module: "finance" } });
      }),
  };

  const subscription: Tool = {
    name: "finance.subscription",
    description: {
      sr: "Dodaje pretplatu ili menja postojeću (ime određuje koju). Za novu traži račun, iznos, vrstu i učestalost; raspored postojeće menja se na stranici Finansije. Koristi ga kada korisnik kaže da se nešto plaća redovno ili da menja iznos.",
      en: "Adds a subscription, or changes an existing one with the same name. A new one needs an account, an amount, a kind and a cadence; a schedule is changed on the Finance page. Use it when the user says something is charged regularly, or changes what it costs.",
    },
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: MAX_FIN_RECURRING_NAME_LENGTH, description: "The subscription's name. An existing one with this name is changed; otherwise a new one is made." },
        newName: { type: "string", minLength: 1, maxLength: MAX_FIN_RECURRING_NAME_LENGTH, description: "A new name, when changing an existing subscription." },
        account: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The account it is charged to, by name or id." },
        amount: { type: "number", minimum: 0, description: "The charge in major units, positive." },
        kind: { type: "string", enum: [...KINDS], description: "expense for a charge, income for a regular payment in." },
        category: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "A category of the same kind, by name or id." },
        every: { type: "string", enum: [...EVERY], description: "How often it repeats: day, week, month or year. Required for a new subscription." },
        interval: { type: "integer", minimum: 1, maximum: MAX_RECURRENCE_INTERVAL, description: "Repeat every N of the cadence. Defaults to 1." },
        start: { type: "string", pattern: DAY_PATTERN, description: "The first charge day, YYYY-MM-DD. Defaults to today." },
        endDate: { type: "string", pattern: DAY_PATTERN, description: "The last day it may charge, YYYY-MM-DD. Leave it out for no end." },
        payee: { type: "string", minLength: 1, maxLength: MAX_FIN_PAYEE_LENGTH, description: "Who is paid." },
        note: { type: "string", minLength: 1, maxLength: MAX_FIN_NOTE_LENGTH, description: "A short note." },
        reminderDays: { type: "integer", minimum: 0, maximum: MAX_FIN_REMINDER_DAYS, description: "How many days before a charge to remind, 0 to 365." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const name = asText(args.name, "name", MAX_FIN_RECURRING_NAME_LENGTH);
        const newName = asOptionalText(args.newName, "newName", MAX_FIN_RECURRING_NAME_LENGTH);
        const accountName = asOptionalText(args.account, "account", MAX_NAME_CHARS);
        const amount = asOptionalNumber(args.amount, "amount", 0, Number.MAX_SAFE_INTEGER);
        const kind = asOptionalEnum(args.kind, "kind", KINDS);
        const categoryName = asOptionalText(args.category, "category", MAX_NAME_CHARS);
        const every = asOptionalEnum(args.every, "every", EVERY);
        const interval = asOptionalCount(args.interval, "interval", 1, MAX_RECURRENCE_INTERVAL);
        const start = asOptionalDay(args.start, "start");
        const endDate = asOptionalDay(args.endDate, "endDate");
        const payee = asOptionalText(args.payee, "payee", MAX_FIN_PAYEE_LENGTH);
        const note = asOptionalText(args.note, "note", MAX_FIN_NOTE_LENGTH);
        const reminderDays = asOptionalCount(args.reminderDays, "reminderDays", 0, MAX_FIN_REMINDER_DAYS);

        const { accounts, categories, recurring } = stores(context.profileId);
        const accountList = accounts.listActive();
        const existing = findNamed(recurring.listActive(), name, context.locale, SUBSCRIPTION_REFUSAL.ambiguous);

        if (existing !== undefined) {
          if (every !== undefined || interval !== undefined || start !== undefined || endDate !== undefined) {
            throw new Error(text(context.locale, SCHEDULE_ON_PAGE));
          }
          const account = accountName === undefined ? undefined : resolveNamed(accountList, accountName, context.locale, ACCOUNT_REFUSAL);
          const currentAccount = accountList.find((entry) => entry.id === existing.accountId);
          const currency = (account ?? currentAccount)?.currency ?? "";
          // The direction is the stored sign unless the user names one, exactly as the page derives it.
          const direction: EntryKind = kind ?? (existing.amount > 0 ? "income" : "expense");

          const fields: UpdateFinRecurringFields = {};
          const changed: string[] = [];
          if (newName !== undefined) {
            fields.name = newName;
            changed.push(text(context.locale, FIELD.name));
          }
          if (account !== undefined) {
            fields.accountId = account.id;
            changed.push(text(context.locale, FIELD.account));
          }
          if (amount !== undefined || kind !== undefined) {
            const magnitude = amount === undefined ? Math.abs(existing.amount) : minorOf(amount, currency, context.locale);
            fields.amount = direction === "income" ? magnitude : -magnitude;
            if (amount !== undefined) changed.push(text(context.locale, FIELD.amount));
            if (kind !== undefined) changed.push(text(context.locale, FIELD.kind));
          }
          if (categoryName !== undefined) {
            const category = resolveNamed(categories.list().filter((entry) => entry.kind === direction), categoryName, context.locale, CATEGORY_REFUSAL);
            fields.categoryId = category.id;
            changed.push(text(context.locale, FIELD.category));
          }
          if (payee !== undefined) {
            fields.payee = payee;
            changed.push(text(context.locale, FIELD.payee));
          }
          if (note !== undefined) {
            fields.note = note;
            changed.push(text(context.locale, FIELD.note));
          }
          if (reminderDays !== undefined) {
            fields.reminderDays = reminderDays;
            changed.push(text(context.locale, FIELD.reminder));
          }
          if (changed.length === 0) throw new Error(text(context.locale, NOTHING_TO_CHANGE));

          const declined = await confirmOrDecline(
            context,
            "finance.subscription",
            "write",
            phrase(context.locale, SUBSCRIPTION_EDIT_SUMMARY, existing.name, changed.join(", ")),
          );
          if (declined !== null) return declined;
          const updated = recurring.update(existing.id, fields, instantOf(deps.now()));
          return okResult(phrase(context.locale, SUBSCRIPTION_EDITED, updated.name, updated.id), { navigateTo: { module: "finance" } });
        }

        if (accountName === undefined || amount === undefined || kind === undefined || every === undefined) {
          const missing: AssistantText[] = [];
          if (accountName === undefined) missing.push(FIELD.account);
          if (amount === undefined) missing.push(FIELD.amount);
          if (kind === undefined) missing.push(FIELD.kind);
          if (every === undefined) missing.push(FIELD.every);
          throw new Error(phrase(context.locale, MISSING_FIELDS, missing.map((field) => text(context.locale, field)).join(", ")));
        }

        const account = resolveNamed(accountList, accountName, context.locale, ACCOUNT_REFUSAL);
        const category =
          categoryName === undefined
            ? undefined
            : resolveNamed(categories.list().filter((entry) => entry.kind === kind), categoryName, context.locale, CATEGORY_REFUSAL);
        const startDay = start ?? localDay(deps.now());
        const magnitude = minorOf(amount, account.currency, context.locale);
        const recurrence = validateRecurrenceRule(ruleFor(every, interval ?? 1, startDay, endDate));
        if (recurrence === null) throw new Error(text(context.locale, RULE_INVALID));

        const declined = await confirmOrDecline(
          context,
          "finance.subscription",
          "write",
          phrase(
            context.locale,
            SUBSCRIPTION_CREATE_SUMMARY,
            name,
            formatMoney(context.locale, magnitude, account.currency),
            cadenceText(context.locale, every, interval ?? 1),
            account.name,
            formatDayShort(context.locale, startDay),
          ),
        );
        if (declined !== null) return declined;

        const input: CreateFinRecurringInput = {
          accountId: account.id,
          name,
          amount: kind === "income" ? magnitude : -magnitude,
          recurrence,
          startDate: startDay,
          ...(category === undefined ? {} : { categoryId: category.id }),
          ...(payee === undefined ? {} : { payee }),
          ...(note === undefined ? {} : { note }),
          ...(reminderDays === undefined ? {} : { reminderDays }),
        };
        const created = recurring.create(input, instantOf(deps.now()));
        return okResult(phrase(context.locale, SUBSCRIPTION_CREATED, created.name, created.id, startDay), { navigateTo: { module: "finance" } });
      }),
  };

  const pause: Tool = {
    name: "finance.pause",
    description: {
      sr: "Pauzira ili nastavlja pretplatu po imenu. Pauzirana pretplata se ne naplaćuje dok se ne nastavi; ništa se ne briše. Koristi ga kada korisnik kaže da prestane da plaća nešto, ali da zadrži pretplatu.",
      en: "Pauses or resumes a subscription by name. A paused subscription is not charged until it resumes; nothing is deleted. Use it when the user wants to stop being charged but keep the subscription.",
    },
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: MAX_FIN_RECURRING_NAME_LENGTH, description: "The subscription's name or id." },
        action: { type: "string", enum: [...PAUSE_ACTIONS], description: "pause to stop charging, resume to start again." },
      },
      required: ["name", "action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const name = asText(args.name, "name", MAX_FIN_RECURRING_NAME_LENGTH);
        const action = asEnum(args.action, "action", PAUSE_ACTIONS);
        const { recurring } = stores(context.profileId);
        const row = resolveNamed(recurring.listActive(), name, context.locale, SUBSCRIPTION_REFUSAL);
        const paused = row.pausedAt !== null;

        if (action === "pause" && paused) return okResult(phrase(context.locale, ALREADY_PAUSED, row.name));
        if (action === "resume" && !paused) return okResult(phrase(context.locale, NOT_PAUSED, row.name));

        const declined = await confirmOrDecline(
          context,
          "finance.pause",
          "write",
          phrase(context.locale, action === "pause" ? PAUSE_SUMMARY : RESUME_SUMMARY, row.name),
        );
        if (declined !== null) return declined;
        const now = instantOf(deps.now());
        if (action === "pause") recurring.pause(row.id, now);
        else recurring.resume(row.id, now, localDay(deps.now()));
        return okResult(phrase(context.locale, action === "pause" ? PAUSED_DONE : RESUMED_DONE, row.name, row.id), {
          navigateTo: { module: "finance" },
        });
      }),
  };

  return [summary, transactions, budgets, subscriptions, record, budget, subscription, pause];
}

// --- Periods and dates --------------------------------------------------------

/**
 * The inclusive span a report answers over. With neither end named it is the
 * current month; with one end named the other is that month's own edge, so
 * „from 2026-10-03" reads to the end of October rather than to nothing.
 */
function periodOf(from: string | undefined, to: string | undefined, today: string): FinPeriod {
  const anchor = from ?? to ?? today;
  return { from: from ?? `${anchor.slice(0, 7)}-01`, to: to ?? monthEnd(anchor) };
}

/** The last day of the month a bare day falls in: day 0 of the next month is the last of this one. */
function monthEnd(day: string): string {
  const last = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** The Monday-first weekday of a bare day, the index the recurrence engine uses (0 = Monday). */
function weekdayOf(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The instant a store writes, from main's clock. */
function instantOf(atMs: number): string {
  return new Date(atMs).toISOString();
}

// --- Money -------------------------------------------------------------------

/**
 * A major-unit amount as minor units of `currency`, or a refusal naming the
 * currency's own decimal count. The number is read through its shortest decimal
 * form, so 12.34 is exactly 1234 and never 1233.999….
 */
function minorOf(amount: number, currency: string, locale: AssistantLocale): number {
  const minor = minorUnitsFromText(String(amount), currency, ["."]);
  if (minor === null) throw new Error(phrase(locale, AMOUNT_PRECISION, currency, currencyMinorDigits(currency)));
  return minor;
}

/**
 * The currency a budget is in: the one the user named, else the one every live
 * account shares. Several currencies with none named is a question for the user,
 * asked with the list.
 */
function budgetCurrency(named: string | undefined, accounts: readonly FinAccount[], locale: AssistantLocale): string {
  if (named !== undefined) return named;
  const currencies = [...new Set(accounts.map((account) => account.currency))].sort();
  const only = currencies[0];
  if (currencies.length === 1 && only !== undefined) return only;
  if (currencies.length === 0) throw new Error(text(locale, NO_ACCOUNT_FOR_CURRENCY));
  throw new Error(phrase(locale, CURRENCY_NEEDED, currencies.join(", ")));
}

/** The live, non-archived accounts that hold `currency`, with their balances, in name order. */
function accountBalances(
  live: readonly FinAccount[],
  currency: string,
  balances: readonly { readonly accountId: string; readonly currency: string; readonly minorUnits: number }[],
): { name: string; minorUnits: number }[] {
  const byId = new Map(live.filter((account) => !account.archived).map((account) => [account.id, account] as const));
  return balances
    .filter((balance) => balance.currency === currency)
    .flatMap((balance) => {
      const account = byId.get(balance.accountId);
      return account === undefined ? [] : [{ name: account.name, minorUnits: balance.minorUnits }];
    });
}

// --- Names -------------------------------------------------------------------

/**
 * The one row a name means, or undefined when none does: its id first, then its
 * name folded (case and diacritics). A folded name shared by several rows is a
 * refusal listing them, with their ids, so the model can name one.
 */
function findNamed<T extends { readonly id: string; readonly name: string }>(
  items: readonly T[],
  query: string,
  locale: AssistantLocale,
  ambiguous: AssistantPhrase<[name: string, candidates: string]>,
): T | undefined {
  const byId = items.find((item) => item.id === query);
  if (byId !== undefined) return byId;
  const needle = foldSearchText(query.trim());
  const matches = items.filter((item) => foldSearchText(item.name) === needle);
  if (matches.length > 1) {
    throw new Error(phrase(locale, ambiguous, query, matches.map((item) => `${item.name} (${item.id})`).join(", ")));
  }
  return matches[0];
}

/** `findNamed`, refusing with the names that exist when nothing matches. */
function resolveNamed<T extends { readonly id: string; readonly name: string }>(
  items: readonly T[],
  query: string,
  locale: AssistantLocale,
  refusal: NameRefusal,
): T {
  const found = findNamed(items, query, locale, refusal.ambiguous);
  if (found !== undefined) return found;
  const known = items.map((item) => item.name).join(", ");
  throw new Error(phrase(locale, refusal.unknown, query, known.length === 0 ? text(locale, NONE) : known));
}

// --- Rows and rules ----------------------------------------------------------

/** One transaction as a line: its id first, for a follow-up, then the reading a person gives. */
function transactionLine(
  locale: AssistantLocale,
  row: FinTransaction,
  categories: ReadonlyMap<string, string>,
  accounts: ReadonlyMap<string, FinAccount>,
): string {
  const account = accounts.get(row.accountId);
  const currency = account?.currency ?? "";
  const from = account?.name ?? "";
  const where =
    row.counterAccountId === null
      ? from
      : `${from} ${text(locale, LABEL.to)} ${accounts.get(row.counterAccountId)?.name ?? ""}`;
  const category = row.categoryId === null ? text(locale, LABEL.uncategorized) : (categories.get(row.categoryId) ?? "");
  const note = row.note === null ? "" : ` — ${row.note}`;
  return `- ${row.id} ${row.date} ${row.payee ?? "—"} ${formatMoney(locale, row.amount, currency)} [${category}, ${where}]${note}`;
}

/** One subscription as a line: its id, what it costs, how it repeats, and where its next charge stands. */
function subscriptionLine(locale: AssistantLocale, row: FinRecurring, account: FinAccount): string {
  const state =
    row.pausedAt !== null
      ? text(locale, LABEL.paused)
      : row.nextRun === null
        ? text(locale, LABEL.finished)
        : `${text(locale, LABEL.next)} ${row.nextRun}`;
  return `- ${row.id} ${row.name} ${formatMoney(locale, row.amount, account.currency)} [${recurrenceText(locale, row.recurrence)}, ${account.name}, ${state}]`;
}

/** One upcoming charge: its day, the subscription and the money in that subscription's currency. */
function renewalLine(locale: AssistantLocale, renewal: FinUpcomingRenewal): string {
  return `- ${renewal.date} ${renewal.name} ${formatMoney(locale, renewal.amount, renewal.currency)}`;
}

/** A stored rule's cadence in words, with its interval when it is not one. */
function recurrenceText(locale: AssistantLocale, rule: RecurrenceRule): string {
  const freq = rule.freq;
  switch (freq.kind) {
    case "daily":
      return cadenceText(locale, "day", freq.interval);
    case "weekdays":
      return cadenceText(locale, "weekdays", 1);
    case "weekly":
      return cadenceText(locale, "week", freq.interval);
    case "monthly-date":
    case "monthly-ordinal":
      return cadenceText(locale, "month", freq.interval);
    case "yearly":
      return cadenceText(locale, "year", freq.interval);
  }
}

function cadenceText(locale: AssistantLocale, every: Every | "weekdays", interval: number): string {
  const word = text(locale, CADENCE[every]);
  return interval > 1 ? `${word} (×${interval})` : word;
}

/**
 * The recurrence rule a flat `every` names, in the shape the engine validates. A
 * week repeats on its start's weekday, a month on its start's day of the month,
 * and the end is `endDate` or never. Typed `unknown`: `validateRecurrenceRule` is
 * the gate, so no rule is trusted by its shape alone.
 */
function ruleFor(every: Every, interval: number, start: string, endDate: string | undefined): unknown {
  const freq =
    every === "day"
      ? { kind: "daily", interval }
      : every === "week"
        ? { kind: "weekly", interval, days: [weekdayOf(start)] }
        : every === "month"
          ? { kind: "monthly-date", interval, day: Number(start.slice(8, 10)) }
          : { kind: "yearly", interval };
  return { freq, end: endDate === undefined ? { kind: "never" } : { kind: "until", date: endDate } };
}
