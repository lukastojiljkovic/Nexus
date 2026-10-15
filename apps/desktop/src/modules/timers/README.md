# timers

A stopwatch and named countdowns that keep running with the page closed.

## Manifest

- **id** — `timers`
- **prefix** — `UTIL`
- **group** — `plan`
- **default** — on
- **settings card** — yes
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `createPreset`, `renamePreset`, `removePreset`, `createCountdown`, `pauseCountdown`, `resumeCountdown`, `extendCountdown`, `cancelCountdown`, `setSoundOnEnd`.
- **Store** — `TimersStore` in [`packages/db/src/timers/`](../../../../../packages/db/src/timers/), migration [`071-timers.ts`](../../../../../packages/db/src/migrations/071-timers.ts).
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with the timing rules in [`renderer/timing.ts`](renderer/timing.ts). Countdowns are armed in main with `ctx.armUntil`, so they do not depend on the page.
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx)
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — [PRD 29 Utilities](../../../../../docs/prd/29-utilities.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/timers.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/timers.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`timers.ts`](../../main/assistant/tools/timers.ts).
