# library

The books, films and series you read and watch: what is on the wish list, what is in progress, and what is finished.

## Manifest

- **id** — `library`
- **prefix** — `LIB`
- **group** — `culture`
- **default** — on
- **settings card** — none
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops by group: the whole list (`list`); items (`addItem`, `updateItem`, `removeItem`, `restoreItem`); passes (`addPass`, `removePass`); thoughts (`addThought`, `updateThought`, `removeThought`); collections (`createCollection`, `updateCollection`, `removeCollection`, `restoreCollection`, `addToCollection`, `removeFromCollection`, `moveCollectionItem`); and `adoptSuggestion`.
- **Store** — `LibraryStore` in [`packages/db/src/library/`](../../../../../packages/db/src/library/), migration [`072-library.ts`](../../../../../packages/db/src/migrations/072-library.ts). Attached files are carried by the blob hook (ADR-108).
- **Content pack** — `dataset` packs may carry curated collections, read by [`main/packCollections.ts`](main/packCollections.ts).

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with the view helpers in [`renderer/library.ts`](renderer/library.ts).
- **Settings** — none: the module has no settings card.
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-108](../../../../../docs/architecture/adr/108-kit-blobs.md)
- **PRD** — [PRD 27 Library](../../../../../docs/prd/27-library.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/library.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/library.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`library.ts`](../../main/assistant/tools/library.ts).
