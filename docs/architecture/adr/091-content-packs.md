# ADR-091 — Content packs: a signed folder, verified with the release key

**Status:** accepted (2026-10-09) · **Owner:** founder

Nexus is becoming *the internet without the internet*: offline Wikipedia and
other libraries, maps, survival and reference content, later local AI models.
This ADR fixes the format those arrive in, how one is trusted, where it is kept,
and the local half of the machinery — install from a folder on disk, verify,
list, remove. Downloading packs is a separate run; §7 is the seam it plugs into.

## 1. The finding

Three constraints met in one place:

1. **That content is public and large.** A full offline Wikipedia is tens of
   gigabytes. None of it is anybody's private data, and none of it is produced
   by this application.
2. **It cannot ship in the installer.** An installer carrying a library is an
   installer nobody downloads, and a release that had to be rebuilt to add a
   map is a release per map.
3. **It cannot live in the profile database.** The database is encrypted with
   the profile's key (`ADR-018`), is written through SQLite transactions, is
   copied whole by an export (`ADR-022`) and is restored whole by a restore
   (`ADR-023`). Twenty gigabytes of Wikipedia inside it would be twenty
   gigabytes in every backup, on every sync, and in every restore — for data
   that is not the user's and is not secret.

What was missing was not storage. It was **a way to know that a folder of
content is the folder it claims to be** before anything is copied, and a way to
do that with a key this application already trusts.

## 2. The pack format

**A pack is a folder.** It contains:

- `pack.json` — the manifest, the pack's claim about itself;
- `pack.json.sig` — a detached Ed25519 signature over the manifest's exact
  bytes;
- the content files the manifest lists, in whatever folder structure it names.

`pack.json`:

```json
{
  "format": 1,
  "id": "wikipedia-sr",
  "version": "2026.10.0",
  "kind": "zim",
  "title": { "sr": "…", "en": "…" },
  "description": { "sr": "…", "en": "…" },
  "files": [{ "path": "wikipedia.zim", "size": 0, "sha256": "…" }],
  "licence": { "spdx": "CC-BY-SA-4.0", "attribution": "…", "url": "https://…" },
  "source": { "name": "…", "url": "https://…" },
  "minAppVersion": "1.6.0"
}
```

- `format` is the only version this build reads. A manifest claiming another is
  refused, never best-effort parsed: a format change is exactly the case where
  guessing installs a pack with the meaning of a field changed under it.
- `id` is kebab-case, at most 64 characters, and must be a usable folder name on
  Windows (no reserved device name, no trailing dot or space). It is also the
  name of the folder the pack is installed into, which is why the folder rules
  are checked before anything is copied.
- `version` is `MAJOR.MINOR.PATCH`, no leading `v`. The comparison reuses
  `main/update/version.ts`'s parser rather than a second grammar.
- `kind` is one of `zim`, `map`, `dataset`, `model`, `content`.
- `title` and `description` carry **both** languages, each non-empty and capped.
  The product's copy is Serbian and English, and a pack's own copy is copy.
- `files` lists every content file with its exact size and SHA-256. It is the
  whole of what the copy verifies.
- `licence` carries the identifier, the attribution and the licence's address.
  `attribution` is required and is always shown in the UI: CC BY-SA requires it,
  and a pack whose attribution were optional would ship somebody else's work
  without the notice they asked for.
- `minAppVersion` is the app version this pack needs. A pack that asks for a
  newer one is refused rather than installed and half-understood.
- **A field the format does not define is refused**, at every level. A typo
  (`minAppVerison`) and a newer format's field are both worse read past than
  refused: the first installs a pack whose minimum version was never checked,
  and the second installs a format-2 pack under format-1 rules.

### Why a folder and not a `.nexuspack` tar

Either a folder or a plain uncompressed tar of that folder would work. **The
folder wins on the one ground that matters here: fewer parsers in the trust
boundary.**

- A tar is a **second parser on hostile input** — entry names, PAX and GNU long
  names, sparse files, hard links, path traversal inside the archive — and Node
  ships no tar reader, so a tar would have meant either a new dependency or
  writing one by hand. `archiveReader.ts` and `apkgReader.ts` did not have to,
  because `yauzl` is already a dependency for zip.
