/**
 * The caps every pack operation runs under.
 *
 * A pure module with no Electron import, for `update/limits.ts`'s reason: the
 * numbers are what a hostile or merely broken pack cannot exceed, and they
 * should be readable and testable without a browser process.
 *
 * The content caps are deliberately loose, because a content pack is supposed
 * to be large — a full offline Wikipedia is tens of gigabytes, and that is the
 * product. They are not there to keep packs small; they are there so that a
 * manifest cannot describe a hundred million files, or a single file larger
 * than the disk it is about to be copied onto. The tight ones are the manifest
 * and the signature, which are small by construction: a bound on those is a
 * bound on how long a hostile folder can make this process read before it has
 * even looked at a hash.
 */
export const PACK_LIMITS = {
  /** `pack.json`: ids, two-language copy and one line per file. A megabyte is a hundredfold headroom. */
  manifestBytes: 1024 * 1024,
  /** A detached Ed25519 signature is 64 bytes. The slack absorbs a whitespace-quoted re-write. */
  signatureBytes: 4 * 1024,
  /** One content file. */
  fileBytes: 64 * 1024 * 1024 * 1024, // 64 GiB
  /** The whole pack, every file together. */
  packBytes: 256 * 1024 * 1024 * 1024, // 256 GiB
  /** How many content files one pack may list. */
  files: 4096,
  /** Longest relative path the manifest may name, in characters. */
  pathLength: 240,
  /** Deepest a pack path may nest, in path segments. */
  pathDepth: 8,
  /** Longest pack id, in characters. */
  idLength: 64,
  /** Longest title, in characters, per language. */
  titleChars: 200,
  /** Longest description, in characters, per language. */
  descriptionChars: 4000,
  /**
   * What a copy needs on top of the pack's own bytes: the `.staging` tree holds
   * a second copy until the rename lands, and a full volume would fail the
   * rename rather than the copy. Checked before a byte moves.
   */
  installHeadroomBytes: 64 * 1024 * 1024,
  /**
   * How much a copy or a verify copies before it reports progress again.
   * Sixteen mebibytes is a fraction of a second on any disk this app installs
   * from, and it is what keeps a twenty-gigabyte file from being one event.
   */
  progressStepBytes: 16 * 1024 * 1024,
} as const;
