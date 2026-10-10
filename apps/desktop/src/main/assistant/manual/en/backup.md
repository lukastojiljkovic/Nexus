---
id: backup
title: Backup
location: { module: settings, settings: data }
keywords: [backup, export, archive, password, automatic, keeping]
---
A backup exports the whole profile into one archive: open formats (JSON and CSV), notes as Markdown files and attachments in their original form — all readable and usable without Nexus. The card is called "Backup and restore".

Manual export:

1. Open "What gets exported" if you do not want everything — "all" is the default, and with no module ticked you read "Pick at least one module."
2. Tick "Protect the archive with a password" for an encrypted archive. Enter a "Password" and "Confirm password" (at least 12 characters, at most 256).
3. If the archive stays without a password, confirm "I understand that the archive will not be encrypted and that anyone who gets the file can open it."
4. Click "Export all data…" and pick where the archive is saved.

Automatic backup:

1. Click "Choose a folder…" and set an "Archive password" ("Set a password").
2. Turn on "Turn on automatic backup" and pick the "Frequency" ("Daily" or "Weekly") and how many copies are kept.
3. "Make one now" makes a copy at once; below it "Last:" states the outcome.

Limits: the archive password is not stored anywhere — lose it and the archive can no longer be opened. An automatic backup is always encrypted and never carries private notes; a manual export carries them only while the section is unlocked and only with a password, and when the section is not unlocked it says they were not exported. A missed slot is made up at the next unlock.

Related: restore, settings-data
