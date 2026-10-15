# emergency

The facts a stranger or a medic can read when you cannot speak: emergency cards and contacts, with a printable copy.

## Manifest

- **id** — `emergency`
- **prefix** — `HLTH`
- **group** — `life`
- **default** — on
- **settings card** — none
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `createCard`, `updateCard`, `removeCard`, `addContact`, `updateContact`, `removeContact`, `moveContact`, `printCard`.
- **Store** — `EmergencyCardStore` in [`packages/db/src/emergency/`](../../../../../packages/db/src/emergency/), migration [`078-emergency.ts`](../../../../../packages/db/src/migrations/078-emergency.ts).
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with [`renderer/CardForm.tsx`](renderer/CardForm.tsx), [`renderer/CardView.tsx`](renderer/CardView.tsx) and [`renderer/ContactsEditor.tsx`](renderer/ContactsEditor.tsx). Printing is in [`main/print.ts`](main/print.ts).
- **Settings** — none: the module has no settings card.
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — [PRD 21 Health](../../../../../docs/prd/21-health.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/emergency.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/emergency.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`emergency.ts`](../../main/assistant/tools/emergency.ts).
