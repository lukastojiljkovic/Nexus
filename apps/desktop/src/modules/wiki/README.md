# wiki

Wikipedia, dictionaries and manuals you read without the internet, from ZIM libraries you import or download.

## Manifest

- **id** — `wiki`
- **prefix** — `WIKI`
- **group** — `knowledge`
- **default** — on
- **settings card** — none
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `catalogue`, `importFile`, `removeLibrary`, `download`, `cancelDownload`, `read`, `search`, `bookmark`, `unbookmark`, `clearHistory`.
- **Store** — `WikiStore` in [`packages/db/src/wiki/`](../../../../../packages/db/src/wiki/), migration [`086-wiki.ts`](../../../../../packages/db/src/migrations/086-wiki.ts): bookmarks and reading history.
- **Content pack** — none: the libraries are ZIM files the module imports or downloads through [`main/zim/`](../../main/zim/); the catalogue is the Kiwix library feed in [`main/zim/catalog.ts`](../../main/zim/catalog.ts).

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with the reading view in [`renderer/zimView.ts`](renderer/zimView.ts).
- **Settings** — none: the module has no settings card.
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-098](../../../../../docs/architecture/adr/098-zim-offline-library.md), [ADR-114](../../../../../docs/architecture/adr/114-item-intent-for-kit-pages.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/wiki.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/wiki.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`wiki.ts`](../../main/assistant/tools/wiki.ts).
