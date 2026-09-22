import { Fragment, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Button,
  CardsView,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  ProportionBar,
  Select,
  StatBand,
  TextField,
} from "@nexus/ui";
import { applyFilters, isValidDayKey, monthKeyOf, shiftMonthKey } from "@nexus/core";
import type { CardsViewConfig, CollectionSchema, FilterSpec } from "@nexus/core";
import {
  FIN_ACCOUNT_KINDS,
  FIN_CATEGORY_KINDS,
  MAX_FIN_ACCOUNT_NAME_LENGTH,
  MAX_FIN_CATEGORY_NAME_LENGTH,
  MAX_FIN_NOTE_LENGTH,
  MAX_FIN_PAYEE_LENGTH,
  MAX_FIN_RECURRING_NAME_LENGTH,
} from "../../shared/ipc.js";
import type {
  FinAccount,
  FinAccountBalance,
  FinBudget,
  FinCategory,
  FinAccountKind,
  FinCategoryKind,
  FinCategorySpend,
  FinCurrencyTotal,
  FinRecurring,
  FinTransaction,
  FinUpcomingRenewal,
  RecurrenceRule,
} from "../../shared/ipc.js";
import { RecurrencePicker } from "./RecurrencePicker.js";
import { localTodayKey, shiftDayKey } from "./examDates.js";
import { FinBalanceFlow } from "./FinBalanceFlow.js";
import { FinCsvImportSection } from "./FinCsvImport.js";
import { normalizeCurrencyInput, readStoredPrimaryCurrency } from "./financePrefs.js";
import {
  buildFinMonthReport,
  formatFinMonthLabel,
  monthPeriod,
  type FinReportLine,
  type FinReportSection,
} from "./financeReport.js";
import { formatMoney, formatMoneyPlain, moneyInputValue, parseMoneyInput } from "./money.js";
import { NotePopover } from "./notePopover.js";
import { countUnit, strings } from "./strings.js";
import { TypedConfirmDialog } from "./TypedConfirmDialog.js";
import { moduleName } from "./moduleName.js";

/**
 * Finansije (FIN) — the ledger's page. Slice a shipped the data layer and the
 * five decisions written into migration 051; this page is bound by every one of
 * them and revisits none:
 *
 * - **Money is an INTEGER of minor units** in every value this file holds. The
 *   only decimal anywhere is produced by `money.ts` at the moment of drawing,
 *   and the only decimal ever read is parsed by the same module before it
 *   crosses the wire. There is no `toFixed` here and no float arithmetic.
 * - **Currency is per ACCOUNT and nothing converts.** Which is why every
 *   aggregate on this page — the band, a day's net, the month report — is a
 *   LIST keyed by currency rather than a number, and why nothing here ever
 *   reduces such a list. A cross-currency sum is not merely avoided: the store
 *   publishes no method that could produce one, and `money.ts` cannot format an
 *   amount without being told which money it is, so there is nothing to add up
 *   by accident.
 * - **A balance is DERIVED**, read on its own channel and never patched
 *   locally: every write re-reads the whole screen (`reload`), so a balance on
 *   screen is always one the store just computed from the rows beside it.
 * - **A transfer is ONE row** naming both accounts. „Prenos" is the single act
 *   that writes it, and a transfer row is DRAWN as a transfer — the two account
 *   names and the direction — never as an expense wearing a strange category.
 *   It is also absent from every aggregate here, because it is neither income
 *   nor expense and folding it into one would be inventing money.
 * - **Categories are flat, with a kind**, so the picker offers exactly the kind
 *   the current entry can carry, and offers none at all for a transfer.
 *
 * **What this page is, as a piece of design.** It is three hundred numbers, so
 * the numbers come first and everything else is chrome around them:
 *
 * - *Summary before detail.* The band at the top states the balance the profile
 *   holds and what came in and went out of the rows currently on screen — one
 *   group per currency, the code named once as the group's caption.
 * - *The unit is hoisted exactly when it is constant.* `soleValue` decides,
 *   from the rows about to be drawn, whether they share one currency. When they
 *   do, the code moves to the column head and the cells hold the figure alone;
 *   when they do not, every cell carries its own, because the repetition is
 *   then information. The rail applies the identical rule to its balances.
 * - *Grouped by day, never paginated.* Rows arrive newest-day-first and stay
 *   that way; the page cuts them at each date change and gives every run a
 *   sticky rule carrying that day's net.
 * - *One row of chrome.* The half switcher moved into the page header's actions
 *   slot, the entry form became a disclosure — it is used a few times a day on
 *   a surface that is read a hundred — and what is left above the ledger is a
 *   single controls row.
 *
 * The ledger's FILTERING is still the views engine's (`applyFilters`, ADR-050):
 * the list draws `visibleRows`, and „Kartice" hands `CardsView` the same specs,
 * so the two shapes can never disagree about which rows exist. Only the list's
 * ARRANGEMENT is the page's own, because a ledger is grouped by day and the
 * engine has no slot for a group. There is no `sort` spec, so „newest day
 * first" stays what the store already guarantees.
 *
 * The CATEGORY filter is a `FilterSpec` — strict equality is exactly what it
 * needs, `null` for „Bez kategorije" included — while the ACCOUNT and PERIOD
 * filters are predicates applied here, because equality cannot express „either
 * side of a transfer" or a range. That is the same split TASK's page makes.
 *
 * **„Izveštaj"** reads ONE month and states what happened in it — per currency,
 * never merged — under one rule more than the ledger obeys: it claims nothing
 * it was not told. No projection, no forecast, no „ovim tempom ćeš…", and no
 * budget inferred from what was spent before; a category with no limit says so.
 * All of the month's arithmetic lives in `financeReport.ts`. Budgets are edited
 * beside the categories, because a budget IS a category's monthly limit.
 */

/** The three acts the one entry form performs. It decides the SIGN and what the row may carry — never a stored field. */
type EntryKind = "expense" | "income" | "transfer";

const ENTRY_KINDS: readonly EntryKind[] = ["expense", "income", "transfer"];

/** The page's three halves, in toggle order. */
type FinPage = "ledger" | "report" | "subscriptions";

const FIN_PAGES: readonly FinPage[] = ["ledger", "report", "subscriptions"];

/**
 * How far ahead „Predstojeće naplate" reads. Three months: far enough that a
 * quarterly subscription shows up at all, near enough that the list is a
 * heads-up rather than a projection — and it is read from the RULES, so the
 * number costs an expansion and never a written row.
 */
const RENEWAL_HORIZON_DAYS = 92;

/**
 * The renewal reminder leads the form offers, in days. A closed list rather than
 * a number field: „podseti me 137 dana ranije" is not a thing anybody means, and
 * the four here are what a charge is actually worth hearing about. `null` is the
 * shipped value — a subscription reminds only when its owner asks it to.
 */
const REMINDER_DAY_OPTIONS: readonly number[] = [0, 1, 3, 7];

/** Which way a subscription's money goes; it decides the SIGN and is never a stored field. */
type RecurringDirection = "out" | "in";

/** The two shapes the ledger opens in, in toggle order. */
type LedgerView = "list" | "cards";

const LEDGER_VIEWS: readonly LedgerView[] = ["list", "cards"];

/** The category filter's own values beside a real id: every category, or none of them. */
const CATEGORY_FILTER_ALL = "";
const CATEGORY_FILTER_NONE = "none";

/**
 * The views engine's generic bound is `Record<string, unknown>`; a TS interface
 * has no implicit index signature, so rows reach it through this structurally
 * identical mapped type — the `TaskFields` trick, one module over.
 */
type FinTransactionFields = { [K in keyof FinTransaction]: FinTransaction[K] };

/**
 * The ledger's fields for the engine. `amount` is a `number` of MINOR UNITS —
 * the engine only ever compares it, and comparing minor units is comparing
 * money as long as the rows share a currency, which within one account they
 * always do. The two id fields are `text` rather than `select`: their domains
 * are this profile's own rows, and the engine needs options only for a board
 * this page does not draw.
 */
const FIN_SCHEMA: CollectionSchema = {
  fields: [
    { key: "date", type: "date" },
    { key: "amount", type: "number" },
    { key: "payee", type: "text" },
    { key: "accountId", type: "text" },
    { key: "categoryId", type: "text" },
  ],
};

/** One pending undo offer; a fresh delete replaces the previous one, exactly as on the tasks page. */
type PendingUndo =
  | null
  | { kind: "transaction"; id: string }
  | { kind: "account"; id: string }
  | { kind: "subscription"; id: string };

/** Which inline rail editor is open, if any. */
type AccountEditing = null | { mode: "new" } | { mode: "edit"; id: string };
type CategoryEditing = null | { mode: "new" } | { mode: "rename"; id: string };

/**
 * The one value a run of rows all carry, or `null` when they carry more than
 * one. **This is the page's rule for telling a caption from a datum**, and it
 * is computed rather than assumed: a word that is the same on every row is the
 * heading of the column it sits in, and printing it sixty times is sixty copies
 * of one fact competing with the sixty facts that differ. The currency is the
 * case that matters — „ RSD" after every amount is 180 characters of noise
 * beside the figures — and the moment two currencies are genuinely on screen
 * the same rule puts the code back on every cell, where it is information.
 *
 * An empty run has no shared value and gets `null`, which is the safe answer:
 * nothing is hoisted out of a column that has nothing in it.
 */
function soleValue(values: Iterable<string>): string | null {
  let sole: string | null = null;
  for (const value of values) {
    if (value === "") continue;
    if (sole === null) sole = value;
    else if (sole !== value) return null;
  }
  return sole;
}

/**
 * A MOVEMENT of money, with its direction stated by the SIGN PAIR: an explicit
 * „+" for money arriving, the locale's own minus for money leaving.
 *
 * The pair is the point. A lone minus is something a reader has to notice, and
 * on a page where most rows are expenses it becomes the wallpaper; a plus
 * opposite it is something they cannot miss, and it is a glyph rather than a
 * hue — so the jade on income reinforces the fact instead of being the only
 * thing carrying it. The „+" is prefixed rather than asked of `Intl` because
 * `money.ts` owns every other decision about the string, including where the
 * MINUS goes, and sr-Latn is a prefix-sign locale in both directions.
 *
 * A BALANCE is not a movement and never comes through here: it is a state, and
 * „+123.456,00" for having money is a claim about a direction it is not going
 * in. The band prints those with `formatMoneyPlain` directly.
 *
 * `unit` is the currency hoisted out of the column (`soleValue`), or null when
 * every cell has to carry its own code.
 */
function signedMoney(minorUnits: number, currency: string, unit: string | null): string {
  const text =
    unit === null ? formatMoney(minorUnits, currency) : formatMoneyPlain(minorUnits, currency);
  return minorUnits > 0 ? `+${text}` : text;
}

/**
 * The ledger's dated rule — „ČET, 7. AVG 2026." UTC because a day key is a
 * calendar day and not an instant: parsing it in the local zone would shift the
 * label by one day for anybody east of Greenwich at the wrong hour.
 */
