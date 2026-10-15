# pantry

What is in the house, what runs out, and what expires, with shopping lines and locations.

## Manifest

- **id** — `pantry`
- **prefix** — `PANT`
- **group** — `life`
- **default** — on
- **settings card** — yes
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops by group: the whole list (`list`); items (`createItem`, `updateItem`, `changeQuantity`, `archiveItem`, `unarchiveItem`, `removeItem`); locations (`createLocation`, `renameLocation`, `moveLocation`, `removeLocation`); shopping (`addShoppingLine`, `tickShoppingLine`, `removeShoppingLine`); and `setExpiryWindow`.
- **Store** — `PantryStore` in [`packages/db/src/pantry/`](../../../../../packages/db/src/pantry/), migration [`075-pantry.ts`](../../../../../packages/db/src/migrations/075-pantry.ts).
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with the view helpers in [`renderer/pantryPage.ts`](renderer/pantryPage.ts).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx)
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/pantry.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/pantry.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`pantry.ts`](../../main/assistant/tools/pantry.ts).
