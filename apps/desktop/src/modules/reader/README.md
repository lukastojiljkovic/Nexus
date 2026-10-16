# reader

Books from content packs: read, search and print them.

## Manifest

- **id** — `reader`
- **prefix** — `READ`
- **group** — `knowledge`
- **default** — on
- **settings card** — none
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `library`, `contents`, `article`, `setPosition`, `setBookmark`, `removeBookmark`, `setTextSize`, `acknowledge`, `search`, `print`, `openExternal`.
- **Store** — `ReaderStore` in [`packages/db/src/reader/`](../../../../../packages/db/src/reader/), migration [`084-reader.ts`](../../../../../packages/db/src/migrations/084-reader.ts): positions, bookmarks, settings and acknowledgements. The search index is built in [`main/searchIndex.ts`](main/searchIndex.ts).
- **Content pack** — `content` packs, read through [`main/catalog.ts`](main/catalog.ts).

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with [`renderer/blocks.tsx`](renderer/blocks.tsx), [`renderer/reading.ts`](renderer/reading.ts) and [`renderer/highlight.ts`](renderer/highlight.ts).
- **Settings** — none: the module has no settings card.
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-091](../../../../../docs/architecture/adr/091-content-packs.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-100](../../../../../docs/architecture/adr/100-reader-module.md)
- **PRD** — [PRD 26 Read Later & Bookmarks](../../../../../docs/prd/26-read-later.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/reader.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/reader.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`reader.ts`](../../main/assistant/tools/reader.ts).
