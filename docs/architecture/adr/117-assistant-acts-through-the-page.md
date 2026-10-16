# ADR-117 — The assistant acts through the page: an action a location carries, a queue per module, and every area gets tools

**Status:** accepted (2026-10-15). **Owner:** the run that built the assistant's
tool seam. **Amends [ADR-114](114-item-intent-for-kit-pages.md)**: the held item
becomes a queue per module, and the intent gains an action arm. ADR-114's text is
kept as it was accepted. Number 115 was never written, and 116 is taken, so this
is 117.

## 1. The finding: a tool could answer "opened" and the view never moved

The assistant's `app.open` answers "Opened module …" and returns
`navigateTo`. Nothing consumed `navigateTo`: only a citation click reached
`openAppLocation`, so the sentence was true of a tool result and false of the
screen. Five more defects sat beside it, each one a place a later area's tools
would have landed on a broken seam:

- the shell held ONE item for one module, so a second request overwrote the first
  and a request for another module cleared it (`itemIntent.ts`);
- the kit page contract had one arm, `reveal`, so a page whose state lives in
  memory (Canvas holds its scene and autosaves every 800 ms; a device preference
  lives in the renderer's `localStorage`) could only be told what to show, never
  what to change, and a write from main would be clobbered by the page's next save;
- a location naming a compiled-in page's item (`tasks`, `notes`, `calendar`) was
  held as a kit item that page never read;
- the assistant page kept one confirmation, so two `confirm` events in one step
  overwrote each other and the first tool waited forever;
- a failed turn (every `error` except `aborted`) was dropped silently.

## 2. The decision: an action is a location's second half

`AppLocation` gains an optional `action: AppAction` (`{ name, payload? }`,
`packages/core/src/assistant/contract.ts`). A store-backed module writes in main
and answers `navigateTo` with an `item`, and the page reveals the row. A
page-held module answers `navigateTo` with an `action`, and its page applies it.
`name` is the page's own verb and is opaque to the shell, exactly as `item` is.

The action is NOT part of a citation. A citation is a link to where an answer came
from, and a link that changed something when it was clicked would be a command
wearing a link's shape. `citationTarget` strips an action from a citation's place
before the shell sees it, and a test pins that; nothing persists an action today.

## 3. The page intent has two arms

`ModulePageIntent` (`shared/moduleApi.ts`) is
`{ kind: "reveal", item }` or `{ kind: "action", action, payload, item? }`. A page
that does not know an action ignores it and still reports it handled
(`onIntentHandled`), so the queue moves on rather than parking a page that will
never act. The same rule applies to a page that is handed a reveal it cannot use.

## 4. The shell holds a queue per module

`renderer/src/moduleKit/itemIntent.ts` holds a `ReadonlyMap<moduleId, intents[]>`,
oldest first. A request enqueues one intent for its module; a request naming
neither an item nor an action enqueues nothing and leaves every queue alone;
`dropIntent` removes the head when the page reports it handled. Each request
builds a fresh intent object, so two requests for the same place reveal twice.
Compiled-in pages (`tasks`, `notes`, `calendar`, `study`) keep their typed
`PendingIntent` and do not use the queue: `App.tsx`'s `compiledInReveal` maps the
item onto the shape each one declared, and `study` gets nothing, because its reveal
needs more than an id.

## 5. The assistant opens what the turn asked for, when the turn ends

Opening a place unmounts the page that asked, and the assistant page's unmount
stops its turn. So `renderer/turnLocations.ts` reads the `navigateTo` of every
`tool-result` of a finished turn, in order, and the page opens them after the poll
reads `done`. The assistant's own page is dropped, and a repeated place is
collapsed only when it carries no action. A turn that ended in an error, or that
the user stopped, opens nothing; `tool-failed` is the one error the loop emits and
then carries on from (`loop.ts`), so it does not stop the navigation.

Parked confirmations are a queue too (`renderer/confirmQueue.ts`): the dialog
draws the oldest, answering drops it, and the end of a turn clears the lot. A
failed turn says why: each loop error code has one sentence in both locales
(`copy.{sr,en}.ts`, `thread.ts`'s `turnErrorSentence`), and the table is keyed by
the code, so a new code without a sentence does not compile.

## 6. The registry is ready for every area

Every module gets tools, one file per area, and the rule the next runs follow is
written in `apps/desktop/src/main/assistant/tools/index.ts` and in
[`assistant-tools.md`](../assistant-tools.md). This overturns the earlier reading
that the games, signals, workshop, drawings, the scanner and the translator had
nothing worth a tool: the assistant is meant to be able to do everything the app
can. The registry test pins a count per area, one line each, so a run that adds an
area changes only its own line.

## 7. Consequences

- A tool that acts on page-held state is written as an action, and its page's
  apply code is the only place that state changes. A page that is not mounted when
  the action arrives gets it from the queue when it mounts, as a reveal does.
- A store-backed tool still writes through the store its IPC handler calls, and
  its result says so in the row the user sees.
- An action's `payload` is validated twice, once by the tool and once by the page,
  because the window event between them is not a gate.
- The shell still knows no module's verbs or item shapes. A verb nobody handles is
  a no-op, which a test can miss, so each page's apply code has its own test.
- `study`'s location carries no reveal yet. Its page needs `entity` and `parentId`
  as well as an id, and an id alone does not say what it names.
