/**
 * THE EXTERNAL-LINK RULE (ADR-103): the one way a renderer may cause an address
 * to leave this process.
 *
 * A content pack carries its own licence and its own source, and a credits
 * screen is worthless if the addresses there cannot be opened. Opening one means
 * `shell.openExternal`, which hands the string to the operating system: on
 * Windows that is `ShellExecute`, so `file:`, a UNC path, an `.exe` on a share
 * and a protocol handler registered by some other program are all reachable
 * through it. That is the phishing and remote-launch primitive `ADR-089` refused
 * when it turned down `openExternal(url)` for the renderer, and the reason this
 * rule exists rather than a channel that forwards whatever it is given.
 *
 * WHAT IT ALLOWS, and nothing else: an `https` address, without credentials, of
 * a bounded length. What it deliberately does NOT do is allowlist hosts. The
 * addresses on the credits screen are third-party licences and third-party
 * sources — `creativecommons.org`, `www.kiwix.org`, somebody's own site — and a
 * compiled-in list of them would either be wrong within a week or would make the
 * credits screen a list of links that do not open. The rule that matters is the
 * SCHEME: an https address opens in the user's browser, which is a document
 * viewer, while a `file:` or a custom scheme opens a program. The rest of the
 * address travels unchanged, as the pack's publisher wrote it.
 *
 * THE LOADER IS THE USER'S BROWSER, never this process's network stack: nothing
 * here fetches anything, and `scripts/check-egress.mjs` carries an exemption for
 * exactly this file and exactly that reason.
 */

import { shell } from "electron";

/**
 * Longest address this will hand over. Real licence and source addresses are
 * well under a hundred characters; the cap is here so that a manifest cannot
 * make the OS parse a megabyte of string, and it is generous because a URL with
 * a query and a fragment can legitimately be long.
 */
const MAX_EXTERNAL_URL_LENGTH = 2048;

/**
 * Whether an address may be handed to the operating system.
 *
 * A pure function, so the rule is testable without Electron and readable in one
 * place. Unparseable, `http:`, a non-https scheme, an address carrying a
 * username or a password, and an over-long string all answer `false`: the caller
 * then does nothing rather than opening something it cannot vouch for.
 */
export function allowsExternalUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_EXTERNAL_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  // `https://user:pass@host/` reads as a host to a person and is not one; the
  // browser is the only party that would tell the difference.
  if (parsed.username !== "" || parsed.password !== "") return false;
  return parsed.hostname !== "";
}

/**
 * Opens `url` in the user's browser, and answers whether it did.
 *
 * A refused address answers `false` rather than throwing: the caller is a
 * credits row, and a row whose link does not open is not an error worth an
 * exception crossing the bridge.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (!allowsExternalUrl(url)) return false;
  await shell.openExternal(url);
  return true;
}
