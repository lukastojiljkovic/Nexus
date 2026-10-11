# ADR-106 — The assistant module: the kit's first stateful, networked, streaming surface

**Status:** accepted (2026-10-10) · **Owner:** the `assistant` run · **Amends**
nothing; it joins the eight parts ADR-095 built to a page.

## 1. What this decides

The assistant existed as eight libraries with fakes of each other (ADR-095, ADR-096,
ADR-097, ADR-104, ADR-105). This run built the thing a person uses:
`modules/assistant/` — the manifest, the contract, the handlers, the chat page, the
setup, the model chooser and the conversation store — and made four decisions the
earlier ADRs left open because no module existed to make them.

## 2. A turn is a cursor, not a subscription

The kit's IPC is request/response and its preload bridge has no push channel, by
design (ADR-090 section 2). A streamed answer therefore cannot arrive by itself, so a
turn is:

```
send(conversationId, text, workflowId?) -> { turnId }
poll(turnId, cursor)                    -> { events, nextCursor, done, thread }
stop(turnId)                            -> null
```

**`cursor` is the sequence number of the last event the page has read, and the page
asks from it.** A poll answers every event with a greater number, `nextCursor` is the
last one it handed over (or the cursor it was given when there was nothing new), and
`done` is whether the turn has ended. That is one integer travelling back and forth,
which is smaller than a subscription and needs no change to any other module's
bridge.

**The finished turn is dropped when it has been read.** Main writes the turn's
messages into the conversation, marks the turn finished, and hands the saved thread
back on the poll that reads `done` — then forgets the turn in the same breath. A page
that stopped polling a moment before the answer arrived still reads it, because the
buffer outlives the turn until somebody has read it.

**One turn at a time per profile, refused by name.** A second `send` while one runs
is refused with the running turn's id in the message, so a page has something to
stop. Two profiles in one window may each run one: the rule is per profile, which is
what "one turn" means when several accounts are open.

## 3. A confirmation is an event, and the contract is not edited

`AgentEvent` is the loop's vocabulary and has no variant for "a tool is asking".
ADR-095 section 4 says a part that needs more than a type extends its own interface,
so the module declares `AssistantTurnEventView = AgentEvent | { type: "confirm",
requestId, tool, summary, effect }` and answers it with `answerConfirm(requestId,
allow)`. A `write` or `network` tool parks on `ToolContext.confirm`, main emits the
event, and the page draws the house `ConfirmDialog` with the tool's own one-line
summary.

Three rules the page cannot be trusted to keep, so `ConfirmPark` keeps them:

* an id nobody is waiting on answers `false`, and a question answered twice answers
  `false` the second time — a double click cannot resolve a tool twice;
* a stopped turn, a session end and a page that leaves (`stop` from the page's own
  cleanup) resolve every parked question as **refused**, which is an ordinary result
  and not an error;
* the promise a tool is parked on is created before the event is emitted, so a
  refusal can never arrive before the question.

## 4. The renderer never names a model file

`setup` and `searchModels` are the only ops that produce a `ModelEntry`, and main
remembers every entry it produced: `downloadModel` takes an id and looks it up there.
A renderer that could send an entry would be sending a URL and a SHA-256, and
ADR-092's whole shape is that neither is the renderer's to choose. A download runs
only in the `downloads` network mode (the download service's own rule), and the
models screen says which mode it needs and offers the way to that setting instead of
a button that would fail.

**Progress is polled too.** The download's progress row rides in the `setup` answer,
because a push channel is the one thing the kit does not have; the page polls while a
download runs and stops when its status is no longer `running`.

## 5. The knowledge index is optional, and the embedding model is discovered

Retrieval must work with no model loaded (ADR-104 section 5), and the same argument
applies one level down: the module looks for the first installed entry whose
capabilities include `embedding` and answers `null` when there is none, so a machine
with one chat model has a full-text knowledge base and the settings card says so. A
separate "embedding model" setting was considered and refused: it would be a second
chooser for a decision the runtime already reports.

## 6. The archive carries the conversation, not the model

Migration 091 adds three tables to the profile's encrypted database:
`assistant_conversations`, `assistant_messages` and `assistant_settings`. They are
**not** in `RESTORE_WIPE_TABLES`, on the kit's structural rule (ADR-090 section 6):
the module replaces its own rows inside the restore's one transaction through
`ModuleContext.importData`, and `imex/restoreStore.test.ts` names all three beside
the timers module's.

A `ModelEntry` is deliberately not in the section. A model is a file on one machine
and a download that would have to be repeated; carrying it would promise either a
restore that fetches gigabytes or a row pointing at a file that is not there. What
travels is what the person wrote: the thread, the id of the model that answered it,
and the tier they chose.

## 7. Voice is not wired here

ADR-105 built `createVoiceService`, and the composer will grow a microphone button
and an attach button. This run leaves that seam open and builds neither: the module
composes the model runtime, the knowledge base, the tools, the web service and the
conversation store, and the voice service's construction belongs to the run that
builds its surface, because it needs a worker host whose lifetime is that run's
decision. The composer is one component with an actions row beside it, which is where
the two buttons go.

## 8. Navigation: one window event, and deliberately shallow

A kit module's page is handed its `profileId` and nothing else (ADR-090), so a
citation that names a place in the app has no prop to call. The module asks the shell
on the window, under `nexus:open-location`, with an `AppLocation`; `App.tsx` gains one
listener that shows `location.module` and, when `settings` names a module publishing a
settings card, opens that card. The request goes to the renderer rather than through
main because which page is shown is the shell's state, and main has no business
knowing it.

`location.item` travels with the request and is not yet acted on: revealing an item
means a per-module intent (`PendingIntent`), and inventing one per module from this
side would be guessing at shapes other modules own. The listener is where that lands
when it is built.

## 9. Group and copy

The module is `knowledge` (ADR-093's own reading of the group: the recorder is there
because it handles what somebody wrote down, and this is the same thing one step
further), `order: 240` — after the translator and before the maker's tools — with a
prefix (`ASST`) of its own. `defaultEnabled: true`, and `ESSENTIALS_MODULE_PRESET`
gains its one line, because it writes nothing until somebody asks it something and its
page is where a person learns where models come from.

## 10. Consequences

* A turn is bounded: `MAX_TURN_EVENTS` (8 000) stops a model that will not stop
  talking, and hitting the cap aborts the turn rather than growing the buffer.
* A locked or switched profile drops everything this module built, `unloadAll`
  included. The model runtime is an Electron utility process of this app, so quitting
  the app takes the child with it — that is what "the utility process must not outlive
  the app" means in practice.
* `check:egress` is unaffected: the only files that reach the network are the ones
  ADR-092 and ADR-097 already named, and this module adds none.
* The manual gains one page in each language (`assistant.md`), which is what the
  `check-manual` census follows.
