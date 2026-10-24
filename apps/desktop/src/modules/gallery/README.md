# gallery

One local place for art-pack images, pictures found in downloaded Reference
libraries, and images the user imports from this computer.

## Manifest

- **id** — `gallery`
- **prefix** — `GAL`
- **group** — `culture`
- **default** — on

## Main half

- **Channels** — `list`, `importImage`, `update`, `remove` and `scanZim` in
  [`shared/ipc.ts`](shared/ipc.ts), registered in
  [`main/register.ts`](main/register.ts).
- **Personal store** — `GalleryStore` in
  [`packages/db/src/gallery/`](../../../../../packages/db/src/gallery/),
  migration [`100-gallery.ts`](../../../../../packages/db/src/migrations/100-gallery.ts).
- **Images** — personal originals and generated thumbnails are separate
  encrypted, content-addressed blobs. Main decodes the original, enforces the
  edge and pixel caps, and produces the thumbnail; none of those values are
  renderer claims.
- **Public sources** — installed signed art packs are read through the shared
  art reader. Reference-library images use a bounded ZIM scan and
  `nx-zim://`; no library path crosses to the renderer.

## Renderer half

- **Page** — [`renderer/Page.tsx`](renderer/Page.tsx)
- **Filters and viewer model** — [`renderer/gallery.ts`](renderer/gallery.ts)

The grid uses thumbnails. Opening a card loads the original in the dialog.
Personal images can be imported, renamed, tagged, annotated and deleted with
confirmation. Pack and ZIM images are read-only and keep their credit and
licence or library attribution.

## Archive

The profile archive carries personal image metadata, originals and thumbnails.
Pack and ZIM images are not duplicated into the profile.

## Records

- **ADRs** — [ADR-019](../../../../../docs/architecture/adr/019-encrypted-blob-store.md),
  [ADR-090](../../../../../docs/architecture/adr/090-module-kit.md),
  [ADR-098](../../../../../docs/architecture/adr/098-zim-offline-library.md),
  [ADR-108](../../../../../docs/architecture/adr/108-kit-blobs.md)
- **Manual** — [en](../../../../../apps/desktop/src/main/assistant/manual/en/gallery.md),
  [sr](../../../../../apps/desktop/src/main/assistant/manual/sr/gallery.md)
