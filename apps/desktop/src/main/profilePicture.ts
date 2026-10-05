import { readFile, stat } from "node:fs/promises";
import type { BrowserWindow, OpenDialogOptions } from "electron";
import { dialog, nativeImage } from "electron";
import { centerSquareCrop, isInlineImageMime, sniffMime, PROFILE_PICTURE_SIZE } from "@nexus/core";
import { shellStrings } from "./shellStrings.js";
import type { ProfilePicturePickErrorCode } from "../shared/ipc.js";

/**
 * The whole of a profile picture's file handling (SET-001), in the main process
 * and nowhere else — the ADR-041 background pick, with one addition that is the
 * entire point of this module: main also PROCESSES the image.
 *
 * THE SECURITY POSTURE. The renderer never sends a path (SEC-EL: main owns the
 * dialog, as it does for every file this app reads) and it never sends BYTES
 * either. That second half is what makes an interactive crop UI unbuildable
 * here, and its absence a deliberate decision rather than an omission: a
 * drag-a-box-over-your-photo control lives in the renderer, which means the
 * renderer must receive the full-resolution image, decode it in the untrusted
 * process, and send back either a rectangle over bytes it holds or the cropped
 * bytes themselves. Every version of that inverts the one discipline this
 * pipeline exists to keep. So the crop is automatic and CENTRED, the caption in
 * Settings says so plainly rather than hiding it, and the founder gets the
 * trade named (see the lane report) instead of a feature that quietly moved
 * image handling into the renderer.
 *
 * THE METADATA STRIP. `nativeImage.createFromBuffer` decodes into an in-memory
 * bitmap — pixels, and nothing else. EXIF, XMP, ICC profiles and every other
 * ancillary chunk are properties of the CONTAINER (the JPEG's APP1 segment, the
 * PNG's `eXIf`/`iTXt` chunks), and the container is discarded at decode. `toPNG`
 * then encodes a brand-new PNG from that bitmap, so the bytes stored are a
 * container this process built: it carries no metadata by construction, because
 * there is no path by which the original's metadata could reach it. This
 * matters for a profile picture more than for any other image the app takes:
 * a photo of a person is the file most likely to carry GPS coordinates, a
 * camera serial number and a capture timestamp, and an offline-first app has no
 * business writing any of that to disk because someone chose an avatar. The
 * output is re-sniffed below as a cheap standing check that what we store is
 * what we claim (SEC-FILE-02) — never a claim from anywhere else.
 *
 * Deliberately NOT electron-free, unlike `restore.ts` and `profileData.ts`:
 * `nativeImage` IS the decoder, so this module cannot be exercised under
 * Vitest (see `vitest.config.ts`). The one piece with a right and a wrong
 * answer — the crop rectangle — therefore lives in `@nexus/core`'s
 * `centerSquareCrop`, where it is pure and tested.
 */

/** One picked, processed picture: PNG bytes main produced itself, and the mime it sniffed off them. */
export interface ProcessedProfilePicture {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** The outcome of the native "pick a profile picture" dialog: canceled, refused for a NAMED reason, or the processed bytes. */
export type PickedProfilePicture =
  | { status: "canceled" }
  | { status: "rejected"; code: ProfilePicturePickErrorCode }
  | { status: "ok"; picture: ProcessedProfilePicture };

/** The dialog's extension filter — the ADR-041 allowlist, so the picker offers exactly what `isInlineImageMime` accepts. An extension is a hint for the user, never a check: the sniff below is the check. */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

/**
 * Opens the native picker, reads the chosen file under a size cap, sniffs it,
 * and hands back a square PNG this process encoded itself.
 *
 * Order matters and is deliberate, mirroring `handleDashboardPick`:
 *
 * 1. `stat` BEFORE the read, so an oversized file is refused without ever being
 *    loaded — reading first and measuring after would make the cap decorative.
 * 2. Sniff the bytes, never the extension (SEC-FILE-02). A `.png` whose content
 *    is a PDF sniffs as a PDF and is refused by name.
 * 3. Decode, crop, resize, re-encode — see the module doc for what step 3 is
 *    really for.
 *
 * The one place this differs in kind from the background pick is step 3's
 * failure mode. Electron's `createFromBuffer` documents itself as trying "PNG or
 * JPEG first", and a buffer no decoder in it can read comes back as an EMPTY
 * image rather than an error — so a GIF or a WebP inside the allowlist may
 * legitimately arrive here and fail to decode. That is reported as its own named
 * reason (`undecodable`) rather than folded into `unsupported-format`: the
 * format IS one this app allows, the decoder is what could not read it, and the
 * two deserve different sentences in front of the user. Keeping the allowlist
 * wide also means the day Electron's decoder set widens, those formats start
 * working with no change here.
 */
export async function pickProfilePicture(
  win: BrowserWindow | null,
  maxBytes: number,
): Promise<PickedProfilePicture> {
  const options: OpenDialogOptions = {
    properties: ["openFile"],
    filters: [{ name: shellStrings().imageFilterName, extensions: IMAGE_EXTENSIONS }],
  };
  const { canceled, filePaths } = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  const filePath = canceled ? null : (filePaths[0] ?? null);
  if (filePath === null) return { status: "canceled" };

  let bytes: Buffer;
  try {
    const stats = await stat(filePath);
    if (stats.size > maxBytes) return { status: "rejected", code: "too-large" };
    bytes = await readFile(filePath);
  } catch {
    return { status: "rejected", code: "unreadable" };
  }

  if (!isInlineImageMime(sniffMime(bytes))) {
    return { status: "rejected", code: "unsupported-format" };
  }

  const picture = processProfilePicture(bytes);
  if (picture === null) return { status: "rejected", code: "undecodable" };
  return { status: "ok", picture };
}

/**
 * Decode → centre-square crop → resize to `PROFILE_PICTURE_SIZE` → encode PNG.
 * Returns null when the decoder could not read the buffer at all, or produced
 * something this function is unwilling to store.
 *
 * The resize is to a FIXED edge, including when the source square is smaller —
 * upscaling a tiny image gains no detail, but one predictable stored size is
 * worth more than the few kilobytes saved: the avatar is drawn at several sizes
 * and on displays with a device pixel ratio of 2 or 3, and a picture that was
 * sometimes 512px and sometimes 40px would be visibly inconsistent between two
 * profiles sitting in the same list.
 *
 * The final `sniffMime` is not ceremony. It is the one assertion that closes the
 * loop this module opened: the bytes that go into the blob store, and the mime
 * the database records for them, are read off the SAME buffer — so the row can
 * never claim a type the file is not, whatever the encoder did.
 */
function processProfilePicture(bytes: Buffer): ProcessedProfilePicture | null {
  const decoded = nativeImage.createFromBuffer(bytes);
  if (decoded.isEmpty()) return null;

  const { width, height } = decoded.getSize();
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }

  const square = decoded.crop(centerSquareCrop(width, height));
  const resized = square.resize({
    width: PROFILE_PICTURE_SIZE,
    height: PROFILE_PICTURE_SIZE,
    quality: "best",
  });

  const png = resized.toPNG();
  if (png.byteLength === 0) return null;

  const mime = sniffMime(png);
  if (mime !== "image/png") return null;
  return { bytes: png, mime };
}
