# car

A service book per vehicle: services and receipts, due intervals, odometer readings, fuel and faults.

## Manifest

- **id** — `car`
- **prefix** — `CAR`
- **group** — `life`
- **default** — on
- **settings card** — yes
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops by group: vehicles (`list`, `detail`, `nextDue`, `createVehicle`, `updateVehicle`, `archiveVehicle`, `unarchiveVehicle`, `removeVehicle`); the log (`addReading`, `removeReading`, `addService`, `updateService`, `removeService`, `attachReceipts`, `removeReceipt`); intervals (`setInterval`, `clearInterval`); fuel (`addFuel`, `removeFuel`); faults (`addFault`, `updateFault`, `removeFault`); and `setThresholds`.
- **Store** — `CarStore` in [`packages/db/src/car/`](../../../../../packages/db/src/car/), migration [`074-car.ts`](../../../../../packages/db/src/migrations/074-car.ts). Receipts are carried by the blob hook (ADR-108).
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx): the garage, then the chosen vehicle's service log, intervals, fuel and faults. The view helpers are in [`renderer/carView.ts`](renderer/carView.ts).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx)
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-108](../../../../../docs/architecture/adr/108-kit-blobs.md)
- **PRD** — [PRD 22 Car](../../../../../docs/prd/22-car.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/car.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/car.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`car.ts`](../../main/assistant/tools/car.ts).
