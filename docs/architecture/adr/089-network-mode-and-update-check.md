# ADR-089 — a network mode and an opt-in update check

**Status:** accepted (2026-10-07) · **Owner:** founder

This ADR meets [SEC-EL-07](../../security/baseline.md)'s update clause — TLS plus
cryptographic signature verification — with a pinned Ed25519 key, and it replaces
1.4.0's rule of keeping auto-update disarmed until releases were
Authenticode-signed. SEC-EL-07's first clause, that releases are code-signed, is
unchanged and stays open under DEV-008.

## 1. The finding

The product promised two things that had begun to contradict each other in the
hands of a user.

1. **„A user who never turns cloud on is running the local-only product."** That
   is a structural guarantee: `net/offline.ts` installs a request allowlist, a
   dead proxy, a resolver block and a spellchecker shutdown, and the strongest
   of the four is the resolver, which is a Chromium command-line switch fixed for
   the life of the process.
2. **„The app updates itself."** The 1.4.0 tree SHIPPED `electron-updater` as a
   dependency but never called it: the auto-update section in
   `apps/desktop/src/main/index.ts` was disarmed, because the path it would have
   taken was a live remote-code-execution hole in a shipped build —
   `checkForUpdatesAndNotify()` defaults to `autoDownload: true` and
   `autoInstallOnAppQuit: true`, and the build is unsigned, so electron-updater's
   Windows Authenticode check compares the installer's publisher against an
   absent `publisherName` and RETURNS AS THOUGH IT PASSED. 1.5.0 removes the
   dependency: a shipped dependency that is never called is still supply-chain
   surface.

The first promise is what makes the second worth doing carefully; the second is
what makes the first a choice rather than a constraint. A user who wants updates
must be able to say so, and a user who does not must never be reachable by a
packet.

The condition that kept the updater disarmed was **Authenticode**. That is a
vendor-identity control: it says a certificate authority believes the binary is
ours. It is the right answer to „is this file really from Nexus", and it is not
the threat that matters most here — a stolen GitHub token or a compromised feed
repository produces a release that is signed by us and hostile.

## 2. The decision

**A device-level network mode, chosen on first start, defaults to offline, and
is changeable in Settings.**

`userData/network.json` holds `{"version":1,"mode":"offline"|"updates"}`. It sits
beside `cloud.json` and is read in the same pre-`ready` path, for the same
reason: the boundary is installed while the app is starting, before any account
is unlocked, so the answer cannot live inside an encrypted profile database.
Missing, unreadable, malformed or of an unknown version means **offline and
„no valid choice recorded"** — fail closed, parsed the way `readCloudSwitch` is.
The `version` field exists so a third mode (a future `"cloud"`, say) can be
added by teaching the parser about it rather than migrating every device.

**„Offline only" is byte-for-byte the 1.4.0 boundary.** `host-resolver-rules`
stays `MAP * ~NOTFOUND`; the renderer's session keeps an empty request allowlist
and a dead proxy; the spellchecker stays off. Nothing in this ADR adds a request
the renderer can make.

**„Offline + update checks" is the smallest exception that works.** Four things
stay exactly as they are in offline mode, and one changes:

- The renderer's session is not touched. Its `webRequest` list stays empty and
  its proxy stays dead.
- A **dedicated, non-persistent session** (`session.fromPartition("nexus-update")`)
  carries the update traffic, using its own `fetch`. Its `onBeforeRequest`
  admits **https only, and only three hosts, matched exactly**:
  `api.github.com`, `github.com`, and `release-assets.githubusercontent.com`.
  No wildcard, no subdomain rule. It also cancels **every** request unless the
  launch came up in „Offline + update checks", so in offline mode the session is
  as dead as the renderer's rather than merely unused. It connects **directly**
  rather than through the system proxy: a proxy is handed the host name and
  never consults the resolver, so direct mode is what keeps the rule below in
  force for this session.
- `host-resolver-rules` becomes `MAP * ~NOTFOUND, EXCLUDE <each of those hosts>`.
  The base rule is untouched; the exceptions are named.

The three hosts are the whole of the chain, verified against a real release on
2026-10-07 with `curl.exe -sIL`: `github.com` answers `302` to
`release-assets.githubusercontent.com`, which answers `200`. If GitHub moves its
release assets to another host, the download **fails closed** — the app offers
the release page instead — and the fix is a one-line change to the pinned list,
not a runtime re-derivation.

**The check.** Once a day at startup, plus „Proveri sada" on the About card.
`GET https://api.github.com/repos/lukastojiljkovic/Nexus/releases/latest` with
`Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`.
The version is compared with `app.getVersion()` by a comparison written by hand
in `apps/desktop/src/main/update/version.ts`. Its grammar is exactly
`v?MAJOR.MINOR.PATCH`: no leading zeros, no pre-release and no build metadata,
and a tag that is anything else is refused rather than ordered, because the
product never tags a pre-release and the text order the old comparison used
(`rc.10` below `rc.9`) let a crafted tag pass for newer. `semver` left the tree with electron-updater. A `403`/`429` or a network
failure is silent on the automatic check and reported on „Proveri sada", because
an unasked question on a shared address is not an error the user needs to see.

**Nothing downloads until the user presses Download and install.** The check offers a version
and the release notes, rendered as safe text — never HTML.

**Verification, all required; any failure deletes the file and offers the
release page.** The pinned chain in `update/electron.ts` and `update/service.ts`:

1. `SHA256SUMS.txt.sig` is a detached Ed25519 signature over the exact bytes of
   `SHA256SUMS.txt`, verified with `crypto.verify(null, …)` against the public
   key compiled into the binary (`apps/desktop/src/main/update/releaseKey.ts`).
