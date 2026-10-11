# Security policy

Nexus is a desktop application that keeps your data on your own device,
encrypted at rest, and contacts nothing unless you allow it to check for updates
of Nexus itself. There is no server to compromise and none to defend. Security
reports are welcome and are taken seriously.

## Supported versions

The current release line is **1.5.x**. The latest release is supported, and so
is the release before it for as long as it is the previous minor.

| Version | Supported |
| --- | --- |
| `1.5.x` (latest release) | Yes |
| `1.4.x` (previous minor) | Yes |
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

- **Encryption at rest and key handling** — the passcode-derived local data key,
  the key chain that wraps it, the Recovery Kit, the private-notes credential,
  the attachment containers, the archive format, and anything that would expose
  a key to a process, a log or a backup that should not see it.
- **The main/renderer boundary** — the IPC channel allowlist, the preload
  bridge, the per-field validators in the main process, and the renderer's
  sandbox settings (`contextIsolation`, `sandbox`, `nodeIntegration`).
- **The SQL stores and migrations** — `packages/db`, including SQL injection,
  cross-profile reads, and a validator that can be walked past.
- **File handling** — preview of untrusted documents, attachment storage, and
  archive import/export parsing.
- **The network boundary** — the two network modes, the request allowlist, the
  resolver block, and anything that would let a build in **Offline only** open
  a connection.
- **The update channel** — the pinned hosts, the release-asset URL check, the
  signature over the checksums, and anything that would let a party other than
  the pinned repository have an installer run.

## What is out of scope

- A compromised operating system, or a device an attacker already controls.
- Data you exported yourself: an archive, a CSV, a PDF copy of a note. Export
  is a deliberate plaintext path unless you give the archive a passphrase.
- Physical access to an unlocked device, or someone who knows your passcode.
- The absence of code signing, which makes Windows show a SmartScreen warning on
  first run. That is a known state of the project, not a vulnerability.
- A report about a third-party dependency that does not demonstrate an impact on
  Nexus.

## The security model

### Encryption at rest, and the keys

Everything a local account holds lives in one SQLite database, opened through
SQLCipher with a raw 256-bit key. The key is not stored beside the database: the
key chain keeps it wrapped twice — once under a key derived from your passcode,
once under a key derived from the Recovery Kit code — while the passcode-derived
wrap additionally mixes in a device secret that is itself encrypted by the
operating system's key store (DPAPI on Windows), which is what binds the key
chain to this machine. The passcode is stretched with Argon2id and the wraps are
AES-GCM, so a wrong passcode or a tampered key chain fails to open rather than
opening to something else. The failed-attempt counter and its lockout live
inside that OS-protected blob too, so a text editor cannot reset the throttle.

Attachments and processed images are stored as their own AES-256-GCM containers
in a content-addressed store, keyed from the same data key, so a blob copied out
of the folder is not readable without it.

### Electron hardening

The renderer is untrusted. It runs with `contextIsolation` on, `sandbox` on and
`nodeIntegration` off, it reaches the main process only through a frozen,
one-method-per-channel preload bridge, and every payload is validated in main
with a per-field validator before it is used. Navigation is denied and no window
may be opened. At packaging time the app's Electron fuses are set so the
executable cannot be started as a Node interpreter, cannot take `NODE_OPTIONS`
or `--inspect` from the environment, encrypts cookies through the OS key store,
verifies the asar archive's SHA-256 at load, and will not load an app directory
beside the executable.

### The network boundary

There are two modes, chosen once for the device, and the default is the strong
one.

**Offline only** installs four independent layers: every request whose scheme is
not local is cancelled, the proxy points at a dead loopback port, DNS is mapped
to `NOTFOUND` at the Chromium command line, and the spellchecker is off and
pointed at a `file:` base. The resolver rule is a command-line switch, so it
cannot be lifted at runtime, and that is why a mode change requires a restart.

**Offline + update checks** admits exactly three `https` hosts — `api.github.com`,
`github.com` and `release-assets.githubusercontent.com` — matched exactly, with
no wildcard and no subdomain rule, for the release API and the release download
URLs it names. That session is the only network client a shipped build can
reach: the cloud path has one of its own — the single `net.fetch` call site in
`apps/desktop/src/main/sync/electronFetch.ts`, which `check:egress` pins there —
and it is unreachable while cloud is off (see the last section).

### Update verification

The updater reads the release API of the one pinned repository over `https` and
accepts an asset only under that repository's release-download path, with no
`userinfo`, no port, no query and no fragment. Before an installer runs, the app
downloads `SHA256SUMS.txt` and its detached **Ed25519 signature**, verifies the
signature against a public key compiled into the binary, checks the installer's
SHA-256 against the signed list, and hashes the file a second time immediately
before launching it. Anything that does not verify is deleted and never run.
Replies are read under size caps and deadlines, so a hostile server cannot make
an installed copy allocate without bound.

### Build provenance

Releases are built by CI from a tag whose version matches the application's own,
with every action pinned to a commit SHA and no dependency cache. The installer
artifacts are checksummed and signed by a separate job that runs no project
tooling, and the release is created as a **draft** for a human to inspect before
it is published. A CycloneDX SBOM and the third-party notices are attached to
each release, and the build carries a GitHub build-provenance attestation, so
`gh attestation verify <file> --repo lukastojiljkovic/Nexus` answers which commit
and workflow produced a binary. Code signing is deliberately not done yet, which
is why Windows warns on first run; that is a known limitation of the release,
not a property of the code.

### Sync, cloud and the web app are on hold

The sync and cloud work — `packages/sync-*`, `apps/desktop/src/main/sync/` and
the Supabase migrations under `supabase/` — still exists in the tree and is
still built and tested, but it is **on hold since 2026-10-08, off by default and
not shipped as a feature**: no screen in this build can turn it on, no hosted
backend exists, and the app is not distributed with a project configured for
one. Those modules and the server migrations are not part of the threat model
above because they are not reachable in the shipped product; a report about them
is still welcome, since the code is meant to be correct the day it is turned
back on.

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

Three source-level guarantees you may want to test yourself, because they are
mechanical rather than promises:

- **A local-only build cannot reach the network.** `scripts/check-egress.mjs`
  fails CI on any new network construct, and the runtime assertion lives in
  `apps/desktop/src/main/net/offline.ts`.
- **A local-only build cannot be configured into one that can.** The network
  mode is read once per launch, the switch is fail-closed on every kind of
  doubt, and a change requires a restart — see the same file.
- **A command line is never data.** `scripts/check-runner.mjs` names every file
  in the app that may start a process and enforces the same rules on each: no
  shell, no exec-family call, and no command assembled from data.
