# puzzles

Sudoku, nonograms, mahjong and Broj. Every game is saved and picks up where it stopped.

## Manifest

- **id** — `puzzles`
- **prefix** — `PUZ`
- **group** — `play`
- **default** — on
- **settings card** — yes
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `save`, `clearSave`, `finish`, `setCheckWhileTyping`.
- **Store** — `PuzzlesStore` in [`packages/db/src/puzzles/`](../../../../../packages/db/src/puzzles/), migration [`088-puzzles.ts`](../../../../../packages/db/src/migrations/088-puzzles.ts).
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with one panel per game: [`renderer/SudokuPanel.tsx`](renderer/SudokuPanel.tsx), [`renderer/NonogramPanel.tsx`](renderer/NonogramPanel.tsx), [`renderer/MahjongPanel.tsx`](renderer/MahjongPanel.tsx) and [`renderer/BrojPanel.tsx`](renderer/BrojPanel.tsx). The engine is the worker [`renderer/engine.worker.ts`](renderer/engine.worker.ts).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx)
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — [PRD 31 Entertainment & Boosters](../../../../../docs/prd/31-entertainment.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/puzzles.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/puzzles.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `puzzles.ts` there.