2. The installer's SHA-256, hashed while streaming, matches its line in
   `SHA256SUMS.txt`.
3. The file is hashed again immediately before launch.

Only URLs under `https://github.com/lukastojiljkovic/Nexus/releases/download/`
are accepted. The installer is written to a generated name under
`userData/updates/` and launched with `shell.openPath`; the app then quits.

**Every fetch runs under a resource cap**
(`apps/desktop/src/main/update/limits.ts`): 1 MiB for the `releases/latest`
reply, 64 KiB for `SHA256SUMS.txt` and its `.sig`, 512 MiB for the installer, a
30-second deadline for the two small requests as a whole, and a 60-second idle
deadline for the installer that aborts it when no chunk arrives. A declared
`Content-Length` over the cap is refused before the body is read, a real body
over it is cancelled the moment it crosses, and a partial installer is deleted
on the failure path.

**Windows installs; Linux opens the release page.** The Windows asset is
`Nexus-Setup-<version>.exe`. An AppImage or a tarball has no self-install path,
so the offer is the release page.

## 3. Why a pinned Ed25519 key, not Authenticode, gates updates

SEC-EL-07 asks for three things: releases are code-signed, they travel over TLS,
and updates are cryptographically verified. This ADR meets the last two:

- **TLS.** Every URL in the chain is https.
- **Cryptographic signature verification of updates.** The Ed25519 key is
  compiled into the binary and verifies a signature over the checksum file; the
  installer is accepted only when its hash appears in that signed file.

The first — code-signed releases — stays a deviation (**DEV-008**). Authenticode
is still required by SEC-EL-07; what changes is that it no longer GATES updates.
It was a *proxy* for the verification clause, and a pinned key is a stronger
control for the threat that actually exists: it survives a stolen GitHub release
token, because the attacker does not hold the private key. On the update path,
Authenticode is **a SmartScreen concern** — a warning-suppression feature, not an
integrity gate. The
`CODE SIGNING GOES HERE` marker in `release.yml` says so, and the two controls
are independent: neither is a prerequisite for the other.

`electron-updater` was removed rather than re-armed because re-arming it would
have meant adopting its defaults (`autoDownload`, `autoInstallOnAppQuit`) and its
own feed format, and then disabling all of that; the updater that replaces it has
no feed and can only ever fetch three hosts. `electron-updater` and `semver` must
not come back (see `apps/desktop/src/main/index.ts`).

## 4. Why upgrading users get the choice screen too

The trigger is „no valid choice is recorded on this device", not „this is a new
install". No version before 1.5.0 ever wrote `network.json`, so a device
upgrading from 1.4.0 is in exactly the state a new install is in, and the
honest thing is to ask.

The screen asks a question; it does not welcome anybody. There is no „welcome to
Nexus", no „let's get you set up", and no copy that reads differently to
somebody with four months of notes. It says what the two modes do, in plain
words, and explains that „Offline only" means no connection at all.

The choice is recorded the moment either option is confirmed. Closing the window
without choosing records nothing, keeps the mode offline, and shows the screen
again on the next start — the file is written by the confirm button and by
nothing else.

## 5. Consequences

- **The choice screen precedes the unlock screen.** Main answers the mode read
  while locked, exactly as it answered `cloud.json`'s.
- **A mode change takes effect after a restart.** The resolver rule is a
  command-line switch read once at launch, so both directions need one. The
  „Mreža i ažuriranja" card in Settings says so and offers the restart.
- **The card is the first card of the „Privatnost" category** (ADR-088's
  information architecture), with search entries, because it is the device-level
  answer to „what reaches the network" and the card below it is the prose.
- **`check:egress` gains exactly one exemption**, for
  `apps/desktop/src/main/update/electron.ts`, whose one flagged construct is
  `shell.openExternal(<the pinned release page>)` — the loader it hands the URL
  to is the user's browser, not this process's network stack.
- **The release workflow signs, in a job of its own.** The `sign` job takes the
  installers from the build jobs by the artifact IDs they reported, writes
  `SHA256SUMS.txt` itself and signs that, so no other job can put a file in
  front of the key. The list covers the installers only; the notices and the
  SBOM (`pnpm sbom`, from the lockfile) are covered by the build-provenance
  attestation. No release job restores a cache, so nothing an earlier run saved
  reaches a signed build. The job runs in the `release` environment, which holds
  `NEXUS_RELEASE_SIGNING_KEY` and admits `v*` tags only. It fails when the key is missing, and it verifies the
  signature against the committed public key before uploading, so a secret that
  does not match the key in the app can never ship a release every installed
  copy would reject.
- **The screenshot harness records the default choice** in its sandbox, so a
  sweep photographs the app rather than a question.

## 6. Alternatives rejected

- **Authenticode first, updates later.** Waiting for a certificate makes the
  integrity control depend on a vendor-identity control that answers a different
  question, and leaves the product unable to update itself in the meantime.
- **Re-arming electron-updater with `autoDownload: false`.** It keeps a feed
  format (`latest*.yml`) and a client whose defaults are the hazard; the app
  would still be one missed option away from fetching and running an installer.
- **A boolean `updates.json`.** A boolean cannot gain a third mode without a
  migration, and the product already knows a cloud mode is coming.
- **Letting the renderer open the release page with a URL it supplies.** The
  open-release channel takes no argument: a renderer that can hand main a URL to
  open has been handed a phishing primitive.
- **Hashing without the signature.** A checksum over a file fetched from the
  same place as the file defends a truncated download, not a compromised
  release.
