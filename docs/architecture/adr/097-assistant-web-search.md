# ADR-097 — opt-in web search for the assistant

**Status:** accepted (2026-10-10) · **Owner:** founder · Amends
[ADR-092](092-downloads-network-mode.md)'s host rule for one path, and nothing
else

## 1. The finding

The assistant is offline: it answers from the model on the user's disk and from a
knowledge base built out of the user's own notes, tasks, events, files, the
content packs and the app manual. That is the product's promise, and it is also
its limit — a user stranded in nature waiting for a helicopter may want to know
today's weather warning, and a user reading about a topic may want the source a
pack was summarised from.

Luka's decision, on 2026-10-10, is one sentence: **web search only when the user
turns it on; otherwise the assistant uses local RAG only.** This ADR is that
decision made structural, and web search is the second sanctioned egress path in
the product (the first is the download service, ADR-092).

## 2. The decision

### 2.1 A consent, not a fourth network mode

The switch is **an app-wide setting of its own, off by default**, stored in
`userData/assistant-web.json` beside `cloud.json` and `network.json`:

```json
{ "version": 1, "enabled": false, "searxng": null }
```

Device-level, for `cloud.json`'s reason: the question has to be answerable before
any account is unlocked, and an answer inside an encrypted profile database could
not be read at that moment. It is therefore world-readable and user-writable, and
it is **not** a control against an attacker who is already running as the user; it
is a control against this app, which is the thing that can make a packet.
Missing, unreadable, malformed, of an unknown version, or `enabled` that is not
literally `true` reads as **no consent** — the same fail-closed parse
`readCloudSwitch` and `readNetworkMode` use. The two fields are judged separately
once the record itself is trusted: a bad `searxng` URL turns that one provider off
and leaves the consent exactly as the user recorded it.

**Why not a fourth mode.** The three modes answer "what may Nexus reach ON ITS
OWN, without being asked", and each is a superset of the one before, which is
what makes the first-run question answerable in one sentence. Web search is a
different question - may the assistant fetch a page the USER asked for - and it is
not a superset of anything: a user who wants the assistant to read a Wikipedia
article may not want the app filling its disk with a content pack, and a fourth
mode would have GIVEN them the pack, because a wider mode inherits everything the
narrower one allows. It would also have re-opened the thing the modes are made of:
`allowedHostsFor` returns a compiled-in list, and a search result's host is by
definition not in it.

**The mode still gates it, and the consent is an AND on top.** Web search needs a
mode that allows a connection (`modeAllowsUpdates(mode) || modeAllowsDownloads(mode)`
- the existing predicates, not a comparison against mode names) *and* the user's
consent. "Offline only" stays byte-for-byte the product it was: no mode, no
request, whatever the switch says.

**The switch is read live; the mode is not.** `network.json` is read once at
launch because `host-resolver-rules` is a Chromium command-line switch and the
launch's mode is the mode it keeps. Nothing downstream of the mode has that
property, so the consent is read at call time: a user who turns web search off
stops the NEXT request rather than the next launch, which is the direction the
mistake should fall in.

### 2.2 What a web request may be, and why the gate is not a host list

The one URL rule every request is read through (`web/gate.ts`):

> **https only, and only while the consent is on in a mode that allows a
> connection.**

The rest of the boundary is where a URL is not enough and an ADDRESS is
(`web/target.ts`):

1. **The host is resolved first, and every answer has to be public.** Loopback,
   private (RFC 1918), carrier-grade NAT, link-local (which is where
   `169.254.169.254` lives), the documentation and protocol-assignment blocks,
   multicast, reserved, and the IPv6 equivalents (ULA, link-local, multicast,
   `2001:db8::/32`, the Teredo and 6to4 tunnels, and a v4-mapped address judged as
   the IPv4 address it carries). A name that answers with one public and one
   private address is refused outright - that is what a rebinding attempt looks
   like from here, and picking "the public one" would be picking the answer the
   attacker did not want this time.
2. **An address literal never reaches the resolver.** `https://2130706433/` is
   `127.0.0.1` in decimal and the WHATWG URL parser - the one this check and the
   socket share - normalises it, so the check sees a literal in the hostname and
   judges it directly. The same for `0177.0.0.1`, `0x7f.0.0.1`, `[::1]` and
   `[::ffff:127.0.0.1]`.
3. **A credential in a URL is refused.** `https://wikipedia.org@evil.example/` is
   a citation that names one host while opening another, and nothing in this
   feature needs userinfo.