const LEDGER_DAY_FORMATTER = new Intl.DateTimeFormat("sr-Latn", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A day key as the ledger's rule reads it; degrades to the key itself rather than throwing on a malformed one. */
function formatLedgerDay(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? dayKey : LEDGER_DAY_FORMATTER.format(date);
}

/** One dated run of the ledger, and what that day came to. */
interface FinDayGroup {
  date: string;
  rows: FinTransactionFields[];
  /** The day's net per CURRENCY — never one number across two, and no transfer in any of them. */
  nets: Map<string, number>;
}

/** One currency's line in the page's summary band. */
interface FinBandGroup {
  currency: string;
  /** The profile's balance in this currency, or null when it keeps no live account in it. */
  balance: number | null;
  /** Money that arrived, and money that left, among the rows currently on screen — both as positive magnitudes. */
  income: number;
  outflow: number;
}

/**
 * Maps a FIN store/IPC failure onto the Serbian copy by matching the store's
 * own validation messages (they cross IPC inside the error text) — the exact
 * shape `planErrorMessage` uses for STUDY. UX only: the store remains the
 * authority on what is rejected, and nothing here decides anything.
 */
function financeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const copy = strings.finance.error;
  if (message.includes("must be different accounts")) return copy.transferSameAccount;
  if (message.includes("cannot cross currencies")) return copy.transferCurrency;
  if (message.includes("carries no category")) return copy.transferCategory;
  if (message.includes("can only be set on an expense category")) return copy.budgetOnIncome;
  if (message.includes("positive safe INTEGER")) return copy.budgetAmount;
  if (message.includes("already exists in this profile")) {
    return strings.finance.categories.duplicate;
  }
  // FIN slice d: the one refusal a subscription has that nothing else does.
  if (message.includes("not a valid recurrence rule")) return copy.recurrenceInvalid;
  if (
    message.includes("No active account") ||
    message.includes("No category") ||
    message.includes("No active transaction") ||
    message.includes("No active subscription") ||
    // ADR-074's two: pausing something already paused, or resuming something
    // that is running, are the same „taj red više nije takav" as the four above.
    message.includes("No unpaused subscription") ||
    message.includes("No paused subscription") ||
    message.includes("budget on category")
  ) {
    return copy.notFound;
  }
  return strings.finance.actionError;
}

/** A renewal lead in words — the same closed list the form offers, so one number reads the same on both surfaces. */
function reminderLabel(days: number): string {
  const labels = strings.finance.subscriptions.reminderOptions;
  return labels[String(days) as keyof typeof labels] ?? String(days);
}

/** What kind of movement a row IS, derived from the row itself — never a stored flag. */
function entryKindOf(transaction: FinTransactionFields): EntryKind {
  if (transaction.counterAccountId !== null) return "transfer";
  return transaction.amount > 0 ? "income" : "expense";
}

/** Membership against the closed list, narrowing the kind `<select>`'s raw string without an assertion. */
function asAccountKind(value: string): FinAccountKind {
  for (const kind of FIN_ACCOUNT_KINDS) if (kind === value) return kind;
  return "current";
}

/** Everything one render of this page stands on, read in one round of parallel calls. */
interface FinanceSnapshot {
  accounts: FinAccount[];
  balances: FinAccountBalance[];
  totals: FinCurrencyTotal[];
  categories: FinCategory[];
  budgets: FinBudget[];
  transactions: FinTransaction[];
  subscriptions: FinRecurring[];
  /** What the RULES say is coming — expanded by the store, never read off a row. */
  renewals: FinUpcomingRenewal[];
}

/** One month's two aggregate reads, which are the only thing the report is built from. */
interface FinMonthSnapshot {
  spend: FinCategorySpend[];
  income: FinCurrencyTotal[];
}

/**
 * The page's one read. The rail and the ledger are ONE screen, so a render
 * holding transactions but no accounts — or balances that predate the row which
 * changed them — is never shown; all five are reads of the same local database,
 * so any one of them failing is the page's one load error.
 *
 * Module-level so the mount effect and every write's refresh call the same
 * thing without either becoming a dependency of the other (the `reload`-inside-
 * an-effect trap the neighbouring pages step around by duplicating the calls).
 */
async function loadFinance(profileId: string): Promise<FinanceSnapshot> {
  const today = localTodayKey();
  const [accounts, balances, totals, categories, budgets, transactions, subscriptions, renewals] =
    await Promise.all([
      window.nexus.listFinAccounts(profileId),
      window.nexus.finAccountBalances(profileId),
      window.nexus.finCurrencyTotals(profileId),
      window.nexus.listFinCategories(profileId),
      window.nexus.listFinBudgets(profileId),
      window.nexus.listFinTransactions(profileId),
      window.nexus.listFinRecurring(profileId),
      // From TODAY forward, deliberately: a renewal before today is a charge the
      // ledger already holds, and listing it as „predstojeće" would be false.
      window.nexus.finUpcomingRenewals(profileId, {
        from: today,
        to: shiftDayKey(today, RENEWAL_HORIZON_DAYS),
      }),
    ]);
  return { accounts, balances, totals, categories, budgets, transactions, subscriptions, renewals };
}

/**
 * The month's own read, separate from `loadFinance` because it is asked over a
 * DIFFERENT input — the chosen month — and re-asked when that changes while
 * nothing else has. Both halves come back together for the reason the page's
 * five reads do: a report holding this month's spending against last month's
 * income would be a screen that is wrong about itself.
 */
async function loadFinMonth(profileId: string, monthKey: string): Promise<FinMonthSnapshot> {
  const period = monthPeriod(monthKey);
  const [spend, income] = await Promise.all([
    window.nexus.finSpendByCategory(profileId, period),
    window.nexus.finIncomeByCurrency(profileId, period),
  ]);
  return { spend, income };
}

export type FinanceIntent = { kind: "create" };

export interface FinancePageProps {
  profileId: string;
  /** A pending deep link (021-e): „Nova transakcija" from the palette, or the quick-create chord. */
  intent: FinanceIntent | null;
  onIntentHandled: () => void;
}

