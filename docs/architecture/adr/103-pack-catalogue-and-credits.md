# ADR-103 — the pack catalogue, the download screen and the credits

**Status:** accepted (2026-10-10) · **Owner:** founder · Amends
[ADR-091](091-content-packs.md) (format 1 gains an optional `notice`) and uses
the seam [ADR-092](092-downloads-network-mode.md) left open

ADR-091 built a pack as a signed folder and installed it from a disk. ADR-092
built a mode that may reach the network and a service that moves a file against
a known SHA-256. What was missing is the thing in between: a way for a user to
find out which packs exist, decide about one from what its author requires to
be shown, and get it — without leaving Nexus and without a byte of it being
trusted before it is checked. This ADR is that, plus the two obligations the
decision of 10 October added: every pack's licence, attribution and source
travel with the app, and a safety pack carries a disclaimer everywhere it is
read.

## 1. The finding

Three facts, and each one closes off a design that would otherwise look
reasonable:

1. **A pack's address cannot be a renderer's.** ADR-089 refused
   `openExternal(url)`, and ADR-092 refused a URL the renderer may hand main to
   FETCH, for the same reason: a channel that accepts a URL is a primitive for
   pointing this process at a server of somebody else's choosing. So the list of
   addresses has to arrive in a document MAIN fetched and verified.
2. **A list of packs is not a thing a binary can carry.** Packs are published
   after the app ships; a compiled-in list would be a release per pack, which is
   the argument ADR-091 §1 already made about content. So the list is a document
   that arrives over the network.
3. **A document that decides where downloads go is worth forging.** Whoever can
   write the catalogue decides which server this app talks to and which bytes it
   installs. That places the catalogue exactly where the manifest already is: on
   the far side of the key compiled into the binary.

## 2. The decision: a third signed document

**The catalogue is a JSON document, signed with the release key over the
context string `nexus-pack-catalogue-v1\n` followed by its exact bytes.** It is
the third kind of document the release key signs, beside `SHA256SUMS.txt` (the
updater) and `pack.json` (a pack), and the context is a **third** one:
`PACK_CATALOGUE_SIGNATURE_CONTEXT` in `packs/verify.ts` and in
`scripts/pack-sign.mjs`, held together by the script's test exactly as the
manifest's two copies are.

Without the third context a pack's signed manifest would be a valid catalogue
and a catalogue would be a valid – if unusual – manifest, because both are
"some JSON, signed by the release key". A signature that cannot be presented as
another document's is the whole of what the context buys, and the second
document is precisely the case the mechanism was written for.

It is fetched from one compiled-in address:

```
https://github.com/lukastojiljkovic/nexus-packs/releases/download/catalogue/catalogue.json
```

and its detached signature from `<that URL>.sig`. The repository is created at
release time; the host is `github.com`, which `DOWNLOAD_HOSTS` already holds,
and a release asset's `302` to `release-assets.githubusercontent.com` is
allowed because the download list holds that host too and the hop rule checks
every hop.

**The document is refused, never best-effort read.** Not JSON, not an object, a
`format` this build does not read, an unknown field at any level, no `packs`,
more packs than the cap — each is a refusal with a code. The unknown-field rule
is ADR-091 §2's, for its exact reason: a field nothing reads is a field nothing
enforces.

## 3. An entry: everything a person needs BEFORE a byte moves

```json
{
  "format": 1,
  "packs": [
    {
      "id": "wikipedia-sr",
      "version": "2026.10.0",
      "kind": "zim",
      "title": { "sr": "…", "en": "…" },
      "description": { "sr": "…", "en": "…" },
      "size": 0,
      "licence": { "spdx": "…", "attribution": "…", "url": "https://…" },
      "source": { "name": "…", "url": "https://…" },
      "notice": "safety",
      "files": [
        { "path": "pack.json", "url": "https://…", "size": 0, "sha256": "…" },
        { "path": "pack.json.sig", "url": "https://…", "size": 0, "sha256": "…" },
        { "path": "wikipedia.zim", "url": "https://…", "size": 0, "sha256": "…" }
      ]
    }
  ]
}
```

Four decisions are in that shape:

- **The metadata is the manifest's metadata.** `id`, `version`, `kind`, both
  languages of copy, `licence` and `source` are validated by the MANIFEST's own
  validators (`packs/manifest.ts`), not by a second copy of the rules: an entry
  a manifest would refuse describes a pack nobody could install, and the second
  copy is the one that drifts.
- **`size` is the download's total**, every listed file added up — the number a
  free-space check and a progress bar need. It must equal the sum it states,
  because a stated size that is not the sum is a progress bar that lies and a
  space check that lies with it. (The manifest's own `size` is the content
  alone; the two are different questions and both are answered where they are
  asked.)
