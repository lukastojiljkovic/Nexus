# maps

A map that works offline: download a territory, a continent or the world, search places, drop pins and measure a distance.

## Manifest

- **id** — `maps`
- **prefix** — `MAP`
- **group** — `knowledge`
- **default** — on
- **settings card** — none
- **dashboard widget** — none

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `createPin`, `updatePin`, `removePin`, `setLocation`, `clearLocation`, and the machine's map regions: `regions`, `estimateRegion`, `downloadRegion`, `pauseRegion`, `cancelRegion`, `removeRegion`.
- **Store** — `MapsStore` in [`packages/db/src/maps/`](../../../../../packages/db/src/maps/), migration [`085-maps.ts`](../../../../../packages/db/src/migrations/085-maps.ts).
- **Map regions** — Cut from the Protomaps planet build by [`main/extract/`](main/extract/) and downloaded by [`main/regions/`](main/regions/) into `<userData>/maps/`; the map reads them through the `nx-map:` scheme ([`main/regions/protocol.ts`](main/regions/protocol.ts)). `main/index.ts` wires the service with `configureMapRegions` ([`main/regions/services.ts`](main/regions/services.ts)).

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with [`renderer/PinDialog.tsx`](renderer/PinDialog.tsx) and [`renderer/PinList.tsx`](renderer/PinList.tsx). The style is built from the installed regions by [`renderer/style.ts`](renderer/style.ts), whose tiles [`renderer/regionTiles.ts`](renderer/regionTiles.ts) reads; the outline's card is [`renderer/regions/`](renderer/regions/). Place search is in the worker [`renderer/searchWorker.ts`](renderer/searchWorker.ts), which reads each region's places from its tiles ([`renderer/placeIndex.ts`](renderer/placeIndex.ts)).
- **Settings** — none: the module has no settings card.
- **Widget** — none: the module publishes no dashboard card.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-099](../../../../../docs/architecture/adr/099-offline-map.md), [ADR-118](../../../../../docs/architecture/adr/118-maps-cut-from-the-planet-build.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/maps.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/maps.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`maps.ts`](../../main/assistant/tools/maps.ts).
