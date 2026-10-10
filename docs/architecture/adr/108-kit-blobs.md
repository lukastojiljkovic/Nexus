# ADR-108 — Module attachments travel in the archive and count in the blob store

**Status:** Accepted; extends [ADR-090](090-module-kit.md) §5 with a blob
carrier beside the kit section (the section itself is unchanged)
**Date:** 2026-10-10
**Supersedes:** nothing.

## 1. The finding

The module kit ([ADR-090](090-module-kit.md)) gave a module a folder, a
contract, a page and two archive hooks. It also gave it a way to keep files: a
module writes bytes into the app's one content-addressed blob store
(`ModuleContext.attachFiles` / `releaseBlob`, `main/moduleIpc.ts`), and its rows
hold the plaintext `sha256` that names them. Culture's tickets and tracks, the
cookbook's recipe photos, the car's receipts, RECORDER's media and Library's
covers all work that way.

Two places never learnt it, and both are the same hand-written list:

1. **The reference count.** `blobRefCount` and the mime lookup beside it in
   `apps/desktop/src/main/index.ts` are the single place that answers "does
   anything still name this file" (`attachments.ts`'s garbage collector) and
   "may `nx-blob:` serve it". A module widened them by hand — four lines naming
   culture, cookbook, car and recorder — under a comment that said so
   ("A module that gains blobs widens exactly these two functions"). A module
   that forgot its line was not refused anywhere: it lost its files to the
   collector, silently, the first time a row was deleted.
2. **The archive.** A module's rows ride through `exportData` / `importData`
   (ADR-090 §5), but the archive's `blobs/<sha256>` union is built in
   `packages/core/src/imex/exportArchive.ts` from `ProfileData`, which names
   only the built-in tables. So an exported profile carried a recipe's row and
   not its photo, and restoring it brought the row back pointing at a file that
   was not there. The modules recorded the limit rather than hid it —
   `modules/recorder/main/imex.ts` called it "a change to the interchange and to
   `main/restore.ts`, not to this module", and `modules/library/main/imex.ts`
   named "the blob carrier" as the piece to add. This is that change.

The two are one bug in one place: a fact about a module's files that main had to
be told by hand. A run that adds a module should not have to find the largest
file in the repository to say where its files live.

## 2. The hook: a module names its blobs once

`ModuleContext` gains one registration, beside `exportData` and `importData`:

```ts
ctx.blobs({
  refCount: (session, profileId, sha256) => store(session, profileId).refCount(sha256),
  mimeForHash: (session, profileId, sha256) => store(session, profileId).mimeForHash(sha256),
  exportBlobs: (session) => …,   // the hashes one EXPORT of these profiles carries
  importBlobs: (payload) => …,   // the hashes one IMPORT of this payload names
});
```

* **`refCount`** is how many of the module's rows — across every profile; the
  blob store is content-addressed across the whole database — name the hash.
  Main's `blobRefCount` adds it to the built-in tables' counts, and a total of
  zero is what makes a file collectable.
* **`mimeForHash`** is what `nx-blob:` must announce for a hash the module's
  rows hold, or `null`. Same union, and the first module that answers wins.
* **`exportBlobs`** is read off the same live rows `exportData` reads, so the
  file a module declares is the file beside the row it declares.
* **`importBlobs`** is read off the PAYLOAD, and it is the one answer the live
  rows cannot give: a restore reads an archive into a profile whose module
  tables still hold the previous owner's state. It is what lets a restore write
  a module's bytes before the module's own `apply` writes the rows that name
  them, and what lets the preview report a file the archive lacks.

The first two take a `ModuleSession` because the store they read lives behind
the session's own `profileDb`, exactly as a handler's does. `importBlobs` is a
pure function of the payload, which is why it appears in the registration but
not in a session.

**Why four answers rather than the three the brief names.** The export half and
the import half cannot be one function: the first reads a store, the second
reads a payload, and nothing can union the two signatures without a cast that
would hide which moment the caller is in. `importBlobs` is what makes the
missing-file case reportable at all — the module's rows are inside a payload
neither `@nexus/core` nor `main/restore.ts` may read.

