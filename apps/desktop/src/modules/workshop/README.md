# workshop

View STL models, G-code toolpaths and Gerber boards, with nothing else installed.

## Manifest

- **id** — `workshop`
- **prefix** — `WS`
- **group** — `make`
- **default** — on
- **settings card** — yes
- **dashboard widget** — none

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `open`, `reopen`, `pickFiles`, `saveFile`, `saveBatch`.
- **Store** — none: the module keeps no data and has no migration.
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with the 3D view in [`renderer/Viewport3D.tsx`](renderer/Viewport3D.tsx). Files are parsed in the worker [`renderer/parse.worker.ts`](renderer/parse.worker.ts); the file picker is [`main/picker.ts`](main/picker.ts).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx).
- **Widget** — none: a dashboard card would draw a fact about the profile, and this module holds none.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/workshop.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/workshop.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `workshop.ts` there.
