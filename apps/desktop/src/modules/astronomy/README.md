# astronomy

Four views of the sky at one instant: the solar system, day and night on Earth, tonight's sky, and the Sun and Moon for a chosen place.

## Manifest

- **id** — `astronomy`
- **prefix** — `ASTR`
- **group** — `knowledge`
- **default** — on
- **settings card** — yes
- **dashboard widget** — none

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Its one op is `packs`, answered from the installed packs so that no pack path crosses the bridge.
- **Store** — none: the module stores nothing in the profile and has no migration.
- **Content pack** — The `dataset` pack `planet-textures` (`PLANET_TEXTURES_PACK_ID`), read by [`main/packData.ts`](main/packData.ts).

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx): the four views, [`renderer/solar/`](renderer/solar/), [`renderer/earth/`](renderer/earth/), [`renderer/stars/`](renderer/stars/) and [`renderer/sunmoon/`](renderer/sunmoon/), over one shared clock.
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx). Prefs: the place, read and written by [`renderer/prefs.ts`](renderer/prefs.ts) (a device value).
- **Widget** — none: a dashboard card would draw a fact about the profile, and this module holds none.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-091](../../../../../docs/architecture/adr/091-content-packs.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-109](../../../../../docs/architecture/adr/109-astronomy.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/astronomy.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/astronomy.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `astronomy.ts` there.
