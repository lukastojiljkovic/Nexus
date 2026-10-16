# assistant

A conversation with a local model that knows the app, its manual and the user's own material. Nothing leaves the machine except web search, which is opt-in.

## Manifest

- **id** — `assistant`
- **prefix** — `ASST`
- **group** — `knowledge`
- **default** — on
- **settings card** — yes
- **dashboard widget** — none

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops by group: conversations (`list`, `createConversation`, `renameConversation`, `removeConversation`); one turn (`open`, `send`, `poll`, `stop`, `answerConfirm`); models (`setup`, `searchModels`, `importModel`, `downloadModel`, `cancelDownload`, `resumeDownload`, `removeModel`, `setDefaultTier`, `setChatModel`, `setWebSearch`, `reindexKnowledge`); voice (`voice`, `capture`, `transcribe`, `speak`). A turn is polled, not pushed. The runtime is in [`apps/desktop/src/main/assistant/`](../../../../../apps/desktop/src/main/assistant/).
- **Store** — `ConversationStore` in [`packages/db/src/assistant/`](../../../../../packages/db/src/assistant/), with the knowledge index written through [`main/assistant/knowledge/store.ts`](../../main/assistant/knowledge/store.ts). Migrations [`090-assistant-knowledge.ts`](../../../../../packages/db/src/migrations/090-assistant-knowledge.ts), [`091-assistant-conversations.ts`](../../../../../packages/db/src/migrations/091-assistant-conversations.ts), [`092-assistant-chat-model.ts`](../../../../../packages/db/src/migrations/092-assistant-chat-model.ts) and [`093-assistant-tool-outcome.ts`](../../../../../packages/db/src/migrations/093-assistant-tool-outcome.ts).
- **Content pack** — `model` packs for the chat and voice models ([`main/voicePacks.ts`](main/voicePacks.ts) for the voices). The knowledge base indexes content packs and the installed Reference libraries ([`main/assistant/knowledge/sources.ts`](../../main/assistant/knowledge/sources.ts)).

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx): the conversations rail, one thread with its citations and tool lines, and the composer; [`renderer/ModelPanel.tsx`](renderer/ModelPanel.tsx) chooses the models; voice is in [`renderer/voice/`](renderer/voice/).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx)
- **Widget** — none: the module publishes no dashboard card.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-095](../../../../../docs/architecture/adr/095-assistant.md), [ADR-096](../../../../../docs/architecture/adr/096-assistant-model-runtime.md), [ADR-097](../../../../../docs/architecture/adr/097-assistant-web-search.md), [ADR-103](../../../../../docs/architecture/adr/103-pack-catalogue-and-credits.md), [ADR-104](../../../../../docs/architecture/adr/104-assistant-knowledge.md), [ADR-105](../../../../../docs/architecture/adr/105-voice.md), [ADR-106](../../../../../docs/architecture/adr/106-assistant-module.md), [ADR-112](../../../../../docs/architecture/adr/112-assistant-tools-per-turn.md), [ADR-113](../../../../../docs/architecture/adr/113-assistant-tiers-by-active-parameters.md), [ADR-114](../../../../../docs/architecture/adr/114-item-intent-for-kit-pages.md), [ADR-116](../../../../../docs/architecture/adr/116-the-grammar-a-tool-call-decodes-under.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/assistant.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/assistant.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/), which is the tool registry itself; there is no `assistant.ts` there.
