---
id: network-and-updates
title: Network and updates
location: { module: settings, settings: privacy }
keywords: [network, mode, offline, update, github, download]
---
"Network and updates" is the first card in the "Privacy" category and decides whether Nexus may open any connection to the internet. The mode is for the whole computer.

The three modes:

1. "Offline only" — Nexus opens no connection to the internet. Nothing leaves this computer.
2. "Offline + update checks" — Nexus contacts GitHub only, and only to check for and download a new version of itself. Your notes and data never leave this computer.
3. "Offline + update checks + downloads" — everything the previous mode allows, plus downloads you start yourself, only from the addresses built into the app.

How to change it and what follows:

1. Pick a mode and click "Save the choice". The change takes effect the next time Nexus starts, and "Restart Nexus" starts the app right away.
2. With the checks on, "Check now" and "What is new" are here too.
3. When a version is available, click "Download and install". Nothing downloads until that click; Nexus checks the installer's signature, starts it and closes.

If the choice is not saved, Nexus stays in "Offline only" and asks again on the next start. If a check fails, the reason is stated: "GitHub is limiting the number of checks right now…", "The network connection is unavailable…", "Signature on the checksum file is not valid…" or "The downloaded file does not match its checksum. It was deleted and not started."

Related: settings-privacy, settings-about
