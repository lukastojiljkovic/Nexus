import type { ModuleManifest } from "@nexus/core";

/**
 * GALLERY — public art packs, images inside installed Reference libraries, and
 * the profile's own encrypted picture library.
 */
export const manifest: ModuleManifest = {
  id: "gallery",
  prefix: "GAL",
  group: "culture",
  defaultEnabled: true,
  order: 245,
  copy: {
    name: { sr: "Galerija", en: "Gallery" },
    description: {
      sr: "Umetničke slike iz paketa, slike iz preuzetih referenci i tvoje lične fotografije.",
      en: "Art from packs, images from downloaded Reference libraries and your own pictures.",
    },
  },
};
