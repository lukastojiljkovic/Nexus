# miniapps

Nine small tools in one place: a metronome, dice, counters, a scoreboard, typing practice, dates, a world clock, a screen light and a QR reader.

## Manifest

- **id** — `miniapps`
- **prefix** — `UTIL`
- **group** — `make`
- **default** — on
- **settings card** — none
- **dashboard widget** — none

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `setLastApp`, `saveCounters`, `saveScoreboard`, `saveTyping`, `saveCities`, `saveDiceHistory`.
- **Store** — `MiniappsStore` in [`packages/db/src/miniapps/`](../../../../../packages/db/src/miniapps/), migration [`083-miniapps.ts`](../../../../../packages/db/src/migrations/083-miniapps.ts).
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with each tool in [`renderer/apps/`](renderer/apps/). The QR reader decodes in the worker [`renderer/qr.worker.ts`](renderer/qr.worker.ts).
- **Settings** — none: the module has no settings card.
- **Widget** — none: the module publishes no dashboard card.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — [PRD 29 Utilities](../../../../../docs/prd/29-utilities.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/miniapps.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/miniapps.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`miniapps.ts`](../../main/assistant/tools/miniapps.ts).
