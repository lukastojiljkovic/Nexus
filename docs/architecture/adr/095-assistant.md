# ADR-095 — The assistant: eight parts, one contract, nothing off this machine

**Status:** accepted (2026-10-10) · **Owner:** founder

## 1. What is being built, in the founder's words

A helper that lives on the user's own computer and works with the network off: a
local model run through llama.cpp, picked by the user from Hugging Face and
recommended by their own hardware in three tiers (intelligence, balance,
speed); a knowledge base that knows the app itself as well as the user's notes,
tasks, events and files; agentic workflows that can read and write through the
app's own modules; a voice mode; vision where the chosen model has it. The scene
the idea came from is the one that fixes the rules: a person stranded in the
middle of nowhere, waiting for a helicopter, talking the situation through with
the assistant. It recommends what to read from the packs, it gives advice, it
helps the user find their way around the app — and it never pretends to be the
helicopter.

Nexus's promise that nothing needs a server is not a slogan here: this feature is
where it would be easiest to break, so it is the feature with the strictest
default. Offline is the state; the network is a place two parts may go, under
rules that already exist (ADR-089, ADR-092).

## 2. One contract, eight parts, built at the same time

`packages/core/src/assistant/contract.ts` is the whole of what the parts share.
It holds types and nothing else, no part may add behaviour to it, and a part
that needs more than a type says so by extending its own interface. Eight runs
build against it at once:

| Part | Factory / entry | Where |
| --- | --- | --- |
| the loop | `runAgentTurn` | `packages/core/src/assistant/` (this ADR) |
| the model host | `createModelHost` | `apps/desktop/src/main/assistant/runtime/` |
| the knowledge base | `createKnowledgeService` | `apps/desktop/src/main/assistant/knowledge/` |
| the tools | `createToolRegistry` | `apps/desktop/src/main/assistant/tools/` |
| the voice | `createVoiceService` | `apps/desktop/src/main/assistant/voice/` |
| web search and page reading | `createWebService` | `apps/desktop/src/main/assistant/web/` |
| the app manual | the manual the knowledge base reads | `apps/desktop/src/main/assistant/manual/` |
| the evals | scenarios and their harness | `apps/desktop/src/main/assistant/evals/`, `scripts/` |

**Nothing here is reachable from a page yet, and that is deliberate.** The module
itself — the chat page, the setup, the model chooser, the conversation store and
the wiring of the five factories to this loop — is the next wave. So each part
ships as a library with its factory and its tests, and the tests use fakes of the
other parts (a scripted `ChatModel`, a fake `Embedder`, a fake `KnowledgeBase`)
defined in their own files. A fake that only one package can reach is a fake
everybody re-invents, which is why the scripted model is exported from the
package root beside the loop.

## 3. The loop, and the decisions this ADR fixes

`runAgentTurn` assembles the request (system prompt, history, user message),
retrieves from the knowledge base ONCE before the first completion, injects the
hits as a fenced block, calls the model, streams its text out as `token` events,
validates each tool call against its own JSON schema, runs the calls, feeds the
results back, and repeats until the model answers or the step limit is reached.
What follows is what the brief left open, and what this run chose:

* **A `message` event per completed response that has visible text**, carrying
  the citations collected so far, and the response's `toolCalls` when it asked
  for any. The page draws streamed tokens and commits them with the message
  event; a response that is only tool calls produces no message, because an
  empty bubble is not a thing a user asked for.
* **Stop reasons are the model's, with two exceptions.** `end` and `length` pass
  through. A turn cut short by the step limit or by a request that cannot fit
  reports `length`, because in both cases the answer is short of what the
  conversation had left to say, and the `error` event beside it (`step-limit`,
  `context-full`) says which. An abort emits `error` with `aborted` and then
  `done` with `aborted`: `AgentErrorCode` carries `aborted` for exactly this
  case, and the page needs one event that tells a stop the user asked for from a
  model that finished.
* **A tool call the model already made is never lost to the step limit.** The
  last allowed model call still has its tools run and their results emitted; the
  turn then stops. Discarding it would drop a write the user had already
  confirmed, and leave the page drawing a request with no answer.
* **An unknown tool name, arguments that fail the schema, and a tool that threw
  all come back as a `tool-result` with `ok: false`** — never as a throw out of
  the loop. The first two are the model's own corrections and emit no `error`
  event; a tool that threw also emits `error` with `tool-failed`, because that
  one is the app's problem and the user should see it.
* **Knowledge is retrieved once** (`KNOWLEDGE_HIT_LIMIT` = 6), so every step of
  the turn reads the same passages and a citation can never point at something
  that appeared halfway through an answer. A knowledge search that fails leaves
  the turn running without a knowledge block — the assistant then says the app's
  knowledge does not cover the question, which is true.