- **`pack.json` and `pack.json.sig` are listed like any other file**, with their
  own URL, size and SHA-256, and both are REQUIRED. The manifest cannot carry
  its own hash, which is why the manifest's `files` omits the pair; the
  catalogue is outside the manifest and pins every byte the download will
  fetch, the two small files included.
- **`notice` is optional**, absent means "no notice", and its one value is
  `"safety"`. It travels into `InstalledPackView` and `PackCandidateView`, which
  is what lets the card and the credits screen draw the disclaimer without
  re-reading a manifest.

### The `notice` field, and why format 1 was amended rather than bumped

`pack.json` gains `"notice": "safety"` as an OPTIONAL field of format 1. **No
pack has shipped yet**, so there is no format-1 pack in the world whose meaning
this changes: amending is honest and a bump would be ceremony owed to nobody.
ADR-091's format rule is unchanged in the direction that matters — a manifest
that carries a field format 1 does not define is still refused, and a `notice`
that is not one of the known values is refused too, because a notice this build
does not understand is a disclaimer it would not draw. The day a pack has
shipped under these rules, the next change of this kind gets a `format: 2` and
nothing here argues otherwise.

## 4. The address rule: every file URL is on the compiled-in list

**An entry whose file URL is not `https` on a host in `DOWNLOAD_HOSTS` is
refused with `"catalogue-host"`, before anything is offered to the user.** The
rule is `isHttpsHostAllowed`'s (ADR-092 §2): https only, the host matched
exactly, no wildcard, no subdomain, no port. The list is passed into the parser
rather than imported by it, so the module stays a pure function of a document
and the rule the binary decided on.

The download service checks the same list again, on every request and every
`Location` — so this is not the only gate. It is the gate that means a
forged-but-signed-by-nobody catalogue cannot even be listed, and the gate that
makes the card's "download" button safe to draw.

## 5. The download: through the service, file by file, then the install

`packs/download.ts` is the seam between the two halves that already exist:

```
catalogue entry ─▶ download service (a hash per file, a cap, a resume point)
               ─▶ one folder of verified files
               ─▶ installPackFromDirectory (signature, manifest, structure)
               ─▶ packs/<id>/<version>/
```

**Nothing is verified twice and nothing is verified here.** Each file's SHA-256
is computed by the service WHILE it is written and compared before the file is
handed over; the manifest's signature, the app-version floor, the structural
comparison, the disk check and the atomic rename are `installPackFromDirectory`'s
(ADR-091 §7). This module's whole job is to fetch the files the signed
catalogue pins into one folder and then call exactly that function.

- **Staging is under `packs/.staging/<random>/`**, with the pack's files
  assembled in `pack/` and the service's own `.part` files beside them in
  `part/`. `.staging` is the one name `registry.ts` skips, so a half-downloaded
  pack can never be listed, and the folder the install is handed holds the
  pack's files and nothing else.
- **Progress is one view for both halves** (`packs:download-progress`), with a
  `phase` of `"download"` or `"install"`, because from the card's side it is one
  operation that got to its last step.
- **Pause keeps what it has.** Pausing pauses the file in flight; the service
  keeps its staging file, its byte count and the reply's validator, and a
  resume asks for `Range: bytes=<n>-` with `If-Range`. Files already placed stay
  placed, so a resumed pack re-downloads nothing it already has. When the server
  cannot satisfy the range (a `200`, a `416`, a validator that changed) the file
  is truncated and written again from zero, hash and all — ADR-092 §3's rule,
  unchanged, used here rather than re-decided.
- **Cancel deletes the whole staging folder.** Nothing partial survives it, and
  an interrupted download leaves `packs/<id>/` exactly as it was.
- **Free space is checked before the first request**, against twice the entry's
  size plus the install's headroom: the download stages a full copy and the
  install copies it again before the rename. `null` (a platform that cannot say)
  is not a refusal — a guess would refuse a download on a machine with room.
- **The mode is asked first.** Outside `"downloads"` every entry point refuses
  with `"downloads-off"` and no request is made, and the card says the sentence
  that names where the switch is rather than showing a button that cannot work:
  *"Downloads are off. Turn on Downloads in Privacy."*

## 6. The screen: the catalogue is part of the Packs card

`PacksSettings.tsx` gains a **catalogue view below the installed list**: the
entries grouped **by kind** (only the kinds the document actually offers — a
heading with nothing under it is a promise the catalogue did not make), each row
carrying its title, version, total size, licence and its state on this device
(`not-installed`, `installed`, or `update-available` with the installed version
shown beside it).

