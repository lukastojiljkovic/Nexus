# translator

A Serbian-English dictionary and travel phrases, which work offline. Translation runs on an installed NLLB model, in the main process.

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
- **Content packs** — `dictionary-sr-en` (`PACK_ID` in [`main/pack.ts`](main/pack.ts)) for the dictionary, and the NLLB models `nllb-600m`, `nllb-1.3b` and `nllb-3.3b` for translation ([`main/nllb/`](main/nllb/)).

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with [`renderer/format.ts`](renderer/format.ts) and the Translate tab under [`renderer/translate/`](renderer/translate/).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx). Prefs: [`renderer/prefs.ts`](renderer/prefs.ts).
- **Widget** — none: a dashboard card would draw a fact about the profile, and this module holds none.

## Translate

The Translate tab is the page's first and default tab. One text is translated
between any two of NLLB-200's languages as the user types: a change starts a
translation after a short pause, and the output fills in one sentence at a
time while the model works. The language pickers name each language in the
interface language and search by name, English name or NLLB code. Detection
(`renderer/translate/detect.ts`) guesses the source with franc, and the guess
is shown on the picker until the user chooses a language.

The timing lives in `renderer/translate/session.ts`, a unit with no React in
it: a change restarts the pause, a running job is polled until it is done, and
a new translation replaces the old one in main. The model is the one the user
chose if it is installed, else the smallest one installed. Serbian is read in
Cyrillic only, so Latin input is converted before it is sent, and Cyrillic
output can be shown in Latin.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-091](../../../../../docs/architecture/adr/091-content-packs.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/translator.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/translator.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `translator.ts` there.