* **The budget is an estimate in characters, and it is measured.** No tokeniser
  ships in this package, so the estimator divides a character count by a ratio
  measured with the tokeniser of a real GGUF family
  (`@huggingface/transformers` 4.3.1,
  `AutoTokenizer.from_pretrained("Qwen/Qwen2.5-7B-Instruct")`, 2026-10-10). Four
  shapes were measured, because a request is made of more than prose:

  | shape | sr | en |
  | --- | --- | --- |
  | prose (60 000 characters of this app's copy tables) | 2.478 chars/token | 4.388 |
  | JSON (twelve task records) | 2.184 | 2.647 |
  | the assembled system prompt | 4.101 | 4.129 |

  The constants round those DOWN — 2.4 and 4.3 for prose, 2.1 and 2.6 for a tool
  result, which is counted with its own pair because JSON is denser than prose
  in both languages and counting it as prose would under-estimate a request by
  about a third. One number for both languages would under-count Serbian — the
  default locale — by a third in the other direction. A model that reports its
  own `promptTokens` replaces both ratios for the rest of the turn, because the
  runtime's arithmetic beats our guess.
* **What gives way, in order: old turns, long tool results, knowledge.** The
  system prompt and the current question are never dropped, and a request that
  cannot hold even those is refused with `context-full` rather than sent for
  llama.cpp to truncate. Old turns go a whole turn at a time (never leaving a
  tool message whose call was dropped). A tool result is trimmed at its end,
  where a list's least relevant entries are, and carries a marker saying how
  much went — the page still shows the user the whole of it. The numbers that
  are policy rather than measurement say so in `budget.ts`: an answer's room is
  a quarter of the window between 256 and 1024 tokens, and a tool result is
  never trimmed below 240 characters. A trimmed block keeps its closing fence
  marker, because an unterminated region of data is worse than a shorter result:
  the model can no longer tell where the data stops.
* **The prompt is one text, in English, with the reply-language rule**, and it is
  NAMED (`SYSTEM_PROMPT_VERSION`) so an evals table can say which prompt
  produced a score. It states who the assistant is, what this turn's tools are
  (in the turn's language, with the ones that ask the user first marked), how to
  cite, that fenced blocks are data, when to ask before acting, the safety rule
  with the notice verbatim in both languages, and that the assistant never
  invents a fact, a number or a source.
* **Tool calls that arrive as text are recovered** for the three families the
  catalogue carries (Hermes/Qwen `<tool_call>`, Llama 3.x
  `{"name", "parameters"}`, Mistral `[TOOL_CALLS]`), each cited from the
  artefact that writes it (`toolCalls.ts`). Parsing is literal and never
  guesses: a block whose JSON does not parse stays in the visible text, a bare
  object counts as a call only when it is the whole message, and nothing is
  coerced.

## 4. Trust boundaries

* **Pack articles, notes, files, web pages and tool results are DATA.** They
  reach the model inside a block that opens with a marker, a label and a token,
  and closes with the matching token. The token is 64 random bits drawn per
  turn, and every copy of it inside the text is removed before fencing, so the
  token appears exactly twice around each block and a document cannot close the
  block early. The content's own words are kept, not censored: the defence is
  that the model is told, in the system prompt, that a fenced block is material
  and cannot command it. A tool result replayed in the conversation's history is
  fenced on the way in as well, because the page replays what it drew (a
  `tool-result` event carries the raw text) rather than what the model read; text
  that is already fenced is left alone rather than nested.
* **User data never leaves.** The loop holds no store and writes nothing. What
  the knowledge base indexes lives in the profile's encrypted database
  (`agent-knowledge`); nothing in this ADR creates a cache file.
* **Offline by default.** The loop's only inputs are the injected
  `KnowledgeBase`, the turn's `Tool` list and the `ChatModel`. It has no fetch,
  no URL and no path: a network tool can only be one the page obtained from the
  web service, which exists only when the user turned web search on.
* **Writes ask first.** The loop never asks for confirmation itself — the tool
  does, through `ToolContext.confirm`, with a one-line summary — and the prompt
  says a refusal is a normal result and never to repeat the call.
* **Safety.** The notice is a constant in both languages
  (`SAFETY_NOTICE`), the prompt tells the assistant to quote it verbatim when an
  answer draws on a safety pack, and to point at the pack's own words rather
  than paraphrase an instruction; a citation from such a pack carries
  `safety: true`, which is what the message event's citations expose. The
  stranded recipe says, in both languages, that calling 112 is the first step
  and that nothing replaces it.
* **Both languages.** Prompts are English with the reply-language rule; every
  user-facing string this part owns (the notice, the workflow names, goals and
  checklists, the brief's labels) exists as `{ sr, en }`.

## 5. What the next wave builds, and what this ADR does not decide

The module: the chat page (token stream, tool calls as they happen, the citation
list, the safety notice drawn where the answer drew on a safety pack), the setup
and the model chooser, the conversation store, and the wiring of
`createModelHost`, `createKnowledgeService`, `createToolRegistry`,
`createVoiceService` and `createWebService` to `runAgentTurn`. The workflow list
shows the built-ins from `ASSISTANT_WORKFLOWS` and starts one with
`toolsForWorkflow` and `renderWorkflowBrief`; the store that lets a user write
their own workflow is that wave's, and the shape it must produce is fixed here.
The external-link rule the briefs mention has no wrapper yet: a URL is drawn as
selectable text with a copy button and one `TODO(external-links)`.

Three things this ADR deliberately does NOT decide, because they belong to other
parts: which tools exist and what their names are (the registry is the authority
— a workflow names them and a name the registry does not carry selects nothing);
which model wins a scenario (the evals harness scores that); and where a
document's bytes live (the knowledge service).

**An offline map is named conditionally, and that is a fact about the tree, not
hedging.** No map module exists today, so the stranded recipe may not promise to
open one; the emergency card is named because `packages/core/src/emergency` and
`packages/db/src/emergency` do exist.

## 6. Costs worth knowing

* The estimator reads text, so an image's tokens are invisible to it; a vision
  turn's real cost is under-counted until the runtime reports it.
* A tool call recovered from text is streamed as tokens before the message event
  replaces it, so the page can flash raw JSON for a moment. Avoiding that would
  mean buffering the whole completion, which is the opposite of streaming.
* The two ratios were measured on one family's tokeniser. A model whose
  tokeniser differs by tens of percent is corrected after its first completion
  reports `promptTokens`, and never before.
