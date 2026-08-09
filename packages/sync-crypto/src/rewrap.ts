/**
 * Re-wrapping the master key when the email address changes. **Desktop only.**
 *
 * ─── Why this is a file and not three functions further down `kdf.ts` ───────
 *
 * `kdf.ts` is the module a BROWSER imports: it holds `deriveWebAuthPassword`,
 * which is the browser's entire legitimate interest in the password. This
 * operation is the opposite — it holds K_wrap, calls `unwrapKey`, and has MK in
 * plaintext for the duration — so keeping the two in one module made the
 * browser-facing module import `wrap.ts`.
 *
 * That mattered for a reason more concrete than tidiness. The rule stated in
 * `kdf.ts` is that a browser must never reference `deriveWebPasswordKeys`,
 * `rewrapMasterKeyForEmailChange` or `unwrapKey`, and a rule about what a bundle
 * references is only as good as whatever checks it. With the split, one of the
 * three is not merely unimported but UNREACHABLE: `@nexus/sync-crypto/web` does
 * not export it, and no module that barrel re-exports has a path to `wrap.ts`.
 * `scripts/web-key-surface.test.mjs` walks that graph and fails if one appears.
 *
 * The remaining two live in `kdf.ts` next to the function the browser does
 * import, because they are the same derivation and splitting a KDF in half to
 * satisfy a scanner would be the scanner deciding the design. They are kept out
 * by the export list instead — which is why the graph walk is not the only check.
 */

import { SyncCryptoError } from "./errors.js";
import { normalizeWebEmail, deriveWebPasswordKeys } from "./kdf.js";
import { zeroize } from "./bytes.js";
import type { Argon2idParams, CryptoPort } from "./port.js";
import { unwrapKey, wrapKey, type SealedKey } from "./wrap.js";

/** What {@link rewrapMasterKeyForEmailChange} needs. */
export interface EmailChangeInput {
  /** The master-key wrap currently stored server-side (`purpose: "mk/web-password"`). */
  readonly sealed: SealedKey;
  /** The account id the wrap is bound to. Unchanged by an address change. */
  readonly userId: string;
  readonly currentEmail: string;
  readonly nextEmail: string;
  /** The password, unchanged: an address change re-salts, it does not re-password. */
  readonly password: string;
  readonly params: Argon2idParams;
}

/**
 * Re-derives the master-key wrap for a new email address.
 *
 * This is the operation the salt design makes mandatory. It opens the wrap
 * under the key derived from the CURRENT address and re-seals it under the key
 * derived from the NEXT one, and it throws if the first step fails — so an
 * address change can never be committed against a wrap nobody can open. The
 * caller must treat this as one transaction with the identity provider's own
 * address change: **write the new wrap first, and only then let the address
 * change land.** Doing it the other way round loses the account, because the
 * old wrap's key is no longer derivable from anything the user knows.
 *
 * MK is held in plaintext for the few microseconds between the two calls, and
 * that is unavoidable — a re-wrap is by definition an unwrap followed by a
 * wrap. It never leaves this function. **It is also why this is a DESKTOP
 * operation**: it holds both K_wrap and MK, and neither belongs in a browser.
 */
export async function rewrapMasterKeyForEmailChange(
  port: CryptoPort,
  input: EmailChangeInput,
): Promise<SealedKey> {
  const context = { purpose: "mk/web-password", userId: input.userId } as const;

  // An address that normalises to the one already in use is not a change, and
  // re-wrapping under the identical key would burn a live wrap for nothing —
  // and, if the caller then "committed" the change, would look like it worked.
  if (normalizeWebEmail(input.currentEmail) === normalizeWebEmail(input.nextEmail)) {
    throw new SyncCryptoError(
      "kdf/bad-input",
      "The new address is the same address; there is nothing to re-wrap.",
    );
  }

  const current = await deriveWebPasswordKeys(port, {
    email: input.currentEmail,
    password: input.password,
    params: input.params,
  });
  // `try/finally` around the unwrap as well, not just the wrap: a wrong
  // password throws here, and the key derived from it must not outlive the
  // attempt just because the attempt failed.
  let masterKey: Uint8Array;
  try {
    masterKey = await unwrapKey(port, current.wrapKey, input.sealed, context);
  } finally {
    zeroize(current.wrapKey);
  }

  const next = await deriveWebPasswordKeys(port, {
    email: input.nextEmail,
    password: input.password,
    params: input.params,
  });
  try {
    return await wrapKey(port, next.wrapKey, masterKey, context);
  } finally {
    zeroize(next.wrapKey);
    zeroize(masterKey);
  }
}
