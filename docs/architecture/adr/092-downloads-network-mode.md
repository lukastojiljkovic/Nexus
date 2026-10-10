# ADR-092 — the third network mode, „downloads", and the download service

**Status:** accepted (2026-10-09) · **Owner:** founder · Amends
[ADR-089](089-network-mode-and-update-check.md)

## 1. The finding

Nexus can hold an offline Wikipedia, a map, a pack of material — that is the
point of an offline-first app — and until now the only way to get such a file in
was to leave Nexus: download it in a browser, then import it. The mode that lets
the app reach the network for itself, `"updates"`, is exactly the wrong shape
for that job: it may reach three GitHub hosts, and only to fetch a release
installer of Nexus. So a user who wanted a pack had two bad answers — turn the
network off and move the file by hand, or reach for a mode whose copy promises
something else entirely.

Two things were missing, and they are different things: a mode that says what it
allows, and a service whose guarantees are about BYTES rather than about a
version string. A release asset arrives from Nexus' own release workflow and its
SHA-256 is listed in a file signed by a key compiled into the binary. A content
pack arrives from a third party, may be hundreds of megabytes, may be paused,
and has one fingerprint the caller already knows. Sharing the updater's
pipeline with that would have meant loosening every one of the updater's rules.

**„Offline only" is untouched.** The four layers in `net/offline.ts` are
unchanged, the renderer's session keeps an empty allowlist and a dead proxy, and
the renderer's request rule — `isRequestAllowed` — still takes no network mode
at all, which is what keeps the third mode from widening what a renderer can
reach.

## 2. The decision

**`NetworkMode` gains a third member: `"offline" | "updates" | "downloads"`.**

`userData/network.json` holds `{"version":1,"mode":"downloads"}`. **The version
does not move**, and that is the point ADR-089 wrote the field for: it describes
the file's SHAPE, the shape did not change, and a build that predates the mode
reads such a file as „no valid choice recorded" and asks the question again —
the same fail-closed answer it gives any file it cannot trust.

**The three modes are ordered, and each is a superset of the one before.**
`"downloads"` allows everything `"updates"` allows, plus a download the user
starts. The order is what makes the choice explainable in one sentence on a
screen a person meets once, it is why the third mode costs the update check
nothing, and it is why a fourth mode will not have to re-decide the three that
exist. In code it is two predicates, `modeAllowsUpdates` and
`modeAllowsDownloads`, and every guard reads one of them rather than comparing
against a mode name.

**The mode is fixed per launch, in both directions.** Layer 3 of the boundary
(`host-resolver-rules`) is a Chromium command-line switch, so the mode a process
came up under is the mode it keeps; `networkModeRequiresRestart` answers `true`
for any change, and the settings card says so. The mode a launch may ACT on is
`activeNetworkMode(running, stored)`: while the stored choice and the launch
disagree, the launch behaves as `"offline"`, because until the restart nothing
has been re-derived. Switching DOWN to offline therefore takes effect at once
and switching up waits — the asymmetry ADR-089 chose, kept.

**The host rule is two compiled-in lists and one function over them.**
`UPDATE_HOSTS` is ADR-089's three hosts. `DOWNLOAD_HOSTS` is the list a download
may reach; **for now it is the same three hosts**, and a later run appends the
content hosts after researching them. Adding a host is one line in that array,
and two tests make that line safe: every entry is a bare lower-case host name
(no scheme, no port, no path, no wildcard), and `UPDATE_HOSTS` is a subset of
`DOWNLOAD_HOSTS` — a download list that had drifted narrower would take the
update check away from a user who chose the wider mode.

`isHttpsHostAllowed(url, hosts)` is the whole rule: **https only, and the host
matched exactly** — `parsed.host`, so `api.github.com:8443` is refused, and an
equality test against the list, so `evil-api.github.com` and
`api.github.com.evil.tld` are refused too. No wildcard, no subdomain rule, no
runtime re-derivation. `isSessionRequestAllowed(mode, url)` is that function
over `allowedHostsFor(mode)`: nothing in `"offline"`, the update list in
`"updates"`, the download list in `"downloads"`. Both the session's
`onBeforeRequest` and the resolver's `EXCLUDE` list read the same constant, so
the two cannot drift into admitting different names.

**One dedicated session, not one per feature.** The non-persistent, directly
connected session ADR-089 created (`session.fromPartition("nexus-update")` — the
partition keeps its name, this is its second tenant) serves both modes, with its
`onBeforeRequest` rule read from the launch's mode. Direct mode is still what
keeps `host-resolver-rules` in force for it: with a proxy configured, Chromium
hands the proxy the host name and never consults the resolver. In `"offline"`
the session is as dead as the renderer's — every request cancelled before the
allowlist is consulted — rather than merely unused.

**No renderer sends a URL, and the IPC this ADR adds is one value.** The third
mode crosses the existing `network:set-mode` channel, validated by
`asNetworkMode` against `NETWORK_MODES`; the choice screen and the „Mreža i
ažuriranja" card offer it, and the copy says what it allows rather than what it
might one day do. There is no channel through which a renderer could name a URL,
a host, a size or a hash.

## 3. The download service

