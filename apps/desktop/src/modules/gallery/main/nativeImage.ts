import { nativeImage } from "electron";
import { sniffMime } from "@nexus/core";

import { encodedImageSize, thumbnailSize, validateImageSize } from "./assets.js";

export interface ProcessedGalleryImage {
  readonly width: number;
  readonly height: number;
  readonly thumbnail: Uint8Array;
  readonly thumbnailMime: "image/png";
}

/** Decode and thumbnail in main, so none of these values are renderer claims. */
export function processGalleryImage(bytes: Uint8Array): ProcessedGalleryImage {
  const declared = encodedImageSize(bytes);
  if (declared === null) throw new Error("The selected file does not contain a supported image header.");
  // Refuse the allocation before `nativeImage` expands the encoded bytes.
  const header = validateImageSize(declared.width, declared.height);
  const decoded = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (decoded.isEmpty()) throw new Error("The selected file does not contain a decodable image.");

  const original = decoded.getSize();
  const { width, height } = validateImageSize(original.width, original.height);
  if (width !== header.width || height !== header.height) {
    throw new Error("The image header and decoded dimensions do not match.");
  }
  const thumbnailDimensions = thumbnailSize(width, height);
  const thumbnail = decoded
    .resize({ ...thumbnailDimensions, quality: "best" })
    .toPNG();
  if (thumbnail.byteLength === 0 || sniffMime(thumbnail) !== "image/png") {
    throw new Error("Nexus could not prepare a thumbnail for that image.");
  }
  return { width, height, thumbnail, thumbnailMime: "image/png" };
}
