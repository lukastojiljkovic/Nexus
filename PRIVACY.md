# Privacy

**Last updated:** 2026-10-02

Nexus is built so that the answer to "what does this app send?" is short, and so
that the short answer can be checked in the source rather than believed.

## The short version

- Everything you write lives in **one encrypted database on your own device**.
- **There is no telemetry, no analytics and no crash reporting.** None is built,
  and none can be added quietly: `scripts/check-egress.mjs` fails CI on a new
  network construct in the desktop app.
- **Cloud is off by default.** A user who never turns it on is running the
  local-only product, and the local-only path cannot reach the network at all —
  that is a runtime assertion in `apps/desktop/src/main/net/offline.ts`, not a
  setting somebody remembered to check.
- **The app requires no online account.** Local accounts are passcode-protected
  profiles on your machine.
- **In the build you can download today, sync cannot be turned on.** No backend
  project is compiled into it, so the sync screen says there is no server
  configured and every round refuses before making a request. No hosted backend
  exists for this project at all.

## If you turn sync on

Sync is an optional feature for carrying the same data between two devices. It
is end-to-end encrypted: the server stores and returns ciphertext, and the keys
that open it never leave your devices.

**What the server holds, once sync is enabled for an account:**

| What | Why | In the clear? |
| --- | --- | --- |
| Your account email address | Sign-in, and confirming the account | Yes — it is your login |
| A device record: platform, an encrypted device name, a public key, when it was created and last seen, and whether it was revoked | Deciding which sessions may read your data | Mostly no: the name is encrypted; the rest is metadata |
| Your data, row by row: collection name, object id, version, a deleted flag, a nonce and the ciphertext | Moving changes between devices, and resolving conflicts | **No — content is ciphertext** |
| Wrapped keys: the master key wrapped under a key derived from your password, and per-profile content keys wrapped under the master key | Letting a new device open your data without the server ever holding a key that opens it | No — these are wrapped, and the wrapping key is derived on your device |
| Sync bookkeeping: which device has seen which change, per collection | Knowing what a device still needs | Yes — sequence numbers and timestamps, no content |
| Pairing records while a pairing code is live | Connecting a second device | No — opaque values that expire |

**What the server never receives:**

- The content of a note, task, calendar entry, document, photo or attachment —
  those are encrypted on your device before they are sent.
- Your **local data key**, and the passcode that opens it. The local database
  stays local.
- **Your password.** Sign-in sends a value derived from it with Argon2id, not
  the password itself; the password never leaves the client.
- The **Recovery Kit** code, except at the moment you use it to adopt a new
  device.

Metadata in the clear is an accepted trade-off, and it is deliberate: the server
has to be able to route a change and count it. What it cannot do is read one.

## Retention and deletion

- **Local accounts.** Deleting an account from the app deletes its local
  database and key material, after offering an export. This is implemented
  (ADR-048) and it is immediate.
- **A synced account.** The server rows for an account are tied to the account
  itself and are removed with it: every table references the account and
  cascades on delete. **There is no self-service way to delete the server
  account from inside the app today** — that is a gap to close before sync is
  hosted, and it is listed as such in the project's own status notes.
- **Deleting a note or a task** is a soft delete, so the change can travel to
  your other devices. The row stops carrying content the moment it is deleted
  server-side; the ciphertext of the previous version is not kept by this
  project, though a hosting provider's own backups may retain a snapshot for
  the retention window of the plan it runs on.
- **Pairing records** expire ten minutes after they are created, and expired
  ones are cleaned up.

## Your rights, and the law

If you run Nexus entirely locally, **no personal data reaches anybody** — there
is no controller and no processor, because nothing is transmitted.

If a hosted sync service is offered later, the operator of that service is its
controller, and the rules that apply to it are the **General Data Protection
Regulation** (EU 2016/679) and the Serbian **Zakon o zaštiti podataka o
ličnosti** (Personal Data Protection Act, "ZZPL"). This document will name the
controller, the hosting region and the retention window **before** any such
service is offered, not after.

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