- The folder makes verification and copying the **same act**: the bytes hashed
  while copying are the bytes of the file on disk, with nothing in between to
  disagree with them.
- Everything else is identical either way. A `.nexuspack` remains the format's
  obvious wrapper — *a tar of exactly this folder* — and adding it later is one
  extraction step in front of `installPackFromDirectory` (§7), with no second
  verifier: the extraction produces a folder and the same code reads it.
  Nothing in this ADR would have to change.

## 3. The trust model

**A pack is signed with the release key, and no unsigned pack ever installs.**
`pack.json.sig` is an Ed25519 detached signature over the context string
`nexus-pack-manifest-v1\n` followed by the exact bytes of `pack.json`, verified
by `update/verify.ts`'s `verifyDetachedSignature` against `update/releaseKey.ts`'s
pinned public key — the same function and the same key that gate a self-update
(`ADR-089`). There is deliberately **no second verifier**: a second
implementation of "does this signature check out" is a second thing to get
wrong, and the one that is wrong is the one nobody reviewed.

The context is there because the key signs two kinds of document. A self-update
trusts a signature over `SHA256SUMS.txt` alone, and a pack signature never covers
the manifest alone, so neither signature can be presented as the other, however
the two formats change. `PACK_SIGNATURE_CONTEXT` in `packs/verify.ts` and in
`scripts/pack-sign.mjs` is the one string, and the script's test holds the two
copies together.

The signature covers the manifest, and the manifest covers the content by hash.
That chain is the whole of it:

```
release key  →  pack.json  →  every file's SHA-256  →  the bytes on disk
```

A person who can mint `pack.json` can describe any content, and the content is
only accepted when it hashes to what the signed manifest says. So publishing a
pack requires the private half of the release key, which lives in the repository's
Actions secrets and in the maintainer's offline backup — not in
this application, not in CI for a fork, and not on the machine that installs.

### Why a pack does not check its own signature, and why not user-signed packs yet

The verifying key is **compiled into the binary**. A pack cannot bring a key
with it, and a pack cannot name one: `pack.json` has no `key` field, and a
manifest carrying one would be refused as an unknown field. Trust that a
document can assert about itself is not trust.

Two further keys were considered and are deliberately not here yet:

- **A second pack-signing key** (a subkey the release key certifies). It would
  be the right answer the day packs are published by somebody other than the
  maintainer, because rotating a pack key then does not mean rotating the update
  key. It is not needed while there is one publisher, and it adds a second trust
  root that has to be tested. `format: 1` is what makes adding it a deliberate
  act rather than a silent one.
