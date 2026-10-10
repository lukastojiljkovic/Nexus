# ADR-100 - The Reader module: content packs, read and printed

**Status:** Accepted (2026-10-10). **Owner:** the 2.0 wave (module `reader`, group
`knowledge`, order 200)

The survival handbook, the laws, the fairy tales, the car help and the maker
guides all arrive as packs of kind `content` (ADR-091). This ADR fixes what such a
pack IS - a folder of Markdown articles - and builds the module that reads them:
a shelf, a reading view with a table of contents, a search index in the profile's
cache, bookmarks with notes, a safety notice for reference material, and printing
through `webContents.printToPDF` so the pages survive the computer.

## 1. What a `content` pack is

ADR-091 fixes the pack's envelope; this ADR fixes its contents, because the Reader
has to know what to open.

- **Every `.md` file the manifest lists is an article.** Everything else the
  manifest lists is an asset - an image an article points at, later a map's tiles
  - and is never a page.
- **The folders are the chapters.** `1-zakoni/ustav.md` is an article called
  `ustav.md` under a chapter called `1-zakoni`. No index file is needed and none
  is invented: an index would be a second place the structure is written down,
  and the first thing to disagree with the files beside it.
- **Order is a number when the author gave one.** A path segment may open with up
  to four digits (`03-treca.md`) and that is the entry's order; everything else is
  sorted by the display name through `Intl.Collator(["sr-Latn", "sr"])`, with
  numbered entries first. A pack that numbers nothing is sorted by name alone.
- **The article's title is its first heading**, falling back to its file name with
  the order prefix and separators removed. Nothing else is needed, and no front
  matter is introduced: a format read by strangers should have one way to say a
  thing, and a heading is the way Markdown already says it.
- **The markdown subset** is ATX headings, paragraphs, blockquotes, bullet and
  ordered lists, fenced code, pipe tables, thematic breaks, and inline bold,
  italic, code, links, images and `<https://autolinks>`. Raw HTML and any link
  target that is not `http(s):`, a `#fragment` or a path inside the pack are
  REFUSED with the line they were on.
- **The `source` line of every article is the pack's own `source`**, shown as a
  link (the external-link rule), and the pack's `licence` is shown with it. An
  article does not carry a source of its own, because a pack is one publication.

**The one manifest field this ADR adds: `notice`.** A pack whose content is
reference material carries `"notice": "safety"` and is not installed at all by a
build that does not know that value - the direction a warning may be lost in is
the dangerous one, so an unknown notice is refused rather than ignored. It is
optional and additive inside `format: 1`; `scripts/pack-sign.mjs` learned the same
optional key, because a field the app reads but the signing tool refuses is a
field nobody can publish.

## 2. What the module renders, and how

Main sends the article's TEXT. The page parses it with the same parser in
`@nexus/core` (`reader/markdown.ts`) and renders React elements - there is no
`dangerouslySetInnerHTML` anywhere in the module, which is the whole of the XSS
story for content written by somebody else. A refusal names the line it was on, so
a pack's author can fix the pack.

An article's images are addressed relatively (`slike/ozleda.png`) and resolved
against the article's own folder by `resolvePackPath`, which refuses a target that
leaves the pack rather than clamping it. The same function serves the printed
document, so the page and the paper resolve a link identically.

## 3. `nx-pack:` - the scheme a pack is read through

A privileged scheme, registered at the end of `registerSchemesAsPrivileged` in
`main/index.ts` and handled by `main/packs/protocol.ts`. A request is
`nx-pack://<packId>/<path>` and is answered only when ALL of these hold:

1. the id is an INSTALLED pack whose manifest verifies against the release key
   (the `installed.json` index is re-read when its own mtime changes, and
   re-verified when it is rebuilt);
2. the path passes the pack path rules (`packPathProblem`), which the manifest's
   own parse already enforced at install time;
3. the path is one the manifest LISTS - so `../../nexus.db` is refused by not
   being in a list rather than by a comparison somebody has to keep right.

HTTP ranges are supported (206 with an exact `Content-Range`; 416 with the size
for a well-formed range past the end; an invalid spec is ignored and the whole
file served, which is what RFC 9110 says). This is not a convenience: a PMTiles
reader asks for byte ranges constantly, and a media protocol without them cannot
seek.

The content type comes from the extension and NEVER from the bytes. An SVG is
served as `application/octet-stream` - it draws inside an `<img>` and can carry a
script, so it is bytes here - and so is anything the table does not name.
`X-Content-Type-Options: nosniff` rides every answer.

`nx-pack:` is added to the CSP's `img-src` and `connect-src` (the second because a
map fetches tiles rather than drawing them in an image tag), and to
`net/offline.ts`'s `LOCAL_SCHEMES`, without which the renderer's request filter
would cancel a pack's images in the app's default mode.

## 4. Where the rest of the module lives

