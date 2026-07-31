import { strings } from "./strings.js";

/**
 * The profile avatar (SET-001), and the initials it falls back to. One
 * component, two sizes, two surfaces — the Settings profile card and the
 * sidebar's own profile row — because two hand-rolled circles would drift the
 * first time either changed.
 *
 * The picture is served by `nx-blob://<hash>`, the same read protocol inline
 * note images and the dashboard background use: main resolves the hash to a
 * mime through the union in `blobMimeForHash` (which `profiles` is a member of),
 * decrypts the blob and answers with `X-Content-Type-Options: nosniff`. The
 * renderer never holds the bytes — it names a hash and lets main decide.
 */

/**
 * Up to two initials for a name: the first letter of its first two words,
 * uppercased. A name that yields nothing at all (empty, or only punctuation)
 * gives the empty string, and the caller draws a bare circle rather than a
 * placeholder glyph — a profile named nothing is a real state here (main seeds
 * the first-run profile with a blank name, deliberately, since naming belongs to
 * onboarding).
 *
 * `toLocaleUpperCase` with the Serbian Latin tag rather than plain
 * `toUpperCase`: the codebase's own sr-Latn rule, and the reason the collator is
 * always constructed with `["sr-Latn", "sr"]`.
 */
export function profileInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => [...word][0] ?? "")
    .join("")
    .toLocaleUpperCase(["sr-Latn", "sr"]);
}

export interface ProfileAvatarProps {
  name: string;
  /** The blob store's sha256 for this profile's picture, or null — the renderer turns it into an `nx-blob://` URL and never sees the bytes. */
  pictureHash: string | null;
  /**
   * `md` (64px) for the Settings profile card, `sm` (24px) for the sidebar row.
   * Two fixed sizes rather than a free number: the avatar is a circle whose
   * border and type scale have to be chosen for its diameter, and a free size
   * would be a promise to look right at values nobody drew.
   */
  size: "sm" | "md";
}

/**
 * The picture when there is one, the initials when there is not. Always a
 * circle on `--nx-surface-alt` with a token border — quiet by construction: no
 * ring, no glow, no accent fill (the direction brief's selection rules apply to
 * decoration too).
 *
 * The initials are `aria-hidden`: they are a rendering of the profile's name,
 * which both surfaces already show beside them, so announcing them would repeat
 * it letter by letter. The PICTURE keeps a real `alt` — it is the one state
 * with content of its own to announce, and an unlabeled `<img>` is worse than a
 * short, honest "Slika profila".
 */
export function ProfileAvatar({ name, pictureHash, size }: ProfileAvatarProps) {
  const className = `avatar avatar--${size}`;
  if (pictureHash !== null) {
    return (
      <img
        className={className}
        src={`nx-blob://${pictureHash}`}
        alt={strings.settings.profile.pictureAlt}
      />
    );
  }
  return (
    <span className={className} aria-hidden="true">
      {profileInitials(name)}
    </span>
  );
}
