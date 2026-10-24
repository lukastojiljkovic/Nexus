import { describe, expect, it } from "vitest";

import { countText, filterGallery, galleryTags, type GalleryDisplayImage } from "./gallery.js";

function image(
  key: string,
  source: GalleryDisplayImage["source"],
  title: string,
  tags: readonly string[],
  notes = "",
): GalleryDisplayImage {
  return {
    key,
    id: key,
    source,
    title,
    tags,
    notes,
    image: `${key}-thumb`,
    fullImage: key,
    credit: null,
    licence: null,
    width: null,
    height: null,
    personal: null,
  };
}

const IMAGES = [
  image("a", "personal", "More", ["Leto", "Porodica"], "Jadransko more"),
  image("b", "art", "Noć", ["Muzej"], "Van Gog"),
  image("c", "zim", "More", ["Wikipedia"], "Geografija"),
];

describe("Gallery filtering", () => {
  it("combines source, tag and text filters", () => {
    expect(
      filterGallery(IMAGES, { source: "personal", tag: "Leto", query: "JADRANSKO" }),
    ).toEqual([IMAGES[0]]);
    expect(filterGallery(IMAGES, { source: "zim", tag: "Leto", query: "" })).toEqual([]);
  });

  it("searches titles, notes and tags without diacritic folding beyond the entered text", () => {
    expect(filterGallery(IMAGES, { source: null, tag: null, query: "muzej" })).toEqual([
      IMAGES[1],
    ]);
    expect(filterGallery(IMAGES, { source: null, tag: null, query: "noc" })).toEqual([]);
  });

  it("sorts the available tags once", () => {
    expect(galleryTags(IMAGES)).toEqual(["Leto", "Muzej", "Porodica", "Wikipedia"]);
  });

  it("uses the active locale's collation for Serbian tags", () => {
    const serbian = [
      image("a", "personal", "A", ["Čačak", "Cacak", "Đak", "Danas", "Žaba", "Zaba"]),
    ];
    const compare = new Intl.Collator(["sr-Latn", "sr"]).compare;
    expect(galleryTags(serbian, compare)).toEqual(["Cacak", "Čačak", "Danas", "Đak", "Zaba", "Žaba"]);
  });

  it("fills the one count in scan status copy", () => {
    expect(countText("Loaded {count} of {count}?", 12)).toBe("Loaded 12 of 12?");
  });
});
