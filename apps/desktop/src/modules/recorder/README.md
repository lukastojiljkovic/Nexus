# recorder

A voice and camera diary: record sound or video and play it back when you need it.

## Manifest

- **id** — `recorder`
- **prefix** — `REC`
- **group** — `knowledge`
- **default** — on
- **settings card** — yes
- **dashboard widget** — yes

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Ops: `list`, `beginCapture`, `save`, `update`, `remove`, `restore`, `setCountdown`.
- **Store** — `RecorderStore` in [`packages/db/src/recorder/`](../../../../../packages/db/src/recorder/), migration [`077-recorder.ts`](../../../../../packages/db/src/migrations/077-recorder.ts). The media files are carried by the blob hook (ADR-108).
- **Content pack** — none.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with [`renderer/CaptureSection.tsx`](renderer/CaptureSection.tsx); the capture logic is in [`renderer/capture.ts`](renderer/capture.ts). Device access is in [`main/mediaAccess.ts`](main/mediaAccess.ts).
- **Settings** — [`renderer/Settings.tsx`](renderer/Settings.tsx)
- **Widget** — [`renderer/Widgets.tsx`](renderer/Widgets.tsx)

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md), [ADR-108](../../../../../docs/architecture/adr/108-kit-blobs.md)
- **PRD** — none: the PRD registry has no row for this module.
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/recorder.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/recorder.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module's are in [`recorder.ts`](../../main/assistant/tools/recorder.ts).