`apps/desktop/src/main/download/service.ts` (the decisions) and
`electron.ts` (the session's `fetch`, as a port). Like `update/service.ts`, the
service imports no Electron: the mode, the URL rule, the transport, the
free-space reading and the progress sink all arrive as functions, which is what
makes the interesting half testable against a server on loopback.

Every guarantee is enforced in that module rather than promised in copy:

1. **It runs only in `"downloads"`.** Every entry point asks its `mode` function
   first and refuses with the code `"mode"` in the other two, so a caller that
   somehow reached the service in „Offline only" gets no request at all.
2. **Only allowlisted https URLs are requested, on every hop.** The service
   consults the rule before each request AND before following a `Location`, so a
   redirect into a foreign host is refused mid-chain with nothing sent to that
   host.
3. **No download without an expected SHA-256.** A request without a well-formed
   one is refused with `"hash-required"`, the digest is computed WHILE the file
   is written, and it is compared before the file is handed over.
4. **A size limit the caller sets.** A declared `Content-Length` over the cap is
   refused before the body is read; the running total is checked on every chunk,
   because a declared length is a number a server can simply get wrong.
5. **Space is checked before a byte is asked for**, bounded by the caller's
   limit — the most this download may ever store — because the reply's own size
   is not known until it arrives.
6. **Nothing partial survives a failure**, except a PAUSED download, whose
   staging file is exactly the resume point. A verified file is renamed from
   `<id>.part` to `<id>` and handed back by path; every other ending removes the
   staging file.
7. **At most two downloads at once**, counted over downloads actually in
   flight; a third is refused with `"busy"`.

**Resume is HTTP `Range`, and restarts cleanly when it cannot be used.** A
paused download keeps its file, its byte count, its hash state and the reply's
validator; a resume asks for `Range: bytes=<n>-` with `If-Range` naming that
validator. A `200`, a `416`, a `Content-Range` that does not start where this
process stopped, or a validator that changed all mean the same thing — the
partial cannot be appended to — so the file is truncated and the whole body is
written again, with the hash restarted alongside it. A hash over two different
replies would be a hash of nothing.

**Why two, and why the id is the caller's.** Two is the number a person can keep
in mind while watching progress, and a pack is large enough that a third
simultaneous download on a home connection is slower than doing them in order.
The id is the caller's so a manifest can name a download after what it is, and it
is validated as an id (letters, digits, `_`, `-`, at most 64) because it becomes
a file name in the app's own staging directory.

## 4. What this ADR does NOT do

Said plainly, because a document that only lists what exists stops being true:

- **No content host is added.** `DOWNLOAD_HOSTS` is the three update hosts, and
  a later run appends the content hosts after researching them.
- **No surface starts a download.** The mode is the whole of this ADR's IPC; the
  screen that offers a pack arrives with the hosts it would download from. The
  copy added in both locales is written to fit that: it says downloads happen
  only when the user starts one, and it names no content.
- **`apps/desktop/src/main/download/electron.ts` has no caller yet**, for the
  same reason. It is written now rather than by that caller, because the
  alternative is that caller inventing its own socket, and its one subtle
  decision — `redirect: "manual"`, so the service rather than Chromium decides
  which hop is allowed — is a decision, not plumbing.

## 5. Consequences

- **`PRIVACY.md` and `SECURITY.md` owe four sentences**: that the third mode
  reaches the same kind of addresses as the second plus the addresses of any
  download the user starts; that a download runs only when the user starts one;
  that the reachable addresses are compiled into the binary rather than fetched;
  and that a downloaded file is checked against a fingerprint before Nexus uses
  it. The user-facing copy in `strings.sr.ts` / `strings.en.ts` already says the
  second of those, and no more than that.
- **`update/allowlist.ts` is folded into `net/offline.ts`.** Its rule
  (`https` plus the exact host) is now `isHttpsHostAllowed`, read by the
  mode-aware `isSessionRequestAllowed`; a second copy of it would have been a
  second place for the next mode to get it wrong. The update tests moved with
  it, into `offline.test.ts`, which is where the host lists and the resolver
  rule already live.
- **The About row keeps its meaning.** `updatesActive` is true in `"downloads"`
  because the modes are a superset chain, so a user who chose the wider mode is
  not silently denied the version check.
- **`check:egress` gains exactly one exemption**, for
  `apps/desktop/src/main/download/service.test.ts`, whose one flagged construct
  is `node:http` — the loopback server the service's wire behaviour is tested
  against. The service itself reaches the network through the same session
  `ses.fetch` the update check uses, which the gate already allows.
- **The screenshot harness is unaffected**: it answers the choice screen by
  selecting `value="offline"` and records the default in its sandbox, so a third
  radio does not move it.

## 6. Alternatives rejected

- **A boolean `downloadsAllowed` beside the mode.** Two switches that can
  disagree, and no way to say what the second one means without the first.
- **A second file, `downloads.json`.** The mode is one device-level decision
  about what may reach the network; splitting it across two files is how the two
  halves end up disagreeing about the same launch.
- **Fetching the host list, or reading it from the manifest.** A list that
  arrives over the wire is a list an attacker can extend, and the whole point of
  the mode is that the set of reachable names is a fact about the binary.
- **Letting the renderer pass the URL.** ADR-089 refused `openExternal(url)` for
  the phishing primitive it is; a URL the renderer may hand main to FETCH is the
  same primitive with the network attached. Callers in main pass URLs that came
  out of a signed manifest.
- **Downloading first and verifying later.** The verification must happen before
  the bytes are used, and the only place that can be true is the write itself —
  hence the digest computed while writing rather than read back afterwards.
- **Appending to a partial file whenever the server offers a `206`.** A `206`
  says the server is willing to send a range; it does not say the file behind
  the URL is the one the first attempt saw. Hence `If-Range` plus the local
  check that the reply starts exactly where this process stopped.
- **A third Chromium session, or one per download.** Sessions are cheap but the
  rules over them are not: three sessions would be three places to state which
  mode reaches what, and the mode-dependent rule is one function over one list.
