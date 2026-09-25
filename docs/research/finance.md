# Research: Personal Finance Module

**Domain:** budgeting methods, tracker retention, bank sync vs manual entry,
multi-currency.
**Session:** 2026-07-05 (research phase 1, session 8).
**Nexus context:** FIN is (S) — income/expenses, budgets, categories, charts,
subscriptions tracking. Serbia-first user base (RSD + EUR reality).

## 1. Conclusions

1. **Passive trackers churn; proactive budgeting retains.** Finance-app
   day-30 retention averages ~4%, while YNAB reports ~90% retention on the
   back of zero-based budgeting — assigning every dinar a job *before*
   spending; proactive allocation shows ~3× greater habit retention at 12
   months vs retrospective categorization
   ([competitive analysis](https://www.useluminix.com/reports/industry-analysis/competitive-landscape-personal-finance-and-budgeting-apps-2026),
   [YNAB on zero-based budgeting](https://www.ynab.com/blog/what-is-a-zero-based-budget)).
   Nexus FIN therefore offers **envelope/zero-based budgeting as the
   headline mode** (optional; plain tracking also works — founder decision
   #4 depth question "budžeti ili samo evidencija?" already anticipates
   this).
2. **Manual-first entry is the right architecture for Serbia — and for
   offline-first.** Open banking exists formally in Serbia but consumer
   aggregation (Plaid-class) is effectively unavailable; manual-entry
   trackers capture cash (still huge in Serbia), work offline, and handle
   multi-currency cleanly
   ([Open Banking tracker: Serbia](https://www.openbankingtracker.com/country/serbia),
   [manual tracking advantages](https://thrust.finance/learn/track-expenses-without-linking-bank/)).
   Bank sync is a **post-v1 integration point**, never a dependency — which
   conveniently matches offline-first. Reducing manual-entry friction
   becomes the design battleground: fast-entry UI, templates for recurring
   items, quick-capture integration.
3. **Multi-currency from day one:** RSD primary + EUR savings/prices is the
   normal Serbian household pattern; store amounts in original currency with
   explicit exchange rates (user-editable, optionally auto-updated when
   online), never silent conversion.
4. **Subscriptions tracker (raw-spec idea) folds in naturally:** recurring
   expenses with renewal dates → CAL reminders + FIN forecast; charts via
   the shared chart system (`design-system.md`).
5. **Privacy positioning is a differentiator:** finance data is exactly what
   users don't want in someone's cloud — local-first + optional E2E-synced
   is a marketing point against cloud-only competitors.

## 2. Expected feature checklist

Accounts (cash, bank, savings, per currency); fast expense/income entry
(amount-first numpad, recent categories, templates); categories with budgets
(monthly envelopes, rollover option); recurring transactions & subscriptions;
transfers between accounts; charts: spending by category/time, budget
progress, net worth trend; CSV import/export (bank statement import via IMEX
LLM prompts — Serbian banks export CSV/XML); receipts as attachments (→ DOC).
Differentiators: zero-based mode, offline + private, business/personal
profile separation (founder decision #4 — finances are the canonical
"separate" module).

## 3. Pitfalls

- **Entry friction kills the habit** — if logging a coffee takes >5 seconds,
  the ledger dies; quick-capture and defaults matter more than features.
- **Forced budgeting scares casual users** — tracking-only mode must be
  first-class, budgeting an upgrade path.
- **Exchange-rate magic** — silent conversions destroy trust; always show
  the rate and let the user correct it.
- **Categorization fatigue** — sane default category set (localized),
  merchant→category memory, but no ML overreach in v1.
- Scope creep toward accounting (invoices, VAT) — that's the PRO/freelancer
  pack's territory, not personal FIN.

## 4. Open questions → PRD (FIN)

1. Zero-based/envelope mode in v1 of FIN or fast-follow after basic
   tracking? (Recommendation: v1 — it's the retention engine.)
2. Default Serbian category taxonomy — design with localization.
3. Exchange-rate source when online (NBS srednji kurs is the natural
   reference) — verify API/licensing in architecture.
4. Net-worth tracking (assets beyond accounts) — v1 or later? (Recommend
   later; INV module adjacency.)
