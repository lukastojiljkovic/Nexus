# culture

Museums, theatre, concerts and cinema, with a programme, an arts guide and music.

## Manifest

- **id** — `culture`
- **prefix** — `CULT`
- **group** — `culture`
- **default** — on
- **settings card** — yes
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops by group: the whole list (`list`); visits (`createVisit`, `updateVisit`, `removeVisit`, `addVisitPhoto`, `removeVisitPhoto`); venues (`createVenue`, `updateVenue`, `removeVenue`); plans (`createPlan`, `updatePlan`, `removePlan`, `completePlan`); music (`importTrack`, `updateTrack`, `removeTrack`, `recordPlay`, `readTrackBytes`, `createEntry`, `updateEntry`, `removeEntry`, `createPlaylist`, `renamePlaylist`, `removePlaylist`, `addPlaylistTrack`, `movePlaylistItem`, `removePlaylistItem`); and `setPromptPastPlans`, `listArt`.
- **Store** — `CultureStore` in [`packages/db/src/culture/`](../../../../../packages/db/src/culture/), migration [`073-culture.ts`](../../../../../packages/db/src/migrations/073-culture.ts). Attached files are carried by the blob hook (ADR-108).
- **Content pack** — `dataset` packs carrying `art.json`, read by [`main/art.ts`](main/art.ts) for the arts guide.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with the view helpers in [`renderer/view.ts`](renderer/view.ts).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx)
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-107](../../../../../docs/architecture/adr/107-external-links.md), [ADR-108](../../../../../docs/architecture/adr/108-kit-blobs.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/culture.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/culture.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`culture.ts`](../../main/assistant/tools/culture.ts).
