---
id: import-apkg
title: Import from Anki (.apkg)
location: { module: settings, settings: data }
keywords: [anki, apkg, deck, import, cards]
---
The Anki import turns an Anki deck into Nexus cards. The decks go into the subject you pick, and nothing you already have is changed.

How to import:

1. Under "Import and export" open "Import from Anki (.apkg)" and click "Choose an .apkg file…".
2. Pick the subject for the imported decks — an existing one or a new one with its own name.
3. Click "Show a preview" and read the counts on the "Decks", "Notes" and "Cards" rows ("In the deck" and "Importing").
4. "What is not imported" states every reason; if there is nothing to import, the "Import" button is not shown.
5. Click "Import". The import can be undone with one click, but only until you lock or close the app.

Limits: cards start as new — review history, images, audio and Anki tags are not carried over, and extra fields and Anki templates this version cannot render are skipped and listed one by one. An empty deck is not created. A deck that cannot be read (a newer Anki database, a damaged file, one past the safety limits) is refused with an explanation.

Related: study-cards, settings-data
