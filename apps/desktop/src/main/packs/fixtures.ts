/**
 * TEST-ONLY helper — imported by the `*.test.ts` files beside it and by nothing
 * in the app, `renderer/testStorage.ts`'s arrangement.
 *
 * Every pack test needs the same four things: a throwaway Ed25519 key (the real
 * one is the release key's private half and must never be read, printed or
 * copied), a folder with some content in it, a `pack.json` whose hashes and
 * sizes are computed from that content, and a signature over the manifest's
 * exact bytes. Writing that out per test file would be four copies of the same
 * arithmetic, so it is here — as a builder that takes the pieces apart enough
 * for the refusals to be reachable: a manifest whose bytes were edited after
 * signing, a file whose declared hash is wrong, a signature by another key.
 */

import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { packSignedBytes } from "./verify.js";

/** A throwaway Ed25519 pair. `publicKeyPem` is what the install path is handed in tests. */
export function makeKey(): { readonly publicKeyPem: string; readonly privateKey: KeyObject } {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: pair.privateKey,
  };
}

/** Lower-case hex SHA-256, the same digest the manifest carries. */
export function hashOf(contents: string | Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

/** One `files` entry, computed from the bytes that will actually be written. */
export function entry(
  path: string,
  contents: string | Uint8Array,
): { readonly path: string; readonly size: number; readonly sha256: string } {
  return {
    path,
    size: typeof contents === "string" ? Buffer.byteLength(contents, "utf8") : contents.byteLength,
    sha256: hashOf(contents),
  };
}

/** The manifest a valid fixture starts from, with `overrides` applied last so a test can break one field. */
export function baseManifest(
  files: readonly { readonly path: string; readonly size: number; readonly sha256: string }[],
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    format: 1,
    id: "wikipedia-sr",
    version: "1.0.0",
    kind: "zim",
    title: { sr: "Vikipedija na srpskom", en: "Wikipedia in Serbian" },
    description: { sr: "Ceo srpski Vikipedija ZIM.", en: "The whole Serbian Wikipedia as a ZIM." },
    files,
    licence: {
      spdx: "CC-BY-SA-4.0",
      attribution: "Wikipedia contributors",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    source: { name: "Kiwix", url: "https://www.kiwix.org/" },
    minAppVersion: "1.0.0",
    ...overrides,
  };
}

export interface WriteFixtureInput {
  readonly dir: string;
  /** Signs, when neither `omitSignature` nor `signOver` says otherwise. */
  readonly key: KeyObject;
  /** What goes into `pack.json`, as an object. Either this or `manifestBytes`. */
  readonly manifest?: unknown;
  /** What goes into `pack.json`, as exact bytes — for a manifest that is not valid JSON, or one edited after signing. */
  readonly manifestBytes?: Buffer;
  /** What the signature covers. Defaults to the manifest's own bytes. */
  readonly signOver?: Buffer;
  /** Leaves `pack.json.sig` out entirely. */
  readonly omitSignature?: boolean;
  /** Content files, written relative to `dir`. */
  readonly contents?: Readonly<Record<string, string | Uint8Array>>;
}

/**
 * Writes a pack folder: the content, `pack.json`, and `pack.json.sig`.
 *
 * The manifest's bytes are written EXACTLY as given, and the signature covers
 * exactly the bytes `signOver` names, so a test can sign one manifest and put
 * another on disk — which is the only way to reach the refusal that says the
 * signature does not cover what is there.
 */
export function writePack(input: WriteFixtureInput): { readonly manifestBytes: Buffer } {
  mkdirSync(input.dir, { recursive: true });
  for (const [path, contents] of Object.entries(input.contents ?? {})) {
    const target = join(input.dir, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }

  const manifestBytes =
    input.manifestBytes ??
    Buffer.from(`${JSON.stringify(input.manifest, null, 2)}\n`, "utf8");
  writeFileSync(join(input.dir, "pack.json"), manifestBytes);

  if (input.omitSignature !== true) {
    const over = packSignedBytes(input.signOver ?? manifestBytes);
    writeFileSync(join(input.dir, "pack.json.sig"), sign(null, over, input.key));
  }
  return { manifestBytes };
}
