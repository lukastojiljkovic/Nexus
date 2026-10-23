import type { MapLibreMap } from "maplibre-gl";

import { DISPUTED_HATCH_IMAGE, DISPUTED_POINT_IMAGE } from "./style.js";

/** The RGBA of one resolved design token, read through a canvas rather than parsed by hand. */
function colourChannels(colour: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Nexus: the map cannot create a 2D canvas for a disputed-area image.");
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

/** A transparent 8 by 8 tile with one token-coloured diagonal stroke. */
function hatchImage(colour: string): ImageData {
  const size = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Nexus: the map cannot create a 2D canvas for the dispute hatch.");
  const [red, green, blue] = colourChannels(colour);
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((x + y) % size >= 2) continue;
      const at = (y * size + x) * 4;
      image.data[at] = red;
      image.data[at + 1] = green;
      image.data[at + 2] = blue;
      image.data[at + 3] = 150;
    }
  }
  return image;
}

/** A small token-coloured circle whose stroke is dashed. */
function pointImage(colour: string): ImageData {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Nexus: the map cannot create a 2D canvas for a disputed point.");
  context.strokeStyle = colour;
  context.lineWidth = 1.6;
  context.setLineDash([3, 2]);
  context.beginPath();
  context.arc(size / 2, size / 2, 5.5, 0, Math.PI * 2);
  context.stroke();
  return context.getImageData(0, 0, size, size);
}

/**
 * Register the two runtime images a style cannot carry as an asset, or redraw
 * them: the token's colour differs by theme, and an image a style diff kept
 * would otherwise stay in the previous theme's colour.
 */
export function addDisputedImages(map: MapLibreMap, colour: string): void {
  for (const [id, image] of [
    [DISPUTED_HATCH_IMAGE, hatchImage(colour)],
    [DISPUTED_POINT_IMAGE, pointImage(colour)],
  ] as const) {
    if (map.hasImage(id)) map.updateImage(id, image);
    else map.addImage(id, image, { pixelRatio: 1 });
  }
}