export function FinancePage({ profileId, intent, onIntentHandled }: FinancePageProps) {
  const s = strings.finance;

  const [accounts, setAccounts] = useState<FinAccount[] | null>(null);
  const [balances, setBalances] = useState<FinAccountBalance[]>([]);
  const [totals, setTotals] = useState<FinCurrencyTotal[]>([]);
  const [categories, setCategories] = useState<FinCategory[]>([]);
  const [budgets, setBudgets] = useState<FinBudget[]>([]);
  const [transactions, setTransactions] = useState<FinTransaction[] | null>(null);
  const [subscriptions, setSubscriptions] = useState<FinRecurring[]>([]);
  const [renewals, setRenewals] = useState<FinUpcomingRenewal[]>([]);
  const [failed, setFailed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // „Izveštaj": which half is on screen, which month it reads, and that month's
  // two aggregates. The month opens on the current one — the report is about
  // what happened, and the month that is happening is the one being lived in.
  const [page, setPage] = useState<FinPage>("ledger");
  const [monthKey, setMonthKey] = useState(() => monthKeyOf(localTodayKey()));
  const [month, setMonth] = useState<FinMonthSnapshot | null>(null);
  const [monthFailed, setMonthFailed] = useState(false);

  // The rail's account filter; null is „Svi računi", which is a VIEW over every
  // account rather than an account of its own.
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [view, setView] = useState<LedgerView>("list");
  const [categoryFilter, setCategoryFilter] = useState<string>(CATEGORY_FILTER_ALL);
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");

  // The one entry form, serving create and edit (the tasks page's own shape).
  // It is a DISCLOSURE: the ledger is read far more often than it is written
  // to, so the form is not on screen until somebody asks for it.
  const [formOpen, setFormOpen] = useState(false);
  const [entryKind, setEntryKind] = useState<EntryKind>("expense");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amountDraft, setAmountDraft] = useState("");
  const [payeeDraft, setPayeeDraft] = useState("");
  const [dateDraft, setDateDraft] = useState(localTodayKey);
  const [accountDraft, setAccountDraft] = useState("");
  const [counterDraft, setCounterDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // The rail's own editors and its one error line.
  const [accountEditing, setAccountEditing] = useState<AccountEditing>(null);
  const [accountName, setAccountName] = useState("");
  const [accountKind, setAccountKind] = useState<FinAccountKind>("current");
  const [accountCurrency, setAccountCurrency] = useState(readStoredPrimaryCurrency);
  const [accountOpening, setAccountOpening] = useState("");
  const [categoryEditing, setCategoryEditing] = useState<CategoryEditing>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryKind, setCategoryKind] = useState<FinCategoryKind>("expense");
  const [budgetCurrency, setBudgetCurrency] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [railError, setRailError] = useState<string | null>(null);
  /** The category a delete click is asking about; null when nothing is being asked. */
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<FinCategory | null>(null);

  // „Pretplate" (FIN slice d): one form, serving create and edit, exactly as the
  // ledger's own does. The rule is edited by the SAME `RecurrencePicker` the
  // task and event forms use — there is one schedule language in this app.
  const [subEditingId, setSubEditingId] = useState<string | null>(null);
  const [subFormOpen, setSubFormOpen] = useState(false);
  const [subDirection, setSubDirection] = useState<RecurringDirection>("out");
  const [subName, setSubName] = useState("");
  const [subAmount, setSubAmount] = useState("");
  const [subAccount, setSubAccount] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [subStart, setSubStart] = useState(localTodayKey);
  const [subRule, setSubRule] = useState<RecurrenceRule | null>(null);
  const [subReminder, setSubReminder] = useState<number | null>(null);
  const [subNote, setSubNote] = useState("");
  const [subError, setSubError] = useState<string | null>(null);

  const [pendingUndo, setPendingUndo] = useState<PendingUndo>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // Bumped by an arriving intent, so the focus lands in the effect AFTER the
  // one that switches to „Knjiga" and opens the form — the amount field does
  // not exist to be focused until that has rendered.
  const [focusTick, setFocusTick] = useState(0);

  // The setters are written out here rather than routed through a shared
  // `adopt` helper on purpose: a function declared in the component body is a
  // fresh reference on every render, so this effect would either list it and
  // re-read on every render, or omit it and need a lint exemption. The READ
  // itself is shared (`loadFinance`), which is where the duplication would
  // actually have cost something.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const snapshot = await loadFinance(profileId);
        if (!active) return;
        setAccounts(snapshot.accounts);
        setBalances(snapshot.balances);
        setTotals(snapshot.totals);
        setCategories(snapshot.categories);
        setBudgets(snapshot.budgets);
        setTransactions(snapshot.transactions);
        setSubscriptions(snapshot.subscriptions);
        setRenewals(snapshot.renewals);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load finances:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // The month's own read, re-run whenever the chosen month changes. Read even
  // while „Knjiga" is on screen: both queries are indexed aggregates over the
  // local file, and a report that only begins loading when it is looked at
  // would flash a spinner on every switch.
  useEffect(() => {
    let active = true;
    setMonthFailed(false);
    void (async () => {
      try {
        const snapshot = await loadFinMonth(profileId, monthKey);
        if (active) setMonth(snapshot);
      } catch (error) {
        if (active) setMonthFailed(true);
        console.error("Nexus: failed to load the month report:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, monthKey]);

  // Consumes „Nova transakcija" (021-e): the entry form lives in „Knjiga", so
  // the intent puts that half on screen, opens the form and asks for the caret.
  // Reported handled immediately — there is no row to wait for, unlike a reveal.
  useEffect(() => {
    if (!intent) return;
    setPage("ledger");
    setFormOpen(true);
    setFocusTick((tick) => tick + 1);
    onIntentHandled();
  }, [intent, onIntentHandled]);

  // …and the caret lands here, one render later, once that half has been
  // committed. Keyed on the tick rather than on `page`, so switching halves by
  // hand never steals focus and a mount never does either.
  useEffect(() => {
    if (focusTick === 0) return;
    amountRef.current?.focus();
  }, [focusTick]);

  /**
   * Re-reads the WHOLE screen. Every write does: a balance and a per-currency
   * total are derived from the transactions, so a page that patched one row
   * locally would show a balance that no longer follows from the rows beside it
   * — the exact drift the missing `balance` column exists to make impossible.
   */
  async function reload(): Promise<void> {
    const [snapshot, monthSnapshot] = await Promise.all([
      loadFinance(profileId),
      // The report is derived from the same rows, so it is re-read with them:
      // a budget raised or a transaction filed changes what the month says.
      loadFinMonth(profileId, monthKey),
    ]);
    setAccounts(snapshot.accounts);
    setBalances(snapshot.balances);
    setTotals(snapshot.totals);
    setCategories(snapshot.categories);
    setBudgets(snapshot.budgets);
    setTransactions(snapshot.transactions);
    setSubscriptions(snapshot.subscriptions);
    setRenewals(snapshot.renewals);
    setMonth(monthSnapshot);
    setMonthFailed(false);
  }

  /**
   * Runs one rail mutation: clears the previous refusal, performs it, closes
   * the editor and re-reads. A failure leaves what was typed where it is.
   *
   * `close` is false for the budget actions alone: a category can hold an
   * allowance in more than one currency, and closing the editor after the first
   * would make setting the second a matter of finding the category again.
   */
  async function runRailAction(action: () => Promise<void>, close = true): Promise<void> {
    setRailError(null);
    try {
      await action();
      if (close) {
        closeAccountEditor();
        closeCategoryEditor();
      }
      await reload();
    } catch (error) {
      setRailError(financeErrorMessage(error));
      console.error("Nexus: finance rail action failed:", error);
    }
  }

  const accountList = accounts ?? [];
  const liveAccounts = accountList.filter((account) => !account.archived);
  const archivedAccounts = accountList.filter((account) => account.archived);
  const accountById = new Map(accountList.map((account) => [account.id, account]));
  const balanceById = new Map(balances.map((balance) => [balance.accountId, balance]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  /**
   * The account the form is filing into, resolved rather than trusted: what was
   * picked while it still names a live account, else the rail's selection, else
   * the first account there is. That resolution is also what the `<select>`
   * shows, so the value on screen and the value submitted cannot disagree.
   */
  const railAccount = selectedAccountId === null ? undefined : accountById.get(selectedAccountId);
  const formAccountId =
    accountDraft !== "" && accountById.has(accountDraft)
      ? accountDraft
      : (railAccount?.archived === false ? railAccount.id : liveAccounts[0]?.id) ?? "";
  const formAccount = accountById.get(formAccountId);

  /** The subscription form's account, resolved on exactly the ledger form's terms. */
  const subAccountId =
    subAccount !== "" && accountById.has(subAccount) ? subAccount : (liveAccounts[0]?.id ?? "");
  const subCurrency = accountById.get(subAccountId)?.currency ?? readStoredPrimaryCurrency();
  /** Which currency the amount field is being typed in — the account's own, said in the field's own label. */
  const formCurrency = formAccount?.currency ?? readStoredPrimaryCurrency();

  /**
   * Clears the draft but LEAVES the panel open — filing one row usually means
   * filing the next, which is also why `keepKind` exists: somebody entering
   * three prihoda in a row should not have to say „Prihod" three times. The
   * kind is only reset when the ACT ends (closing the panel), never between two
   * rows of the same act.
   */
  function resetForm(keepKind = false): void {
    setEditingId(null);
    if (!keepKind) setEntryKind("expense");
    setAmountDraft("");
    setPayeeDraft("");
    setNoteDraft("");
    setDateDraft(localTodayKey());
    setAccountDraft("");
    setCounterDraft("");
    setCategoryDraft("");
    setFormError(null);
  }

  /** Clears the draft AND puts the panel away — „Otkaži", and whatever else ends the act. */
  function closeForm(): void {
    resetForm();
    setFormOpen(false);
  }

  /** Opens an existing row in the same form; its kind is derived from the row, never stored on it. */
  function beginEdit(transaction: FinTransactionFields): void {
    const account = accountById.get(transaction.accountId);
    setFormOpen(true);
    setEditingId(transaction.id);
    setEntryKind(entryKindOf(transaction));
    setAmountDraft(
      account === undefined ? "" : moneyInputValue(Math.abs(transaction.amount), account.currency),
    );
    setPayeeDraft(transaction.payee ?? "");
    setNoteDraft(transaction.note ?? "");
    setDateDraft(transaction.date);
    setAccountDraft(transaction.accountId);
    setCounterDraft(transaction.counterAccountId ?? "");
    setCategoryDraft(transaction.categoryId ?? "");
    setFormError(null);
    // One render later: the panel may not have been on screen a moment ago.
    setFocusTick((tick) => tick + 1);
  }

  /**
   * Writes the form. The SIGN comes from the entry kind and never from what was
   * typed: „Rashod" is money leaving the named account, „Prihod" money arriving
   * in it, and „Prenos" is ONE row leaving the source account — the counter side
   * receives `-amount` by construction, with no second row to keep in step.
   */
  async function submitForm(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (formAccount === undefined) {
      setFormError(s.form.needsAccount);
      return;
    }
    const magnitude = parseMoneyInput(amountDraft, formAccount.currency);
    if (magnitude === null) {
      setFormError(s.form.invalidAmount);
      return;
    }
    const absolute = Math.abs(magnitude);
    if (absolute === 0) {
      setFormError(s.form.zeroAmount);
      return;
    }
    if (entryKind === "transfer" && (counterDraft === "" || counterDraft === formAccount.id)) {
      setFormError(s.form.missingCounter);
      return;
    }

    const fields = {
      accountId: formAccount.id,
      counterAccountId: entryKind === "transfer" ? counterDraft : null,
      // A transfer carries none — the store refuses one by name, so asking is
      // asking to be told off rather than deciding not to ask.
      categoryId: entryKind === "transfer" || categoryDraft === "" ? null : categoryDraft,
      date: dateDraft,
      amount: entryKind === "income" ? absolute : -absolute,
      payee: payeeDraft.trim() === "" ? null : payeeDraft.trim(),
      note: noteDraft.trim() === "" ? null : noteDraft.trim(),
    };

    setFormError(null);
    try {
      if (editingId === null) {
        await window.nexus.createFinTransaction(profileId, fields);
      } else {
        await window.nexus.updateFinTransaction(profileId, editingId, fields);
      }
      resetForm(true);
      // The caret goes back where the next amount is typed: filing a row is
      // almost never the last thing somebody does on this screen.
      amountRef.current?.focus();
      await reload();
    } catch (error) {
      setFormError(financeErrorMessage(error));
      console.error("Nexus: failed to save the transaction:", error);
    }
  }

  /** Soft-deletes a row and offers it back — the tasks page's undo shape over the store's own reversible delete. */
  async function deleteTransaction(transaction: FinTransactionFields): Promise<void> {
    setFormError(null);
    try {
      await window.nexus.deleteFinTransaction(profileId, transaction.id);
      if (editingId === transaction.id) closeForm();
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndo({ kind: "transaction", id: transaction.id });
      await reload();
    } catch (error) {
      setFormError(financeErrorMessage(error));
      console.error("Nexus: failed to delete the transaction:", error);
    }
  }

  async function undoDelete(): Promise<void> {
    const pending = pendingUndo;
    if (pending === null) return;
    try {
      if (pending.kind === "transaction") {
        await window.nexus.restoreFinTransaction(profileId, pending.id);
      } else if (pending.kind === "subscription") {
        await window.nexus.restoreFinRecurring(profileId, pending.id);
      } else {
        await window.nexus.restoreFinAccount(profileId, pending.id);
      }
      setPendingUndo(null);
      await reload();
    } catch (error) {
      setRailError(financeErrorMessage(error));
      console.error("Nexus: failed to undo the delete:", error);
    }
  }

  function closeAccountEditor(): void {
    setAccountEditing(null);
    setAccountName("");
    setAccountOpening("");
  }

  function beginNewAccount(): void {
    setRailError(null);
    setAccountName("");
    setAccountKind("current");
    setAccountCurrency(readStoredPrimaryCurrency());
    setAccountOpening("");
    setAccountEditing({ mode: "new" });
  }

  function beginEditAccount(account: FinAccount): void {
    setRailError(null);
    setAccountName(account.name);
    setAccountKind(account.kind);
    setAccountCurrency(account.currency);
    setAccountOpening(moneyInputValue(account.openingBalance, account.currency));
    setAccountEditing({ mode: "edit", id: account.id });
  }

  function submitAccount(event: FormEvent): void {
    event.preventDefault();
    const editing = accountEditing;
    if (editing === null) return;
    const name = accountName.trim();
    if (name === "") {
      setRailError(s.accounts.invalidName);
      return;
    }
    const currency = normalizeCurrencyInput(accountCurrency);
    if (currency === null) {
      setRailError(s.accounts.invalidCurrency);
      return;
    }
    // An empty opening balance is zero — an account opened at nothing — while a
    // typed one that is not an amount is a refusal rather than a silent zero.
    const opening = accountOpening.trim() === "" ? 0 : parseMoneyInput(accountOpening, currency);
    if (opening === null) {
      setRailError(s.accounts.invalidOpening);
      return;
    }
    const fields = { name, kind: accountKind, currency, openingBalance: opening };
    void runRailAction(async () => {
      if (editing.mode === "new") {
        await window.nexus.createFinAccount(profileId, fields);
      } else {
        await window.nexus.updateFinAccount(profileId, editing.id, fields);
      }
    });
  }

  function closeCategoryEditor(): void {
    setCategoryEditing(null);
    setCategoryName("");
    setBudgetAmount("");
  }

  function beginNewCategory(): void {
    setRailError(null);
    setCategoryName("");
    setCategoryKind("expense");
    setBudgetAmount("");
    setCategoryEditing({ mode: "new" });
  }

  function beginEditCategory(category: FinCategory): void {
    setRailError(null);
    setCategoryName(category.name);
    setCategoryKind(category.kind);
    setBudgetAmount("");
    setCategoryEditing({ mode: "rename", id: category.id });
  }

  function submitCategory(event: FormEvent): void {
    event.preventDefault();
    const editing = categoryEditing;
    if (editing === null) return;
    const name = categoryName.trim();
    if (name === "") {
      setRailError(s.categories.invalidName);
      return;
    }
    void runRailAction(async () => {
      if (editing.mode === "new") {
        await window.nexus.createFinCategory(profileId, name, categoryKind);
      } else {
        await window.nexus.renameFinCategory(profileId, editing.id, name);
      }
    });
  }

  /**
   * Sets one category's allowance in ONE currency. The amount is parsed by the
   * same `money.ts` that parses every other amount on this page, so a limit is
   * an integer of minor units before it leaves the renderer — a budget is money
   * and obeys money's rules. The editor stays open afterwards, because a
   * category may hold an allowance in each currency the profile keeps.
   */
  function submitBudget(categoryId: string, currency: string): void {
    const amount = parseMoneyInput(budgetAmount, currency);
    if (amount === null || amount <= 0) {
      setRailError(s.budgets.invalidAmount);
      return;
    }
    void runRailAction(async () => {
      await window.nexus.setFinBudget(profileId, { categoryId, currency, amount });
      setBudgetAmount("");
    }, false);
  }

  // --- Pretplate (FIN slice d) -----------------------------------------------

  function closeSubForm(): void {
    setSubFormOpen(false);
    setSubEditingId(null);
    setSubName("");
    setSubAmount("");
    setSubNote("");
    setSubError(null);
  }

  function beginNewSubscription(): void {
    setSubEditingId(null);
    setSubDirection("out");
    setSubName("");
    setSubAmount("");
    setSubAccount("");
    setSubCategory("");
    setSubStart(localTodayKey());
    // „Mesečno" is what a subscription almost always is, and a form that opened
    // on „ne ponavlja se" would be offering to make a subscription that is not
    // one. The picker reads it back as its own „Mesečno" preset at this anchor.
    setSubRule({
      freq: { kind: "monthly-date", interval: 1, day: Number(localTodayKey().slice(8, 10)) },
      end: { kind: "never" },
    });
    setSubReminder(null);
    setSubNote("");
    setSubError(null);
    setSubFormOpen(true);
  }

  /** Opens an existing subscription in the same form; its direction is derived from the amount's sign, never stored. */
  function beginEditSubscription(subscription: FinRecurring): void {
    const account = accountById.get(subscription.accountId);
    setSubEditingId(subscription.id);
    setSubDirection(subscription.amount > 0 ? "in" : "out");
    setSubName(subscription.name);
    setSubAmount(
      account === undefined ? "" : moneyInputValue(Math.abs(subscription.amount), account.currency),
    );
    setSubAccount(subscription.accountId);
    setSubCategory(subscription.categoryId ?? "");
    setSubStart(subscription.startDate);
    setSubRule(subscription.recurrence);
    setSubReminder(subscription.reminderDays);
    setSubNote(subscription.note ?? "");
    setSubError(null);
    setSubFormOpen(true);
  }

  /**
   * Writes the subscription form. The SIGN comes from the direction and never
   * from what was typed, exactly as the ledger form's does — „Naplata" is money
   * leaving the named account, „Priliv" money arriving in it.
   */
  async function submitSubscription(event: FormEvent): Promise<void> {
    event.preventDefault();
    const account = accountById.get(subAccountId);
    if (account === undefined) {
      setSubError(s.form.needsAccount);
      return;
    }
    const name = subName.trim();
    if (name === "") {
      setSubError(s.subscriptions.invalidName);
      return;
    }
    const magnitude = parseMoneyInput(subAmount, account.currency);
    if (magnitude === null) {
      setSubError(s.subscriptions.invalidAmount);
      return;
    }
    const absolute = Math.abs(magnitude);
    if (absolute === 0) {
      setSubError(s.subscriptions.zeroAmount);
      return;
    }
    if (!isValidDayKey(subStart)) {
      setSubError(s.subscriptions.invalidStart);
      return;
    }
    if (subRule === null) {
      setSubError(s.error.recurrenceInvalid);
      return;
    }

    const fields = {
      accountId: account.id,
      categoryId: subCategory === "" ? null : subCategory,
      name,
      amount: subDirection === "in" ? absolute : -absolute,
      note: subNote.trim() === "" ? null : subNote.trim(),
      recurrence: subRule,
      startDate: subStart,
      reminderDays: subReminder,
    };

    setSubError(null);
    try {
      if (subEditingId === null) {
        await window.nexus.createFinRecurring(profileId, fields);
      } else {
        await window.nexus.updateFinRecurring(profileId, subEditingId, fields);
      }
      closeSubForm();
      await reload();
    } catch (error) {
      setSubError(financeErrorMessage(error));
      console.error("Nexus: failed to save the subscription:", error);
    }
  }

  async function deleteSubscription(subscription: FinRecurring): Promise<void> {
    setSubError(null);
    try {
      await window.nexus.deleteFinRecurring(profileId, subscription.id);
      if (subEditingId === subscription.id) closeSubForm();
      setPendingUndo({ kind: "subscription", id: subscription.id });
      await reload();
    } catch (error) {
      setSubError(financeErrorMessage(error));
      console.error("Nexus: failed to delete the subscription:", error);
    }
  }

  /**
   * „Pauziraj" / „Nastavi" (ADR-074) — one handler, because the row offers
   * whichever of the two applies and its own `pausedAt` is what decides.
   *
   * No undo offer, unlike the delete beside it: the row stays exactly where it
   * is wearing „Pauzirano", and the button that put it there now says „Nastavi"
   * — an offer to undo would be a second copy of a control already on screen.
   *
   * Await-then-refetch like every other write on this page: the pause decides
   * both what the row says and what „Predstojeće naplate" holds, and an
   * optimistic patch could leave a renewal on screen that the store has just
   * stopped placing.
   */
  async function togglePause(subscription: FinRecurring): Promise<void> {
    setSubError(null);
    try {
      if (subscription.pausedAt === null) {
        await window.nexus.pauseFinRecurring(profileId, subscription.id);
      } else {
        await window.nexus.resumeFinRecurring(profileId, subscription.id);
      }
      await reload();
    } catch (error) {
      setSubError(financeErrorMessage(error));
      console.error("Nexus: failed to pause or resume the subscription:", error);
    }
  }

  // --- What this render draws ------------------------------------------------

  /**
   * The currencies a limit may be set in: the ones this profile actually keeps
   * accounts in. A limit in a currency the user holds no account in could never
   * be spent against, so it is not offered — which is also why this is a picker
   * rather than the free-text field the account form needs.
   *
   * Archived accounts count: their currency is still money the profile holds.
   *
   * The selection is RESOLVED rather than trusted, exactly as the form's
   * account is: what was picked while it still names a currency the profile
   * keeps, else the one the entry form is working in, else the first there is.
   */
  const budgetCurrencies = [...new Set(accountList.map((account) => account.currency))].sort();
  const activeBudgetCurrency = budgetCurrencies.includes(budgetCurrency)
    ? budgetCurrency
    : budgetCurrencies.includes(formCurrency)
      ? formCurrency
      : (budgetCurrencies[0] ?? "");

  /** One category's standing allowances, by currency — what its editor lists and what the report pairs spending with. */
  const budgetsOf = (categoryId: string): FinBudget[] =>
    budgets.filter((budget) => budget.categoryId === categoryId);

  /**
   * The category the rail's editor is open on, when it is open on an EXISTING
   * one — resolved rather than trusted, exactly as the form's account is. A
   * limit needs a category to belong to, so „Nova kategorija" has no budget
   * block until it has been saved.
   */
  const editingCategory =
    categoryEditing?.mode === "rename" ? categoryById.get(categoryEditing.id) : undefined;

  /**
   * The month, as sections. Every figure below is one `financeReport.ts`
   * computed from what the store returned — there is no projection anywhere on
   * this screen, and no budget that was not set by hand.
   */
  const report: FinReportSection[] =
    month === null
      ? []
      : buildFinMonthReport({
          spend: month.spend,
          income: month.income,
          budgets,
          categories,
        });
  const currentMonthKey = monthKeyOf(localTodayKey());

  const rows: FinTransactionFields[] = transactions ?? [];
  const periodInvalid = fromDraft !== "" && toDraft !== "" && fromDraft > toDraft;
  const filtersActive =
    selectedAccountId !== null ||
    categoryFilter !== CATEGORY_FILTER_ALL ||
    fromDraft !== "" ||
    toDraft !== "";

  /**
   * The two filters the engine's strict equality cannot express, applied here.
   *
   * The ACCOUNT one is why: a transfer names TWO accounts, and a ledger scoped
   * to „Štednja" that hid the transfer INTO it would be hiding money that
   * arrived. `FilterSpec` compares one field to one value, so this is a
   * predicate rather than a spec. The PERIOD one is a range, which the same
   * grammar cannot state either.
   */
  const scopedRows = rows.filter((row) => {
    if (
      selectedAccountId !== null &&
      row.accountId !== selectedAccountId &&
      row.counterAccountId !== selectedAccountId
    ) {
      return false;
    }
    if (fromDraft !== "" && isValidDayKey(fromDraft) && row.date < fromDraft) return false;
    if (toDraft !== "" && isValidDayKey(toDraft) && row.date > toDraft) return false;
    return true;
  });

  /** The one filter equality DOES express — „Bez kategorije" included, as `equals: null` rather than as a special case. */
  const filterSpecs: FilterSpec[] =
    categoryFilter === CATEGORY_FILTER_ALL
      ? []
      : [
          {
            field: "categoryId",
            equals: categoryFilter === CATEGORY_FILTER_NONE ? null : categoryFilter,
          },
        ];

  // No `sort`, deliberately: `applySort` returns its input untouched without
  // one, so the rows render in exactly the order `listFinTransactions` handed
  // over — newest day first, which is what a ledger is.
  const cardsConfig: CardsViewConfig = { type: "cards", filters: filterSpecs };
  /** What both shapes draw — the SAME engine call, so „Lista" and „Kartice" can never disagree about which rows exist. */
  const visibleRows = applyFilters(scopedRows, filterSpecs);

  /** The currency a row's amount is stated in — its account's own, always; there is no other it could be in. */
  const currencyOf = (row: FinTransactionFields): string =>
    accountById.get(row.accountId)?.currency ?? "";

  const accountNameOf = (id: string | null): string =>
    id === null ? "" : (accountById.get(id)?.name ?? "");

  /**
   * The unit hoisted out of the ledger's amount column, or null when the rows
   * on screen genuinely hold more than one currency. The column head carries it
   * in the first case; every cell carries its own in the second.
   */
  const ledgerUnit = soleValue(visibleRows.map(currencyOf));
  /** The same rule over the rail's balances: one currency across every account, or none hoisted. */
  const railUnit = soleValue(accountList.map((account) => account.currency));

  /**
   * Whether the row's own words still say something. The account chip and the
   * category chip were on every row unconditionally, and when the ledger is
   * filtered to one account that chip is the FILTER's name repeated sixty
   * times, not the row's data. Same for a single-account profile, where the one
   * account is a fact about the profile rather than about any row in it.
   */
  const showAccount = selectedAccountId === null && accountList.length > 1;
  const showCategory = categoryFilter === CATEGORY_FILTER_ALL;
  /** The same rule in the rail: „Rashod" over a list of nothing but rashod categories is a caption, not a datum. */
  const categoryKindsPresent = FIN_CATEGORY_KINDS.filter((kind) =>
    categories.some((category) => category.kind === kind),
  ).length;

  /**
   * What the row did to the account whose ledger this is. A transfer is ONE row
   * carrying the SOURCE account's delta, so in the destination account's ledger
   * that same number is the wrong way round — the money arrived there. Nothing
   * else on the page is scoped this way, and nothing needs to be: only a
   * transfer names two accounts.
   */
  function scopedAmount(row: FinTransactionFields): number {
    return selectedAccountId !== null && row.counterAccountId === selectedAccountId
      ? -row.amount
      : row.amount;
  }

  /** A row's own one-line title: what it was for, or — on a transfer, which has no payee to speak of — what it is. */
  const rowTitle = (row: FinTransactionFields): string =>
    row.payee ?? (entryKindOf(row) === "transfer" ? s.ledger.transfer : "—");

  /** The row's second level: where it landed and under which label, as text — sixty pills are sixty boxes drawn around words. */
  function rowMeta(row: FinTransactionFields): string {
    if (entryKindOf(row) === "transfer") {
      const arrow = s.ledger.transferArrow;
      return `${accountNameOf(row.accountId)} ${arrow} ${accountNameOf(row.counterAccountId)}`;
    }
    const parts: string[] = [];
    if (showAccount) parts.push(accountNameOf(row.accountId));
    if (showCategory) {
      parts.push(
        row.categoryId === null
          ? s.ledger.uncategorized
          : (categoryById.get(row.categoryId)?.name ?? s.ledger.uncategorized),
      );
    }
    return parts.join(" · ");
  }

  /** The class the amount cell wears — three states, and the sign in the text is what carries the fact. */
  function amountClass(row: FinTransactionFields): string {
    const kind = entryKindOf(row);
    if (kind === "transfer") return "nx-num fin__amount fin__amount--move";
    return kind === "income" ? "nx-num fin__amount fin__amount--in" : "nx-num fin__amount";
  }

  /** Two inline actions, which is the cap; they stay in the DOM at `opacity: 0` so the keyboard can still reach them. */
  function rowActions(row: FinTransactionFields): ReactNode {
    return (
      <span className="fin__row-actions">
        <Button
          size="sm"
          className="fin__row-action"
          aria-label={`${s.ledger.edit}: ${rowTitle(row)}`}
          title={s.ledger.edit}
          onClick={() => beginEdit(row)}
        >
          <Icon name="pencil" size={14} />
        </Button>
        <Button
          size="sm"
          className="fin__row-action fin__row-delete"
          aria-label={`${s.ledger.delete}: ${rowTitle(row)}`}
          title={s.ledger.delete}
          onClick={() => void deleteTransaction(row)}
        >
          <Icon name="trash" size={14} />
        </Button>
      </span>
    );
  }

  /**
   * The ledger, cut at every date change. The rows arrive newest-day-first from
   * the store and stay in that order, so one pass over them is the whole
   * grouping — no sort, no map of days, nothing that could reorder what the
   * store already ordered.
   *
   * A day's net is a MAP keyed by currency and never one number: a day may hold
   * rows from a dinar account and a euro one, and there is no rate with which
   * to add them. Transfers are absent from every net, because a transfer is
   * neither income nor expense — the rule the whole module is built on.
   */
  const dayGroups: FinDayGroup[] = [];
  for (const row of visibleRows) {
    let group = dayGroups[dayGroups.length - 1];
    if (group === undefined || group.date !== row.date) {
      group = { date: row.date, rows: [], nets: new Map<string, number>() };
      dayGroups.push(group);
    }
    group.rows.push(row);
    if (entryKindOf(row) === "transfer") continue;
    const currency = currencyOf(row);
    if (currency === "") continue;
    group.nets.set(currency, (group.nets.get(currency) ?? 0) + row.amount);
  }

  /**
   * The band: the page's hero, and the one place „Ukupno" is stated. ONE group
   * per currency, in code order — nothing here reduces the list, and the store
   * publishes no method that could.
   *
   * `balance` is the profile's own, read from `finCurrencyTotals`; a currency
   * that reaches the band only through the rows on screen (every account in it
   * archived, say) has none to state and says so rather than inventing a zero.
   * `income` and `outflow` cover exactly the rows currently VISIBLE, which is
   * what the caption under the band says out loud — and, like every other
   * aggregate here, they leave transfers out.
   */
  const bandByCurrency = new Map<string, FinBandGroup>();
  const bandGroupFor = (currency: string): FinBandGroup => {
    const existing = bandByCurrency.get(currency);
    if (existing !== undefined) return existing;
    const created: FinBandGroup = { currency, balance: null, income: 0, outflow: 0 };
    bandByCurrency.set(currency, created);
    return created;
  };
  for (const total of totals) bandGroupFor(total.currency).balance = total.minorUnits;
  if (page === "ledger") {
    for (const row of visibleRows) {
      if (entryKindOf(row) === "transfer") continue;
      const currency = currencyOf(row);
      if (currency === "") continue;
      const group = bandGroupFor(currency);
      if (row.amount > 0) group.income += row.amount;
      else group.outflow -= row.amount;
    }
  }
  // ISO-4217 codes are ASCII, so a plain code-point comparison IS alphabetical
  // here — no collator, and none of the sr-Latn tailoring a Serbian word needs.
  const bandGroups = [...bandByCurrency.values()].sort((a, b) =>
    a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0,
  );

  /**
   * The band, through the shared `StatBand`.
   *
   * It used to be `.fin__band` — a hand-written twin, here because this page
   * needs PER-CURRENCY groups and the shared component modelled a flat list.
   * The chrome had been matched by hand, which kept the app looking like one
   * product but left two objects to keep in step. `StatBand` understands groups
   * now (`StatGroup`), so this page supplies figures and nothing else.
   *
   * The two flow figures belong to the LEDGER: they are about the rows on
   * screen, and there are no rows on screen on the other two halves. `size:
   * "flow"` is what keeps them a tier under the balance they moved — the same
   * hierarchy the hand-written band drew, now stated once in the component.
   */
  function renderBand(): ReactNode {
    if (bandGroups.length === 0) {
      return <StatBand stats={[]} caption={s.totals.none} />;
    }
    return (
      <StatBand
        caption={page === "ledger" ? s.totals.captionLedger : s.totals.caption}
        groups={bandGroups.map((group) => ({
          label: group.currency,
          stats: [
            {
              label: s.totals.heading,
              value:
                group.balance === null
                  ? s.totals.noBalance
                  : formatMoneyPlain(group.balance, group.currency),
            },
            // Jade for money arriving, muted ink for money leaving. The
            // direction is already stated by the label over each figure, so
            // the hue is the second encoding and never the only one — and an
            // ordinary month of spending is not painted as a warning.
            ...(page === "ledger"
              ? ([
                  {
                    label: s.report.income,
                    value: formatMoneyPlain(group.income, group.currency),
                    tone: "data" as const,
                    size: "flow" as const,
                  },
                  {
                    label: s.report.expense,
                    value: formatMoneyPlain(group.outflow, group.currency),
                    size: "flow" as const,
                  },
                ] as const)
              : []),
          ],
        }))}
      />
    );
  }

  function renderLedgerRow(row: FinTransactionFields): ReactNode {
    return (
      <div key={row.id} className="fin__row">
        <span className="fin__title">{rowTitle(row)}</span>
        <span className="fin__meta">{rowMeta(row)}</span>
        <span className={amountClass(row)}>
          {signedMoney(scopedAmount(row), currencyOf(row), ledgerUnit)}
        </span>
        {rowActions(row)}
      </div>
    );
  }

  /** A card is a column, not a row: the title and its actions, then the day and the row's own second level. */
  function renderCard(row: FinTransactionFields): ReactNode {
    return (
      <>
        <div className="fin__card-head">
          <span className="fin__title">{rowTitle(row)}</span>
          {rowActions(row)}
        </div>
        <div className="fin__card-foot">
          <span className="fin__date">{formatLedgerDay(row.date)}</span>
          <span className={amountClass(row)}>
            {signedMoney(scopedAmount(row), currencyOf(row), ledgerUnit)}
          </span>
        </div>
        <span className="fin__meta">{rowMeta(row)}</span>
      </>
    );
  }

  /**
   * The budget block inside the category editor — the one place a limit is set,
   * because a limit IS a category's monthly amount and belongs where the user
   * already manages categories.
   *
   * An INCOME category gets no controls at all, only the sentence saying why:
   * a budget is a limit, and a target on income would compare the opposite way.
   * That refusal is the store's, restated here so the field never asks for
   * something that can only be rejected.
   */
  function renderBudgetEditor(category: FinCategory): ReactNode {
    const own = budgetsOf(category.id);
    return (
      <div className="fin__budget">
        <div className="fin__budget-heading">{s.budgets.heading}</div>
        {category.kind === "income" ? (
          <p className="fin__field-hint">{s.budgets.incomeOnly}</p>
        ) : (
          <>
            {own.length === 0 ? (
              <p className="fin__field-hint">{s.budgets.none}</p>
            ) : (
              <div className="fin__budget-rows">
                {own.map((budget) => (
                  <div key={budget.id} className="fin__budget-row">
                    <span className="fin__budget-amount">
                      {formatMoney(budget.amount, budget.currency)}
                    </span>
                    <Button
                      size="sm"
                      className="fin__rail-action fin__row-delete"
                      title={s.budgets.clearHint}
                      aria-label={`${s.budgets.clearHint} ${budget.currency}`}
                      onClick={() =>
                        void runRailAction(
                          () =>
                            window.nexus.clearFinBudget(
                              profileId,
                              budget.categoryId,
                              budget.currency,
                            ),
                          false,
                        )
                      }
                    >
                      <Icon name="trash" size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {budgetCurrencies.length === 0 ? (
              <p className="fin__field-hint">{s.budgets.needsAccount}</p>
            ) : (
              <>
                <div className="fin__budget-controls">
                  <Select
                    label={s.budgets.currencyLabel}
                    value={activeBudgetCurrency}
                    onChange={(event) => setBudgetCurrency(event.target.value)}
                  >
                    {budgetCurrencies.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </Select>
                  <TextField
                    className="fin__budget-input"
                    label={s.budgets.amountLabel}
                    value={budgetAmount}
                    inputMode="decimal"
                    placeholder={s.form.amountPlaceholder}
                    onChange={(event) => setBudgetAmount(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      // The block sits outside the rename form, so Enter has no
                      // submit of its own to reach — this is it.
                      event.preventDefault();
                      submitBudget(category.id, activeBudgetCurrency);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => submitBudget(category.id, activeBudgetCurrency)}
                  >
                    {s.budgets.set}
                  </Button>
                </div>
                <span className="fin__field-hint">{s.budgets.hint}</span>
              </>
            )}
          </>
        )}
      </div>
    );
  }

  /** One category line of the month report: its name, one bar on the section's shared scale, and the two figures. */
  function renderReportLine(line: FinReportLine, currency: string): ReactNode {
    const name = line.name ?? s.ledger.uncategorized;
    const spent = formatMoneyPlain(line.spent, currency);
    // The spoken version keeps the currency code: a screen reader has no
    // section heading in view to carry it, and the code is what says which
    // money this is.
    const label =
      line.budget === null
        ? `${name}: ${formatMoney(line.spent, currency)}, ${s.report.noBudget}`
        : `${name}: ${formatMoney(line.spent, currency)} / ` +
          `${formatMoney(line.budget, currency)}${line.over ? `, ${s.report.over}` : ""}`;

    // `describedAs` makes the whole row one `role="img"` carrying this
    // sentence. Necessary because „over budget" is drawn as a colour and a
    // font weight, and neither reaches a screen reader — without it the row
    // reads out its numbers and omits the one thing it exists to say.
    return (
      <ProportionBar
        key={line.categoryId ?? ""}
        describedAs={label}
        label={
          <span className={line.name === null ? "fin__bar-label--muted" : undefined}>{name}</span>
        }
        value={
          <>
            <span className={line.over ? "fin__bar-spent--over" : undefined}>{spent}</span>
            {line.budget === null ? (
              // The honesty rule, on the row itself: no limit means no number.
              <span className="fin__bar-nobudget">{s.report.noBudget}</span>
            ) : (
              <span className="fin__bar-budget">
                {`/ ${formatMoneyPlain(line.budget, currency)}`}
              </span>
            )}
          </>
        }
        segments={[
          { key: "spent", fraction: line.spentRatio, tone: line.over ? "danger" : "data", label },
        ]}
        {...(line.budgetRatio === null ? {} : { target: { fraction: line.budgetRatio, label } })}
      />
    );
  }

  /**
   * One currency's whole month. Two of them are two sections, never one sum:
   * every figure drawn here is read out of a section that names its currency,
   * and nothing on this page adds two of those together. The head is the band's
   * own figure recipe — one fact, one shape, wherever the page states it.
   */
  function renderReportSection(section: FinReportSection): ReactNode {
    const hasAnyBudget = section.lines.some((line) => line.budget !== null);
    return (
      <section key={section.currency} className="fin__report-section" aria-label={section.currency}>
        <StatBand
          className="fin__report-head"
          groups={[
            {
              label: section.currency,
              stats: [
                {
                  label: s.report.income,
                  value: formatMoneyPlain(section.income, section.currency),
                  tone: "data",
                  size: "flow",
                },
                {
                  label: s.report.expense,
                  value: formatMoneyPlain(section.expense, section.currency),
                  size: "flow",
                },
              ],
            },
          ]}
        />
        <FinBalanceFlow
          currency={section.currency}
          monthKey={monthKey}
          accounts={accountList}
          transactions={rows}
        />
        {section.lines.length === 0 ? (
          <p className="fin__report-note">{s.report.noSpending}</p>
        ) : (
          <>
            {hasAnyBudget && <p className="fin__report-note">{s.report.barsCaption}</p>}
            <div className="fin__bars">
              {section.lines.map((line) => renderReportLine(line, section.currency))}
            </div>
            {/* Said only when a line actually went negative, so a minus in the
                column reads as a refund rather than as a bug. */}
            {section.hasRefundLine && <p className="fin__report-note">{s.report.refundNote}</p>}
          </>
        )}
      </section>
    );
  }

  /**
   * One subscription row: what it is, where it charges from, when the next
   * charge falls, and how much. The next charge comes from the row's own CURSOR
   * — the first occurrence not yet written — so the line says what will happen
   * rather than what has; a spent series says so in words.
   *
   * A PAUSED one (ADR-074) stays in this one alphabetical list rather than being
   * moved to a section of its own: it is still the user's subscription, and
   * splitting the list would make „koje pretplate imam" two questions. It reads
   * muted, wears „Pauzirano", and the date column says „Bez naplate" — because
   * while it is paused its cursor names a day that will not happen, and printing
   * that day would be the one thing this row must never do.
   *
   * Two inline actions and no more: pause/resume and edit are what this list is
   * used for, and the delete — the one act that cannot be undone by clicking
   * the same button again — sits behind the row's own „⋯".
   */
  function renderSubscriptionRow(subscription: FinRecurring): ReactNode {
    const account = accountById.get(subscription.accountId);
    const currency = account?.currency ?? "";
    const category =
      subscription.categoryId === null ? null : categoryById.get(subscription.categoryId);
    const paused = subscription.pausedAt !== null;
    const meta = [account?.name ?? "", category?.name ?? ""].filter((part) => part !== "");
    return (
      <ListRow
        key={subscription.id}
        muted={paused}
        className={paused ? "fin__subs-row--paused" : undefined}
        leading={
          <span className="fin__date">
            {paused
              ? s.subscriptions.pausedNext
              : (subscription.nextRun ?? s.subscriptions.finished)}
          </span>
        }
        trailing={
          <span className="fin__row-actions">
            <Button
              size="sm"
              className="fin__row-action"
              aria-label={`${paused ? s.subscriptions.resume : s.subscriptions.pause}: ${subscription.name}`}
              title={paused ? s.subscriptions.resume : s.subscriptions.pause}
              onClick={() => void togglePause(subscription)}
            >
              <Icon name={paused ? "play" : "pause"} size={14} />
            </Button>
            <Button
              size="sm"
              className="fin__row-action"
              aria-label={`${s.subscriptions.edit}: ${subscription.name}`}
              title={s.subscriptions.edit}
              onClick={() => beginEditSubscription(subscription)}
            >
              <Icon name="pencil" size={14} />
            </Button>
            <NotePopover
              label={`${s.subscriptions.menuLabel}: ${subscription.name}`}
              triggerClassName="fin__row-action"
            >
              {(close) => (
                <button
                  type="button"
                  role="menuitem"
                  className="note__menu-item note__menu-item--danger"
                  onClick={() => {
                    close();
                    void deleteSubscription(subscription);
                  }}
                >
                  {s.subscriptions.delete}
                </button>
              )}
            </NotePopover>
          </span>
        }
      >
        <span className="fin__sub-body">
          <span className="fin__title">{subscription.name}</span>
          <span className="fin__sub-meta">
            <span className="fin__meta">{meta.join(" · ")}</span>
            {paused && (
              <Chip className="fin__paused-chip" title={s.subscriptions.pausedChipTitle}>
                {s.subscriptions.pausedChip}
              </Chip>
            )}
            {subscription.reminderDays !== null && (
              <Chip variant="data" title={s.subscriptions.reminderChip}>
                {reminderLabel(subscription.reminderDays)}
              </Chip>
            )}
          </span>
          <span
            className={
              subscription.amount > 0 ? "nx-num fin__amount fin__amount--in" : "nx-num fin__amount"
            }
          >
            {/* Always coded: this list is not scoped to one account, so two
                subscriptions side by side can genuinely be two currencies. */}
            {signedMoney(subscription.amount, currency, null)}
          </span>
        </span>
      </ListRow>
    );
  }

  /**
   * One account row in the rail: its name, its own DERIVED balance, what kind
   * of account it is — and one „⋯" holding everything that can be DONE to it.
   *
   * The menu is the reason the names fit. The row used to keep three hover-only
   * buttons in flow, which took about 80px of a 248px rail permanently, so the
   * name was squeezed into roughly 116px and „Devizna štednja" truncated at
   * twelve characters with half the rail standing empty beside it. One 24px
   * control gives that width back, and the name now has the whole row: about
   * 187px, which is twenty-two characters at this size.
   *
   * The kind and the balance share the line under it, as `.fin__rail-meta` —
   * a GRID, which is where the escaping balance was fixed. See that rule.
   */
  function renderAccountRow(account: FinAccount): ReactNode {
    const balance = balanceById.get(account.id);
    const minorUnits = balance === undefined ? account.openingBalance : balance.minorUnits;
    const currency = balance === undefined ? account.currency : balance.currency;
    const active = selectedAccountId === account.id;
    return (
      <div key={account.id} className="fin__rail-row">
        <button
          type="button"
          className={active ? "fin__rail-item fin__rail-item--active" : "fin__rail-item"}
          aria-current={active ? "true" : undefined}
          onClick={() => setSelectedAccountId(active ? null : account.id)}
        >
          <span className="fin__rail-name">{account.name}</span>
          <span className="fin__rail-meta">
            <span className="fin__rail-kind">
              {account.archived ? s.accounts.archivedChip : s.accounts.kinds[account.kind]}
            </span>
            <span className="fin__rail-balance nx-num">
              {railUnit === null
                ? formatMoney(minorUnits, currency)
                : formatMoneyPlain(minorUnits, currency)}
            </span>
          </span>
        </button>
        <NotePopover
          label={`${s.accounts.menuLabel}: ${account.name}`}
          triggerClassName="fin__rail-menu"
        >
          {(close) => (
            <>
              <button
                type="button"
                role="menuitem"
                className="note__menu-item"
                onClick={() => {
                  close();
                  beginEditAccount(account);
                }}
              >
                {s.accounts.edit}
              </button>
              <button
                type="button"
                role="menuitem"
                className="note__menu-item"
                onClick={() => {
                  close();
                  void runRailAction(async () => {
                    await window.nexus.updateFinAccount(profileId, account.id, {
                      archived: !account.archived,
                    });
                  });
                }}
              >
                {account.archived ? s.accounts.unarchive : s.accounts.archive}
              </button>
              <div className="note__menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="note__menu-item note__menu-item--danger"
                onClick={() => {
                  close();
                  void runRailAction(async () => {
                    await window.nexus.deleteFinAccount(profileId, account.id);
                    if (selectedAccountId === account.id) setSelectedAccountId(null);
                    setPendingUndo({ kind: "account", id: account.id });
                  });
                }}
              >
                {s.accounts.delete}
              </button>
            </>
          )}
        </NotePopover>
      </div>
    );
  }

  /**
   * The categories of ONE kind, listed under that kind's own heading. They used
   * to be a wrap of pills, each cramming „Kafa i izlasci · Rashod · limit" into
   * a single 11px line inside a 14.8px-tall button beside an 18px „×" — three
   * facts with no separation and two targets under the 24px floor. Grouping by
   * kind deletes the middle fact from every row at once (it is the heading
   * now), the limit becomes a chip of its own, and both targets clear the
   * floor by construction.
   */
  function renderCategoryGroup(kind: FinCategoryKind, showHeading: boolean): ReactNode {
    const own = categories.filter((category) => category.kind === kind);
    if (own.length === 0) return null;
    return (
      <Fragment key={kind}>
        {/* Only when there are actually two kinds to tell apart. A profile with
            nothing but rashod categories has „Rashod" as a fact about itself,
            not about any row — the same rule that hoists the currency. */}
        {showHeading && (
          <div className="fin__rail-heading fin__rail-heading--stacked">
            {s.categories.kinds[kind]}
          </div>
        )}
        <div className="fin__cat-rows">
          {own.map((category) => (
            <div key={category.id} className="fin__cat-row">
              <button
                type="button"
                className="fin__cat-name"
                aria-label={`${s.categories.edit}: ${category.name}`}
                title={s.categories.editHint}
                onClick={() => beginEditCategory(category)}
              >
                {category.name}
              </button>
              {/* A category that carries a limit says so where it is managed —
                  one word, never an amount, because one category can hold one
                  limit per currency. */}
              {budgetsOf(category.id).length > 0 ? (
                <Chip variant="accent" className="fin__cat-limit">
                  {s.budgets.marker}
                </Chip>
              ) : (
                <span />
              )}
              <Button
                size="sm"
                className="fin__rail-action fin__row-delete fin__cat-delete"
                aria-label={`${s.categories.delete}: ${category.name}`}
                title={s.categories.deleteHint}
                // Asks first: this is a HARD delete with no restore endpoint,
                // and NOTE's identical category rail has always asked for the
                // name back before running one.
                onClick={() => setPendingDeleteCategory(category)}
              >
                <Icon name="trash" size={14} />
              </Button>
            </div>
          ))}
        </div>
      </Fragment>
    );
  }

  // --- The screen -------------------------------------------------------------

  if (failed) {
    return <EmptyState sigil="finance" title={s.loadErrorTitle} description={s.loadError} />;
  }
  if (accounts === null || transactions === null) {
    return <LoadingState label={strings.app.loading} rows={6} />;
  }

  /** The picker offers exactly the kind this entry can carry; a transfer gets no picker at all. */
  const categoryOptions = categories.filter((category) =>
    entryKind === "income" ? category.kind === "income" : category.kind === "expense",
  );
  /**
   * An ARCHIVED account is not offered for a new entry — archiving is how the
   * user says an account is closed — but it stays in the picker while a row
   * that already names it is being edited, or the select would silently show a
   * different account than the row belongs to.
   */
  const accountOptions = accountList.filter(
    (account) => !account.archived || account.id === formAccountId,
  );
  const transferTargets = accountList.filter(
    (account) => account.id !== formAccountId && (!account.archived || account.id === counterDraft),
  );
  /**
   * The table's own column heads. Every one of them is a word the page already
   * owns — the entry form's field labels, which is what those columns hold —
   * and the amount's carries the hoisted unit whenever the rows below it share
   * one. The second column names exactly the facts it is currently showing, so
   * a head can never promise a word the rows have dropped.
   */
  const amountColumnLabel =
    ledgerUnit === null ? s.form.amountLabel : `${s.form.amountLabel} · ${ledgerUnit}`;
  /**
   * …and whether that second column has anything to hold at all. Both hoists
   * can fire at once — a ledger filtered to one account AND one category — but
   * a TRANSFER names two accounts whatever the filters took away, so one
   * visible transfer keeps the column open. Without that check the track
   * collapses to zero underneath a row that still has „Tekući → Štednja" in it.
   */
  const showMetaColumn =
    showAccount || showCategory || visibleRows.some((row) => row.counterAccountId !== null);
  const metaColumnLabel = !showMetaColumn
    ? ""
    : showAccount && showCategory
      ? `${s.form.accountLabel} · ${s.form.categoryLabel}`
      : showCategory
        ? s.form.categoryLabel
        : s.form.accountLabel;

  return (
    <div className="fin">
      {/* The page's three halves, in the header's own actions slot. They used to
          be the first of five stacked switcher rows above the data; a half is a
          property of the PAGE, so it belongs beside the page's name. */}
      <PageHeader
        title={moduleName("finance")}
        sigil="finance"
        actions={
          <div className="fin__segmented" role="group" aria-label={s.pages.label}>
            {FIN_PAGES.map((option) => (
              <Button
                key={option}
                size="sm"
                className="nx-segmented__option"
                aria-pressed={page === option}
                onClick={() => setPage(option)}
              >
                {option === "ledger"
                  ? s.pages.ledger
                  : option === "report"
                    ? s.pages.report
                    : s.pages.subscriptions}
              </Button>
            ))}
          </div>
        }
      />

      <div className="fin__body">
        <aside className="fin__rail" aria-label={s.accounts.heading}>
          <div className="fin__rail-heading">
            <span>{s.accounts.heading}</span>
            {/* The unit, hoisted out of the balances beneath it on exactly the
                ledger's rule — present only while every account shares one. */}
            {railUnit !== null && <span className="fin__rail-heading-unit">{railUnit}</span>}
          </div>
          <div className="fin__rail-rows" role="group" aria-label={s.accounts.heading}>
            <div className="fin__rail-row">
              <button
                type="button"
                className={
                  selectedAccountId === null
                    ? "fin__rail-item fin__rail-item--active"
                    : "fin__rail-item"
                }
                aria-current={selectedAccountId === null ? "true" : undefined}
                onClick={() => setSelectedAccountId(null)}
              >
                <span className="fin__rail-name">{s.accounts.all}</span>
              </button>
            </div>
            {liveAccounts.map((account) => renderAccountRow(account))}
          </div>

          {archivedAccounts.length > 0 && (
            <>
              {/* Visible, and clearly secondary: a closed account still has a
                  balance, and a page that hid it would be hiding money. It is
                  out of „Ukupno" all the same — that total is what you can
                  spend. */}
              <div className="fin__rail-heading fin__rail-heading--stacked">
                {s.accounts.archivedHeading}
              </div>
              <div className="fin__rail-rows fin__rail-rows--muted">
                {archivedAccounts.map((account) => renderAccountRow(account))}
              </div>
            </>
          )}

          {accountEditing !== null ? (
            <form className="fin__rail-form" onSubmit={submitAccount}>
              <TextField
                label={s.accounts.nameLabel}
                value={accountName}
                placeholder={s.accounts.namePlaceholder}
                maxLength={MAX_FIN_ACCOUNT_NAME_LENGTH}
                onChange={(event) => setAccountName(event.target.value)}
              />
              <Select
                label={s.accounts.kindLabel}
                value={accountKind}
                onChange={(event) => setAccountKind(asAccountKind(event.target.value))}
              >
                {FIN_ACCOUNT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {s.accounts.kinds[kind]}
                  </option>
                ))}
              </Select>
              <TextField
                label={s.accounts.currencyLabel}
                value={accountCurrency}
                maxLength={3}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setAccountCurrency(event.target.value)}
              />
              <span className="fin__field-hint">{s.accounts.currencyHint}</span>
              <TextField
                label={s.accounts.openingLabel}
                value={accountOpening}
                inputMode="decimal"
                placeholder={s.form.amountPlaceholder}
                onChange={(event) => setAccountOpening(event.target.value)}
              />
              <span className="fin__field-hint">{s.accounts.openingHint}</span>
              <div className="fin__rail-form-actions">
                <Button type="submit" size="sm" variant="primary">
                  {s.accounts.save}
                </Button>
                <Button type="button" size="sm" variant="quiet" onClick={closeAccountEditor}>
                  {s.accounts.cancel}
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" className="fin__rail-add" onClick={beginNewAccount}>
              <Icon name="plus" size={14} />
              {s.accounts.newAccount}
            </Button>
          )}

          <div className="fin__rail-heading fin__rail-heading--stacked">
            {s.categories.heading}
          </div>
          {categories.length === 0 ? (
            <p className="fin__rail-note">{s.categories.empty}</p>
          ) : (
            FIN_CATEGORY_KINDS.map((kind) => renderCategoryGroup(kind, categoryKindsPresent > 1))
          )}
          {categoryEditing !== null ? (
            <div className="fin__rail-form">
              <form className="fin__category-form" onSubmit={submitCategory}>
                <TextField
                  label={s.categories.heading}
                  value={categoryName}
                  placeholder={s.categories.namePlaceholder}
                  maxLength={MAX_FIN_CATEGORY_NAME_LENGTH}
                  onChange={(event) => setCategoryName(event.target.value)}
                />
                {/* The kind is fixed once a category exists: flipping „Plata"
                    from prihod to rashod would silently re-classify every
                    transaction ever filed under it, which is exactly why the
                    store has no method that could. */}
                {categoryEditing.mode === "new" && (
                  <div className="fin__segmented" role="group" aria-label={s.accounts.kindLabel}>
                    {FIN_CATEGORY_KINDS.map((kind) => (
                      <Button
                        key={kind}
                        type="button"
                        size="sm"
                        variant={categoryKind === kind ? "primary" : "ghost"}
                        aria-pressed={categoryKind === kind}
                        onClick={() => setCategoryKind(kind)}
                      >
                        {s.categories.kinds[kind]}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="fin__rail-form-actions">
                  <Button type="submit" size="sm" variant="primary">
                    {s.accounts.save}
                  </Button>
                  <Button type="button" size="sm" variant="quiet" onClick={closeCategoryEditor}>
                    {s.accounts.cancel}
                  </Button>
                </div>
              </form>
              {/* Beside the rename rather than inside it: a limit is its own act
                  with its own submit, and a form cannot hold another form. */}
              {editingCategory !== undefined && renderBudgetEditor(editingCategory)}
            </div>
          ) : (
            <Button size="sm" className="fin__rail-add" onClick={beginNewCategory}>
              <Icon name="plus" size={14} />
              {s.categories.newCategory}
            </Button>
          )}

          {railError !== null && (
            <p className="fin__rail-error" role="status">
              {railError}
            </p>
          )}
        </aside>

        <div className="fin__main">
          {/* Summary before detail: the figures open the page, and everything
              under them is the detail behind those figures. */}
          {renderBand()}

          {/* Above all three halves: an account can be deleted from the rail,
              which is on screen whichever half is. */}
          {pendingUndo !== null && (
            <div className="fin__undo" role="status">
              <span className="fin__undo-text">
                {pendingUndo.kind === "transaction"
                  ? s.ledger.deletedNotice
                  : pendingUndo.kind === "subscription"
                    ? s.subscriptions.deletedNotice
                    : s.accounts.deletedNotice}
              </span>
              <Button size="sm" onClick={() => void undoDelete()}>
                {s.undo}
              </Button>
              <Button
                size="sm"
                variant="quiet"
                aria-label={s.dismiss}
                title={s.dismiss}
                onClick={() => setPendingUndo(null)}
              >
                <Icon name="close" size={14} />
              </Button>
            </div>
          )}

          {page === "subscriptions" ? (
            <div className="fin__subs">
              {/* Said out loud, above everything: nothing here is in the balance
                  until its day arrives. A screen that showed „predstojeće"
                  beside a total would otherwise invite the reading that it
                  already is. */}
              <p className="fin__caption">{s.subscriptions.caption}</p>

              {accountList.length === 0 ? (
                <EmptyState
                  sigil="finance"
                  title={s.subscriptions.needsAccountTitle}
                  description={s.subscriptions.needsAccountDescription}
                  action={
                    <Button variant="primary" onClick={beginNewAccount}>
                      {s.accounts.newAccount}
                    </Button>
                  }
                />
              ) : (
                <>
                  {subFormOpen ? (
                    <form
                      className="fin__panel fin__form"
                      onSubmit={(event) => void submitSubscription(event)}
                    >
                      <div
                        className="fin__segmented"
                        role="group"
                        aria-label={s.subscriptions.directionLabel}
                      >
                        {(["out", "in"] as const).map((option) => (
                          <Button
                            key={option}
                            type="button"
                            size="sm"
                            variant={subDirection === option ? "primary" : "ghost"}
                            aria-pressed={subDirection === option}
                            onClick={() => setSubDirection(option)}
                          >
                            {option === "out"
                              ? s.subscriptions.directionOut
                              : s.subscriptions.directionIn}
                          </Button>
                        ))}
                      </div>

                      <div className="fin__quick-add">
                        <TextField
                          className="fin__payee-input"
                          label={s.subscriptions.nameLabel}
                          value={subName}
                          placeholder={s.subscriptions.namePlaceholder}
                          maxLength={MAX_FIN_RECURRING_NAME_LENGTH}
                          onChange={(event) => setSubName(event.target.value)}
                        />
                        {/* The unit lives in the field's own label — the one
                            place it is needed, and never beside the figure. */}
                        <TextField
                          className="fin__amount-input"
                          label={`${s.subscriptions.amountLabel} · ${subCurrency}`}
                          value={subAmount}
                          inputMode="decimal"
                          placeholder={s.form.amountPlaceholder}
                          onChange={(event) => setSubAmount(event.target.value)}
                        />
                      </div>

                      <div className="fin__fields">
                        <Select
                          label={s.subscriptions.accountLabel}
                          value={subAccountId}
                          onChange={(event) => setSubAccount(event.target.value)}
                        >
                          {accountList
                            .filter((account) => !account.archived || account.id === subAccountId)
                            .map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                        </Select>
                        {/* The picker offers the kind this direction can carry —
                            the ledger form's own rule, applied to a template. */}
                        <Select
                          label={s.subscriptions.categoryLabel}
                          value={subCategory}
                          onChange={(event) => setSubCategory(event.target.value)}
                        >
                          <option value="">{s.form.categoryNone}</option>
                          {categories
                            .filter((category) =>
                              subDirection === "in"
                                ? category.kind === "income"
                                : category.kind === "expense",
                            )
                            .map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                        </Select>
                        <TextField
                          type="date"
                          label={s.subscriptions.startLabel}
                          value={subStart}
                          onChange={(event) => setSubStart(event.target.value)}
                        />
                        <Select
                          label={s.subscriptions.reminderLabel}
                          value={subReminder === null ? "" : String(subReminder)}
                          onChange={(event) =>
                            setSubReminder(
                              event.target.value === "" ? null : Number(event.target.value),
                            )
                          }
                        >
                          <option value="">{s.subscriptions.reminderNone}</option>
                          {REMINDER_DAY_OPTIONS.map((days) => (
                            <option key={days} value={String(days)}>
                              {reminderLabel(days)}
                            </option>
                          ))}
                        </Select>
                        <TextField
                          className="fin__note-input"
                          label={s.subscriptions.noteLabel}
                          value={subNote}
                          maxLength={MAX_FIN_NOTE_LENGTH}
                          onChange={(event) => setSubNote(event.target.value)}
                        />
                      </div>

                      {/* ADR-024's own field, the very component the task and
                          event forms mount: there is one schedule language in
                          this app, and „svakog 5. u mesecu" means the same thing
                          in all three. */}
                      <RecurrencePicker
                        key={subEditingId ?? "new"}
                        value={subRule}
                        anchor={subStart}
                        onChange={setSubRule}
                      />

                      <div className="fin__form-actions">
                        <Button type="submit" variant="primary">
                          {s.subscriptions.save}
                        </Button>
                        <Button type="button" variant="quiet" onClick={closeSubForm}>
                          {s.subscriptions.cancel}
                        </Button>
                      </div>

                      {subError !== null && (
                        <p className="fin__error" role="alert">
                          {subError}
                        </p>
                      )}
                    </form>
                  ) : (
                    <Button variant="primary" onClick={beginNewSubscription}>
                      <Icon name="plus" size={15} />
                      {s.subscriptions.newSubscription}
                    </Button>
                  )}

                  {subscriptions.length === 0 ? (
                    <EmptyState
                      sigil="finance"
                      title={s.subscriptions.emptyTitle}
                      description={s.subscriptions.emptyDescription}
                    />
                  ) : (
                    <div className="fin__subs-list">
                      {subscriptions.map((subscription) => renderSubscriptionRow(subscription))}
                    </div>
                  )}

                  {/* What the RULES say is coming. Not a forecast and not a
                      balance — a reading of the schedule, which is the only
                      thing that can honestly be said about a charge that has
                      not happened yet. */}
                  <div className="fin__rail-heading fin__rail-heading--stacked">
                    {s.subscriptions.upcomingHeading}
                  </div>
                  {renewals.length === 0 ? (
                    <p className="fin__rail-note">{s.subscriptions.upcomingEmpty}</p>
                  ) : (
                    <div className="fin__subs-upcoming">
                      {renewals.map((renewal) => (
                        <div
                          key={`${renewal.recurringId}@${renewal.date}`}
                          className="fin__subs-upcoming-row"
                        >
                          <span className="fin__date">{renewal.date}</span>
                          <span className="fin__title">{renewal.name}</span>
                          <span className="nx-num fin__amount">
                            {signedMoney(renewal.amount, renewal.currency, null)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : page === "report" ? (
            <div className="fin__report">
              <div className="fin__report-nav">
                <Button
                  size="sm"
                  className="fin__row-action"
                  aria-label={s.report.previousMonth}
                  title={s.report.previousMonth}
                  onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}
                >
                  <Icon name="chevronLeft" size={14} />
                </Button>
                <span className="fin__report-month">{formatFinMonthLabel(monthKey)}</span>
                <Button
                  size="sm"
                  className="fin__row-action"
                  aria-label={s.report.nextMonth}
                  title={s.report.nextMonth}
                  onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}
                >
                  <Icon name="chevronRight" size={14} />
                </Button>
                {monthKey !== currentMonthKey && (
                  <Button size="sm" variant="quiet" onClick={() => setMonthKey(currentMonthKey)}>
                    {s.report.thisMonth}
                  </Button>
                )}
              </div>
              {/* The whole report's one caption: what it covers, and what it
                  will never do. Said out loud so nobody waits for a
                  prediction. */}
              <p className="fin__caption">{s.report.caption}</p>

              {monthFailed ? (
                <EmptyState
                  sigil="finance"
                  title={s.report.loadErrorTitle}
                  description={s.report.loadError}
                />
              ) : month === null ? (
                <LoadingState label={strings.app.loading} rows={6} />
              ) : accountList.length === 0 ? (
                // No accounts is a different fact from an empty month, and it
                // has a different answer: the same invitation the ledger offers.
                <EmptyState
                  sigil="finance"
                  title={s.accounts.emptyTitle}
                  description={s.accounts.emptyDescription}
                  action={
                    <Button variant="primary" onClick={beginNewAccount}>
                      {s.accounts.newAccount}
                    </Button>
                  }
                />
              ) : report.length === 0 ? (
                // Nothing happened, said plainly — and the transfer rule
                // restated, because „prazan mesec" would otherwise look wrong to
                // somebody who moved money between their own accounts all month.
                <EmptyState
                  sigil="finance"
                  title={s.report.emptyTitle}
                  description={s.report.emptyDescription}
                />
              ) : (
                report.map((section) => renderReportSection(section))
              )}
            </div>
          ) : (
            <>
              {/* ONE row of chrome, where there used to be five. What to do on
                  the left; what to leave out on the right. */}
              <div className="fin__toolbar">
                <Button
                  variant="primary"
                  disabled={liveAccounts.length === 0}
                  aria-expanded={formOpen}
                  onClick={() => {
                    // Three states, not two: closed opens a fresh draft, open-on
                    // -a-draft closes, and open-on-an-EDIT starts a new draft
                    // rather than closing — this button says „Nova transakcija",
                    // and a control that silently discarded an edit instead
                    // would be doing something it never claimed to.
                    if (formOpen && editingId === null) {
                      closeForm();
                      return;
                    }
                    resetForm();
                    setFormOpen(true);
                    setFocusTick((tick) => tick + 1);
                  }}
                >
                  <Icon name="plus" size={15} />
                  {s.ledger.newTransaction}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-expanded={importOpen}
                  onClick={() => setImportOpen((open) => !open)}
                >
                  {importOpen ? s.importDisclosure.hide : s.importDisclosure.show}
                </Button>

                <div className="fin__toolbar-filters">
                  <span className="fin__count">
                    {`${visibleRows.length} ${countUnit(
                      visibleRows.length,
                      s.ledger.itemsOne,
                      s.ledger.itemsFew,
                      s.ledger.itemsMany,
                    )}`}
                  </span>
                  <Select
                    layout="inline"
                    label={s.filters.categoryLabel}
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                  >
                    <option value={CATEGORY_FILTER_ALL}>{s.filters.categoryAll}</option>
                    <option value={CATEGORY_FILTER_NONE}>{s.filters.categoryNone}</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </Select>
                  {/* „Od – Do" as one control: the pair reads as a range because
                      it is drawn as one, and each half keeps its own name. */}
                  <span className="fin__period" role="group" aria-label={s.filters.periodLabel}>
                    <span className="fin__period-label">{s.filters.periodLabel}</span>
                    <TextField
                      type="date"
                      aria-label={s.filters.fromLabel}
                      className="fin__period-input"
                      value={fromDraft}
                      onChange={(event) => setFromDraft(event.target.value)}
                    />
                    <span className="fin__period-sep" aria-hidden="true">
                      –
                    </span>
                    <TextField
                      type="date"
                      aria-label={s.filters.toLabel}
                      className="fin__period-input"
                      value={toDraft}
                      onChange={(event) => setToDraft(event.target.value)}
                    />
                  </span>
                  <div className="fin__segmented" role="group" aria-label={s.views.label}>
                    {LEDGER_VIEWS.map((option) => (
                      <Button
                        key={option}
                        size="sm"
                        className="nx-segmented__option"
                        aria-pressed={view === option}
                        onClick={() => setView(option)}
                      >
                        {option === "list" ? s.views.list : s.views.cards}
                      </Button>
                    ))}
                  </div>
                  {filtersActive && (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => {
                        setSelectedAccountId(null);
                        setCategoryFilter(CATEGORY_FILTER_ALL);
                        setFromDraft("");
                        setToDraft("");
                      }}
                    >
                      {s.filters.clear}
                    </Button>
                  )}
                </div>
              </div>

              {periodInvalid && (
                <p className="fin__error" role="status">
                  {s.filters.invalidPeriod}
                </p>
              )}

              {/* The entry form, on request. It is the same form for create and
                  edit, and it stays open after a row is filed — filing one
                  usually means filing the next — with the caret back in the
                  amount field. */}
              {formOpen && (
                <form className="fin__panel fin__form" onSubmit={(event) => void submitForm(event)}>
                  <div className="fin__segmented" role="group" aria-label={s.form.kindLabel}>
                    {ENTRY_KINDS.map((kind) => (
                      <Button
                        key={kind}
                        type="button"
                        size="sm"
                        variant={entryKind === kind ? "primary" : "ghost"}
                        aria-pressed={entryKind === kind}
                        onClick={() => {
                          setEntryKind(kind);
                          // A transfer carries no category and an ordinary row
                          // no counter account; leaving a stale one selected
                          // would let the form ask for something the store must
                          // refuse.
                          if (kind === "transfer") setCategoryDraft("");
                          else setCounterDraft("");
                        }}
                      >
                        {kind === "expense"
                          ? s.form.kindExpense
                          : kind === "income"
                            ? s.form.kindIncome
                            : s.form.kindTransfer}
                      </Button>
                    ))}
                  </div>

                  <div className="fin__quick-add">
                    {/* The caret has to be able to land here, both from the
                        palette's „Nova transakcija“ and after every filed row,
                        and that is the whole reason this field was hand-written:
                        `TextField` had no `ref` to forward. It forwards the
                        INPUT's now — the element the caret actually has to
                        reach — so the amount is the component like every field
                        around it, and the hand-written twin of the component's
                        own two rules (`.fin__field`) is gone with the `<label>`
                        that wrapped the control to name it.

                        Which money the amount is in — the account's own — is
                        said in the label rather than left to be assumed. */}
                    <TextField
                      ref={amountRef}
                      className="fin__amount-input"
                      label={`${s.form.amountLabel} · ${formCurrency}`}
                      value={amountDraft}
                      inputMode="decimal"
                      placeholder={s.form.amountPlaceholder}
                      onChange={(event) => setAmountDraft(event.target.value)}
                    />
                    <TextField
                      className="fin__payee-input"
                      label={s.form.payeeLabel}
                      value={payeeDraft}
                      placeholder={s.form.payeePlaceholder}
                      maxLength={MAX_FIN_PAYEE_LENGTH}
                      onChange={(event) => setPayeeDraft(event.target.value)}
                    />
                  </div>

                  <div className="fin__fields">
                    <TextField
                      type="date"
                      label={s.form.dateLabel}
                      value={dateDraft}
                      onChange={(event) => setDateDraft(event.target.value)}
                    />
                    <Select
                      label={
                        entryKind === "transfer" ? s.form.fromAccountLabel : s.form.accountLabel
                      }
                      value={formAccountId}
                      onChange={(event) => setAccountDraft(event.target.value)}
                    >
                      {accountOptions.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </Select>
                    {entryKind === "transfer" ? (
                      <Select
                        label={s.form.toAccountLabel}
                        value={counterDraft}
                        onChange={(event) => setCounterDraft(event.target.value)}
                      >
                        <option value="">{s.form.toAccountLabel}</option>
                        {transferTargets.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Select
                        label={s.form.categoryLabel}
                        value={categoryDraft}
                        onChange={(event) => setCategoryDraft(event.target.value)}
                      >
                        <option value="">{s.form.categoryNone}</option>
                        {categoryOptions.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </Select>
                    )}
                    <TextField
                      className="fin__note-input"
                      label={s.form.noteLabel}
                      value={noteDraft}
                      maxLength={MAX_FIN_NOTE_LENGTH}
                      onChange={(event) => setNoteDraft(event.target.value)}
                    />
                  </div>

                  <div className="fin__form-actions">
                    <Button type="submit" variant="primary" disabled={liveAccounts.length === 0}>
                      {editingId === null ? s.form.submitAdd : s.form.submitSave}
                    </Button>
                    <Button type="button" variant="quiet" onClick={closeForm}>
                      {s.form.cancel}
                    </Button>
                  </div>

                  {formError !== null && (
                    <p className="fin__error" role="alert">
                      {formError}
                    </p>
                  )}
                </form>
              )}

              {/* Uvoz izvoda (FIN slice e) — the SAME component Settings mounts,
                  so there is one flow and two ways to reach it. */}
              {importOpen && <FinCsvImportSection profileId={profileId} />}

              {accountList.length === 0 ? (
                // An honest invitation, never a fabricated starter row: nothing
                // in this app writes money the user did not.
                <EmptyState
                  sigil="finance"
                  title={s.accounts.emptyTitle}
                  description={s.accounts.emptyDescription}
                  action={
                    <Button variant="primary" onClick={beginNewAccount}>
                      {s.accounts.newAccount}
                    </Button>
                  }
                />
              ) : visibleRows.length === 0 && filtersActive ? (
                <EmptyState
                  sigil="finance"
                  title={s.ledger.filterEmptyTitle}
                  description={s.ledger.filterEmptyDescription}
                />
              ) : visibleRows.length === 0 ? (
                <EmptyState
                  sigil="finance"
                  title={s.ledger.emptyTitle}
                  description={s.ledger.emptyDescription}
                />
              ) : view === "list" ? (
                <div className={showMetaColumn ? "fin__ledger" : "fin__ledger fin__ledger--nometa"}>
                  <div className="fin__ledger-head">
                    <span>{s.form.payeeLabel}</span>
                    <span>{metaColumnLabel}</span>
                    <span className="fin__ledger-head-amount">{amountColumnLabel}</span>
                    <span />
                  </div>
                  {dayGroups.map((group) => (
                    <Fragment key={group.date}>
                      <div className="fin__day">
                        <span className="fin__day-name">{formatLedgerDay(group.date)}</span>
                        <span className="fin__day-net">
                          {[...group.nets.entries()].map(([currency, net]) => (
                            <span key={currency}>{signedMoney(net, currency, ledgerUnit)}</span>
                          ))}
                        </span>
                      </div>
                      {group.rows.map((row) => renderLedgerRow(row))}
                    </Fragment>
                  ))}
                </div>
              ) : (
                <CardsView<FinTransactionFields>
                  items={scopedRows}
                  schema={FIN_SCHEMA}
                  config={cardsConfig}
                  itemKey={(row) => row.id}
                  renderItem={renderCard}
                />
              )}
            </>
          )}
        </div>
      </div>

      {pendingDeleteCategory !== null && (
        <TypedConfirmDialog
          title={strings.finance.categories.deleteDialog.title}
          name={pendingDeleteCategory.name}
          warning={strings.finance.categories.deleteDialog.warning}
          confirmLabel={strings.finance.categories.deleteDialog.confirmLabel}
          confirmPlaceholder={strings.finance.categories.deleteDialog.confirmPlaceholder}
          confirmValue={pendingDeleteCategory.name}
          submitLabel={strings.finance.categories.deleteDialog.submit}
          cancelLabel={strings.finance.categories.deleteDialog.cancel}
          danger
          onConfirm={() => {
            const category = pendingDeleteCategory;
            setPendingDeleteCategory(null);
            void runRailAction(() => window.nexus.deleteFinCategory(profileId, category.id));
          }}
          onCancel={() => setPendingDeleteCategory(null)}
        />
      )}
    </div>
  );
}
