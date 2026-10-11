---
id: import-fin-csv
title: Import a statement (.csv)
location: { module: settings, settings: data }
keywords: [statement, bank, csv, transactions, duplicates, currency]
---
The statement import reads a bank statement (.csv) and writes the entries into one of your accounts. An account has to exist first ("Create an account first — the statement goes into the account you pick…").

How to import:

1. Under "Import and export" open "Import a statement (.csv)", or use "Import a statement (.csv)…" in Finance.
2. Click "Choose a statement (.csv)…" and set the roles in "Statement column mapping": "Date", "Amount (signed)", "Outflow (money out)", "Inflow (money in)", "Payee", "Description", "Currency" or "Not imported". One column must be "Date", and the amount is either one signed column or the outflow/inflow columns — never both.
3. Pick the "Column separator", whether "The first row is a header", the "Account the statement goes into" and "What the sign in the Amount column means".
4. Click "Show a preview". Under "How the file was read" stand the number format, the date format and the sign; under "Already imported" every row the ledger already holds; under "What is not imported" the dropped rows.
5. Click "Import".

Limits: a statement in a currency other than the chosen account is refused — Nexus has no exchange rate. If a column allows two readings that give different numbers or dates, the import is refused rather than guessed. The same statement can be imported twice without duplicates: every already-imported row is skipped and written out in the preview. A file over 5 MB is refused.

Related: finance-transactions, import-csv
