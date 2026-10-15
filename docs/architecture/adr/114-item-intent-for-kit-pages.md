# ADR-114 — A citation's item reaches a kit page: one held intent, and the wiki page that reveals it

**Status:** accepted (2026-10-15); amended by [ADR-117](117-assistant-acts-through-the-page.md),
which makes the held item a queue per module and adds an action arm to the intent.
**Owner:** the run that closed the citation
loop. **Amends [ADR-106](106-assistant-module.md) §8**, which sent
`location.item` to the shell "for a shell that learns to reveal one" and said in
so many words that no shell did.

## 1. The finding: the one citation that could not be clicked

The assistant cites the leads of the Wikipedia articles it reads (ADR-104). A
manual page's citation opens the module the page is about (Settings, where the
page's subject is a card there), a file's opens the module that owns the
attachment — and a wiki citation was plain text. The reason was exact and visible
in one line of `knowledge/sources.ts`: `wikiHits` built
`{ kind: "wiki", id, title, locator: "lead" }`, and `citationTarget` in the
assistant page answers `none` for anything with neither a `location` nor an
https address, so the citation was drawn as a `<span>` — the plain-text shape
`CitationTarget` names for precisely this. The module that could open the article
— `wiki`, whose `read` op is handed a `libraryId` and a `zimPath` — was exactly
the module the shell had no way to reach, because a kit page is handed its
`profileId` and nothing else (ADR-090, ADR-106 §8).

**The decision.** A wiki citation names its place, the shell holds that place's
item for the page of the module it named, and the wiki page reveals the entry the
item names.

## 2. The citation carries its place, and the place is the reader's own path

`wikiHits` now answers `location: { module: "wiki", item: title.path }` beside the
id it already carried, and the id stays `title.path` — one string, read twice.
That string is the shape `zimWiki.ts` fixes for every library it searches:
`<library id>/<entry path>`. It was already the reader's own addressing, so the
item needed no new field on either side and no second spelling of "which article":
the passage and the page cannot name different articles, because they name the
same string.

Nothing else about the citation changed. `citationTarget` already preferred a
`location` over an address, so the citation became a button the moment the
location was there, and the assistant page grew no branch for the wiki.

## 3. The kit page contract gains an intent pair

`ModulePageProps` (`shared/moduleApi.ts`) gains two optional members, which is the
smallest change that lets a kit module receive "reveal this item":

```ts
export interface ModulePageIntent {
  readonly kind: "reveal";
  readonly item: string;
}

interface ModulePageProps {
  readonly profileId: string;
  readonly intent?: ModulePageIntent | null;
  readonly onIntentHandled?: () => void;
}
```

**The item is opaque, and the shell does not learn any module's ids.** The one arm
carries `item`, not a field per module, because the shell cannot know what a
circuit id or a library path looks like, and a shell that guessed them would be a
second opinion about another module's shapes — `App.tsx`'s `dispatchIntent` can
name `noteId` and `taskId` only because those pages are compiled into the shell
beside it. Reading the item is the module's own job, exactly as reading its own
ids on its own page is. That is also why the intent is NOT an arm of
`PendingIntent` (021-e): that union is closed over the compiled-in pages' own
payload types, and a `module: string` arm would make every
`pending?.module === "electronics"` beside it narrow to two shapes at once.
`renderer/src/moduleKit/itemIntent.ts` is that state's home, with the same rule
`PendingIntent` keeps: at most one, cleared when its page reports it handled.

**It is a value the shell holds, not an event the page must hear.** A kit page
arrives in its own chunk (`moduleKit/pages.ts`, ADR-090 §4), so the page a
citation is aimed at may not exist at the moment it is clicked — an event raised
then would be heard by nobody. `App.tsx` therefore keeps what
`holdItemIntent(moduleId, location.item)` answered in state, and every render
asks `intentForPage` what the page being drawn is owed; a page that mounts a
second later reads the same answer, and a page that has already reported the
intent consumed is owed nothing.

**A second press is a new value.** Two clicks on the same citation must reveal the
article twice, and a page's effect keys off the prop's identity: handing back the
object it already consumed would leave the page sitting still on the second
press. So every request builds a fresh intent, while a re-render of the shell for
any other reason hands the page the very same reference — which is what keeps the
reveal from repeating itself.

**A module that ignores the prop behaves exactly as it did.** Both members are
optional, the shell passes `null` for every page a location did not name, and
`KitModulePage` only forwards what `App.tsx` computed: it decides nothing about
the intent, so a module with no use for one cannot tell that it was ever there.

## 4. The wiki page reveals it

`modules/wiki/renderer/Page.tsx` consumes the intent in one effect, and the effect
does what a search result's row already does: `open(libraryId, zimPath)`, which is
the module's `read` op, which records the visit and answers with the article the
page frames. The item is split by `itemTarget` (`renderer/zimView.ts`), the page's
pure half — and it is split at the FIRST slash, because a library id is kebab-case
with no `/` in it (`zim/libraries.ts`) and everything after the boundary, slashes
included, is the entry's own path.

An item that names no entry, a library that has been removed since the answer was
written, and an entry that is not in the file all land on what the page already
shows for an article it cannot open: `problem` = `not-found`, „Ova stranica nije
nađena u biblioteci". No new failure path was built for this, and none is
promised: the citation is a link to a place, and a place that is gone says so in
the words the module already had.

## 5. Consequences

* `AppLocation.item`, which `modules/assistant/renderer/location.ts` sends, now has
  one reader, and both that file's comment and `App.tsx`'s say so rather than
  saying a shell could learn to reveal one.
* A kit module that wants a location's item reads exactly one prop pair, and needs
  no event, no subscription and no change to the kit's discovery.
* Source kinds whose citations carry no location (a note's, a task's, a pack
  article's) are untouched: they are still text, and the module that would reveal
  them has to name a place first, as the wiki now does.
* The `file` source's location already carried an item — the note or task the
  attachment hangs off (`attachmentSource`) — and that one is still read by
  nobody. The notes and tasks pages are compiled into the shell and take their
  intents from `dispatchIntent`, so teaching them is that mechanism's job and not
  this one's; the held item is handed to kit pages only.
