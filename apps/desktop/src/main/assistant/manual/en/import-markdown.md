---
id: import-markdown
title: Import notes (.md)
location: { module: settings, settings: data }
keywords: [import, markdown, notes, folder, md]
---
The notes import makes one note out of each Markdown file. The title is the first "# " in the file, or the file's own name if there is none.

How to import:

1. Under "Import and export" open "Import notes (.md)".
2. Pick the "Folder for the imported notes" ("No folder" or an existing one).
3. Click "Choose .md files…" or "Choose a folder…". The folder is read together with its subfolders, and all the notes go into the chosen folder.
4. Wait for the import ("Importing…") and read the outcome: "Imported N notes" or "No note was imported."

Limits: images are not carried over — they stay as text with their path, and the outcome says so. A file over 1 MB, an empty file, a file that is not Markdown and content too large for a single note are each skipped, with their reason under "What was not imported". At most 200 files at a time; this one and all after it are skipped.

Related: notes, settings-data
