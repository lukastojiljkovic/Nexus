# boards

Six board games, against the computer or on one machine.

## Manifest

- **id** — `boards`
- **prefix** — `BOARD`
- **group** — `play`
- **default** — on
- **settings card** — yes
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `save`, `remove`, `finish`, `setDefaultLevel`.
- **Store** — `BoardsStore` in [`packages/db/src/games/boards/`](../../../../../packages/db/src/games/boards/), migration [`089-boards.ts`](../../../../../packages/db/src/migrations/089-boards.ts): the game in progress, the record against the computer, and the module's preference.
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx): the lobby, then the board being played: [`renderer/Board.tsx`](renderer/Board.tsx), [`renderer/DiceBoards.tsx`](renderer/DiceBoards.tsx) and [`renderer/panels.tsx`](renderer/panels.tsx); the computer player is in [`renderer/ai/`](renderer/ai/).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx)
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/boards.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/boards.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `boards.ts` there.
