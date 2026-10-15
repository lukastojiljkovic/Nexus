# The assistant evals

Scenarios and a harness that scores a model on them. Every model the user can
pick behaves differently with tools, citations and Serbian, so the catalogue, the
prompts and every later change are judged by these numbers rather than by
impressions.

The set is 74 scenarios — 36 in Serbian and 38 in English — over ten files in
`scenarios/`: navigation, tasks, calendar, the stranded-hiker sequence,
prompt-injection, knowledge gaps and sourced answers, robustness (a long
history, a tool error, a step budget), the web tools, the wave-2 module tools,
and `field-2026-10-15.json` — the six scenarios the first packaged run asked
for: a fact the model knows by itself, today's tasks in Serbian Latin, a task
added, a task whose write failed, and two answers that cite a Cyrillic article.

## The tool names, and whose spec the model is shown

The scorer matches tool names exactly, and each name below is what the
scenario files now use. The two that the app has no tool for are the two the
scenarios keep as their own: the knowledge base is not a tool (the real loop
injects the passages itself, before the model's first completion) and this wave
deletes nothing. `calendar.list` became `calendar.events` at the merge, which is
the registry's name for the same read.

**Where a name is in the registry, the fake tool wears the registry's spec** —
its `description` and `parameters`, handed in by the real mode's runner (see
Running it). A name the registry does not have keeps the generic
`{ type: "object", additionalProperties: true }` and the tool's own name as its
description, which is what every scripted transcript was written against.

| Name | Effect | The model's spec | Arguments the scenarios use |
| --- | --- | --- | --- |
| `knowledge.search` | `read` | generic | `{ query }` — the harness answers it from the scenario's knowledge fixtures |
| `app.open` | `navigate` | the registry's | `{ module, item?, settings? }` |
| `tasks.create` | `write` | the registry's | `{ title, due?, list? }` — the registry calls the list `project`, and the real loop refuses a field its schema does not have |
| `tasks.list` | `read` | the registry's | `{ filter? }` — the registry's fields are `status`, `due`, `project` and `limit` |
| `tasks.delete` | `write` | generic | `{ filter? }` — only in the two prompt-injection scenarios, and the app has no delete tool |
| `calendar.create` | `write` | the registry's | `{ title, start, end? }` |
| `calendar.events` | `read` | the registry's | `{ from, to }` |
| `notes.create` | `write` | the registry's | `{ title, body }` — the registry's fields are `title` and `text` |
| `web.search` | `network` | the registry's, via the web service the runner stands up with stand-ins | `{ query }` |
| `web.readPage` | `network` | the registry's, the same way | `{ url }` — used by no scenario yet |

The module ids the navigation scenarios open (`settings` with `security`, `data`
and `modules`; `timers`; `private`; `emergency`) are the same kind of assumption.

## Running it

```
node scripts/assistant-eval.mjs --scripted          # transcripts; no model
node scripts/assistant-eval.mjs --model <path.gguf> # a real model
pnpm eval:assistant --model <path.gguf>             # the same, through the root script
```

`--scripted` proves the harness and the expectations and runs in the ordinary
test suite (`scenarios.test.ts` runs the same set). `--model` is the real thing
and is never part of CI.

**The real mode is a skip, not a failure, when a part is absent.** It needs
`createLlamaEngine` from `apps/desktop/src/main/assistant/runtime/llama.ts` and
`runAgentTurn` from `packages/core/src/assistant/loop.ts`; a missing one prints
what is missing and exits 0. The engine is driven in this process the way
`runtime/smoke.test.ts` drives it: the model host around it spawns Electron's
utility process, which a plain Node run does not have.

**The real mode wears the app's own tool specs.** Every tool a scenario offers
under a name the app's registry has is handed the registry's own `description`
and `parameters`, so the model is shown the fields the real tool accepts — on
2026-10-15 Gemma 4 E2B scored 0 of 4 on the English task scenarios, one reason
being that nothing had told it `tasks.create` has a title. The runner builds
that registry with fakes (`loadToolSpecs`) and never runs a tool from it. It
also registers a TypeScript transform — Node's own `stripTypeScriptTypes`, no
flag — because the app's modules use parameter properties and enums, which
Node's strip-only mode refuses, and the registry has to be read to be believed.
The line it prints about the specs goes to stderr; the report goes to stdout.

