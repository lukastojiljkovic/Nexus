# ADR-107 — one door for external links

**Status:** accepted (2026-10-10) · **Owner:** founder · Uses
[ADR-103](103-pack-catalogue-and-credits.md) §7 (the rule and the channel) and
[ADR-090](090-module-kit.md) (the kit's surface)

ADR-103 built the external-link rule and used it for the credits screen. By the
end of wave 1 four other places in the app had a link of their own and each one
reached for `shell.openExternal` itself, or for an `<a>` that the window then
refused. A rule with five doors is a rule with none: this ADR makes the rule the
only way an address leaves this process, adds the one second variant the product
actually needs, and gives a module a control to draw a link with.

## 1. The finding

`git grep -n "shell.openExternal" apps/desktop/src` found three call sites
besides `main/external.ts`, and one more place drew a link without calling
anything at all:

| Call site | What it opens | State before |
| --- | --- | --- |
| `main/zim/zimElectron.ts` | a link inside an opened ZIM page | `http(s)` filtered by `zim/external.ts`, then called directly |
| `main/update/electron.ts` | the pinned releases page | a literal URL, called directly |
| `modules/reader/main/electron.ts` | a pack's own source line | `http(s)` filtered in `register.ts`, then called directly |
| `modules/culture/renderer/Page.tsx` („Otvori link") | an address the user typed into a plan | an `<a href target="_blank">` — which `setWindowOpenHandler` denies, so the control drew a link that did nothing |

The last row is the shape that matters most, and it is not a security defect: a
page that draws an anchor is asking a window it does not own to navigate, and
SEC-EL-03 has denied that since the shell was written. What it produces is a
control that looks alive and is not — the same class of defect the licence rows
would have had if ADR-103 had refused to open anything.

The other three rows ARE a security shape: each of them decides for itself which
addresses may be handed to `ShellExecute`, and three copies of a rule that
`external.ts` already states is three chances to disagree with it about `file:`,
a UNC path or credentials.

## 2. The decision: one door, two named variants

**`main/external.ts` is the only file in the app that calls
`shell.openExternal`.** It exports two predicates and two hand-offs:

| | Schemes | Who may call it |
| --- | --- | --- |
| `allowsExternalUrl` / `openExternalUrl` | `https` only | the app's own addresses: the credits rows, the update feature's release page |
| `allowsDocumentExternalUrl` / `openDocumentExternalUrl` | `https`, `http` | a link inside a document the user opened: a ZIM page, a Reader pack's source line |

Both variants share the rest of the rule — a non-credentialled address of a
bounded length, parsed rather than read as text — through one private helper, so
the second variant cannot drift about credentials while the first stays right.

**Why `http:` is allowed for a document and nowhere else.** An offline
encyclopedia's own links are part of the content the reader opened, and most of
an old pack's are `http:`; refusing them would break the one feature a ZIM
exists for. An address this PRODUCT chose is https, and stays https. The
distinction is a fact about the caller — the reader versus the app — so it is a
function in a file the renderer cannot reach, never a parameter on the
`external:open` channel: a channel that took a "weaker rule" flag would be a
channel where the renderer decides how strict the rule is.

**The three other call sites go through the door**, which means:

- `zimElectron.ts`'s `openInBrowser` calls `openDocumentExternalUrl`, and
  `zim/external.ts`'s `externalUrlFor` delegates its scheme decision to
  `allowsDocumentExternalUrl` rather than restating it. The rule is therefore
  checked twice: once to decide whether the frame loads or is cancelled, once
  where the address leaves (which is the point — the second check is the door's
  own, and it cannot be skipped by a caller).
- `update/electron.ts`'s `openReleasePage` calls `openExternalUrl` with the same
  pinned literal `release.ts` holds and `release.test.ts` compares it against.
- the Reader's environment takes `openDocumentExternalUrl` as its `openExternal`
  implementation: a pack's source line is the pack's own link, in the document
  the reader has open.

**Nothing here fetches anything.** The loader is the user's own browser, which
is a document viewer; the app's network stack is not involved, and
`check:egress` keeps its exemption for exactly this file and exactly that
reason. The one fetch path the app has — the download service (ADR-092) — is a
different mechanism in a different file, and this ADR adds no second one.

## 3. The kit's way, so a module does not need a door of its own

`renderer/src/moduleKit/moduleSurface.ts` re-exports two things (ADR-090's
surface, the one file a module reads to learn what the shell offers):

- **`openExternal(url)`** — `window.nexus.openExternal`, which answers whether
  main opened the address or refused it;
- **`ExternalLink`** — a button styled as a link that shows the address's host,
  opens through that call, and REPLACES ITSELF WITH THE ADDRESS as selectable
  text when the answer is `false`. A refusal has to be visible: the alternative
  is a control that does nothing when pressed, which is what §1's fourth row
  was.

`ExternalLink` is a button and not an anchor for §1's reason, and because a
navigation is not what a click here is: the click is a call, and the rule that
answers it lives in main. The pure half — which host a link reads, and what a
press means — lives beside it in `moduleKit/externalLinkRule.ts`, where it can be
tested without a DOM; a channel failure is deliberately NOT a refusal, because a
wiring bug painted as an inert address is a bug hidden behind a security
decision.

**Kit modules use these and never `window.nexus.openExternal` themselves.** The
compiled-in surfaces that already had an address (the credits rows) keep
`renderer/src/links.ts`, which is now the same call with the answer thrown away;
the culture module's „Otvori link" moved onto `ExternalLink`, which is what makes
it work at all (§1).

## 4. What stays denied

- **New windows.** `setWindowOpenHandler` denies every one of them, and the shell
  gains no exception for links: an address leaves through the channel, which is a
  rule this process applies, never a window the renderer opened for itself.
- **Navigation away from the app's own document** (`will-navigate`), unchanged.
- **`file:` and UNC paths.** On Windows `ShellExecute` reaches a local program
  and a share through both; that is the remote-launch primitive ADR-089 refused
  and this ADR keeps refused.
- **Custom schemes** (`mailto:`, `ms-settings:`, `javascript:`, anything another
  program registered). A scheme that starts a program is not a link.
- **Credentials** — `https://user:pass@host/` reads as a host to a person and is
  not one.
- **Addresses past 2048 characters**, and anything that does not parse.
- **Any host allowlist.** Deliberately absent: the addresses on the credits
  screen and in pack documents are third-party, and a compiled-in list of them
  would either be wrong within a week or make those rows a list of links that do
  not open. The scheme is the rule that matters.

## 5. Consequences

- **`check:egress`'s allowlist loses one entry.** It exempted
  `apps/desktop/src/main/update/electron.ts` for `load-remote`, which fires only
  on a literal URL handed straight to a loader — and that call is gone. The
  exemption `main/external.ts` holds stays, and is now the only one of the two
  that describes a real call site.
- **A walk keeps it so.** `external.test.ts` reads every `.ts`/`.tsx` under
  `apps/desktop/src` (tests excluded) and fails unless `main/external.ts` is the
  only file that CALLS `shell.openExternal`; it also pins that the ZIM rule's
  hand-off, the update feature's release page and the Reader's source line name
  the door's functions. Nothing else in the repository can see a fifth call site:
  it typechecks, it lints, and the screenshot sweep photographs an opened link
  and a refused one identically.
- **Five `TODO(external-links)` markers are cleared** (and the stylesheet comment
  that pointed at one of them, `translator.css`). The translator's Wiktionary
  address became an `ExternalLink`; the two in `main/assistant/tools/packs.ts`
  and `main/assistant/web/index.ts` keep their URL as TEXT, because what reads
  them is the model and the chat page is where a link is drawn. The two pack
  builders that carried the same marker (`scripts/packs/tales/pack.mjs`,
  `scripts/packs/car-help/plan.mjs`) keep their URL as text for that reason too.
  `docs/packs/tales.md` says so now.
- **The rule did not get a second implementation in the renderer.** The renderer
  never decides whether an address is openable; it asks and is answered.

## 6. Alternatives rejected

- **Leaving the three call sites and the anchor alone.** Then "the external-link
  rule" is a file that five places happen to import a different way, and the
  culture module's link keeps not working while looking like it does.
- **Passing "may this be http?" through the IPC channel.** The renderer would
  decide how strict the rule is for its own address, which inverts §2's split.
- **A renderer-side scheme allowlist**, so a refused link could be drawn as inert
  before it is clicked. It would be a second opinion about a security rule, and
  the second one is always the one that drifts; the `false` main already answers
  IS the refusal, and `ExternalLink` renders it.
- **An `<a href>` with the rule copied into `onClick`.** The anchor still asks
  the window to navigate before the handler runs, and the window denies it.
- **Allowing `http:` for every address** (so the credits rows would open an
  `http://` source). The app's own addresses are https; a publisher's `http:`
  source is a missing redirect, not a case this app should soften a rule for.
- **A second variant for `mailto:`.** A mail address is a link on the open web
  and is not one here: it starts another program, which is the class this file
  exists to refuse. A person who wants to write to a licence holder can select
  the address.
