/**
 * `SHA256SUMS.txt`, read the way `sha256sum` writes it.
 *
 * The file is produced by the release workflow with `sha256sum <files>`, so a
 * line is `<64 hex>  <name>` for a text-mode entry and `<64 hex> *<name>` for a
 * binary one. Both are accepted; every other line — a blank one, a comment, a
 * line someone hand-edited — is skipped rather than guessed at. The caller
 * looks its installer up by exact name, so a parse that dropped a line fails
 * closed as "no checksum", never as "matches".
 *
 * The line is read by POSITION rather than by a regular expression. A pattern
 * such as `/^([0-9a-fA-F]{64})[ \t]+\*?(.+)$/` is the ReDoS shape CodeQL flags —
 * overlapping quantifiers can be made to backtrack — and the format is
 * fixed-width, so a pattern buys nothing here.
 */

export function parseSha256Sums(text: string): ReadonlyMap<string, string> {
  const sums = new Map<string, string>();
  // A name that appeared twice cannot be trusted: two hashes for one name is a
  // file whose content is ambiguous, and picking the first or the last would be
  // a guess. Such names are dropped from the result outright, so `checksumFor`
  // answers null and the caller fails closed as "no checksum".
  const duplicated = new Set<string>();
  for (const rawLine of text.split("\n")) {
    // `sha256sum` writes LF; a file that travelled through a Windows editor may
    // carry CRLF, so one trailing CR is stripped before the positions are read.
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    // Characters 0-63 are the digest, 64 is a space, 65 is a space (text mode)
    // or `*` (binary mode), and the rest is the name.
    const hash = line.slice(0, 64);
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) continue;
    if (line[64] !== " ") continue;
    const mode = line[65];
    if (mode !== " " && mode !== "*") continue;
    const name = line.slice(66);
    if (name === "") continue;
    if (duplicated.has(name)) continue;
    if (sums.has(name)) {
      duplicated.add(name);
      sums.delete(name);
      continue;
    }
    sums.set(name, hash.toLowerCase());
  }
  return sums;
}

/** The expected lower-case hash for `name`, or null when the file does not list it. */
export function checksumFor(sums: ReadonlyMap<string, string>, name: string): string | null {
  return sums.get(name) ?? null;
}