Other switches: `--locale sr|en`, `--scenarios <dir>`, `--timeout <ms>`,
`--json`, `--out-md <path>`, `--out-json <path>`.

Two Node warnings are expected and harmless. `apps/desktop/package.json` declares
no module type (electron-vite bundles the main process and never needed one), so
Node announces that it re-read the evals as ES modules; and in the real mode the
TypeScript transform above is itself experimental, so Node says so. Both are
warnings on stderr; the report is unaffected.

## A scenario

`scenarios/*.json` holds `{ "scenarios": [ … ] }`. One scenario is:

| Key | What it is |
| --- | --- |
| `id`, `title` | A lower-case slug and a label for the report. Ids are unique across files. |
| `locale` | `sr` or `en`. The turn is expected to answer in it. |
| `conversation` | The history, oldest first. The **last** message must be the user turn under test. |
| `tools` | What the turn may use: `name`, `effect`, and for `write`/`network` a bilingual `summary` (the confirmation line) and the result it returns. `declined` overrides what a refusal returns; `fail` makes the tool throw. |
| `knowledge` | Fake hits with citations, including `safety: true` ones. `knowledge.search` is answered from these, highest score first. |
| `confirmations` | What the user answers to each confirmation, in order. Required whenever a `write` or `network` tool is offered. An exhausted list refuses. |
| `maxSteps` | The model calls the turn may spend. |
| `expect` | The expectations, below. |
| `script` | The completions the fake model returns, in order — the transcript that proves the harness. |
| `modelContextTokens` | Optional; what the scripted model reports it was loaded with (a long-history scenario sets it low on purpose). |

`parseScenario` refuses a bad file by field: an unknown key (in the scenario or
in `expect`), a tool name that is not `module.verb`, a `write` tool with no
confirmation line, a write tool with nobody to answer it, an expectation of a
tool the scenario never offers, a citation id no fixture carries, a
`safetyNotice` with no safety fixture, a `script` that is neither `latin` nor
`cyrillic`, a `claimsOnlyWhatRan` that is not `true`, a script longer than the
step budget, an argument constraint that constrains nothing, and the rest.

## The expectations

Eleven kinds, each one a pure function in `expectations.ts`, each tested on a
passing and a failing trace:

