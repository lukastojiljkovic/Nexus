# Security policy

Nexus keeps your data on your own device by default, encrypted at rest. If you
choose to turn sync on, the server holds ciphertext and never the content
itself. Security reports are welcome and are taken seriously.

## Supported versions

The current release line is **1.4.x**. The latest release is supported, and so
is the release before it for as long as it is the previous minor.

| Version | Supported |
| --- | --- |
| `1.4.x` (latest release) | Yes |
| 1.3.x and earlier | No — no release line before 1.4 has been published |
| `main` (development) | Not supported, but fixes land here first |

## Reporting a vulnerability

Use **GitHub private vulnerability reporting**:

<https://github.com/lukastojiljkovic/Nexus/security/advisories/new>

That is also reachable through the repository's **Security** tab, under
**Report a vulnerability**. Please do not open a public issue for a security
problem; a public issue is a working exploit notice for everyone running the
app.

Private vulnerability reporting is enabled on this repository. If GitHub is not
a route you can use, email **stojiljkovic.d.luka@gmail.com** instead.

A useful report contains the affected version or commit, the platform, what you
did, what happened, and a proof of concept if you have one. A report that says
"this looks wrong" is still worth sending.

## What is in scope

- **Sync cryptography and protocol** — `packages/sync-crypto`,
  `packages/sync-transport`, `packages/sync-engine`, and the server migrations
  under `supabase/`. In particular: key wrapping and recovery, the pairing
  exchange, the ciphertext format, and anything that would let a server or a
  network attacker learn plaintext or forge a row.
- **Key handling** — the passcode-derived local data key, the master sync key,
  the Recovery Kit, and anything that would expose a key to a process, a log, a
  crash report or a backup that should not see it.
- **The main/renderer boundary** — the IPC channel allowlist, the preload
  bridge, the per-field validators in the main process, and the renderer's
  sandbox settings (`contextIsolation`, `sandbox`, `nodeIntegration`).
- **The SQL stores and migrations** — `packages/db`, including SQL injection,
  cross-profile reads, and a validator that can be walked past.
- **File handling** — preview of untrusted documents, attachment storage, and
  archive import/export parsing.
- **The update channel**, once one exists — today auto-update is deliberately
  disarmed.

## What is out of scope

- A compromised operating system, or a device an attacker already controls.
- Data you exported yourself: an archive, a CSV, a PDF copy of a note. Export
  is a deliberate plaintext path.
- Physical access to an unlocked device, or someone who knows your passcode.
- The absence of code signing, which makes Windows show a SmartScreen warning on
  first run. That is a known state of the project, not a vulnerability.
- A report about a third-party dependency that does not demonstrate an impact on
  Nexus.

## What to expect

Nexus is maintained by one person, in their own time. There is **no service
level agreement and no bug bounty**, and there is no fund behind one. Reports
are read as soon as possible, and a security report is always read before
anything else. If it has been a while and you have heard nothing, a second
message is welcome rather than rude.

## Disclosure

Please give a fix a chance before writing publicly about the issue. Once a fix
is out, the finding is described in the release notes, and you are credited by
name or handle if you want to be.

## How the guarantees are enforced

Two source-level guarantees you may want to test yourself, because they are
mechanical rather than promises:

- **A local-only build cannot reach the network.** `scripts/check-egress.mjs`
  fails CI on any new network construct, and the runtime assertion lives in
  `apps/desktop/src/main/net/offline.ts`.
- **A command line is never data.** `scripts/check-runner.mjs` enforces the
  rules around the one capability that starts a process, the Electronics ROS 2
  runner.

