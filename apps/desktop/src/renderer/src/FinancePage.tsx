import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button, CardsView, Chip, EmptyState, ListRow, ListView, TextField } from "@nexus/ui";
import { applyFilters, isValidDayKey } from "@nexus/core";
import type { CardsViewConfig, CollectionSchema, FilterSpec, ListViewConfig } from "@nexus/core";
import {
  FIN_ACCOUNT_KINDS,
  FIN_CATEGORY_KINDS,
  MAX_FIN_ACCOUNT_NAME_LENGTH,
  MAX_FIN_CATEGORY_NAME_LENGTH,
  MAX_FIN_NOTE_LENGTH,
  MAX_FIN_PAYEE_LENGTH,
} from "../../shared/ipc.js";
import type {
  FinAccount,
  FinAccountBalance,
  FinAccountKind,
  FinCategory,
  FinCategoryKind,
  FinCurrencyTotal,
  FinTransaction,
} from "../../shared/ipc.js";
import { localTodayKey } from "./examDates.js";
import { normalizeCurrencyInput, readStoredPrimaryCurrency } from "./financePrefs.js";
import { formatMoney, moneyInputValue, parseMoneyInput } from "./money.js";
import { strings } from "./strings.js";

/**
 * Finansije (FIN slice b) — the ledger's page. Slice a shipped the data layer
 * and the five decisions written into migration 051; this page is bound by
 * every one of them and revisits none:
 *
 * - **Money is an INTEGER of minor units** in every value this file holds. The
 *   only decimal anywhere is produced by `money.ts` at the moment of drawing,
 *   and the only decimal ever read is parsed by the same module before it
 *   crosses the wire. There is no `toFixed` here and no float arithmetic.
 * - **Currency is per ACCOUNT and nothing converts.** Which is why the rail's
 *   „Ukupno" block renders `finCurrencyTotals`' LIST verbatim — one row per
 *   currency — and why nothing here ever reduces that list to a number. A
 *   cross-currency sum is not merely avoided: the store publishes no method
 *   that could produce one, so there is nothing to add up by accident.
 * - **A balance is DERIVED**, read on its own channel and never patched
 *   locally: every write re-reads the whole screen (`reload`), so a balance on
 *   screen is always one the store just computed from the rows beside it.
 * - **A transfer is ONE row** naming both accounts. „Prenos" is the single act
 *   that writes it, and a transfer row is DRAWN as a transfer — the two account
 *   names and the direction — never as an expense wearing a strange category.
 * - **Categories are flat, with a kind**, so the picker offers exactly the kind
 *   the current entry can carry, and offers none at all for a transfer, which
 *   is neither income nor expense.
 *
 * The ledger is drawn with the house's existing view vocabulary (list and
 * cards, ADR-050) and is handed the rows in the store's own order: no `sort`
 * spec, so `applySort` returns its input untouched and „newest day first" stays
 * what the store already guarantees. The CATEGORY filter is a `FilterSpec` —
 * strict equality is exactly what it needs, `null` for „Bez kategorije"
 * included — while the ACCOUNT and PERIOD filters are predicates applied here,
 * because equality cannot express „either side of a transfer" or a range. That
 * is the same split TASK's page makes between its smart lists and its filter
 * specs, not a third vocabulary.
 */

/** The three acts the one entry form performs. It decides the SIGN and what the row may carry — never a stored field. */
type EntryKind = "expense" | "income" | "transfer";

const ENTRY_KINDS: readonly EntryKind[] = ["expense", "income", "transfer"];

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
    { key: "date", type: "date", titleKey: "finance.field.date" },
    { key: "amount", type: "number", titleKey: "finance.field.amount" },
    { key: "payee", type: "text", titleKey: "finance.field.payee" },
    { key: "accountId", type: "text", titleKey: "finance.field.account" },
    { key: "categoryId", type: "text", titleKey: "finance.field.category" },
  ],
};

/** One pending undo offer; a fresh delete replaces the previous one, exactly as on the tasks page. */
type PendingUndo = null | { kind: "transaction"; id: string } | { kind: "account"; id: string };

