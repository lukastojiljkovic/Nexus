import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

export interface GalleryPersonalView {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly thumbnailMime: string;
  readonly thumbnailSha256: string;
  readonly thumbnailSizeBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GalleryArtView {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly date: string;
  readonly medium: string | null;
  readonly museum: string;
  readonly credit: string;
  readonly licence: string;
  readonly packId: string;
  readonly image: string;
  readonly width: number;
  readonly height: number;
}

export interface GalleryZimLibraryView {
  readonly id: string;
  readonly title: string;
}

export interface GalleryZimImageView {
  readonly libraryId: string;
  readonly libraryTitle: string;
  readonly zimPath: string;
  readonly title: string;
  readonly mime: string;
  readonly image: string;
}

export interface GalleryView {
  readonly personal: readonly GalleryPersonalView[];
  readonly art: readonly GalleryArtView[];
  readonly skippedPacks: readonly string[];
  readonly zimLibraries: readonly GalleryZimLibraryView[];
}

export interface GalleryImportInput {
  readonly profileId: string;
  readonly fileName: string;
  readonly title: string;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly bytes: Uint8Array;
}

interface ProfilePayload {
  readonly profileId: string;
}

interface UpdatePayload extends ProfilePayload {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  readonly tags: readonly string[];
}

interface RemovePayload extends ProfilePayload {
  readonly id: string;
}

interface ScanZimPayload extends ProfilePayload {
  readonly libraryId: string;
  readonly afterIndex: number;
}

export interface GalleryZimPage {
  readonly images: readonly GalleryZimImageView[];
  readonly nextIndex: number;
  readonly done: boolean;
}

type GalleryOps = {
  list: { request: ProfilePayload; response: GalleryView };
  importImage: { request: GalleryImportInput; response: GalleryView };
  update: { request: UpdatePayload; response: GalleryView };
  remove: { request: RemovePayload; response: GalleryView };
  scanZim: { request: ScanZimPayload; response: GalleryZimPage };
};

export type GalleryApi = ModuleApiOf<GalleryOps>;

export const contract = defineModuleContract<"gallery", GalleryOps>("gallery", [
  "list",
  "importImage",
  "update",
  "remove",
  "scanZim",
]);

declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    gallery: GalleryApi;
  }
}
