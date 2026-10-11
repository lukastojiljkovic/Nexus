# The assistant evals

Scenarios and a harness that scores a model on them. Every model the user can
pick behaves differently with tools, citations and Serbian, so the catalogue, the
prompts and every later change are judged by these numbers rather than by
impressions.

The set is 50 scenarios — 25 in Serbian and 25 in English — over eight files in
`scenarios/`: navigation, tasks, calendar, the stranded-hiker sequence,
prompt-injection, knowledge gaps and sourced answers, robustness (a long
history, a tool error, a step budget) and the web tools.

## The tool names this set assumes

**Align these at merge.** The scorer matches tool names exactly, and the tools
run's brief was not available when these scenarios were written, so each name
below is one the contract's own examples suggest and the scenarios use. Renaming
a tool means renaming it in the scenario files (`scenarios/*.json`) and nowhere
else.

| Name | Effect | Arguments the scenarios use |
| --- | --- | --- |
| `knowledge.search` | `read` | `{ query }` — the harness answers it from the scenario's knowledge fixtures |
| `app.open` | `navigate` | `{ module, item?, settings? }` |
| `tasks.create` | `write` | `{ title, due?, list? }` |
| `tasks.list` | `read` | `{ filter? }` |
| `tasks.delete` | `write` | `{ filter? }` — only in the two prompt-injection scenarios |
| `calendar.create` | `write` | `{ title, start, end? }` |
| `calendar.list` | `read` | `{ from?, to? }` |
| `notes.create` | `write` | `{ title, body }` |
| `web.search` | `network` | `{ query }` |
| `web.readPage` | `network` | `{ url }` — declared in the catalogue, used by no scenario yet |

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
`createModelHost` from `apps/desktop/src/main/assistant/runtime/` and
`runAgentTurn` from `packages/core/src/assistant/loop.ts`, both built by other
runs of this wave; a missing one prints what is missing and exits 0. The runner
calls `createModelHost()` with no arguments, which is an assumption about the
runtime run's signature to align at merge.

Other switches: `--locale sr|en`, `--scenarios <dir>`, `--timeout <ms>`,
`--json`, `--out-md <path>`, `--out-json <path>`.

One Node warning is expected and harmless: `apps/desktop/package.json` declares
no module type (electron-vite bundles the main process and never needed one), so
Node announces that it re-read the evals as ES modules. It is a warning on
stderr; the report is unaffected.

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
`safetyNotice` with no safety fixture, a script longer than the step budget, an
argument constraint that constrains nothing, and the rest.

## The expectations

Nine kinds, each one a pure function in `expectations.ts`, each tested on a
passing and a failing trace:

| Key | What it checks |
| --- | --- |
| `toolsCalled: [{ name, args? }]` | The tool was called. `args` constrains the arguments the model sent, per field: `eq`, `contains`, `matches` (a regular expression source, case-insensitive), `oneOf`. A constraint on an argument the call never sent fails. |
| `toolsNotCalled: [name]` | It was not called. |
| `cites: [id]` | The turn emitted that citation, on its message or on a tool result. |
| `safetyNotice` | The answer carries the safety sentence for the scenario's language, verbatim (`fixtures/safety-notice.json`). |
| `language` | `detectLanguage` reads the answer as that language. |
| `doesNotKnow` | The answer does or does not say it does not know. |
| `maxSteps` | The turn spent no more model calls than this. |
| `answerContains: [text]` | The answer holds each phrase, case-insensitively. |
| `answerNotContains: [text]` | It holds none of them. |

## The two modes, and what differs

Both modes run the same scenarios through the same harness. The scripted mode
injects `referenceRunAgentTurn` — a small, contract-faithful stand-in for
`packages/core`'s loop, so a transcript can be run before that loop lands — and a
model that plays the scenario's `script`. The real mode injects the real loop and
a model the runtime host loaded. The tools and the passages come from the
scenario in both, so the loop and the model are the only variables.

## The report

`reportMarkdown` writes one row per scenario — id, locale, pass/fail, each
expectation as `label=ok` or `label=FAIL`, steps, tokens and time — and a
`## Failures` section that repeats every failed expectation with its reason.
`reportJson` writes the same result as data. Both are pure functions of a suite
result and their exact output is pinned in `report.test.ts`.

`loadScenarios` reads every `scenarios/*.json` in file-name order, so the table
is reproducible without opening a file.

## What these evals cannot see

Each of these is a limit of a mechanical check, named here so a green run is not
read as more than it is:

- **Language** is a detector, not a linguist. It scores Serbian letters, Serbian
  words and English words, and the tests pin both directions; a reply with none
  of the three reads `undetermined`, and a scenario that expects a language fails
  on it.
- **"It does not know"** is a phrase list. An invented answer that sounds
  confident passes it, which is why the gap scenarios pair it with
  `answerNotContains` and lean on the report's citation column.
- **"No invented source"** has no checker: a citation the model *writes in
  prose* is indistinguishable from a real title. What is checked is what the
  turn emitted as a citation.
- **"Never invents a procedure"** is a short, curated `answerNotContains` list —
  the phrases a fabricating answer would plausibly contain. It cannot prove
  absence, and the brief for the hiker scenarios says so.
- **The scripted loop has no context budget.** Prompting, the context budget and
  injection fencing are `agent-core`'s, and the stand-in loop implements none of
  them; the long-history scenarios measure the ANSWER surviving a long history,
  and the trimming itself is exercised only in real mode.
- **Scripted tokens are estimated.** The transcript may declare
  `promptTokens`/`completionTokens` per step; otherwise the model counts four
  characters per token, and the report says `(estimated)`.

## Files

| File | What it holds |
| --- | --- |
| `scenario.ts` | The format and its validator. |
| `language.ts` | The reply-language and does-not-know detectors. |
| `fakes.ts` | The knowledge base and the tools built from a scenario. |
| `scripted.ts` | The scripted model and the stand-in loop. |
| `expectations.ts` | The nine checkers, over a plain `TurnTrace`. |
| `harness.ts` | Loading a scenario set and the safety notice, and scoring runs. |
| `report.ts` | The JSON and Markdown writers. |
| `index.ts` | The public surface. |
| `fixtures/safety-notice.json` | The fixed safety sentence, both languages. |
| `scenarios/*.json` | The scenario set. |
