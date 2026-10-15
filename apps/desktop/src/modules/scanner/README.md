# scanner

Reads text off an image or the camera and hands it to a note. Offline.

## Manifest

- **id** — `scanner`
- **prefix** — `UTIL`
- **group** — `make`
- **default** — on
- **settings card** — none
- **dashboard widget** — none

## Main half

- **Channels** — [`shared/ipc.ts`](shared/ipc.ts) declares the ops below; [`main/register.ts`](main/register.ts) registers one handler per op. Channels are named `<id>:<op>`. Its one op is `saveAsNote`.
- **Store** — none of its own: `saveAsNote` writes through `NoteStore` in [`packages/db/src/notes/`](../../../../../packages/db/src/notes/).
- **Content pack** — The `tessdata-fast` language pack (`TESSDATA_PACK_ID` in [`renderer/ocrConfig.ts`](renderer/ocrConfig.ts)) supplies the language data. The OCR code itself is the app's own.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx), with the image steps in [`renderer/imageOps.ts`](renderer/imageOps.ts) and [`renderer/canvasImage.ts`](renderer/canvasImage.ts), and the recognition session in [`renderer/ocrSession.ts`](renderer/ocrSession.ts).
- **Settings** — none: the module has no settings card.
- **Widget** — none: the module publishes no dashboard card.

## Records

- **ADRs** — [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md), [ADR-093](../../../../../docs/architecture/adr/093-navigation-groups.md)
- **PRD** — [PRD 29 Utilities](../../../../../docs/prd/29-utilities.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/scanner.md), [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/scanner.md)

## Assistant

The assistant's tools live in [`apps/desktop/src/main/assistant/tools/`](../../main/assistant/tools/); this module has no `scanner.ts` there.
