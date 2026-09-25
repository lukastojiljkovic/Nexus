# ADR-073 — FIN, the finance module: the arc design (migrations 050+, interchange 1.28.0+)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Chosen** as the
next module on the founder's „isplaniraj se lepo i nastavi dalje".

## 1. Why FIN and not FIT/HABIT/CANV

FIN is the module the codebase has already been leaving seams for:

- the calendar merge is written so **subscription renewals are one more source**;
- ADR-062 shipped CSV→TASK and recorded in as many words that **FIN's CSV half
  lands with FIN**;
- NTF's source list, the dashboard widget contract and the search index all take
  a new member without redesign.

FIT needs a Serbian food database — an asset the founder must supply, so it is
gated on him rather than on us. CANV is a surface large enough to be its own
arc and NOTE-007 hangs off it. HABIT is small and can ride later. FIN is the one
whose sockets already exist.

## 2. The constraints that decide the model

**No cloud, no bank APIs, no network.** So FIN is *manual + import*, never sync.
That is not a lesser product here: it is the only honest one for a local-only
app, and the CSV importer is what keeps manual entry from being the whole story.

**Money is integers in minor units. Never a float, anywhere, ever.** Amounts are
stored, summed and compared as integers; formatting is the only place a decimal
point exists.

**Currency is per account, and there is no FX.** Rates need a network feed we do
not have, and a stale invented rate is worse than no total. Totals are therefore
reported **per currency** and never summed across them — stated in the store, so
no later "convenience" sum can sneak in.

**Balances are derived, never stored.** An account's balance is its opening
balance plus its transactions. A stored mutable balance is the classic drift
bug — one failed write and the number lies forever, with no way to notice.

**Transfers are one row, not two.** A transfer between your own accounts is not
income and not expense, and modelling it as a pair is how it ends up
double-counted in every report. One row naming both sides, excluded from
income/expense aggregates *by construction* rather than by every caller
remembering to filter.

## 3. The slices

**a. Data layer** (migration **050**, interchange **1.28.0**) — accounts (name,
kind: gotovina/tekući/kartica/štednja, ISO-4217 currency, opening balance,
archive flag), flat categories carrying an income/expense kind (flat for
ADR-072's reason: one tree per app is enough), transactions (account, local day,
signed minor units, payee, note, category, optional counter-account for the
transfer case), budgets, and subscription definitions. Stores with the house
posture: every statement `profile_id`-scoped, every value bound, named refusals.

**b. The page** — accounts with derived balances, the ledger with quick add,
filters by account/category/period. The existing views-engine list/cards
vocabulary rather than a new one.

**c. Categories, budgets and the report** — a monthly budget per category and
spent-vs-budget. **No forecasting and no projections**: the house rule against
fabricated data covers invented futures too. Charts use the existing token
palette, jade for the secondary series, never a new hue.

**d. Subscriptions** — reuse **ADR-024's recurrence engine verbatim**. A
subscription is a recurring transaction template, and its occurrences feed the
calendar's new source, an NTF renewal reminder source, and a dashboard widget.
Writing a second recurrence rule for FIN would be the mistake here.

**e. CSV statement import** — reuse ADR-062's `parseCsv`, delimiter sniffing and
column-mapping dialog. Serbian bank exports vary wildly, which is exactly what
the mapping step is for. The hard part is **re-import**: a stable fingerprint
over (account, date, amount, description) skips rows already imported, additive
only, with every skip named — the ADR-043 foreign-import contract applied to
statements.

## 4. Consequences

- Five slices, one migration to start; later slices add columns rather than
  reshaping tables.
- FIN rows are ordinary profile content: encrypted at rest like everything else,
  travelling in the archive, searchable by payee and note. They are **not** PRIV
  — that section is for sealed notes, and widening it here would dilute a
  guarantee that is currently structural.
- The calendar's sixth source, NTF's new source and the FIN widgets are each one
  more branch in a merge already written to take them.
