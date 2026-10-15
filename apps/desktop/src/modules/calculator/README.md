# calculator

One line of calculation at a time: variables, unit conversion, a history and a scientific keypad. The engine runs off the main thread.

## Manifest

- **id** — `calculator`
- **prefix** — `CALC`
- **group** — `make`
- **default** — on
- **settings card** — yes
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `commit`, `setPinned`, `removeEntry`, `clearHistory`, `clearSession`, `setAngleMode`, `setPrecision`.
- **Store** — `CalculatorStore` in [`packages/db/src/calculator/`](../../../../../packages/db/src/calculator/), migration [`079-calculator.ts`](../../../../../packages/db/src/migrations/079-calculator.ts): the history, the saved session and the settings.
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx): the line with its live result, the keypad, the history and the variables. The engine is [`renderer/engine.worker.ts`](renderer/engine.worker.ts), reached through [`renderer/engineClient.ts`](renderer/engineClient.ts).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx)
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/calculator.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/calculator.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`calculator.ts`](../../main/assistant/tools/calculator.ts).
