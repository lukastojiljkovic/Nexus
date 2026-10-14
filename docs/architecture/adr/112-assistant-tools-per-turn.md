# ADR-112 — The assistant's tools per turn: what fits in the window, and a prompt that stops repeating them

**Status:** accepted (2026-10-14) · **Owner:** the run that repaired the turn
that could not fit · **Uses** ADR-095 (the assistant's contract and loop) and
ADR-104 (the knowledge base); amends neither.
No new dependency and no new schema: the choice is lexical, and it needs no
embedding model.

## 1. What this is

Measured on 2026-10-14, on the installed app: **every** assistant turn ended with
`error: model-failed`. The local model is loaded with an 8192-token context
(`LOAD_CONTEXT_TOKENS`), the answer reserves 1024 of it (`answerReserveTokens`),
and the request that the loop assembled did not fit the rest. These numbers, all
with the real registry (37 tools, web off), are why:

| piece | size |
| --- | --- |
| tool descriptions (`description.en`) | 7 183 characters |
| tool schemas (`JSON.stringify(parameters)`) | 14 636 characters |
| `buildSystemPrompt`, offered the whole registry | 11 164 characters (en) / 10 958 (sr) |
| the same prompt, with `tools: []` | 3 145 characters |

`buildSystemPrompt` listed every offered tool with its description, which was
about 8 000 of its 11 164 characters: only 3 145 are the instructions
themselves. The runtime then described every tool a second time on its own:
`functionsFrom` hands node-llama-cpp every tool as a `functions` entry with
`documentFunctionParams: true` (name, English description and schema, 22 271
characters for the registry), or `fallbackToolsBlock` writes the same three
things into a system block for a chat template that cannot call functions.

Nothing counted any of that. `planContext` measured the MESSAGES, approved a
request it believed was well inside the window, and the model call failed; the
loop caught the error with `catch {}` and emitted a bare `model-failed`, which is the
sentence a user saw and the whole of what a maintainer had to go on.

## 2. The prompt stops repeating the tool descriptions

The runtime documents every offered tool itself (both paths above), so
`buildSystemPrompt` keeps its "# What you can do" section and lists only the
NAMES, grouped by what each tool does to the app:

```
You reach the app only through the tools offered with this message.
- Tools that ask the user first: tasks.create, notes.append
- Tools that move the app's view: app.open
- Tools that only read: tasks.list, notes.search
```

A group with no tools is left out, `network` tools stand with `write` (both
change something outside the app and both ask first - `contract.ts`), and the
empty-set sentence is unchanged. `SYSTEM_PROMPT_VERSION` moved to
`assistant-2026-10-14.1`, because a score in an evals table has to be able to say
which prompt produced it.

## 3. Each turn offers only the tools that fit

`packages/core/src/assistant/toolChoice.ts` is a new platform-free module (no
platform import, no I/O, no clock; it takes `ToolSpec`s and returns a subset).

**The cost of a spec.** `toolSpecTokens = ceil(toolSpecCharacters / 2.1) + 16`.
`toolSpecCharacters` is the name, the English description and the serialised
schema - exactly what the template renders. The 2.1 is the lower of the two
measured JSON ratios in `budget.ts` (`CHARACTERS_PER_TOKEN_STRUCTURED`: sr 2.1,
en 2.6), taken lower because a spec's own language is not a property of the spec
and the conservative direction is the one that leaves the request short of the
ceiling. The 16 is an ALLOWANCE for the template's per-function scaffolding, in
the sense `CHAT_MESSAGE_OVERHEAD_TOKENS` states one: the marker and separator
characters a chat template spends on one function. It is not a measurement.

**The two limits.** `MAX_TOOLS_PER_TURN = 8` and `TOOL_BUDGET_SHARE = 0.4` of the
request ceiling (8192 - 1024 = 7168 tokens at the shipped context, so 2 867
tokens). Both are
POLICY numbers, stated as such in the module: the cap covers the recipes the app
ships with, and the share is deliberately under half so the prompt, the history,
the knowledge passages and the question all have room. The budget is what
actually binds; the cap is the ceiling on top of it.

**The choice is deterministic.** A set that is small enough AND cheap enough is
offered whole, which is every workflow's two to four tools. Otherwise the module
builds one ordered candidate list - the last turn's tool calls (up to four, which
is what makes a follow-up like „i još jedan" work), then every tool the question
scores, best first with ties in registry order, then `CORE_TOOLS`
(`app.search`, `app.open`), then the area siblings of everything already in the
list - and walks it, taking each tool that still fits and SKIPPING the ones that
do not, so one unaffordable favourite cannot hide a cheap answer. The result is
returned in REGISTRY order, so the prompt prefix a turn builds does not depend on
what happened to be scored.

**The score is lexical, and its limits are stated.** Words are lower-cased, `đ`
folds to `dj`, NFD strips the combining marks, anything outside `[a-z0-9]` splits,
words under three characters go, and a short two-language stop list goes with
them. A query word matches a tool word when they are equal or one is a prefix of
the other and the shorter is at least four characters - `zadatak`/`zadatke`,
`task`/`tasks` - which is the crude stemming this app can afford: it ships no
stemmer for either language, and a suffix table is a table that goes stale. A
tool's vocabulary is its name's area and verb plus both halves of its
description, because the USER's words are what is being matched and a Serbian
question often shares nothing with an English description. Points: 2 per matched
word of the question, 1 per matched word of the newest two earlier user messages
that the question did not already count.

**The budget counts the tools.** `planContext` gained `fixedTokens` (default 0),
added to every estimate it compares against the ceiling and to `requiredTokens`
in a refusal, because a tool spec is as much a part of the request as a message
is and cannot be trimmed the way one can. The loop passes `sum of
toolSpecTokens(offered)` as `fixedTokens`, offers exactly the chosen subset to
the model and to the tool runner, and counts `measured.characters` over the
messages PLUS the specs, because the model's own `promptTokens` counted the
tools too.

## 4. A model failure keeps its reason

`AgentEvent`'s error variant gained `readonly detail?: string`, set only for
`model-failed` with the runtime's own message; the module's event handler writes
it to the app's log (`console.error("Nexus: the assistant model failed:", …)`).
It is never drawn by a page. The turn that produced this ADR is the argument: the
sentence that says a schema was refused or a model ran out of memory existed for
one stack frame and then nothing.

## 5. The shipped workflows name tools that exist

`ASSISTANT_WORKFLOWS` listed `calendar.list` (the registry has
`calendar.events`) and `knowledge.search` (not a tool at all - the knowledge
block is injected into every turn by the loop). Both are gone, the checklists
that told the model to search now tell it to use the numbered passages it is
given, and a test in `tools/index.test.ts` checks every workflow's tool names
against `registryWith().tools({ web: false })`, so a name that stops existing
fails the build rather than selecting nothing at run time.

## 6. Consequences

A turn may lack the tool the user needed. That is the accepted cost of a request
that fits, and it is why `app.search` and `app.open` are always candidates: the
model can still find what the user recorded and still go there, and a question
whose tool was not offered gets an answer from the conversation and the knowledge
block rather than a failure. The score is lexical, so a question whose words do
not appear in any description falls back on the recent calls and the core tools -
which is also what a well-scored turn starts from.

Counted with the module's own estimates against the real registry (37 tools, web
off, 8192-token context, the question „Dodaj zadatak za sutra"): 8 tools offered,
2 640 tokens of specs, 1 431 tokens of Serbian prompt - 4 071 of the 7 168-token
ceiling, leaving 3 097 for the history, the knowledge passages and the question.
By the same estimate the 37 specs alone were about 11 200 tokens, more than the
whole ceiling. These are estimates, not a tokeniser's counts; the loop replaces
them with the model's own count after the first request.

## 7. Alternatives rejected

**A bigger context.** Raising `LOAD_CONTEXT_TOKENS` moves the problem to every
machine: the KV cache grows with the window, so a bigger context means more RAM
on hardware the app already recommends a model for, and a longer prompt for every
turn on a CPU. It also does not fix the ordering problem - 37 near-identical
schemas would still all be handed to a small model to choose from.

**A two-step "find a tool" meta-tool.** One extra model call per turn to select
tools, before the call that answers. On a laptop CPU each call costs seconds, and
the app's whole promise is that the assistant is usable offline on the machine in
front of the user. The selection here is arithmetic over words the turn already
holds, and makes no model call.

**A stemmer or an embedding model for the score.** A real Serbian stemmer is
another dependency to ship and maintain, and an embedding model is optional in
this app (ADR-104): most machines have none, so the choice cannot depend on one.
The prefix rule above is wrong in ways that can be named (`zadatak` and `zadatke`
match, as they should; so do `radi` and `radionica`, which should not), and
naming them is better than hiding them behind a model that answers with a
number.
