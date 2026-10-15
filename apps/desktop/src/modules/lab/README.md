# lab

Serial port, battery, tone and light: what the laptop can do beyond its job.

## Manifest

- **id** — `lab`
- **prefix** — `LAB`
- **group** — `make`
- **default** — on
- **settings card** — none
- **dashboard widget** — none

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `logSamples`, `createLog`, `appendSamples`, `removeLog`, `exportLogCsv`, `saveTerminalLog`, `setOffGrid`, `battery`, `setLocation`, `clearLocation`.
- **Store** — `LabStore` in [`packages/db/src/lab/`](../../../../../packages/db/src/lab/), migration [`087-lab.ts`](../../../../../packages/db/src/migrations/087-lab.ts).
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with one card per instrument: [`renderer/SerialCard.tsx`](renderer/SerialCard.tsx), [`renderer/ToneCard.tsx`](renderer/ToneCard.tsx), [`renderer/LightCard.tsx`](renderer/LightCard.tsx) and [`renderer/BatteryCard.tsx`](renderer/BatteryCard.tsx).
- **Settings** — none: the module has no settings card.
- **Widget** — none: the module publishes no dashboard card.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/lab.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/lab.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`lab.ts`](../../main/assistant/tools/lab.ts).
