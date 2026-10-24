import type { GalleryPersonalView } from "../shared/ipc.js";

export type GallerySource = "personal" | "art" | "zim";

export interface GalleryDisplayImage {
  readonly key: string;
  readonly id: string;
  readonly source: GallerySource;
  readonly title: string;
  readonly tags: readonly string[];
  readonly notes: string;
  readonly image: string;
  readonly fullImage: string;
  readonly credit: string | null;
  readonly licence: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly personal: GalleryPersonalView | null;
}

export interface GalleryFilter {
  readonly query: string;
  readonly source: GallerySource | null;
  readonly tag: string | null;
}

export function countText(template: string, count: number): string {
  return template.replaceAll("{count}", String(count));
}

export function galleryTags(
  images: readonly GalleryDisplayImage[],
  compare: (left: string, right: string) => number = (left, right) => left.localeCompare(right),
): string[] {
  return [...new Set(images.flatMap((image) => image.tags))].sort(compare);
}

export function filterGallery(
  images: readonly GalleryDisplayImage[],
  filter: GalleryFilter,
): GalleryDisplayImage[] {
  const needle = filter.query.trim().toLocaleLowerCase();
  return images.filter((image) => {
    if (filter.source !== null && image.source !== filter.source) return false;
    if (filter.tag !== null && !image.tags.includes(filter.tag)) return false;
    if (needle === "") return true;
    return [image.title, image.notes, ...image.tags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle);
  });
}