4. **Every redirect hop is re-checked**, which is why the transport never follows
   one itself (`https.request` simply does not, which is `download/electron.ts`'s
   `redirect: "manual"` stated the other way round). A `302` to `http:`, to
   `127.0.0.1` or to a name that resolves privately ends the chain with nothing
   sent to the host that failed it.
5. **The address is pinned to the connection.** The vetted address is handed to
   `https.request` as its `lookup`, so the name is not resolved a second time
   between the check and the socket; SNI, the `Host` header and certificate
   verification all still use the name.
6. **Bytes and time are capped** (`web/limits.ts`): a declared `Content-Length`
   over the cap ends a request before its body is read, and the running total is
   checked on every chunk - because a declaration is a number a server can get
   wrong, and because a decompressed body has no declared length at all.

### 2.3 The two tools, and what a user is asked

`createWebService(deps): WebService` (`web/index.ts`) returns two tools, both
`effect: "network"`:

| Tool | Parameters | What it returns |
|---|---|---|
| `web.search` | `query`, `provider` (`wikipedia` \| `searxng` \| `brave`, default `wikipedia`), `language` | Titles, https URLs and snippets, capped and fenced |
| `web.read` | `url` | The page's readable text and its title, capped and fenced |

Each call goes through `ToolContext.confirm` with a one-line summary that names
the host and the query (or the URL) - "specific enough to say no to", in the
contract's words. **A refusal is a normal result**: `ok: false`, one sentence, and
no request. The order is deliberate: everything decidable from the URL alone (the
switch, the scheme, a credential, a literal address) is checked BEFORE the dialog,
so a call the gate refuses on its face never asks the user to approve anything;
and a name is resolved only AFTER the user agreed, so no DNS query happens for a
request nobody approved.

**"Allow for this conversation" is NOT offered, and it is not an omission.** The
contract's `ConfirmRequest` has no field for a remembered answer and
`ToolContext.confirm` takes no conversation identity, so a service that offered
one would be inventing a seam the module does not have - and the page, which is
the only part that knows what a conversation is, is built in the next wave. If it
wants a remembered answer, that is a change to the seam and to this ADR, not a
fifth parameter to this factory.

### 2.4 The providers, and the two search engines that are out

**Wikipedia is the default**, because it needs nothing from the user: no account,
no key, no instance, no configuration. It is the search API
(`action=query&list=search`, `formatversion=2`) of the wiki the conversation's
language names (`sr.wikipedia.org`, `en.wikipedia.org`). Wikimedia's User-Agent
policy (https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy) says
"Scripts should use an informative User-Agent string with contact information, or
they may be blocked without notice", and its generic format is "<client
name>/<version> (<contact information>)"; every request this service sends
carries exactly that.