/** Which inline rail editor is open, if any. */
type AccountEditing = null | { mode: "new" } | { mode: "edit"; id: string };
type CategoryEditing = null | { mode: "new" } | { mode: "rename"; id: string };

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
  if (message.includes("already exists in this profile")) {
    return strings.finance.categories.duplicate;
  }
  if (
    message.includes("No active account") ||
    message.includes("No category") ||
    message.includes("No active transaction")
  ) {
    return copy.notFound;
  }
  return strings.finance.actionError;
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
  transactions: FinTransaction[];
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
  const [accounts, balances, totals, categories, transactions] = await Promise.all([
    window.nexus.listFinAccounts(profileId),
    window.nexus.finAccountBalances(profileId),
    window.nexus.finCurrencyTotals(profileId),
    window.nexus.listFinCategories(profileId),
    window.nexus.listFinTransactions(profileId),
  ]);
  return { accounts, balances, totals, categories, transactions };
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
  const [transactions, setTransactions] = useState<FinTransaction[] | null>(null);
  const [failed, setFailed] = useState(false);

  // The rail's account filter; null is „Svi računi", which is a VIEW over every
  // account rather than an account of its own.
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [view, setView] = useState<LedgerView>("list");
  const [categoryFilter, setCategoryFilter] = useState<string>(CATEGORY_FILTER_ALL);
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");

  // The one entry form, serving create and edit (the tasks page's own shape).
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
  const [railError, setRailError] = useState<string | null>(null);

  const [pendingUndo, setPendingUndo] = useState<PendingUndo>(null);
  const amountRef = useRef<HTMLInputElement>(null);

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
        setTransactions(snapshot.transactions);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load finances:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // Consumes „Nova transakcija" (021-e): the form is always on screen here, so
  // the intent only has to put the caret in it. Reported handled immediately —
  // there is no row to wait for, unlike a reveal.
  useEffect(() => {
    if (!intent) return;
    amountRef.current?.focus();
    onIntentHandled();
  }, [intent, onIntentHandled]);

  /**
   * Re-reads the WHOLE screen. Every write does: a balance and a per-currency
   * total are derived from the transactions, so a page that patched one row
   * locally would show a balance that no longer follows from the rows beside it
   * — the exact drift the missing `balance` column exists to make impossible.
   */
  async function reload(): Promise<void> {
    const snapshot = await loadFinance(profileId);
    setAccounts(snapshot.accounts);
    setBalances(snapshot.balances);
    setTotals(snapshot.totals);
    setCategories(snapshot.categories);
    setTransactions(snapshot.transactions);
  }

  /** Runs one rail mutation: clears the previous refusal, performs it, closes the editor and re-reads. A failure leaves what was typed where it is. */
  async function runRailAction(action: () => Promise<void>): Promise<void> {
    setRailError(null);
    try {
      await action();
      closeAccountEditor();
      closeCategoryEditor();
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
  /** Which currency the amount field is being typed in — the account's own, said out loud beside it. */
  const formCurrency = formAccount?.currency ?? readStoredPrimaryCurrency();

  function resetForm(): void {
    setEditingId(null);
    setEntryKind("expense");
    setAmountDraft("");
    setPayeeDraft("");
    setNoteDraft("");
    setDateDraft(localTodayKey());
    setAccountDraft("");
    setCounterDraft("");
    setCategoryDraft("");
    setFormError(null);
  }

  /** Opens an existing row in the same form; its kind is derived from the row, never stored on it. */
  function beginEdit(transaction: FinTransactionFields): void {
    const account = accountById.get(transaction.accountId);
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
    amountRef.current?.focus();
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
      resetForm();
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
      if (editingId === transaction.id) resetForm();
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
  }

  function beginNewCategory(): void {
    setRailError(null);
    setCategoryName("");
    setCategoryKind("expense");
    setCategoryEditing({ mode: "new" });
  }

  function beginRenameCategory(category: FinCategory): void {
    setRailError(null);
    setCategoryName(category.name);
    setCategoryKind(category.kind);
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

  // --- What this render draws ------------------------------------------------

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
  const listConfig: ListViewConfig = { type: "list", filters: filterSpecs };
  const cardsConfig: CardsViewConfig = { type: "cards", filters: filterSpecs };
  /** What the views will actually draw — the same engine call they make, so the empty state and the rows can never disagree. */
  const visibleRows = applyFilters(scopedRows, filterSpecs);

  /** The currency a row's amount is stated in — its account's own, always; there is no other it could be in. */
  const currencyOf = (row: FinTransactionFields): string =>
    accountById.get(row.accountId)?.currency ?? "";

  const accountNameOf = (id: string | null): string =>
    id === null ? "" : (accountById.get(id)?.name ?? "");

  /** A row's own one-line title: what it was for, or — on a transfer, which has no payee to speak of — what it is. */
  const rowTitle = (row: FinTransactionFields): string =>
    row.payee ?? (entryKindOf(row) === "transfer" ? s.ledger.transfer : "—");

  /** The chips a ledger row carries: what kind of movement it is, whose account, and under which label. */
  function rowChips(row: FinTransactionFields): ReactNode {
    if (entryKindOf(row) === "transfer") {
      return (
        <div className="fin__chips">
          <Chip variant="data">
            {`${s.ledger.transfer}: ${accountNameOf(row.accountId)} ${s.ledger.transferArrow} ${accountNameOf(row.counterAccountId)}`}
          </Chip>
        </div>
      );
    }
    return (
      <div className="fin__chips">
        <Chip>{accountNameOf(row.accountId)}</Chip>
        <Chip variant={row.categoryId === null ? "neutral" : "accent"}>
          {row.categoryId === null
            ? s.ledger.uncategorized
            : (categoryById.get(row.categoryId)?.name ?? s.ledger.uncategorized)}
        </Chip>
      </div>
    );
  }

  /**
   * A row's amount. Income takes the data colour (jade), everything else the
   * ordinary text colour: an expense is not an error, and painting every one of
   * them red would make an ordinary month read as a warning.
   */
  function rowAmount(row: FinTransactionFields): ReactNode {
    const kind = entryKindOf(row);
    return (
      <span
        className={
          kind === "income"
            ? "fin__amount fin__amount--in"
            : kind === "transfer"
              ? "fin__amount fin__amount--move"
              : "fin__amount"
        }
      >
        {formatMoney(row.amount, currencyOf(row))}
      </span>
    );
  }

  function rowActions(row: FinTransactionFields): ReactNode {
    return (
      <span className="fin__row-actions">
        <Button
          size="sm"
          className="fin__row-action"
          aria-label={`${s.ledger.edit}: ${rowTitle(row)}`}
          onClick={() => beginEdit(row)}
        >
          ✎
        </Button>
        <Button
          size="sm"
          className="fin__row-action fin__row-delete"
          aria-label={`${s.ledger.delete}: ${rowTitle(row)}`}
          onClick={() => void deleteTransaction(row)}
        >
          ×
        </Button>
      </span>
    );
  }

  function renderRow(row: FinTransactionFields): ReactNode {
    return (
      <ListRow leading={<span className="fin__date">{row.date}</span>} trailing={rowActions(row)}>
        <span className="fin__row-body">
          <span className="fin__title">{rowTitle(row)}</span>
          {rowChips(row)}
          {rowAmount(row)}
        </span>
      </ListRow>
    );
  }

  function renderCard(row: FinTransactionFields): ReactNode {
    return (
      <>
        <div className="fin__card-head">
          <span className="fin__title">{rowTitle(row)}</span>
          {rowActions(row)}
        </div>
        <span className="fin__date">{row.date}</span>
        {rowChips(row)}
        {rowAmount(row)}
      </>
    );
  }

  /** One account row in the rail: its name, its own DERIVED balance, and the three things that can be done to it. */
  function renderAccountRow(account: FinAccount): ReactNode {
    const balance = balanceById.get(account.id);
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
            <span className="fin__rail-balance">
              {balance === undefined
                ? formatMoney(account.openingBalance, account.currency)
                : formatMoney(balance.minorUnits, balance.currency)}
            </span>
          </span>
        </button>
        <span className="fin__rail-actions">
          <Button
            size="sm"
            className="fin__rail-action"
            aria-label={`${s.accounts.edit}: ${account.name}`}
            title={s.accounts.edit}
            onClick={() => beginEditAccount(account)}
          >
            ✎
          </Button>
          <Button
            size="sm"
            className="fin__rail-action"
            aria-label={`${account.archived ? s.accounts.unarchive : s.accounts.archive}: ${account.name}`}
            title={account.archived ? s.accounts.unarchive : s.accounts.archive}
            onClick={() =>
              void runRailAction(async () => {
                await window.nexus.updateFinAccount(profileId, account.id, {
                  archived: !account.archived,
                });
              })
            }
          >
            {account.archived ? "↩" : "▤"}
          </Button>
          <Button
            size="sm"
            className="fin__rail-action fin__rail-delete"
            aria-label={`${s.accounts.delete}: ${account.name}`}
            title={s.accounts.delete}
            onClick={() =>
              void runRailAction(async () => {
                await window.nexus.deleteFinAccount(profileId, account.id);
                if (selectedAccountId === account.id) setSelectedAccountId(null);
                setPendingUndo({ kind: "account", id: account.id });
              })
            }
          >
            ×
          </Button>
        </span>
      </div>
    );
  }

  // --- The screen -------------------------------------------------------------

  if (failed) {
    return <EmptyState title={s.loadErrorTitle} description={s.loadError} />;
  }
  if (accounts === null || transactions === null) {
    return <p className="app__muted">{strings.app.loading}</p>;
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
    (account) =>
      account.id !== formAccountId && (!account.archived || account.id === counterDraft),
  );

  return (
    <div className="fin">
      <aside className="fin__rail" aria-label={s.accounts.heading}>
        {/* Per CURRENCY, drawn straight from the store's list. Nothing here adds
            two rows together, and no method exists that could: without an
            exchange rate a cross-currency total could only be invented. */}
        <div className="fin__rail-heading">{s.totals.heading}</div>
        {totals.length === 0 ? (
          <p className="fin__rail-note">{s.totals.none}</p>
        ) : (
          <div className="fin__totals">
            {totals.map((total) => (
              <div key={total.currency} className="fin__total">
                {formatMoney(total.minorUnits, total.currency)}
              </div>
            ))}
          </div>
        )}
        <p className="fin__rail-note">{s.totals.caption}</p>

        <div className="fin__rail-heading fin__rail-heading--stacked">{s.accounts.heading}</div>
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
                balance, and a page that hid it would be hiding money. It is out
                of „Ukupno" all the same — that total is what you can spend. */}
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
            <label className="fin__field">
              <span className="fin__field-label">{s.accounts.kindLabel}</span>
              <select
                className="fin__select"
                value={accountKind}
                onChange={(event) => setAccountKind(asAccountKind(event.target.value))}
              >
                {FIN_ACCOUNT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {s.accounts.kinds[kind]}
                  </option>
                ))}
              </select>
            </label>
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
              <Button type="button" size="sm" className="fin__quiet" onClick={closeAccountEditor}>
                {s.accounts.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" className="fin__rail-add" onClick={beginNewAccount}>
            {s.accounts.newAccount}
          </Button>
        )}

        <div className="fin__rail-heading fin__rail-heading--stacked">{s.categories.heading}</div>
        {categories.length === 0 ? (
          <p className="fin__rail-note">{s.categories.empty}</p>
        ) : (
          <div className="fin__chips">
            {categories.map((category) => (
              <span key={category.id} className="fin__category">
                <button
                  type="button"
                  className="fin__category-name"
                  aria-label={`${s.categories.rename}: ${category.name}`}
                  onClick={() => beginRenameCategory(category)}
                >
                  {category.name}
                  <span className="fin__category-kind">{s.categories.kinds[category.kind]}</span>
                </button>
                <button
                  type="button"
                  className="fin__category-delete"
                  aria-label={`${s.categories.delete}: ${category.name}`}
                  title={s.categories.deleteHint}
                  onClick={() =>
                    void runRailAction(() => window.nexus.deleteFinCategory(profileId, category.id))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {categoryEditing !== null ? (
          <form className="fin__rail-form" onSubmit={submitCategory}>
            <TextField
              label={s.categories.heading}
              value={categoryName}
              placeholder={s.categories.namePlaceholder}
              maxLength={MAX_FIN_CATEGORY_NAME_LENGTH}
              onChange={(event) => setCategoryName(event.target.value)}
            />
            {/* The kind is fixed once a category exists: flipping „Plata" from
                prihod to rashod would silently re-classify every transaction
                ever filed under it, which is exactly why the store has no
                method that could. */}
            {categoryEditing.mode === "new" && (
              <div className="fin__segmented" role="group" aria-label={s.categories.heading}>
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
              <Button type="button" size="sm" className="fin__quiet" onClick={closeCategoryEditor}>
                {s.accounts.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" className="fin__rail-add" onClick={beginNewCategory}>
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
        <form className="fin__form" onSubmit={(event) => void submitForm(event)}>
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
                  // A transfer carries no category and an ordinary row no
                  // counter account; leaving a stale one selected would let the
                  // form ask for something the store must refuse.
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
            <input
              ref={amountRef}
              className="nx-textfield__input fin__amount-input"
              value={amountDraft}
              inputMode="decimal"
              placeholder={s.form.amountPlaceholder}
              aria-label={s.form.amountLabel}
              onChange={(event) => setAmountDraft(event.target.value)}
            />
            {/* Which money the amount is in — the account's own, said where the
                amount is typed rather than left to be assumed. */}
            <span className="fin__amount-currency">{formCurrency}</span>
            <input
              className="nx-textfield__input fin__payee-input"
              value={payeeDraft}
              placeholder={s.form.payeePlaceholder}
              aria-label={s.form.payeeLabel}
              maxLength={MAX_FIN_PAYEE_LENGTH}
              onChange={(event) => setPayeeDraft(event.target.value)}
            />
            <Button type="submit" variant="primary" disabled={liveAccounts.length === 0}>
              {editingId === null ? s.form.submitAdd : s.form.submitSave}
            </Button>
            {editingId !== null && (
              <Button type="button" className="fin__quiet" onClick={resetForm}>
                {s.form.cancel}
              </Button>
            )}
          </div>

          <div className="fin__fields">
            <TextField
              type="date"
              value={dateDraft}
              aria-label={s.form.dateLabel}
              onChange={(event) => setDateDraft(event.target.value)}
            />
            <select
              className="fin__select"
              value={formAccountId}
              aria-label={entryKind === "transfer" ? s.form.fromAccountLabel : s.form.accountLabel}
              onChange={(event) => setAccountDraft(event.target.value)}
            >
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            {entryKind === "transfer" ? (
              <select
                className="fin__select"
                value={counterDraft}
                aria-label={s.form.toAccountLabel}
                onChange={(event) => setCounterDraft(event.target.value)}
              >
                <option value="">{s.form.toAccountLabel}</option>
                {transferTargets.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className="fin__select"
                value={categoryDraft}
                aria-label={s.form.categoryLabel}
                onChange={(event) => setCategoryDraft(event.target.value)}
              >
                <option value="">{s.form.categoryNone}</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            )}
            <input
              className="nx-textfield__input fin__note-input"
              value={noteDraft}
              placeholder={s.form.noteLabel}
              aria-label={s.form.noteLabel}
              maxLength={MAX_FIN_NOTE_LENGTH}
              onChange={(event) => setNoteDraft(event.target.value)}
            />
          </div>

          {formError !== null && (
            <p className="fin__error" role="alert">
              {formError}
            </p>
          )}
        </form>

        <div className="fin__view-controls">
          <div className="fin__views">
            {LEDGER_VIEWS.map((option) => (
              <Button
                key={option}
                size="sm"
                className={view === option ? "fin__view fin__view--active" : "fin__view"}
                aria-pressed={view === option}
                onClick={() => setView(option)}
              >
                {option === "list" ? s.views.list : s.views.cards}
              </Button>
            ))}
          </div>
          <select
            className="fin__select"
            value={categoryFilter}
            aria-label={s.filters.categoryLabel}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value={CATEGORY_FILTER_ALL}>{s.filters.categoryAll}</option>
            <option value={CATEGORY_FILTER_NONE}>{s.filters.categoryNone}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <TextField
            type="date"
            value={fromDraft}
            aria-label={s.filters.fromLabel}
            onChange={(event) => setFromDraft(event.target.value)}
          />
          <TextField
            type="date"
            value={toDraft}
            aria-label={s.filters.toLabel}
            onChange={(event) => setToDraft(event.target.value)}
          />
          {filtersActive && (
            <Button
              size="sm"
              className="fin__quiet"
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

        {periodInvalid && (
          <p className="fin__error" role="status">
            {s.filters.invalidPeriod}
          </p>
        )}

        {pendingUndo !== null && (
          <div className="fin__undo" role="status">
            <span className="fin__undo-text">
              {pendingUndo.kind === "transaction"
                ? s.ledger.deletedNotice
                : s.accounts.deletedNotice}
            </span>
            <Button size="sm" className="fin__undo-action" onClick={() => void undoDelete()}>
              {s.undo}
            </Button>
            <Button
              size="sm"
              className="fin__quiet"
              aria-label={s.dismiss}
              onClick={() => setPendingUndo(null)}
            >
              ×
            </Button>
          </div>
        )}

        {accountList.length === 0 ? (
          // An honest invitation, never a fabricated starter row: nothing in
          // this app writes money the user did not.
          <EmptyState
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
            title={s.ledger.filterEmptyTitle}
            description={s.ledger.filterEmptyDescription}
          />
        ) : visibleRows.length === 0 ? (
          <EmptyState title={s.ledger.emptyTitle} description={s.ledger.emptyDescription} />
        ) : view === "list" ? (
          <ListView<FinTransactionFields>
            items={scopedRows}
            schema={FIN_SCHEMA}
            config={listConfig}
            itemKey={(row) => row.id}
            renderItem={renderRow}
          />
        ) : (
          <CardsView<FinTransactionFields>
            items={scopedRows}
            schema={FIN_SCHEMA}
            config={cardsConfig}
            itemKey={(row) => row.id}
            renderItem={renderCard}
          />
        )}
      </div>
    </div>
  );
}