**The details come before the download.** A disclosure on each row holds the
attribution and the source, with the licence's address as a link; the state is
what the row shows, and pressing "Download" is what starts anything. There is
deliberately no "install everything" and no queue: ADR-092 §3 allows two
downloads at once because that is what a person can watch, and the card is a
list of decisions, not a console.

## 7. The credits, and the external-link rule

**Settings → About gains "Pack licences"** (`PackLicences.tsx`): every installed
pack's licence, attribution and source, in the place a person looks for what
this app is made of. It reads the same installed list the Packs card reads, and
it draws a safety pack's licence too — the disclaimer and the licence are
different obligations and neither discharges the other.

Those addresses are the first clickable outbound links in this app, so they get
the rule ADR-089 withheld: **`main/external.ts`, a pure `allowsExternalUrl(url)`
and one call to `shell.openExternal`.** It allows an `https` address with no
credentials and a bounded length, and refuses everything else — on Windows
`ShellExecute` reaches `file:`, UNC paths and another program's registered
protocol handler, which is the phishing and remote-launch primitive the refusal
was always about. **It deliberately does not allowlist hosts**: the addresses
are third-party licences and third-party sources, and a compiled-in list of them
would either be wrong within a week or would make the credits screen a list of
links that do not open. The scheme is the rule that matters. The loader is the
USER'S BROWSER, never this process's network stack, which is why `check:egress`
carries an exemption for this one file and one rule id.

## 8. The disclaimer, in one place

`renderer/src/safetyNotice.tsx` exports `SafetyNotice` — the component — and
`safetyNoticeText`, its sentence, both reading the one `strings.safety.text`
entry:

> Samo za informisanje. Nije zamena za stručnu pomoć. Proveri informacije. U
> hitnom slučaju pozovi 112.
> For reference only. Not a substitute for professional help. Check the
> information. In an emergency, call 112.

It exists as a component because the Reader and the assistant have to say the
same thing in the same words; a disclaimer that lives in three slightly
different versions is three different claims, and the one that drifts is the one
somebody relies on. It is drawn wherever a pack whose `notice` is `"safety"` is
shown — starting with the Packs card's own rows and the catalogue entry — and
the text is also available as a string for a caller that needs the sentence
rather than the element.

## 9. Consequences

- **A third context, one verifier.** `verifyCatalogueSignature` is a thin
  wrapper over the same `verifyDetachedSignature` and the same key; nothing in
  the trust chain is new except the string.
- **`DOWNLOAD_HOSTS` needs no new entry.** The catalogue's host and the release
  asset host are both already on the list ADR-092 compiled in.
- **`check:egress` gains two exemptions**, and both are stated in place: the
  downloader's end-to-end suite (a loopback server, the download service's own
  arrangement) and `main/external.ts` (a browser hand-off, not a fetch).
- **The renderer still cannot name an address.** The six new channels carry a
  pack id; the one channel that carries a URL takes it from a credits row and
  hands it to `allowsExternalUrl` before the OS sees it.
- **A catalogue that cannot be read is a card with a sentence on it**, not an
  error dialog: the installed list, the folder import and every other pack
  operation work identically with no catalogue at all.

## 10. Alternatives rejected

- **An unsigned catalogue.** It decides where this app connects and which bytes
  it installs. ADR-089 §3's argument about `SHA256SUMS.txt` without its `.sig`
  applies unchanged.
- **Reusing the manifest context for the catalogue.** Then a pack's manifest is
  a valid catalogue and the two documents are interchangeable wherever one is
  checked. The context is three lines of code and the whole of the separation.
- **A `format: 2` for `notice`.** §3: no format-1 pack has shipped, so there is
  nothing to migrate and a bump would only mean two parsers.
- **Letting the renderer pass the file URL to a download call.** ADR-092 §6
  refused the primitive; this ADR's whole point is that the address comes out of
  a signed document.
- **Downloading the whole pack as one file, then extracting.** A pack is not an
  archive (ADR-091 §2), and a `.nexuspack` would put a second parser in the trust
  boundary in exchange for nothing the file-by-file path does not already do.
- **Verifying the pack twice** (once by the download, once by the install) or
  **not at all** by the download. The hashes are the service's, the signature is
  the install's, and each is checked where it can be: while the bytes are written
  and before the folder is believed.
- **A compiled-in list of known packs.** §1: a release per pack, which is what
  ADR-091 was written to avoid.
- **Allowlisting the credits' hosts.** §7: they are third-party addresses, and a
  rule that has to be edited per pack is a rule that will be edited wrongly.
- **A per-pack disclaimer string in the manifest.** The sentence is the
  product's obligation to the reader, not the publisher's copy: a pack that
  could word it would be a pack that could word it away.