- **User-signed packs.** They are refused by construction: a user-signed pack
  would install content into the machine of the very user who signed it, and the
  only thing the signature would prove is that a key on that machine signed it —
  which the folder's own hashes already prove. What the signature is *for* is
  the hop between a publisher and a stranger. When that hop exists in the other
  direction (a local pack built by a user's own script), the honest shape is a
  developer-mode import that says out loud that it is not verified, and that is
  not in this ADR.

## 4. What is refused, and before what

A folder is read in this order, and the first refusal wins: a signature that
does not verify over the manifest's exact bytes; a `format` this build does not
read; an `id`, a `version`, a `kind`, a `minAppVersion` or copy that breaks its
rule; a file list that breaks one of the caps or repeats a path; a
`minAppVersion` newer than this build; and only then the folder itself.

**Paths are hostile until proven otherwise.** A pack arrives from outside this
machine, and every path in it was written by whoever built it. Each listed path
is refused when it is not a string, is empty, is over 240 characters, contains a
NUL or another control character, is absolute (`/…`), names a drive (`C:…`), is
a UNC path (`\\…`), contains a backslash anywhere, contains an empty segment
(`a//b`, a trailing slash), contains a `.` or `..` segment, contains one of
`< > : " | ? *`, ends a segment with `.` or a space (Windows silently strips
those), names a reserved Windows device (`CON`, `NUL`, `COM1`, `LPT1`, …, with
or without an extension), or nests more than eight segments deep. Two entries
that differ only in case are refused too, because on Windows they are one file.
The same rules are applied again to what is on disk, so the copy never has to
decide about a name the manifest was allowed to omit.

**The folder must match the manifest exactly.** Every listed file is present
with the size the manifest states; no file is present that the manifest does not
list; `pack.json` and `pack.json.sig` are the two names the comparison ignores,
because the manifest cannot carry its own hash. A **symbolic link or a junction
is refused, not followed**: a pack containing one could point anywhere on the
machine — including the user's own files, which the copy would then duplicate
into a pack directory. The test is a realpath comparison rather than
`isSymbolicLink`, because on Windows a junction is a directory with a reparse
point and only resolving it shows that it went somewhere else.

**Every byte is hashed while it is copied.** There is no verify-then-copy step
that could be raced, and no file is ever held in memory: the read stream's own
buffer is the ceiling, so a twenty-gigabyte ZIM costs the same memory as a
one-kilobyte text file. A file that outgrows its declared size stops the copy
rather than filling the disk first.

**The caps** (`main/packs/limits.ts`) are deliberately loose on content and
tight on the two small files, because a content pack is *supposed* to be large:
1 MiB for `pack.json`, 4 KiB for its signature, 64 GiB for one content file,
256 GiB for the pack, 4096 files per pack, 240 characters and 8 segments per
path. A declared `Content-Length`-shaped lie cannot exhaust anything: the sizes
are the manifest's, the copy enforces them, and the set is compared before the
first byte moves.

## 5. Storage: `<userData>/packs`, and why it is outside the database

An installed pack lives at `<userData>/packs/<id>/<version>/`: its content, plus
its own `pack.json` and `pack.json.sig`. Three reasons, and each one is a
property the database cannot give:

- **It is not one profile's data.** Two profiles on one machine share the same
  Wikipedia. Inside the database, the second profile would keep a second copy
  and the export of either would carry it.
- **It must not enter backups.** A backup is the user's own data, taken to be
  kept. Twenty gigabytes of somebody else's library would make every backup
  slow, every restore dangerous, and every sync absurd — and the pack can be
  re-downloaded or re-copied from a stick at any time.
- **It is not secret, and the database is.** The content is public by
  construction; putting it behind the profile key would mean decrypting
  gigabytes to read a map, and would put a second, larger writer inside a
  SQLCipher file.

**Install copies into staging and renames once.** The pack is assembled under
`<userData>/packs/.staging/<random>/` and renamed to `packs/<id>/<version>/`
when it is complete, which is the only atomic step the filesystem offers. So an
interrupted install — a full disk, a removed USB stick, a killed process —
leaves either the old version or nothing, never half a pack the app would then
have to describe. **An upgrade keeps the old version until the new one is
complete, and removes it afterwards**; installing the same version again
replaces it at the same instant, just before the rename.

`<userData>/packs/installed.json` is an **index, and only an index**:
each entry is an installed pack's signed manifest plus its size, file count and
install time. It is rebuilt from the directory when it is missing, unreadable,
of an unknown version, or shaped like something this build does not recognise,
and each installed pack's signature is re-verified as part of that rebuild.
**Content hashes are never re-checked at startup** — hashing fifty gigabytes to
draw a list is not an inspection — and are re-checked only when the user asks,
through the card's „Proveri". The list is drawn from the signed manifests rather
than from a scan, so a folder somebody edited by hand stops being listed instead
of being believed.

## 6. The API, and the one thing it never carries

Five request channels and two pushes (`shared/ipc.ts`, `main/packs/packsIpc.ts`):
`packs:list`, `packs:inspect`, `packs:install`, `packs:remove`,
`packs:verify`, plus `packs:changed` and `packs:progress`.

**No path crosses the bridge, in either direction.** A pack is a folder, and the
only way one is ever named is that a person picked it in a native folder dialog
**main** opened: `packs:inspect` opens it, verifies what was chosen and answers
what the folder holds; `packs:install` then takes **no argument at all** and
installs the candidate that inspect left waiting, re-reading the folder so a
swap between the two calls is caught rather than trusted. A channel through
which a renderer could name a directory would be a way to make this process copy
an arbitrary folder of an attacker's choosing into `packs/`, and a
renderer-triggered walk of an arbitrary tree is a denial of service waiting to
happen. Every payload is validated in main (`assertTrustedSender`, `asRecord`,
`asId`, and the kebab-case check beside the code that names the folder).

**A refusal is data, and a bug is an exception.** Every refusal is a
`PackRefusalCode` — the vocabulary is declared once, in `shared/ipc.ts`, and
`main/packs/errors.ts` imports it — and the card turns each code into a sentence
in the active language. A code that exists on one side and not the other is a
compile error, not a card with a blank line on it.

The card itself is „Paketi sadržaja", the last card of the „Podaci" category —
`ADR-088`'s table gains one row and no category, and this ADR is where the row is
recorded, because a decision log is never rewritten. It draws a list of what is
installed with its title, version, size, licence and attribution, „Instaliraj iz
fascikle…", and per pack „Proveri" and „Ukloni" behind a confirmation.
Attribution is shown for **every** pack and never behind a disclosure. The empty
state is where the card says what a pack *is*, because a user who has never
installed one has nothing else to read.

## 7. The seam the downloads run plugs into

**`installPackFromDirectory(sourceDir, deps)`** — `main/packs/install.ts` — is
the whole of the interface. It takes a folder that is already on disk and does
everything above: signature, manifest, app-version floor, the structural
comparison, the disk-space check, the staging copy with every hash verified
while copying, the atomic rename, the upgrade sweep and the index rebuild. It
reaches nothing on the network, and it would not notice if the folder had come
from one.

So the downloads run downloads into its own staging area (its own network mode,
its own allowlist, its own caps — `ADR-089`'s session is not reused) and calls
this with the folder it produced. No part of verification is duplicated there,
and no part of downloading is here. `--downloads` in the card, when it exists,
is one more button above the same seam.

## 8. The signing tool

`scripts/pack-sign.mjs` builds `pack.json` for a folder and writes its
signature: the maintainer writes the *metadata* (id, version, kind, two
languages of copy, licence, source, `minAppVersion`) and the tool computes the
*file list* — path, size and SHA-256 for every content file — because that is
the half nobody can do by hand and keep correct. The private key's path is an
argument; the key is read, used and never printed, echoed or copied. Metadata
that is missing a field, carries an unknown one, or carries `files` itself is
refused, so a manifest the app would reject is never signed in the first place.
The tool deliberately does **not** re-implement the app's validation: the app is
the authority, and a build tool with its own copy of the rules is a second
answer that drifts.

## 9. Consequences

- **`check:egress` is unaffected.** Nothing in `main/packs/` constructs a
  request; packs arrive through a dialog and a function that takes a path.
- **The screenshot harness sees the card.** It is drawn from the same
  `SETTINGS_CATEGORIES` table as every other card, so „settings-data" photographs
  it with no change to the harness.
- **A pack with no installable version is still a pack.** Installing the same
  id at an older version is allowed and removes the newer one, because "which
  version of Wikipedia do I want" is the user's question and downgrading is a
  legitimate answer to it.
- **Re-hashing is the user's call.** „Proveri" is the only path that reads a
  pack's content back, and it reads all of it; a corrupted pack is otherwise
  discovered when something tries to read the file, which is what the content
  readers already do.
- **A pack is not a module.** It carries no code, is never executed, and the
  renderer never reads a byte of it: everything the app knows about a pack comes
  from its manifest, through the IPC view shapes.

## 10. Alternatives rejected

- **A `.nexuspack` tar as the only format.** §2: a tar reader on hostile input,
  written by hand because Node has none, in exchange for nothing the folder does
  not already give.
- **Storing packs in the database.** §5: their size, their publicness and their
  life outside any one profile.
- **Verifying content hashes at startup.** It makes a fifty-gigabyte pack a
  fifty-gigabyte startup cost, to answer a question nobody asked. The manifest
  is verified (cheap, and it is what the trust rests on) and the hashes are
  verified on demand.
- **A per-pack key recorded in the manifest.** Trust that a document asserts
  about itself; §3.
- **Letting the renderer hand main a path.** §6.
- **A hash without a signature** (the pack carries its own checksums and nothing
  else). That defends a truncated copy, not a hostile publisher — the same
  argument `ADR-089` §3 makes about `SHA256SUMS.txt` without its `.sig`.
- **Making `attribution` optional.** CC BY-SA requires the notice, and a pack
  format that let a publisher omit it would produce packs that violate their own
  licence while claiming it.
