# ADR-056 — Scheduled encrypted backups (SET-011; migration 044, no interchange change)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:**
SET-011, design delegated by the founder (batch answer 15: "kako ti mislis
tako uradi").

## 1. Shape: the manual export, on a clock, never weaker

A scheduled backup is the EXISTING full encrypted export (ADR-022 NXA1,
`buildExportArchive` + the manual flow's writer) run by main on a schedule.
Nothing new is invented at the crypto or archive layer, and two things are
non-negotiable:

- **Encrypted only.** SEC-DAR-02 allows plaintext only behind an explicit
  per-export confirmation; a schedule cannot confirm, so a schedule cannot
  write plaintext. There is no toggle to the contrary.
- **Only while unlocked.** The data key exists only in an unlocked session;
  a locked app cannot read, so it cannot back up. Missed slots are CAUGHT UP:
  on every unlock (and profile switch to the scheduled profile) main checks
  `last_run_at` against the cadence and runs immediately if overdue, then
  keeps an interval check while unlocked.

## 2. The passphrase: set once, wrapped under the data key

Enabling the schedule asks for an archive passphrase ONCE (manual export's
rules verbatim: 12-char minimum, same strings). Main wraps it AES-256-GCM
under the profile's data key and stores the wrap in the settings row —
plaintext never touches disk, and the schedule can run without asking. The
archive stays independently readable anywhere with the passphrase alone (the
ADR-022 property). Consequences stated in the card's copy, not hidden: a lost
passphrase is unrecoverable archives; changing the passphrase re-wraps for
future runs and old files keep the old one.

## 3. Storage: device-local by design — migration 044, **no interchange bump**

`backup_settings` (singleton per profile, `dashboard_settings` pattern):
`profile_id` PK/FK · `enabled` · `cadence` CHECK IN ('daily','weekly') ·
`folder_path` TEXT · `passphrase_wrapped` BLOB · `keep_last` INTEGER CHECK
2..50 DEFAULT 5 · `last_run_at` TEXT NULL · `last_status` CHECK IN
('ok','failed') NULL · `last_error` TEXT NULL · timestamps.

This table is **excluded from the export archive AND from the restore wipe
list** (the wipe-list guard test gets the justification comment): an absolute
folder path is meaningless on another machine, and the wrap opens only under
this account's data key — so the row is a fact about THIS device's routine,
and a restore deliberately does not touch it (the device keeps backing up
right through a restore, which is exactly when backups matter most).

## 4. Mechanics

- **Folder**: native directory picker in main (the house pattern); the row
  stores the absolute path. An unreachable folder at run time = a failed run
  with a named error, never a crash, never a fallback location (writing
  somewhere the user did not choose is worse than not writing).
- **Filename**: the manual export's naming with an `auto` marker and a sortable
  UTC stamp — `nexus-auto-<profil-slug>-<YYYYMMDD-HHmmss>` + the manual flow's
  exact extension. Sortable names make retention trivial and human-auditable.
- **Retention**: after a successful run, delete oldest files IN THAT FOLDER
  matching OUR OWN `nexus-auto-<this-profile-slug>-*` pattern beyond
  `keep_last`. Never anything else — not manual exports, not other profiles'
  files, nothing unmatched.
- **Concurrency/failure**: one run at a time (a module-level in-flight guard);
  write to a `.partial` name and rename on success so a crash never leaves a
  plausible-looking truncated archive; any error lands in
  `last_status/last_error` and the Settings card shows it („Poslednja rezervna
  kopija: nije uspela — <razlog>"). No notification-center entry in v1
  (recorded: the card is the surface; promote to a notification only if the
  founder asks).
- **Settings UI**: the „Rezervna kopija" card grows a „Automatska rezervna
  kopija" block — enable + cadence segmented (Dnevno/Nedeljno), folder row
  with picked path, keep-last select, passphrase set/change (never displayed),
  last-run status line. settingsSearch entry („automatski", „backup",
  „rezervna").

## 5. Consequences

- Zero interchange change, zero renderer crypto, zero new deps.
- A profile restored onto a DIFFERENT account/machine starts with no schedule
  — correct, since neither path nor wrap would be valid; the card simply shows
  the feature off.
- The catch-up check runs at unlock, when the user is present — so even a
  laptop that only wakes for ten minutes a day converges on one backup per
  cadence window.
