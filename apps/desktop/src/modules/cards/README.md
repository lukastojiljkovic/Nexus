# cards

Nine card games, six solitaires and three against the computer, on one shelf with a record per game.

## Manifest

- **id** — `cards`
- **prefix** — `FUN`
- **group** — `play`
- **default** — on
- **settings card** — none
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `save`, `record`, `clear`.
- **Store** — `CardGameStore` in [`packages/db/src/games/cards/`](../../../../../packages/db/src/games/cards/), migration [`081-card-games.ts`](../../../../../packages/db/src/migrations/081-card-games.ts): the game in progress and the record.
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx): the shelf, then the table being played: [`renderer/Solitaires.tsx`](renderer/Solitaires.tsx), [`renderer/TrickGames.tsx`](renderer/TrickGames.tsx) and [`renderer/table.tsx`](renderer/table.tsx). Rules and moves are in [`renderer/rules.ts`](renderer/rules.ts) and [`renderer/moves.ts`](renderer/moves.ts); the computer players are in [`renderer/ai/`](renderer/ai/).
- **Settings** — none: the rules and the level are chosen on the page, before the deal.
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-111](../../../../../docs/architecture/adr/111-cards-module.md)
- **PRD** — [PRD 31 Entertainment & Boosters](../../../../../docs/prd/31-entertainment.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/cards.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/cards.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `cards.ts` there.
