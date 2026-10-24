import { sniffMime } from "@nexus/core";
import {
  GalleryStore,
  MAX_GALLERY_NOTES_LENGTH,
  MAX_GALLERY_TAGS,
  MAX_GALLERY_TAG_LENGTH,
  MAX_GALLERY_TITLE_LENGTH,
  parseGalleryExport,
} from "@nexus/db";

import { zimHost } from "../../../main/zim/host.js";
import { zimUrlPath } from "../../../main/zim/paths.js";
import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  type GalleryPersonalView,
  type GalleryView,
} from "../shared/ipc.js";
import { readArt } from "./art.js";
import { processGalleryImage } from "./nativeImage.js";

const MAX_IMAGE_BYTES = 52_428_800;
const GALLERY_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type Bearer = Pick<ModuleCall, "profileDb">;

function store(bearer: Bearer, profileId: string): GalleryStore {
  return bearer.profileDb(profileId, (db, id) => new GalleryStore(db, id));
}

function personalView(item: ReturnType<GalleryStore["get"]>): GalleryPersonalView {
  return {
    id: item.id,
    title: item.title,
    notes: item.notes,
    tags: item.tags,
    fileName: item.fileName,
    mime: item.mime,
    sizeBytes: item.sizeBytes,
    width: item.width,
    height: item.height,
    sha256: item.sha256,
    thumbnailMime: item.thumbnailMime,
    thumbnailSha256: item.thumbnailSha256,
    thumbnailSizeBytes: item.thumbnailSizeBytes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function instant(ms: number): string {
  return new Date(ms).toISOString();
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  async function viewOf(call: Bearer, profileId: string): Promise<GalleryView> {
    const packs = ctx.packs();
    const art = await readArt(packs.userData(), packs.publicKeyPem);
    return {
      personal: store(call, profileId).listActive().map(personalView),
      art: art.works,
      skippedPacks: art.skipped,
      zimLibraries: zimHost().libraries().map((library) => ({
        id: library.id,
        title: library.title,
      })),
    };
  }

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("importImage", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const bytes = payload.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`Invalid IPC payload: "bytes" must be an image of at most ${String(MAX_IMAGE_BYTES)} bytes.`);
    }
    const mime = sniffMime(bytes);
    if (!GALLERY_IMAGE_MIMES.has(mime)) {
      throw new Error("Gallery accepts PNG, JPEG, WebP or GIF images.");
    }
    const fileName = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.fileName, "fileName"),
      "fileName",
      255,
    );
    const title = call.as.asCappedChars(
      call.as.asString(payload.title, "title") || fileName.replace(/\.[^.]+$/, ""),
      "title",
      MAX_GALLERY_TITLE_LENGTH,
    );
    const notes = call.as.asCappedChars(call.as.asString(payload.notes, "notes"), "notes", MAX_GALLERY_NOTES_LENGTH);
    const tags = Array.isArray(payload.tags) ? payload.tags.map((tag, index) =>
      call.as.asCappedChars(call.as.asString(tag, `tags[${String(index)}]`), `tags[${String(index)}]`, MAX_GALLERY_TAG_LENGTH)
    ).slice(0, MAX_GALLERY_TAGS) : [];
    const processed = processGalleryImage(bytes);
    const saveBlob = call.saveBlob;
    if (saveBlob === undefined) throw new Error("This build has no blob store open.");
    const { sha256 } = await saveBlob(bytes);
    let thumbnailSha256: string;
    try {
      ({ sha256: thumbnailSha256 } = await saveBlob(processed.thumbnail));
    } catch (error) {
      await call.releaseBlob(sha256).catch(() => undefined);
      throw error;
    }
    try {
      store(call, profileId).create(
        {
          title,
          notes,
          tags,
          fileName,
          mime,
          sizeBytes: bytes.byteLength,
          sha256,
          thumbnailMime: processed.thumbnailMime,
          thumbnailSha256,
          thumbnailSizeBytes: processed.thumbnail.byteLength,
          width: processed.width,
          height: processed.height,
        },
        instant(call.now()),
      );
    } catch (error) {
      await Promise.all([
        call.releaseBlob(sha256).catch(() => undefined),
        call.releaseBlob(thumbnailSha256).catch(() => undefined),
      ]);
      throw error;
    }
    return await viewOf(call, profileId);
  });

  ctx.handle("update", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).update(
      call.as.asId(payload.id, "id"),
      {
        title: call.as.asCappedChars(call.as.asNonEmptyString(payload.title, "title"), "title", MAX_GALLERY_TITLE_LENGTH),
        notes: call.as.asCappedChars(call.as.asString(payload.notes, "notes"), "notes", MAX_GALLERY_NOTES_LENGTH),
        tags: Array.isArray(payload.tags) ? payload.tags.map((tag, index) =>
          call.as.asCappedChars(call.as.asString(tag, `tags[${String(index)}]`), `tags[${String(index)}]`, MAX_GALLERY_TAG_LENGTH)
        ).slice(0, MAX_GALLERY_TAGS) : [],
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("remove", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    const removed = store(call, profileId).remove(id, instant(call.now()));
    await Promise.all([
      call.releaseBlob(removed.sha256),
      call.releaseBlob(removed.thumbnailSha256),
    ]);
    return await viewOf(call, profileId);
  });

  ctx.handle("scanZim", (payload, call) => {
    call.as.asId(payload.profileId, "profileId");
    const libraryId = call.as.asId(payload.libraryId, "libraryId");
    const afterIndex = call.as.asBoundedInteger(payload.afterIndex, "afterIndex", 0, 100_000_000);
    const page = zimHost().images(libraryId, afterIndex, 40);
    const library = zimHost().libraries().find((row) => row.id === libraryId);
    return {
      images: page.entries.map((entry) => ({
        libraryId,
        libraryTitle: library?.title ?? libraryId,
        zimPath: entry.zimPath,
        title: entry.title,
        mime: entry.mime,
        image: `nx-zim://${encodeURIComponent(libraryId)}${zimUrlPath(entry.zimPath)}`,
      })),
      nextIndex: page.nextIndex,
      done: page.done,
    };
  });

  ctx.exportData((session) => {
    const profileId = session.profileIds.length === 1 ? (session.profileIds[0] ?? null) : null;
    return profileId === null ? undefined : store(session, profileId).exportData();
  });

  ctx.importData({
    parse: parseGalleryExport,
    apply: (value, session) => {
      for (const profileId of session.profileIds) {
        store(session, profileId).importData(value ?? { version: 1, items: [] });
      }
    },
  });

  ctx.blobs({
    refCount: (session, profileId, sha256) => store(session, profileId).refCount(sha256),
    mimeForHash: (session, profileId, sha256) => store(session, profileId).mimeForHash(sha256),
    exportBlobs: (session) => {
      const profileId = session.profileIds.length === 1 ? (session.profileIds[0] ?? null) : null;
      if (profileId === null) return [];
      const blobs = new Map<string, number>();
      for (const item of store(session, profileId).exportData().items) {
        blobs.set(item.sha256, item.sizeBytes);
        blobs.set(item.thumbnailSha256, item.thumbnailSizeBytes);
      }
      return [...blobs].map(([sha256, sizeBytes]) => ({ sha256, sizeBytes }));
    },
    importBlobs: (value) =>
      value === undefined
        ? []
        : parseGalleryExport(value).items.flatMap((item) => [
            { sha256: item.sha256, sizeBytes: item.sizeBytes },
            { sha256: item.thumbnailSha256, sizeBytes: item.thumbnailSizeBytes },
          ]),
  });
}