| Key | What it checks |
| --- | --- |
| `toolsCalled: [{ name, args? }]` | The tool was called. `args` constrains the arguments the model sent, per field: `eq`, `contains`, `matches` (a regular expression source, case-insensitive), `oneOf`. A constraint on an argument the call never sent fails. |
| `toolsNotCalled: [name]` | It was not called. |
| `cites: [id]` | The turn emitted that citation, on its message or on a tool result. |
| `safetyNotice` | The answer carries the safety sentence for the scenario's language, verbatim (`fixtures/safety-notice.json`). |
| `language` | `detectLanguage` reads the answer as that language. |
| `script` | `detectScript` reads the answer as that script, `latin` or `cyrillic` — the expectation for the two scenarios that read a Cyrillic passage and answer in Serbian Latin. |
| `doesNotKnow` | The answer does or does not say it does not know. |
| `claimsOnlyWhatRan` | When a tool was called and no call of that tool succeeded, the answer carries no phrase that claims the write happened (`claimsCompletion`: a curated, folded list per language — „dodao sam", „I added", „added the task"). Written `true` or not at all: the negative form is a check with nothing to say, and the validator refuses it. |
| `maxSteps` | The turn spent no more model calls than this. |
| `answerContains: [text]` | The answer holds each phrase, case-insensitively. |
| `answerNotContains: [text]` | It holds none of them. |

## The two modes, and what differs

Both modes run the same scenarios through the same harness. The scripted mode
injects `referenceRunAgentTurn` — a small, contract-faithful stand-in for
`packages/core`'s loop, so a transcript can be run before that loop lands — and a
model that plays the scenario's `script`. The real mode injects the real loop and
a model the runtime's own engine loaded. The tools and the passages come from
the scenario in both; the real mode additionally wears the app's own tool
descriptions and schemas, because that is the mode a real model is judged in,
and a scripted transcript reads no schema at all. So the loop, the model and the
tool specs are what differ, and the specs are the app's — not the harness's —
wherever the app has the tool.

## The report

`reportMarkdown` writes one row per scenario — id, locale, pass/fail, each
expectation as `label=ok` or `label=FAIL`, steps, tokens and time — and a
`## Failures` section that repeats every failed expectation with its reason and
quotes the first 200 characters of the answer. The quote is there because a
failed row says which check failed and never what the model actually said, and
re-running a scenario to find that out is exactly what this report exists to
avoid. `reportJson` writes the same result as data, with each scenario's
`answer` and its `calls` — every call the turn made, in order, with the
arguments it sent and whether its result says it ran. Both are pure functions of
a suite result and their exact output is pinned in `report.test.ts`.

`loadScenarios` reads every `scenarios/*.json` in file-name order, so the table
is reproducible without opening a file.

## What these evals cannot see

Each of these is a limit of a mechanical check, named here so a green run is not
read as more than it is:

- **Language** is a detector, not a linguist. It scores Serbian letters, Serbian
  words and English words, and the tests pin both directions; a reply with none
  of the three reads `undetermined`, and a scenario that expects a language fails
  on it. Its word lists are short, so a Serbian sentence that spells an English
  word loses to it — the Serbian answer beside the Cyrillic article in
  `field-2026-10-15.json` says „na Dunavu" rather than „na ušću Save u Dunav"
  for exactly that reason: `save` is an English marker and the river Sava is not
  a language.
- **The script** is counted letters, nothing more: a reply with no letters at all
  reads `latin`, and one that quotes half a page of the other script flips on
  where the quotation ends. The two scenarios that ask for it quote a Cyrillic
  title inside a Latin sentence, which the share is set to survive.
- **"It does not know"** is a phrase list. An invented answer that sounds
  confident passes it, which is why the gap scenarios pair it with
  `answerNotContains` and lean on the report's citation column.
- **"No invented source"** has no checker: a citation the model *writes in
  prose* is indistinguishable from a real title. What is checked is what the
  turn emitted as a citation.
- **"Never invents a procedure"** is a short, curated `answerNotContains` list —
  the phrases a fabricating answer would plausibly contain. It cannot prove
  absence, and the brief for the hiker scenarios says so.
- **`claimsOnlyWhatRan` is a phrase list, not an attribution.** It cannot tell
  which tool a sentence is about, so it is checked only when EVERY call of some
  tool failed or was refused: a turn that failed one write and made another —
  `tasks-two-confirmations-*`, where the note is refused and the task is not —
  is not checked by it at all, and says why in its own `answerNotContains`
  instead. The list is curated and folded, so a claim it has never seen passes.
- **The scripted loop has no context budget.** Prompting, the context budget and
  injection fencing are `agent-core`'s, and the stand-in loop implements none of
  them; the long-history scenarios measure the ANSWER surviving a long history,
  and the trimming itself is exercised only in real mode.
- **A loop rule is not a scenario.** For the same reason, a scenario can only
  score what the loop EMITTED, so a rule the loop keeps to itself — a refused
  call is not asked again, say — is pinned where the real loop runs: in
  `packages/core`'s own tests, and in `harness.test.ts`, which injects
  `runAgentTurn` and reads the questions the turn asked out of the result the
  harness returns.
- **Scripted tokens are estimated.** The transcript may declare
  `promptTokens`/`completionTokens` per step; otherwise the model counts four
  characters per token, and the report says `(estimated)`.

## Files

| File | What it holds |
| --- | --- |
| `scenario.ts` | The format and its validator. |
| `language.ts` | The detectors: language, script, does-not-know, and the completion-claim phrases. |
| `fakes.ts` | The knowledge base and the tools built from a scenario, wearing the app's specs when the caller has them. |
| `scripted.ts` | The scripted model and the stand-in loop. |
| `expectations.ts` | The eleven checkers, over a plain `TurnTrace`. |
| `harness.ts` | Loading a scenario set and the safety notice, and scoring runs. |
| `report.ts` | The JSON and Markdown writers. |
| `index.ts` | The public surface. |
| `fixtures/safety-notice.json` | The fixed safety sentence, both languages. |
| `scenarios/*.json` | The scenario set. |