## 3. The list is built, not written

| What | Built from |
| --- | --- |
| `blobRefCount` | the five built-in stores + `moduleHost.blobRefCount` |
| `blobMimeForHash` | the five built-in stores' mimes, then `moduleHost.blobMimeForHash` |
| the archive's `blobs/` union | the rows `ProfileData` names + `moduleHost.collectBlobs` |

`main/index.ts` keeps its own five (`note_attachments`, `task_attachments`,
`subject_materials`, `dashboard_settings`, `profiles`) and asks the host for
everything else. The four hand-written module lines are gone; culture, cookbook,
car and recorder register in their own `main/register.ts`, and **Library
registers too** — its `library_item_covers` table names a hash and its payload
already carries cover index rows, so a cover taken from an archive would have
had no bytes even though no screen creates one yet.

**Every kit store with a hash column was looked for**
(`git grep -n "sha256" packages/db/src`) and every one of them now registers:
`service_attachments` (car), `cookbook_recipes.photo_sha256`, culture's
`culture_visit_photos`/`culture_tracks`, `recordings` (recorder) and
`library_item_covers`. The remaining hits are the built-in tables above, the
private section (whose ids are random and never content addresses, by design),
and `files/attachmentIndexStore.ts`, which READS the three built-in attachment
tables and writes nothing.

### The one store the audit caught

Every member of main's union is asked for the hash ALONE — the store is
content-addressed across the whole database, and `nx-blob:` asks
`blobMimeForHash` with no profile at all. Culture's `refCount`/`mimeForHash`
were the exception: both were scoped to one profile, and its own doc comment
justified it as "the shape every other member of the union has", which was not
true. Two consequences shipped with it: a culture photo shared between two
profiles could be collected while the second still showed it, and a culture
ticket's `nx-blob://` URL resolved to `null` and 404'd, because the protocol's
lookup has no profile to filter by. Both queries are database-wide now, which is
what the hook's contract states for every module.

## 4. Export: the files ride the archive

`ExportArchiveInput` gains `moduleBlobs?: readonly ExportModuleBlob[]`, a
parallel input beside `data.modules` for `privateNotes`' reason one field up:
core carries a module's payload without reading it, so it cannot look inside one
to find the hashes. `buildExportArchive` declares them into the SAME `blobs/`
union every other blob uses — sha-sorted in the manifest, one entry per hash
however many modules name it, sizes as each module's own row states — and they
join `ExportBinaryEntry[]` as `{ kind: "attachment" }` entries, so they stream
through the writer that already resolves a hash one at a time.

**Absent, not empty, when no module names a blob.** An archive of a profile that
uses no module files is byte for byte what every earlier build wrote: no new
entry, no changed checksum.

**No schema bump, and that is the difference between this and every entry in
`SCHEMA_VERSION`'s list.** The version gate exists for a record type or a field
an older reader would refuse or misread. Here nothing is added to the
interchange at all: the `blobs/` union and the manifest's blob list are the same
two shapes they have always been, and this only ever adds an entry to them. An
older build handed such an archive parses every part it knows and writes only
the bytes its own rows name — the module's rows come back exactly as a 1.42.0
archive restored them, in the module's own missing-file state. Nothing is
refused, so a bump would claim a break that does not exist.

The files ride with every SUBSET export, on the module section's own terms
(ADR-090 §5): a module's payload belongs to no archive module, so neither does
the file beside it.

## 5. Import and restore: bytes first, then rows

`RestoreDeps` gains `moduleBlobs(section)`, wired to
`ModuleHost.collectImportBlobs`, which parses the section exactly as
`applyImports` does and then asks each module's `importBlobs`. On that answer:

* **Every file the archive carries is written into the store BEFORE the module's
  importer runs** — the same before-the-transaction discipline the attachment
  loop already had, and for the same reason: a row that names bytes nobody
  wrote is the failure this ordering makes impossible.
