# Privacy

**Last updated:** 2026-10-09

Nexus is a desktop application with no server. It is built so that the answer to
"what does this app send?" is short, and so that the short answer can be checked
in the source rather than believed.

## The short version

- Everything you write lives in **one encrypted database per local account**, on
  your own device, with the files you attach stored encrypted beside it.
- **There is no telemetry, no analytics and no crash reporting.** None is built,
  and none can be added quietly: `scripts/check-egress.mjs` fails CI on a new
  network construct in the desktop app.
- **Nexus contacts nothing by default.** On the first start after 1.5.0 it asks
  once what it may use the network for, and the default — and the fail-closed
  answer — is **Offline only**, in which no connection is opened at all, not
  even a version check.
- **The app requires no online account.** A Nexus "account" is a local,
  passcode-protected set of profiles on your machine; it is not registered
  anywhere and there is nothing to sign up for.
- **No Nexus server exists to send anything to.** No hosted backend has ever
  run, and Nexus has no online service to sign into.
- **Which parts of Nexus may touch the network is a mode of the whole device**,
  not a per-feature setting: the only network exception this product has is the
  update check described below.

## What Nexus stores, and where

Everything the application writes lives under its own data folder. On Windows
that is `%APPDATA%\Nexus`; on Linux it is `~/.config/Nexus`. The **About** card in
Settings prints the exact path for your installation. In a portable build — one
with the `portable.txt` marker beside the executable — that folder is
`NexusData` next to the executable instead, on the USB stick or disk it was
started from.

| What | Where | Encrypted at rest? |
| --- | --- | --- |
| Your notes, tasks, calendar, documents, study cards, finances, habits, focus sessions and the rest | One database per local account: `accounts/<accountId>/nexus.db` | **Yes** — SQLCipher, opened with a raw 256-bit key |
| Everything kept as a file rather than a row: attachments on notes and tasks, document previews, and your profile picture | `accounts/<accountId>/blobs/` | **Yes** — an AES-256-GCM container per file |
| The list of local accounts, as the lock screen shows it (names and creation dates) | `accounts.json` | No, deliberately: the lock screen lists these before anything is unlocked |
| The key chain: your data key wrapped under your passcode and under the Recovery Kit, with the salts and parameters the wrap needs | `accounts/<accountId>/keychain.json` | Wrapped; the copy of the wrap added to the OS keystore is encrypted by the OS |
| The network mode, and whether you allowed the update check | `network.json` | No — it is a preference, not data |
| When the last update check ran | `updates/last-check.json` | No — a timestamp |
| Device preferences: theme, accent, language, week start, calendar view, and the in-progress onboarding questionnaire | Chromium's own storage for the app (its profile data) | No — preferences only, never content |
| A decrypted copy of a file you asked to open in another application | `accounts/<accountId>/tmp-open/` | No — it is the plaintext file the other application needs. It is deleted when Nexus locks and swept again at the next start |

Nothing else is stored. The application keeps **no record of the window's
position or size**, and it writes **no log file**: diagnostics go to the
developer console, not to a file beside your data.

## What leaves the machine

**Offline only (the default).** Nexus makes no network call of any kind. This is
enforced where a packet would have to pass, not by a setting somebody checks:
every request whose scheme is not local is cancelled, the proxy is pointed at a
dead loopback port, DNS is mapped to `NOTFOUND` at the Chromium command line,
and the spellchecker (the one client Chromium runs without being asked) is off.
See `apps/desktop/src/main/net/offline.ts`.

**Offline + update checks.** Nexus contacts GitHub, and only GitHub, for one
purpose: checking for and downloading a new version of Nexus itself. The
connection is limited to three hosts, matched exactly, over `https` and nothing
else:

- `api.github.com` — the release API the check reads;
- `github.com` — the release download URL the API names;
- `release-assets.githubusercontent.com` — where GitHub redirects a release
  asset.

The check itself is a single `GET` of
`https://api.github.com/repos/lukastojiljkovic/Nexus/releases/latest` with the
two headers GitHub's API asks for (`Accept: application/vnd.github+json` and
`X-GitHub-Api-Version: 2022-11-28`). As with any HTTP request, GitHub also sees
the device's IP address and the user agent the request went out with. **Nothing
about your notes, your files or your settings is in that request or in any
other.** The automatic check runs at most once a day, and a check downloads the
release description and nothing else — an installer is fetched only after you
press Install.

**In either mode there is no telemetry, no analytics, no crash reporting and no
update channel.** No dependency provides one, no code implements one, and the
egress gate above would fail CI on the first network construct added to the app.

## Update checks

Nexus asks the network question once, on the first start after 1.5.0, of a new
installation and of a device upgrading from an older version alike, because no
earlier version ever recorded a choice. The question is asked before any
account is unlocked.

**Offline only (the default).** No network call. A device that has never
answered the question, or whose answer is missing or unreadable, is in this
mode — "I could not tell" and "it is off" are the same outcome.

**Offline + update checks.** Only the update check described above.

You can change the mode at any time in **Settings → Privacy → Network and
updates**. The change takes effect after a restart, because the network boundary
is installed while the application is starting; that is a property of the
boundary, not an inconvenience to be removed later.

## Backups and exports

- **A manual export** writes a portable archive to the path you choose in the
  system save dialog. You can protect it with a passphrase at creation time, in
  which case the archive is sealed under a key derived from it (Argon2id). If
  you leave the passphrase empty, the archive is a plain file — that is a
  deliberate, confirmed choice, and the copy is then no better protected than
  the folder you put it in.
- **A scheduled backup** copies the same archive to a folder you choose, and it
  is always encrypted: a schedule cannot ask for confirmation, so this surface
  has no plaintext branch at all. The passphrase is stored wrapped under your
  data key and is only readable while the application is unlocked.
- **Neither form is sent anywhere.** Both are written to a location you named,
  on this device or on a drive you mounted.

## Retention and deletion

- **Deleting a local account** from the application erases that account's
  directory — its database, its attachment store and its key chain — after
  offering an export. It is immediate, and there is no grace period and no undo.
- **Deleting a note, a task or another record** removes it from your database.
  Whether a previous version is kept inside the file is a property of SQLite's
  own page handling, not a feature of Nexus: the application does not maintain a
  server-side copy of anything, because there is no server.
- **Uninstalling** the application does not delete your data folder. The
  uninstaller offers to remove it and keeps it by default.

## Your rights, and the law

Everything you put into Nexus stays on your device. **No personal data reaches
anybody**: there is no controller and no processor, because nothing is
transmitted. If you are in the EU or in Serbia, that also means there is no
transmission of your personal data to exercise a right about; the remedies you
have are the ones your local law gives you over your own equipment.

Nexus is not "in the cloud", and there is no Nexus service to sign into.
Should Nexus ever offer an online service, this document will name the
controller, the hosting region and the retention window **before** that release,
not after.

Requests about personal data, and questions about this document, go to
**stojiljkovic.d.luka@gmail.com**.

The supervisory authority in Serbia is the **Poverenik za informacije od javnog
značaja i zaštitu podataka o ličnosti** (Commissioner for Information of Public
Importance and Personal Data Protection), <https://www.poverenik.rs/>.

## Changes to this document

Every material change gets an entry in [CHANGELOG.md](CHANGELOG.md) and a new
"last updated" date here. If telemetry is ever added — it is not planned, and it
would change the first paragraph of this document — it would have to be opt-in
and this document would have to say so **before** the release that adds it.
