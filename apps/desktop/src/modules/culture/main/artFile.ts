import { join } from "node:path";
import { isSafePackPath, packPathSegments, isSafePackIdSegment } from "../../../main/packs/paths.js";
import { packsRoot, readInstalled } from "../../../main/packs/registry.js";
import { artImageMime } from "./art.js";

/**
 * Turning a `nx-pack:` URL into a file on disk, or into nothing.
 *
 * **This is the whole gate of the read protocol.** Everything about the request
 * is untrusted - the renderer wrote the URL - so four questions are asked
 * before a byte is read, and a `null` answer is a 404 with no further argument:
 *
 *  1. is the pack id one that could name a folder (`isSafePackIdSegment`) and
 *     the version a `MAJOR.MINOR.PATCH` string?
 *  2. is the path inside the pack (`isSafePackPath`: no `..`, no drive, no
 *     absolute segment, no Windows device name...)?
 *  3. is it an image this guide draws (the extension rule)?
 *  4. is the pack INSTALLED - verified against the release key - a `dataset`,
 *     and does its signed manifest list that exact path?
 *
 * The fourth is the one that makes the protocol read-only in the sense that
 * matters: the bytes served can only be bytes that were hashed while the pack
 * was copied, so a file somebody edited into the folder afterwards is not
 * reachable through the scheme at all.
 *
 * Pure and electron-free on purpose: the protocol handler is three lines in
 * `packProtocol.ts`, and this - the part with the rules in it - is testable
 * against a fixture folder with `packs/fixtures.ts`.
 */

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export interface ResolvedArtFile {
  /** The absolute path the protocol will read. Never crosses the IPC boundary. */
  readonly absolutePath: string;
  readonly mime: string;
}

export function resolveArtFile(
  request: { id: string; version: string; path: string },
  userData: string,
  publicKeyPem: string,
): ResolvedArtFile | null {
  if (!isSafePackIdSegment(request.id)) return null;
  if (!VERSION_PATTERN.test(request.version)) return null;
  if (!isSafePackPath(request.path)) return null;
  const mime = artImageMime(request.path);
  if (mime === null) return null;

  const installed = readInstalled(userData, publicKeyPem).find(
    (pack) => pack.manifest.id === request.id && pack.manifest.version === request.version,
  );
  if (installed === undefined || installed.manifest.kind !== "dataset") return null;
  if (!installed.manifest.files.some((file) => file.path === request.path)) return null;

  return {
    absolutePath: join(packsRoot(userData), request.id, request.version, ...packPathSegments(request.path)),
    mime,
  };
}
