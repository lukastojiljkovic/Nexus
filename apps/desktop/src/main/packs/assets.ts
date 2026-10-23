/**
 * Where one file of a published pack lives: the release asset's name, and its
 * address under a catalogue entry's `assets` base (ADR-103, format 2).
 *
 * **The rule is `scripts/packs/catalogue.mjs`'s `assetName`, spelled a second
 * time on purpose.** The maintainer's tool names the file it uploads and the app
 * names the file it asks for, and the two are the same string or the download is
 * a 404. Format 1 avoided the question by writing every URL into the catalogue,
 * which is what grew the document to within 82 KB of its cap with 22 packs; format
 * 2 pins each pack's manifest instead and derives every other address from it.
 * `assets.test.ts` runs both spellings over the same table, so the copies cannot
 * drift without a red test.
 */

/** How long a flat asset name may be before it is trimmed and disambiguated by its hash. */
const MAX_ASSET_NAME = 180;

/**
 * `<pack id>__<path, with `/` written `__`>`, every character GitHub does not
 * accept in an asset name replaced by `_`, and a name still over the cap cut there
 * and suffixed with the first sixteen hex digits of the file's own SHA-256.
 */
export function packAssetName(packId: string, path: string, sha256: string): string {
  const flat = `${packId}__${path.split("/").join("__")}`.replace(/[^A-Za-z0-9._-]/g, "_");
  if (flat.length <= MAX_ASSET_NAME) return flat;
  return `${flat.slice(0, MAX_ASSET_NAME)}-${sha256.slice(0, 16)}`;
}

/** The asset's address: the entry's base, which the catalogue check guarantees ends in `/`, and the name. */
export function packAssetUrl(base: string, packId: string, path: string, sha256: string): string {
  return `${base}${packAssetName(packId, path, sha256)}`;
}