* **What it wrote is counted in `writtenBlobs`** (`saveBlob`'s `created: true`),
  so undo removes exactly the files this restore added and nothing else. The
  count it removes them by includes the modules, because `blobRefCount` does.
* **A hash a module's rows name and the archive does not carry is a
  `missing-blob` WARNING**, at the preview, naming `blobs/<hash>` with the
  module id as its detail — exactly the problem `parseImportArchive`'s rule 8
  raises for a built-in row. The row still restores, keeping its hash, and the
  module's own page draws the file it cannot find. That is also what an archive
  written by a pre-ADR-108 build is: **older archives import unchanged**, with
  their rows and without their files, and the count of those files reaches the
  user in the restore's own `missingBlobs`.

Foreign import is deliberately untouched: `data/modules.ndjson` is not part of
any format it reads (`foreignImport.ts` says so), so it has no module section to
carry files for.

## 6. What this does not do

* **No migration.** A module's rows and the built-in tables are unchanged; the
  hook is a registration, not a schema.
* **No new IPC and no new copy.** The `missing-blob` problem and its two
  sentences already exist; a module's lost file reuses them with the module's id
  in the detail. The renderer learns nothing new, and no channel crosses the
  bridge that did not before.
* **No change to ADR-090 §5.** The kit section is still one versioned JSON
  value per module, still opaque to core, still whole in every subset. The blob
  list is a sibling input, and the module's `parse`/`apply` pair is untouched.
* **A module with blobs and no `importData` is still refused** as an
  un-restorable section at the preview, which is what it was before: the hook
  cannot restore rows nothing knows how to write.
* **The delete-side list is unchanged, and a whole-profile delete still leaks a
  module's files.** `profiles:delete` asks `ProfileStore.blobHashes` which
  hashes a profile's rows name, and that query is a hand-written union of its
  own: the built-in five (note, task and subject attachments, the dashboard
  background, the profile picture) plus culture's two. It cannot be built from
  this hook — the hook is on main's `ModuleContext` and the query is in
  `@nexus/db` — so deleting a profile reclaims a culture ticket but leaves a
  recipe photo, a receipt, a recording and a cover on disk. That is a LEAK, not
  the loss this decision removes: a hash the list never names is never handed to
  the collector at all. Every other GC path — a module's own row deleted, an
  undo, a restore's overwrite — goes through `blobRefCount` and reclaims them
  correctly. Closing it means handing the profile's module hashes to that walk
  in `profiles:delete`, which is a change to that function's arrangement rather
  than to the kit.

## 7. Alternatives rejected

* **A per-module `blobs` table in the database**, listing module, hash and size,
  so main could ask SQL instead of a module. A second copy of a fact the rows
  already hold, kept in step by hand — the exact failure mode this ADR removes,
  moved one level down.
* **The blob list as a field on `ExportModuleData`** (`{ moduleId, payload,
  blobs }`). It would put the fact inside the record core must not read, change
  `data/modules.ndjson`'s shape, and force a real schema bump for what is a
  sibling of the section rather than a part of it.
* **Letting the module declare its own `blobs/<sha256>` entry through a core
  hook.** Core would then be calling into modules while it builds an archive,
  which is the dependency direction ADR-090 exists to prevent.
* **Keeping the hand-written list and enforcing it with a test.** A test can pin
  the modules that exist today; it cannot refuse the module that ships next
  month without its line, which is the bug.
* **Making the restore's `moduleBlobs` dep optional**, so a build that forgot to
  wire it still compiled. A default of "no module names a blob" is silently
  missing files — the defect, made permanent.

## 8. Consequences

* The two functions in `main/index.ts` no longer name a module. A new module
  with files adds one registration in its own folder, and `adding-a-module.md`
  §6 names it.
* `ModuleHost` gained four readers (`blobRefCount`, `blobMimeForHash`,
  `collectBlobs`, `collectImportBlobs`) and one session builder shared with the
  export, import and session-hook paths, so a session means one thing.
* The archive carries module files with no version bump and no new manifest
  field; a restore onto another machine brings a recipe's photo with it.
* Culture's `refCount`/`mimeForHash` are database-wide, which fixes the
  cross-profile deletion and the 404'd ticket above.
