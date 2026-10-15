# signals

Morse, an ASCII table, a tuner and a sound meter. The microphone opens only when one of them is started.

## Manifest

- **id** — `signals`
- **prefix** — `SIG`
- **group** — `make`
- **default** — on
- **settings card** — yes
- **dashboard widget** — none

## Main half

- **Channels** — none: the module has no contract (no `shared/ipc.ts`, no `main/register.ts`), so it adds no channel.
- **Store** — none: the module stores nothing and has no migration.
- **Content pack** — none.
- Main half: the one microphone permission rule is [`main/permission.ts`](main/permission.ts), which the session's permission handlers in `main/index.ts` consult.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with four tabs: [`renderer/MorseTab.tsx`](renderer/MorseTab.tsx), [`renderer/AsciiTab.tsx`](renderer/AsciiTab.tsx), [`renderer/TunerTab.tsx`](renderer/TunerTab.tsx) and [`renderer/MeterTab.tsx`](renderer/MeterTab.tsx). The analysis worker is [`renderer/analysis.worker.ts`](renderer/analysis.worker.ts).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx). Prefs: [`renderer/prefs.ts`](renderer/prefs.ts).
- **Widget** — none: a dashboard card would draw a fact about the profile, and this module holds none.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/signals.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/signals.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `signals.ts` there.
