---
id: restore
title: Restore from an archive
location: { module: settings, settings: data }
keywords: [restore, archive, replacing data, undo]
---
Restoring from an archive replaces everything now in the profile with the archive's contents. The card is "Backup and restore", and the block is "Restore from an archive".

How to restore:

1. Click "Choose an archive…".
2. If the archive is protected, enter the "Archive password".
3. Click "Show a preview" and read what the archive carries: "Made", "Version" and "Profile in the archive", with a per-module table over the columns "Now" and "From the archive".
4. Read the warning: "Everything now in the profile <name> will be deleted and replaced by the archive's contents."
5. Click "Restore data" (or "Cancel").

After a restore the app refreshes and shows the bar "The data was restored from a backup." with "Undo" — the undo works only until you lock or close the app.

Limits: an archive restores only into a profile of its own type (personal into personal, business into business). An archive made by a newer version of Nexus is refused by this one. If the archive carries private notes and the target section is locked, they will not be restored and the preview says so. If an attachment is missing or damaged, the record is restored without it.

Related: backup, settings-data
