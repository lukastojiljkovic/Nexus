# chess

A chess board against the engine or another person, with clocks, saved games and PGN.

## Manifest

- **id** — `chess`
- **prefix** — `FUN`
- **group** — `play`
- **default** — on
- **settings card** — none
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `getGame`, `saveGame`, `deleteGame`, `setResume`, `clearResume`, `engineMove`, `engineClose`.
- **Store** — `ChessStore` in [`packages/db/src/games/chess/`](../../../../../packages/db/src/games/chess/), migration [`082-chess.ts`](../../../../../packages/db/src/migrations/082-chess.ts): saved games, the resume point and the level records.
- **Content pack** — The `stockfish` tool pack (`STOCKFISH_PACK_ID`), which the engine runs from: [`main/engine.ts`](main/engine.ts) and [`main/stockfish.ts`](main/stockfish.ts).

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx): the board, the clocks and the saved games; [`renderer/board.ts`](renderer/board.ts), [`renderer/clock.ts`](renderer/clock.ts) and [`renderer/engine.ts`](renderer/engine.ts), with the engine worker in [`renderer/engineWorker.ts`](renderer/engineWorker.ts).
- **Settings** — none: the module has no settings card.
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-094](../../../../../docs/architecture/adr/094-tool-packs.md)
- **PRD** — [PRD 31 Entertainment & Boosters](../../../../../docs/prd/31-entertainment.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/chess.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/chess.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `chess.ts` there.
