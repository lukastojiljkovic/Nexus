# PRD 17 — Finance (FIN)

**Status:** draft 2026-07-05. Inputs: raw-spec §16, `docs/research/finance.md`,
subscriptions idea, founder decision #4 (business separation).

## 1. Purpose

Personal money clarity: fast expense/income logging (manual-first — the
right architecture for Serbia and offline), optional zero-based budgeting
(the retention engine per research), subscriptions, and honest charts.
Personal FIN only; business accounting belongs to PRO packs.

## 2. User stories

- As a spender, I want to log an expense in under 5 seconds, so that
  tracking survives real life.
- As a budgeter, I want envelopes where every dinar has a job, so that
  spending becomes intentional (YNAB model).
- As a casual tracker, I want tracking without budgets, so that the module
  doesn't preach.
- As a Serbian user, I want RSD and EUR side by side with visible rates, so
  that my real accounts are representable.
- As a subscriber, I want renewals visible ahead of time, so that no charge
  surprises me.

## 3. User experience & flows

Quick-add (numpad-first: amount → category grid with recents → account →
optional note/date) from FIN, dashboard widget, or quick capture. Views:
Transakcije (list, filters, search), Budžet (envelope board: assign monthly
income to category envelopes, progress bars, rollover), Pretplate (list +
next renewals), Računi (accounts with balances), Pregled (charts: category
breakdown, monthly trend, budget adherence, net cash flow). Month-start
budgeting ritual: "raspodeli" screen if budgeting enabled.

## 4. Functional requirements

- **FIN-001 (M)** Accounts: cash/bank/savings/custom, per-currency, opening
  balance, archived state; balances derived from transactions.
- **FIN-002 (M)** Transactions: expense/income/transfer, amount + currency,
  account, category, date, optional note/tags/attachment (receipt → DOC),
  recurring flag; fast-entry UI meeting the 5-second story.
- **FIN-003 (M)** Categories: localized default taxonomy (sr/en), custom
  categories with icon/color, archive (never delete with history).
- **FIN-004 (M)** Multi-currency: transactions keep original currency;
  display conversions use explicit rates (manual always available;
  auto-update from NBS reference when online — architecture confirms
  source); every converted figure shows its rate on hover/tap.
- **FIN-005 (M)** Budgeting (optional mode): monthly envelopes per category,
  assignment of available money, rollover per category, overspend surfacing;
  tracking-only mode hides all budget UI (research conclusion #1 + founder
  depth question).
- **FIN-006 (M)** Recurring transactions and **subscriptions**: cadence,
  next-date preview, auto-log (confirm or auto per item), renewal reminders
  via NTF and CAL overlay (CAL-003).
- **FIN-007 (M)** Charts (chart kit): spending by category (period
  selectable), income vs expenses trend, budget adherence, per-account
  balances over time.
- **FIN-008 (M)** Profile separation: FIN data strictly per profile
  (decision #4 canonical module); no cross-profile aggregation.
- **FIN-009 (S)** CSV bank-statement import with column-mapping UI +
  dedup (IMEX-007); Serbian bank samples in test set.
- **FIN-010 (S)** Search/filter: by text, category, account, amount range,
  date range (SRCH `due:`-style operators local to FIN).
- **FIN-011 (C)** Savings goals (ciljevi) with envelope linkage.
- **FIN-012 (C)** Cash-flow forecast from recurring items.

## 5. Options & settings

Budgeting mode on/off; default currency + secondary display currency; rate
auto-update on/off; month start day; category taxonomy management.

## 6. Integrations

CAL/NTF (renewals, budget-ritual reminder opt-in); DASH (budget snapshot,
recent transactions widgets); DOC (receipts); IMEX (CSV import, LLM prompt
for arbitrary exports, full export); SHOP (wishlist→planned purchase later);
STATS (yearly review numbers).

## 7. Edge cases & error states

- Transfer between different-currency accounts → explicit both-amounts
  entry (no silent conversion).
- Editing/deleting old transactions → balances recompute; budget months
  affected are flagged.
- Recurring item's account archived → item pauses with notice.
- Rate source unavailable offline → last-known rate with age indicator;
  manual override always wins.
- Sync conflict: transactions are append-only rows (near-conflict-free per
  sync research); edits per-field LWW; a delete/edit conflict keeps the
  edit.
- Budget assigned > available → honest negative "to-assign" state, no
  blocking.
- Import dedup: same amount/date/description within window → flagged in
  preview, user decides.

## 8. Acceptance criteria (key)

- Coffee expense logged in ≤ 5 s / ≤ 6 interactions from dashboard widget.
- Tracking-only mode shows zero budgeting UI anywhere; enabling budgeting
  migrates nothing silently (fresh envelopes, history intact).
- EUR account + RSD account: totals shown in display currency with rate
  visible; changing the manual rate updates displays, never stored amounts.
- Netflix subscription shows on CAL 3 days ahead (default ladder), fires
  NTF, and auto-logs on confirmation.
- Deleting a category with history is impossible; archiving hides it from
  pickers, history intact.
- Business profile's FIN is invisible from personal profile everywhere
  (search, charts, exports scoped per profile).

## 9. Open questions

1. NBS rate source implementation/licensing (architecture; fallback ECB).
2. ~~Default category taxonomy.~~ **Approved (founder 2026-07-05): ~18
   default categories tuned to Serbian reality (komunalije, prevoz,
   kafa/izlasci…); final list drafted at implementation.**
3. ~~Budget month start.~~ **Decided (founder 2026-07-05): custom start day
   supported in v1; default is the 1st.**

## 10. Future extensions

Bank sync where APIs allow (post-v1 ADR); shared household budget (SHARE);
debt payoff planner; net-worth module bridging INV; PRO invoicing stays in
profession packs.
