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

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `save`, `clearSave`, `finish`, `setCheckWhileTyping`, `packs`.
- **Store** — `PuzzlesStore` in [`packages/db/src/puzzles/`](../../../../../packages/db/src/puzzles/), migration [`088-puzzles.ts`](../../../../../packages/db/src/migrations/088-puzzles.ts).
- **Content pack** — `nonograms-pictures`, read by [`main/pictures.ts`](main/pictures.ts) and handed to the page by the `packs` op. With the pack installed, a nonogram at 10, 15 or 20 is dealt one of its pictures and the save keeps the picture's id; the solved line names the picture and credits its author, which CC BY 3.0 requires. Main drops any picture that fails a check and never sends a path to the renderer, and without the pack the board stays random.

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
