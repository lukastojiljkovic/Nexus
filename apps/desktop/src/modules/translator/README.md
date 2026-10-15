# translator

A Serbian-English dictionary and travel phrases, which work offline. Sentence translation runs in a local worker.

## Manifest

- **id** — `translator`
- **prefix** — `LANG`
- **group** — `knowledge`
- **default** — on
- **settings card** — yes
- **dashboard widget** — none

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `status`, `search`, `phrases`, `packs`.
- **Store** — none: the module reads its packs from disk and has no migration.
- **Content pack** — `dictionary-sr-en` (`PACK_ID` in [`main/pack.ts`](main/pack.ts)). The sentence translator loads the `translate-sr-en` pack in its renderer worker ([`renderer/sentences/`](renderer/sentences/)).

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with [`renderer/format.ts`](renderer/format.ts) and the sentence translation under [`renderer/sentences/`](renderer/sentences/).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx). Prefs: [`renderer/prefs.ts`](renderer/prefs.ts).
- **Widget** — none: a dashboard card would draw a fact about the profile, and this module holds none.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-091](../../../../../docs/architecture/adr/091-content-packs.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/translator.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/translator.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `translator.ts` there.
