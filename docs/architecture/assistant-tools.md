# Adding assistant tools for a module

Every module can give the assistant tools, and the rules below are the ones every
area follows (ADR-117). The registry's own header
(`apps/desktop/src/main/assistant/tools/index.ts`) states the same rule in short;
this page is the walk-through.

## 1. The file and the registry line

One file per area, in `apps/desktop/src/main/assistant/tools/`, named for the
module it serves (`cookbook.ts` for the cookbook). It exports one function that
turns the area's deps into the tools:

```ts
export function cookbookTools(deps: CookbookToolDeps): readonly Tool[] {
  return [ /* one object per tool, each named `cookbook.<verb>` */ ];
}
```

Then three lines in the registry, each beside its neighbours:

1. `createToolRegistry` in `tools/index.ts`: spread the new function into the
   `appLevel` list.
2. `thread.tools.labels` in `modules/assistant/renderer/copy.sr.ts` and
   `copy.en.ts`: one label per tool, which `toolLabels.test.ts` pins against the
   registry. A tool with no label fails that test.
3. The per-area count in `tools/index.test.ts` (`countByArea`): one line, in
   alphabetical order. The test fails when a tool is added or removed without its
   area's line changing.

A tool name is `area.verb`, both lower-case (`/^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/`),
and `checkTools` refuses a name that breaks it or collides with another.

## 2. Deps

A tool reads and writes through the seams `ToolDeps` already carries: `profileDb`
(the profile's database, opened the way every store opens it), `now`, `search`,
`packs`, `timers`, `modules` and `web`. Prefer those.

When an area needs a seam none of them carries, add it:

1. add a member to `ToolDeps` in `tools/index.ts`, with a doc comment that says
   what it is;
2. wire it where the registry is built, `AssistantProfile.tools` in
   `modules/assistant/main/profile.ts`, from the services the module is registered
   with;
3. give the test double a fake of it in the area's test file, as the existing
   areas do, so no test reaches the real store.

## 3. Schema rules

The model sees each tool's `parameters` as a JSON Schema, and the harness relies on
a small subset of it (`packages/core/src/assistant/schema.ts`): `type`,
`properties`, `required`, `items`, `enum`, `additionalProperties: false`,
`minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`. Any other
keyword is ignored, so do not rely on it.

Before a call reaches the tool, `arguments.ts` tidies what a small model reliably
gets almost right (numeric strings, day words, enum case) and never refuses; then
`validateToolArguments` refuses a call whose shape is wrong, and the refusal goes
back to the model as an ordinary result. The tool still validates its own input,
with the readers in `tools/args.ts` (`asArgs`, `asOptionalText`, and the rest), and
`guard` turns a thrown refusal into a `failResult`. A tool's `run` never throws.

## 4. `effect` and confirmation

Every tool declares one effect:

- `read`: changes nothing, asks nothing.
- `navigate`: changes no data and shows no dialog; only `app.open` uses it.
- `write` and `network`: change something, or reach out. Every one asks first
  through `confirmOrDecline(context, tool, effect, summary)`, **before** any store
  is touched. The summary is one line in the user's language, specific enough to
  refuse. A refusal returns `USER_DECLINED` and changes nothing.

## 5. `navigateTo`: with an `item`, or with an `action`

A tool that changes what the user looks at answers with `navigateTo` (an
`AppLocation`). Which of the two it carries depends on where the state lives.

**A store-backed module writes in main and names the row.** The tool calls the
same store function the app's own IPC handler calls, then answers with the row's
id, so the app shows what was just written:

```ts
return okResult(`Added the recipe ${title}.`, {
  navigateTo: { module: "cookbook", item: recipe.id },
});
```

**A page-held module names an action its page applies.** Canvas keeps its scene in
memory and autosaves it, and a device preference lives in the renderer's
`localStorage`, so a write from main would be overwritten by the page's next save.
The tool therefore asks the page to do it:

```ts
return okResult(`Opened a new sketch.`, {
  navigateTo: { module: "canvas", action: { name: "sketch", payload: { title } } },
});
```

The payload is JSON the tool has already validated. The page validates it again:
the location travels through a window event and the shell reads neither field.

How a kit page handles an action (`ModulePageProps` in `shared/moduleApi.ts`): the
shell queues the request for that module, hands the page its head as `intent`, and
the page reports it consumed through `onIntentHandled`. A page applies the actions
it knows and reports every other intent handled anyway, so the queue moves on:

```tsx
useEffect(() => {
  if (intent?.kind === "action" && intent.action === "sketch") {
    const sketch = parseSketch(intent.payload); // null for a payload it does not accept
    if (sketch !== null) applySketch(sketch);
  }
  if (intent !== null && intent !== undefined) onIntentHandled?.();
}, [intent, onIntentHandled, applySketch]);
```

A reveal (`kind: "reveal"`, the `item`) is handled the same way: the page reads
`item` as its own id, reveals it, and reports it handled.

Compiled-in pages (`tasks`, `notes`, `calendar`, `study`) are not kit pages: they
take their own typed intents, and the shell maps the `item` onto each in
`App.tsx`'s `compiledInReveal`. A new area with a compiled-in page needs that
mapping, and a kit module needs none.

A citation never carries an action. `citationTarget` strips one from a citation's
place, so a tool result's `citations` can name a place without ever acting on it.

## 6. The eval scenario

Each area gets a scenario file, `apps/desktop/src/main/assistant/evals/scenarios/<area>.json`,
in the format its `README.md` describes: a conversation, the tools the turn may
use with their confirmation summaries, a scripted transcript, and the expectations
(`toolsCalled`, `toolsNotCalled`, `answerContains`, `language`, and the rest). The
scenario is run in `--scripted` mode by the ordinary test suite, so a broken
expectation fails there, and in real mode with a model the user chose.

## 7. The count line

Each area's line in `tools/index.test.ts` (`countByArea`) is the only place the
registry's size is written down. A run that adds an area adds one line; a run that
adds a tool to an existing area changes that area's line alone. A count that reads
too high is a tool that was added and never named there; too low, one that was
removed and left in the table.

## Checks

Before a change is handed over, run its typecheck, lint, the `packages/core` and
`apps/desktop` test suites, and `check:copy`, `check:strings`, `check:english`,
`check:fields` and `check:reachable` (the last three cover new copy and fields).
