# arcade

Five quick games on one shelf: Minesweeper, Blocks, Snake, Bricks and 2048, with a record of the best figures. All of it works offline.

## Manifest

- **id** — `arcade`
- **prefix** — `FUN`
- **group** — `play`
- **default** — off
- **settings card** — none
- **dashboard widget** — none

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `record`.
- **Store** — `ArcadeScoreStore` in [`packages/db/src/games/arcade/`](../../../../../packages/db/src/games/arcade/), migration [`080-arcade-scores.ts`](../../../../../packages/db/src/migrations/080-arcade-scores.ts).
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx): the shelf and the scores table; the five games are in [`renderer/games/`](renderer/games/).
- **Settings** — none: the module has no preference.
- **Widget** — none: the module publishes no dashboard card.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — [PRD 31 Entertainment & Boosters](../../../../../docs/prd/31-entertainment.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/arcade.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/arcade.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `arcade.ts` there.
