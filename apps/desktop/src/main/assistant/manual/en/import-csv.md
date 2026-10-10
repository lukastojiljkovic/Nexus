---
id: import-csv
title: Import tasks (.csv)
location: { module: settings, settings: data }
keywords: [import, csv, tasks, mapping, columns, list]
---
Importing tasks reads a CSV table — an export from another tool, or a list you kept by hand — and makes tasks. You say which column is what, and every task goes into one list you pick.

How to import:

1. Under "Import and export" open "Import tasks (.csv)" and click "Choose a .csv file…".
2. In "Column mapping" set the "Column role" for each column: "Task title", "Description", "Due date", "Priority", "Status", "Section", "Tags", "List (not imported)" or "Not imported". Exactly one column must be "Task title".
3. Pick the "Column separator" ("Comma (,)", "Semicolon (;)") and say whether "The first row is a header".
4. Pick the "List for the imported tasks" — an existing one or "New list…".
5. Click "Show a preview"; you read "Rows in the table" and "Tasks importing", and "What is not imported" lists every dropped row ("Row 12").
6. Click "Import". The import can be undone with one click, but only until you lock or close the app.

Limits: a column with the "List" role is recognised but not carried over — every task goes into the list chosen before the import. A row with no title is skipped; a due date that cannot be read (a two-digit year is refused) gives a task without a due date, not a missing row. A table over 5 MB is refused.

Related: tasks, import-fin-csv