**SearXNG** is whatever instance the user runs or trusts, and it is the answer for
a user who wants general web results without an account anywhere. Its documented
call is `GET /search?q=...&format=json`
(https://docs.searxng.org/dev/search_api.html), and the same page says the thing a
user will actually meet: "Requesting an unset format will return a 403 Forbidden
error. Be aware that many public instances have these formats disabled." A `403`
from an instance is therefore reported as that sentence rather than as a status
code. The instance URL is stored as an https ORIGIN and nothing else - a base
carrying a path would silently become a different endpoint than the one the user
believes they configured.

**Brave Search** is the one that costs money, so it runs only on a key the user
pasted in. The key travels in `X-Subscription-Token` - the header Brave's own
documentation uses
(https://api-dashboard.search.brave.com/app/documentation/web-search/get-started,
where the call is `https://api.search.brave.com/res/v1/web/search?q=...`) - and
NEVER in a URL: a key in a query string is a key in every access log, every error
message and every citation built from the request. It is stored encrypted with
the same device-bound keystore the account key uses (`safeStorage`, DPAPI on
Windows), in a file of its own (`assistant-web-secrets.json`), written atomically
and read fail-closed; when the OS keystore cannot encrypt, the key is REFUSED
rather than stored in the clear. Nothing in the module logs it - there is no
logging call in it at all - and no tool result ever contains it.

**DuckDuckGo and Google are out on their own published terms, not on taste.**

- DuckDuckGo's terms require authorization to use its services - "We expect you to
  use our Services as authorized, or we may otherwise suspend access"
  (https://duckduckgo.com/terms, last updated 2025-07-01) - and the instructions it
  publishes for machines disallow exactly what a search client needs:
  https://duckduckgo.com/robots.txt carries `Disallow: /html`, `Disallow: /lite`
  and `Disallow: /*?`, with the comment "Block query strings on other pages; allow
  them at the root (covers SERP's ?q= and any other root-level params)". There is
  no endpoint left that a query may be sent to.
- Google's terms forbid "using automated means to access content from any of our
  services in violation of the machine-readable instructions on our web pages (for
  example, robots.txt files that disallow crawling, training, or other
  activities)" (https://policies.google.com/terms), and the instruction for the
  endpoint a search would need is published at https://www.google.com/robots.txt
  as `Disallow: /search`. A general web-search API is a paid product with its own
  terms, which is Brave's row above.

Those four checks were made on 2026-10-10 against the URLs above; a later reader
who finds one changed has found a document to amend, not a reason to route around
it.

### 2.5 The extractor, and the untrusted-text rule

`web.read` turns a page into text with a small extractor of its own
(`web/extract.ts`): one pass that drops `script`, `style`, `noscript`, `template`,
`svg`, `iframe`, `object`, `embed`, `canvas`, HTML comments and the `<head>` after
its `<title>`; ends a line at a block element and at `<br>`; prefixes a list item
with `- `; collapses whitespace; and decodes named, decimal and hexadecimal
character references, leaving an unknown entity exactly as written.

**The alternative was `@mozilla/readability` (0.6.0, Apache-2.0) plus a DOM to give
it a document - `linkedom` (0.18.13, ISC) or `jsdom` (30.1.2, MIT).** Both were
declined, and the reason is what this feature actually needs: Readability's value
is deciding WHICH part of a page is the article, and that decision needs a DOM and
a second dependency. The trade is stated rather than hidden: a page whose article
is buried under a sidebar, a comment thread and a newsletter overlay comes out
with all three, and everything the model receives is labelled as data from the web
rather than as a paragraph of the answer.

Everything fetched is **fenced and labelled** before the model sees it
(`web/untrusted.ts`): a fixed delimiter a page cannot forge, and one sentence in
the user's language saying what the block is. The structural half of the rule
needs no help there - nothing a page contains can call a tool, because a tool call
is something the model emits and a page is only ever text.

**The citations are the pages themselves.** A Wikipedia result carries the
contract's `kind: "wiki"`; every other page carries a local widening,
`WebSourceKind = SourceKind | "web"`, because the contract has no member for "a
page on the open web" and labelling a news article as a pack, a note or a file
would be a wrong label on a source the user may click. The contract is not edited
(its own header forbids it, and seven other parts depend on it): the value is
`"web"`, the widening lives in `web/citation.ts` with a single documented cast, and
that file shrinks to a re-export the day `SourceKind` gains the member.

## 3. The egress path, and why it is Node's

ADR-089/092's single non-renderer session allows https to a **compiled-in list of
hosts**, and that is the whole of its value. A search result's host is not a fact
about the binary - it is a fact about the internet, and the user typed the
question - so the layer that makes arbitrary names unreachable
(`host-resolver-rules`, `MAP * ~NOTFOUND` with one `EXCLUDE` per pinned host) is
exactly the layer this feature cannot live under. The two alternatives were:

1. **Lift `host-resolver-rules` for any launch with the consent on.** That weakens
   the two features that DO depend on it - the update check and the content
   download, whose session admits only pinned hosts - in front of a third
   feature's need for arbitrary names.
2. **Give this feature its own socket**, in one named file, behind the gate above.

This ADR takes the second, and states the consequence rather than hiding it: what
protects this path is `gate.ts` (the consent, off by default, AND a mode that
allows a connection), `target.ts` (https, public addresses, re-checked per hop) and
`limits.ts` (bytes and time) - **not** Chromium's proxy, resolver or session rules.
The four layers in `net/offline.ts` are unchanged and still cover the renderer, the
update check and downloads; nothing about them is loosened for this feature.

**`check:egress` learns the new path in two ways, and neither weakens it:**

1. A NEW RULE, `node-dns`. Every other rule in that gate looks for a REQUEST, and a
   DNS lookup is egress with no request in sight: `dns.lookup(hostname)` contains
   none of the words the other rules match, while being exactly the metadata an
   offline-first app promises not to leak. No other module in the tree imports
   `node:dns` (checked on 2026-10-10), so the rule arrives clean.
2. ONE ALLOWLIST ENTRY, for `apps/desktop/src/main/assistant/web/transport.ts`,
   exempting `node-http` and `node-dns` with the reason written in the gate itself.
   The entry names ONE file, so the six files that DECIDE what may be requested
   (`index.ts`, `gate.ts`, `target.ts`, `fetch.ts`, `providers.ts`, `secrets.ts`)
   still fail the gate if one of them reaches for a socket - and
   `scripts/check-egress.test.mjs` asserts that file by file.

## 4. What this ADR does NOT do

Said plainly, because a document that only lists what exists stops being true:

- **No surface.** Nothing in this wave is reachable from the UI: the module is a
  library with its factory, and the settings card that will flip the switch and
  store a key arrives with the assistant's module in the next wave. No IPC
  channel, no preload method, no renderer copy.
- **No cache and no store.** A fetched page lives for as long as the answer being
  written: nothing is written to the profile database, no temporary file keeps a
  copy, and the next question fetches again. "User data never leaves" therefore
  needs no exception here - what this feature SENDS is a query the user approved,
  and what it KEEPS is nothing.
- **No per-conversation consent** (2.3), and no way to remember one.
- **No external-link wrapper.** A URL reaches the user as selectable text with its
  host named; opening it is the user's browser's job, and there is no vetted
  `shell.openExternal` in main yet. The carrier for that decision is one
  `TODO(external-links)` beside the line that writes the URL.
- **No model download, no Hugging Face, no account anywhere.** The Brave key is
  the only credential this service can hold, and it is the user's own.
- **No `PRIVACY.md`/`SECURITY.md` edit.** They owe the same kind of sentences
  ADR-092 owed - that this path exists only when the user turns it on, that it
  reaches only public https addresses, and that nothing fetched is kept - and one
  documentation pass should write them for both egress paths at once.

## 5. Consequences

- **The switch is a new device-level file**, beside `cloud.json` and
  `network.json`, and the first question the next wave's settings card asks is
  which of the two it has to change: the mode costs a restart and the consent does
  not.
- **The assistant's tools are offered conditionally.** `web.search` and `web.read`
  exist in this service unconditionally; the module's `ToolRegistry.tools({ web })`
  is what decides whether a turn is given them, and the contract already says so.
  A tool that is handed out while the consent is off still refuses in `run` -
  defence in depth, not a second policy.
- **A user can turn the consent on and still get nothing**, if the mode is
  "Offline only": the copy for that case names the mode rather than the setting,
  because that is the thing they have to change.
- **`NetworkMode` did not change and `net/offline.ts` was not edited.** ADR-092's
  four layers, its host lists and its resolver rule are exactly as they were; this
  ADR adds a consent BESIDE the mode rather than a member to it.
- **The screenshot harness is unaffected**: nothing here has a screen.

## 6. Alternatives rejected

- **A fourth network mode, `"web"`.** It would have granted the update check and
  downloads by being a superset, and it would have re-opened `allowedHostsFor`,
  whose whole point is that the reachable set is a fact about the binary (2.1).
- **Reusing the update/download session with its host rule.** A search result's
  host cannot be pinned, and lifting the resolver block for consenting launches
  would weaken the features that depend on that block (3).
- **A boolean inside `network.json`.** The mode file is a small forward-compatible
  record with one meaning per launch, and a second meaning inside it is how two
  answers end up disagreeing about one launch - ADR-092's own finding, one file
  over.
- **Fetching through the renderer.** The renderer's session cancels every remote
  request in every mode, deliberately: "the renderer's rule takes no network mode
  at all" is a property `offline.test.ts` pins. A page fetched for the assistant is
  main's business.
- **`@mozilla/readability` plus a DOM parser** (2.5): a second dependency and a
  scoring pass for a decision this feature does not have to make.
- **A DuckDuckGo or Google provider.** Their published instructions forbid it
  (2.4); a product whose copy says "offline by default" cannot make its first
  outbound exception by ignoring a robots.txt.
- **Storing the Brave key in the settings file.** A settings file is copied by
  backup tools and read by anything running as the user; the key goes through
  `safeStorage` and a refusal, never a plaintext fallback.
- **A host allowlist for this feature.** Any list short enough to read is a list
  that excludes the page the user asked for; the rule that holds here is about
  ADDRESSES, which is a rule a search result cannot escape (2.2).
