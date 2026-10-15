# ADR-116 — The grammar a tool call decodes under

**Status:** accepted (2026-10-15) · **Owner:** the run that repaired the turn
that added nothing and said it had.
**Uses** ADR-095 (the assistant's contract and loop) and ADR-112 (the tools a
turn offers); amends neither. No new dependency: the translation is arithmetic
over the schemas the registry already declares.

## 1. The finding

A packaged run of the 2.0.3 release candidate, with Gemma 4 E2B answering a
request to add a task, ended like this: the model called `tasks.create` with
`description: ""`, the schema refused the empty string, and the model then told
the user it had added the task. Nothing was added, and the user was told
otherwise.

**The runtime caused it.** `functionsFrom` handed every tool's JSON Schema to
node-llama-cpp as the function's `params`, and the library compiles that into
the GBNF grammar the model decodes under. Its own documentation
(`node_modules/node-llama-cpp/dist/utils/gbnfJson/types.d.ts`) states the rule:

> `required` is always set to all keys in `properties`, and setting it has no
> effect.

So every OPTIONAL property is forced. A model that has nothing to say for
`description` cannot leave the key out — the grammar requires it — and a string
it must write and has nothing to write is `""`. The library states its own
guidance for an optional value in the same file's `GbnfJsonOneOfSchema`:
`oneOf: [<the schema>, { type: "null" }]`.

The same type list shows the second gap. The grammar's string schema knows
`minLength`, `maxLength` and `format: "date" | "time" | "date-time"`, and no
`pattern`. The tools spell a calendar day as `pattern: "^\\d{4}-\\d{2}-\\d{2}$"`
(`tools/calendar.ts`, `tasks.ts`, `car.ts`, `pantry.ts`, `culture.ts`,
`habits.ts`, `recorder.ts`), so the grammar constrains those fields to *any
string*: `"tomorrow"` decoded, and validation had nothing to say about it
either, because `schema.ts`'s subset deliberately ignores a keyword it does not
know.

**The decision, in three parts.** The schema the model decodes under is built
from the tool's schema but not equal to it (`grammarSchemaFor`,
`runtime/messages.ts`); the arguments the model wrote are normalised before
anything validates them (`packages/core/src/assistant/arguments.ts`); and a
refused call comes back as a sentence the model can act on, with the trying
bounded per tool per turn (`runToolCalls`, `loop.ts`).

## 2. The schema the model decodes under

`functionsFrom` passes `grammarSchemaFor(tool.parameters)`. It is pure, it
returns a copy, and it does exactly what the grammar cannot do for itself:

- **An object property that is not in the object's `required` becomes
  `{ oneOf: [<its schema>, { type: "null" }], description }`**, with the
  description moved onto the choice and ending in „Null when not given." A
  property that already accepts null — `type: ["string", "null"]`, which
  `tasks.reschedule.due` uses to mean „clear the due date" — is that choice
  already, so no second null branch is added beside it.
- **A string schema whose `pattern` is exactly the day pattern becomes
  `{ type: "string", format: "date" }`**, keeping its description; with
  `type: ["string", "null"]` it becomes `oneOf: [{ type: "string", format:
  "date" }, { type: "null" }]`. The grammar can enforce that format, so a day
  field can no longer decode to a word.
- **Any other `pattern` is dropped**, because a regular expression left in the
  copy would read as a constraint the decoder does not apply. Validation is
  unaffected: it reads `tool.parameters` itself (`schema.ts`), and a schema
  keyword no reader understood was never a constraint anyway.
- Recursion covers nested `properties` and array `items`, and the input schema
  is never touched.

**The copy is also what the MODEL READS as the tool's parameters.** Every chat
wrapper documents a function from `params`: the Jinja wrappers serialize it into
the tools list, the others render a TypeScript signature from it, and
`llama.ts` passes `documentFunctionParams: true`. That is why the description is
moved rather than copied: „Null when not given." is the only place a small model
is told that leaving a field out is allowed — the grammar can express the null
branch, and nothing else can explain it.

**Checked against the library rather than argued.** Its own
`getGbnfGrammarForGbnfJsonSchema` (a deep import; it is not on the package's
export map) compiles all 37 tools' copies, and `tasks.create`'s day field comes
out as a choice between a date rule — `("0" [1-9] | "1" [012])` for the month,
`("0" [1-9] | [12] [0-9] | "3" [01])` for the day — and `null`. The same call on
the tool's own schema emits neither, which is the whole of §1: every key forced,
and `due` any string at all.

## 3. The arguments, normalised before validation

Decoding is constrained; what a small model writes is still not the shape a
tool wants. `normalizeToolArguments(schema, args, today)` runs in `runToolCalls`
immediately before `validateToolArguments`, returns a new value, and never
throws. It rewrites what it recognises and hands everything else to validation,
which remains the only thing that decides whether a call runs:

