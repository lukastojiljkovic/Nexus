# drawings

Open an AutoCAD drawing: layers, measurements and print to PDF. DXF opens directly; DWG needs its tool pack.

## Manifest

- **id** — `drawings`
- **prefix** — `DRAW`
- **group** — `make`
- **default** — on
- **settings card** — none
- **dashboard widget** — none

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `open`, `print`.
- **Store** — none: the module keeps no data and has no migration.
- **Content pack** — The `libredwg` tool pack (`DWG_PACK_ID`) converts DWG files; [`main/open.ts`](main/open.ts) decides when it is needed.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx): the drawing, its layers and its measurements. Parsing runs in the worker [`renderer/parseWorker.ts`](renderer/parseWorker.ts); the fonts are in [`renderer/fonts/`](renderer/fonts/).
- **Settings** — none: the module has no settings card.
- **Widget** — none: the module publishes no dashboard card.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-094](../../../../../docs/architecture/adr/094-tool-packs.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/drawings.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/drawings.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `drawings.ts` there.