- **The shelf** lists every installed `content` pack as a book: its title, its
  size, its licence, its article count once its index exists, its bookmarks and
  where the reader stopped. A pack whose manifest carries `notice: "safety"`
  wears that mark, and the mark is an icon AND a word (the redundancy rule).
- **Reading positions, bookmarks and their notes, the reading size and the
  safety acknowledgements live in migration 084** (`reader_positions`,
  `reader_bookmarks`, `reader_settings`, `reader_acknowledged`), scoped by
  profile. A pack's content is never in the database: it is not one profile's
  data, must not enter backups, and is not secret (ADR-091 section 5).
- **The archive section** carries exactly those four things and is registered
  through the kit's `exportData`/`importData`, so a restore replaces the module's
  rows whole and an archive that names no Reader entry empties them. The tables
  are deliberately NOT in `RESTORE_WIPE_TABLES`: a kit module replaces its own
  rows (ADR-090 section 6), and that list is held equal to `@nexus/sync`'s
  collection map by `collectionGuard.test.ts`, which a module may not edit.
- **The search index** is built in MAIN, once per installed pack version, into
  `<userData>/reader-cache/<profileId>/<packId>/<packVersion>.json` - the
  profile's cache and not the database, because it is derived from a pack and can
  be rebuilt. Building reads one article per event-loop turn and reports progress
  (`articlesDone`/`articlesTotal`), which the page polls while it waits; a query
  is then a pass over strings, because each article's text is folded once when its
  index is loaded. A search answers titles first, then bodies, at most fifty
  hits, and a pack whose index is still building is reported as PENDING rather
  than as an empty answer.
- **Printing** builds an HTML document in main (the article, the chapter or the
  whole pack), renders it in a hidden `BrowserWindow` with JavaScript off, and
  hands it to `webContents.printToPDF` at A4 or A5. The pack's title and its
  safety notice ride Chromium's running header, and its licence, its source and
  the page number its running footer - which is the only way a repeated line can
  appear on every sheet. The document is monochrome and states its own stylesheet:
  a print view loads one file with no bundle, so design tokens cannot reach it,
  and paper is not the screen.
- **The safety notice** is one sentence in two languages, defined once in
  `modules/reader/shared/notice.ts` and drawn by the shared
  `renderer/src/safetyNotice.tsx`. It stands at the top of every article of a
  `safety` pack, on every printed sheet, and in a dialog that must be accepted
  before the first article of such a pack is read. Escape and the backdrop close
  that dialog - never the requirement: the pack stays unacknowledged and the
  question is asked again.

## 5. Consequences

- **A pack is read, never executed.** Nothing in the module evaluates a pack's
  bytes; the page renders elements, the protocol serves files, and the printed
  document is HTML built by escaping every value a pack supplies.
- **The Reader is the first surface with an external link**, so it is where the
  vetted wrapper landed: one module op (`reader:openExternal`) that main answers
  only for `http(s):` addresses, calling `shell.openExternal`. The shell's own
  comment said that wrapper would arrive with the first link, and this is it.
- **A pack that is removed is a shelf with one fewer book.** Positions and
  bookmarks that name it stay in the profile (they are the user's own words) and
  resolve again if the pack comes back.
- **A pack that is updated keeps its bookmarks only where the paths survive.** A
  path IS an article's identity, so a renamed file loses its position and its
  bookmark. The alternative - a synthetic id per article that has to agree with
  the manifest - is a second source of truth for the same fact.
- **`check:egress` is unaffected.** Nothing in the module constructs a request;
  the print view loads a `file:` from a temporary directory, and a pack's bytes
  arrive through a scheme the app itself serves.

## 6. Alternatives rejected

- **Rendering to HTML in main and injecting it** (`dangerouslySetInnerHTML`), on
  the strength of a sanitiser. One more parser in the trust boundary, for a
  feature the parser already gives: `reader/markdown.ts` refuses the two
  constructs that matter and the renderer never interprets markup.
- **Serving a pack's files over IPC.** A reader draws images and a map streams
  ranges; IPC would put a whole map in a JavaScript buffer to build a blob URL,
  and `Range` would have no path to the disk.
- **An index in the database.** It is derived from a pack, belongs to no backup,
  and would put a copy of somebody's library inside every profile archive.
- **A Web Worker for the search.** The index is built in main, which is not the
  UI thread, and a query is a string pass over at most a few megabytes; a worker
  would add a second copy of the search rules for no responsiveness anybody could
  measure.
- **Front matter for an article's title and source.** A second syntax in a format
  whose whole point is that a folder of Markdown is the book.

## 7. What this ADR does not do

- ZIM, map, dataset and model packs are listed nowhere and served by nothing: the
  library is exactly the packs this build can render.
- The Reader does not install packs. That is the Packs card (ADR-091), and the
  Reader's empty state says so.
- No download starts from here. The downloads run (ADR-092) owns the network, and
  a pack that arrives through it reaches this module the same way one from a USB
  stick does.