| what arrives | what the tool receives |
| --- | --- |
| an optional `null`, `undefined`, `""` or whitespace | the key is gone |
| a string with padding | the same string, trimmed |
| `"5"` in a number or integer field | `5` |
| `"true"`/`"false"` in a boolean field | `true`/`false` |
| an enum member in another case, or without its diacritics | the member the schema declares |
| `sutra`/`tomorrow`/`juce`/`prekosutra`/`16.10.2026`/`2026-10-16T09:00` in a day field | `YYYY-MM-DD`, counted from the turn's own `today` |
| one item where the schema declares an array | that item, as a one-element array |
| a key the schema does not declare, in a closed object | the key is gone |

**Only what the model can be sure of is rewritten.** A REQUIRED property is
never removed, however empty — `due: null` on `tasks.reschedule` means „clear
the due date", and only the tool may decide what an empty value means for its
own arguments. A day word this module does not know is left alone, because
guessing at „sledeće nedelje" would invent a date the user never said, and an
enum member that matches nothing is left for validation, whose refusal quotes
the vocabulary. The walk covers the top-level object, one level of nested
objects and objects inside an array: every shape the registry's tools declare.

`schema.ts` is changed by another branch in the same way — it stops accepting an
empty optional string — and the two agree rather than compete: this module
removes the key, validation decides.

## 4. A refusal the model can act on

A model that cannot fix its call repeats it, and the runtime had been helping.
The old refusal reprinted nothing, but the CONVERSATION did: the assistant
message carrying the call is in the history, so the failed call sits in the
model's own context and is copied back verbatim.

So the message a refused call returns now:

- names the tool and the finding (`schema.ts`'s own sentence, which names the
  field and the shape it wanted);
- names every field of that tool's schema and what it expects — its type, its
  enum members, „a day as YYYY-MM-DD", and whether it is required — read off the
  schema at the moment of the refusal, never a hand-kept list that goes stale the
  first time a tool changes;
- ends with the two ways out: call it again with the corrected arguments, or
  tell the user what is missing;
- does NOT repeat the arguments it refused, so the only copy of the call in the
  model's context is the one it wrote itself.

**And the trying is bounded.** The loop keeps one map per turn, keyed by tool
name. The second time in a turn that a tool's arguments fail validation, the
answer names the tool and says:

> … failed twice this turn. Do not call it again: tell the user it was not done
> and why.

A third attempt at that tool in the same turn is answered with the same
sentence and is neither validated nor run. The count is per tool NAME and per
turn, so one tool's failures never silence another's, and the whole of the
memory is a `Map<string, number>` that `createAgentTurn` owns and hands to
`runToolCalls` — its own object, so a second reason a call must not be repeated
can sit beside it rather than inside it.

## 5. What this costs, and what it does not do

- **A grammar cannot make a model say something it does not know.** The null
  branch and „Null when not given." make leaving a field out possible and
  legible; a model may still write `""`, and a model may still name a day it
  cannot spell. What changed is that both are now refusals it can act on within
  the turn it is in, instead of a step lost and a user told the work was done.
- **The tool-spec estimate counts the tool's own schema, not this copy**
  (`toolChoice.ts` measures `toolSpecCharacters` over `spec.parameters`). The
  copy is slightly larger — one `oneOf` and one added sentence per optional
  property — so the plan's estimate is a little short of the request the runtime
  actually sends, and the measurement the model itself reports corrects it after
  the first request. Left alone here on purpose: `toolChoice.ts` is another
  branch's file, and the direction of the error is the safe one.
- **It changes nothing about effects.** A normalised call is still a call the
  schema accepted, `write` and `network` tools still ask through
  `ToolContext.confirm`, and a refusal by the user is still an ordinary result.
  Nothing here can make a tool run that the user has not agreed to.
- **No prompt, workflow or tool schema changes.** `prompts.ts`, the registry and
  every tool's own validation are untouched; the translation happens at the one
  place the schema is handed to llama.cpp, and normalisation at the one place a
  call is handed to validation.

## 6. Alternatives considered

1. **Tell the model in the prompt to write `null` for a field it does not
   need.** The prompt is advice and the grammar is not: a prompt cannot make a
   forced key optional. It also spends context on every turn to describe a shape
   the decoder could simply allow.
2. **Drop the `required` list and hope the library reads it.** It does not —
   the sentence quoted above is from its own type definition. The null branch is
   the shape it asks callers to use.
3. **Translate the day pattern into a GBNF terminal ourselves.** The library
   already has a date terminal and spells it `format: "date"`; writing a digit
   grammar by hand would be a second implementation of someone else's format,
   drifting from it.
4. **Refuse loosely written arguments and let the model try again.** Every
   `""`, every `"Sutra"` and every `"HIGH"` would cost a step of a turn that has
   `maxSteps` of them, and the model would be corrected for calls it meant
   correctly. Normalising is what lets the retry budget be spent on calls that
   were actually wrong.
5. **Let the third attempt run anyway.** Three identical refusals in one turn
   are a loop, and a loop on a local model is a fan spinning for minutes while
   the user waits for an answer that is not coming. Telling the model to answer
   instead is the only outcome that ends in the user hearing the truth.
