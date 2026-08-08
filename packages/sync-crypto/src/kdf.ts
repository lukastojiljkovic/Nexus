/**
 * The web password KDF: one Argon2id derivation, split by HKDF into the value
 * the server is allowed to learn and the value it must never learn.
 *
 *   salt   = SHA-256("nexus/web-kdf/v1" ‖ lowercase(email))
 *   PRK    = Argon2id(password, salt, 64 MiB, t=3, p=1) → 32 bytes
 *   K_auth = HKDF-SHA256(PRK, info="nexus/web-kdf/auth/v1") → sent to Supabase
 *            Auth AS THE PASSWORD, base64url-encoded
 *   K_wrap = HKDF-SHA256(PRK, info="nexus/web-kdf/wrap/v1") → wraps MK
 *            server-side (see `wrap.ts`)
 *
 * Neither K_auth nor K_wrap is ever persisted. The password itself never leaves
 * the client at all.
 *
 * ─── Why the split, and why HKDF ────────────────────────────────────────────
 *
 * The server has to be able to authenticate the user, so it necessarily learns
 * *something* derived from the password: K_auth, which it stores the way any
 * password is stored (Supabase hashes it again with bcrypt). Assume the worst
 * and say that store leaks — a stolen database, a compromised host, a hostile
 * operator. K_auth is then known. K_wrap must still be out of reach, because
 * K_wrap is the only thing standing between that adversary and MK, and MK
 * opens every profile.
 *
 * HKDF-Expand is a PRF: its outputs under different `info` strings are
 * computationally independent, and neither reveals the PRK. So knowing K_auth
 * gives no advantage in guessing K_wrap beyond attacking the password itself —
 * which is what the 64 MiB of Argon2id is for. Splitting a 64-byte Argon2
 * output in half would have the same formal property, but the KDF is the wrong
 * place to be clever: `info` strings are self-describing, versioned, and
 * survive a change in output length.
 *
 * ─── Why the salt binds the email, and what that costs ───────────────────────
 *
 * A per-user random salt would have to be FETCHED before the user could sign
 * in, which hands an unauthenticated caller an account-existence oracle and
 * gives a hostile server a per-attempt lever to weaken the derivation. Binding
 * the salt to the address instead makes it derivable offline, identical on
 * every device, and stable — no round trip, nothing to lie about.
 *
 * **The cost is real and must be handled, not documented and forgotten: a
 * change of email address changes the salt, therefore changes K_wrap,
 * therefore renders the stored master-key wrap unopenable.** Changing the
 * address is consequently not a profile edit — it is a re-wrap, and it can
 * only be done while the current password is in hand.
 * {@link rewrapMasterKeyForEmailChange} is that operation, and the address
 * change must not be committed unless it succeeds.
 *
 * The salt is deliberately NOT a secret. It is a public function of a public
 * identifier; its whole job is to stop one rainbow table covering every Nexus
 * account, and it does that.
 *
 * ─── Which half a browser is allowed to compute ─────────────────────────────
 *
 * This is the file where "MK MUST NEVER ENTER A BROWSER" is either kept or
 * quietly lost, so it is worth being exact about the mechanism rather than
 * repeating the slogan.
 *
 * K_wrap opens the master-key wrap. That wrap is STORED ON THE SERVER, and a
 * signed-in browser can fetch it — it is a row of its own account. So any code
 * path that computes K_wrap inside a browser has put MK one `unwrapKey` call
 * away, and `unwrapKey` is exported from the same package. No comment, flag or
 * review convention survives contact with that arrangement.
 *
 * The browser does not need K_wrap. It needs exactly one thing from the
 * password — `authPassword`, to sign in — and it gets the profile content keys
 * from pairing, never from MK. So the two halves are separated by FUNCTION, not
 * by discipline:
 *
 *   {@link deriveWebAuthPassword}   K_auth only. **The browser calls this.**
 *   {@link deriveWebPasswordKeys}   K_auth and K_wrap. **Desktop only** — it is
 *                                   how a desktop writes and re-opens the
 *                                   server-side master-key wrap.
 *
 * That reduces the rule to something a build can actually check and a reviewer
 * can actually grep: **the web bundle must not reference
 * `deriveWebPasswordKeys`, `rewrapMasterKeyForEmailChange` or `unwrapKey`.**
 * This package cannot enforce that from the inside — it does not know who is
 * importing it — so it belongs in the web app's entry points and in a lint rule
 * over them. It is recorded here because this is where a reader will look.
 *
 * The address change is the awkward consequence: it needs K_wrap, so it is a
 * DESKTOP operation. A browser-only user who changes their address must be told
 * to do it from the desktop, or the account's master-key wrap is orphaned.
 */

import { bytesToBase64url, concatBytes, utf8, zeroize } from "./bytes.js";
import { SyncCryptoError } from "./errors.js";
import { AEAD_KEY_BYTES, SHA256_BYTES, type Argon2idParams, type CryptoPort } from "./port.js";
import { unwrapKey, wrapKey, type SealedKey } from "./wrap.js";

/**
 * OWASP's Argon2id baseline (64 MiB, t=3, p=1) — the same figures the local
 * key chain uses in `@nexus/core`. This is a FLOOR as well as a default; see
 * {@link assertAcceptableParams}.
 */
export const WEB_KDF_PARAMS: Argon2idParams = {
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
};

const SALT_LABEL = "nexus/web-kdf/v1";
const AUTH_INFO = utf8("nexus/web-kdf/auth/v1");
const WRAP_INFO = utf8("nexus/web-kdf/wrap/v1");

/** HKDF over a full-entropy Argon2id output legitimately skips the extract salt. */
const EMPTY_SALT = new Uint8Array(0);

/** The two halves of the derivation. Hold neither longer than the operation needs. */
export interface WebPasswordKeys {
  /**
   * The string handed to Supabase Auth in place of a password: 43 characters
   * of unpadded base64url over 32 bytes. base64url specifically because this
   * value crosses a JSON body and an HTTP form, where `+`, `/` and `=` each
   * need escaping somewhere; and 43 characters because bcrypt truncates at 72
   * bytes and a longer encoding would silently throw entropy away.
   */
  readonly authPassword: string;
  /** 32 bytes. Wraps MK for the server (`wrap.ts`, purpose `mk/web-password`). */
  readonly wrapKey: Uint8Array;
}

/** What {@link deriveWebPasswordKeys} needs. `params` is explicit — see the floor check. */
export interface WebPasswordInput {
  readonly email: string;
  readonly password: string;
  /**
   * The account's Argon2id cost, which in production is READ FROM THE SERVER
   * so it can be raised later without locking anyone out. That makes it
   * attacker-controlled input, which is why it is checked against a floor.
   */
  readonly params: Argon2idParams;
}

/**
 * The canonical address: trimmed, NFKC-normalised, lower-cased.
 *
 * NFKC because an address typed through a different keyboard or IME can be a
 * different code-point sequence for the same visible text (fullwidth Latin is
 * the common case), and two spellings must not derive two salts.
 * `toLowerCase`, never `toLocaleLowerCase`: the locale-sensitive form maps `I`
 * to a dotless `ı` under a Turkish locale, so the same account would derive a
 * different key on a Turkish device than anywhere else.
 *
 * Deliberately does NOT do anything cleverer — no stripping of dots, no
 * `+tag` removal. Those transformations are provider-specific folklore, and
 * any of them would make two addresses the identity provider considers
 * DIFFERENT derive the same key.
 */
export function normalizeWebEmail(email: string): string {
  const normalized = email.normalize("NFKC").trim().toLowerCase();
  if (normalized.length === 0) {
    throw new SyncCryptoError("kdf/bad-input", "An email address is required to derive a key.");
  }
  return normalized;
}

/**
 * NFKC-normalised, never trimmed — the same rule (and the same reason) as
 * `@nexus/core`'s `normalizePasscode`. Leading and trailing spaces are part of
 * a password the user chose to type; trimming them would make "secret1 " and
 * "secret1" the same password and silently narrow the space.
 */
export function normalizeWebPassword(password: string): string {
  const normalized = password.normalize("NFKC");
  if (normalized.length === 0) {
    throw new SyncCryptoError("kdf/bad-input", "A password is required to derive a key.");
  }
  return normalized;
}

/**
 * `SHA-256(label ‖ canonical email)`. Plain concatenation is injective here —
 * unlike the AADs in `wrap.ts` and `row.ts`, this is a FIXED prefix followed by
 * exactly one variable-length field, so no two inputs can line up differently.
 */
export async function webKdfSalt(port: CryptoPort, email: string): Promise<Uint8Array> {
  return port.sha256(concatBytes(utf8(SALT_LABEL), utf8(normalizeWebEmail(email))));
}

/**
 * The most this client will spend on one derivation. A ceiling is as necessary
 * as a floor, and for a symmetric reason: the parameters come from a HOSTILE
 * server, and `m = 64 GiB, t = 10000` is not a strong password hash, it is a
 * denial of service that hangs or crashes the tab of every user who tries to
 * sign in. 1 GiB and 16 passes are far above anything this product would
 * choose and far below anything that hurts.
 */
const MAX_WEB_KDF_MEMORY_KIB = 1024 * 1024;
const MAX_WEB_KDF_ITERATIONS = 16;

/**
 * The most lanes this client will accept.
 *
 * Parallelism is the one parameter where "higher" is NOT "stronger". Argon2
 * divides the same total memory among `p` lanes that can be computed
 * independently, so raising `p` at a fixed `m` leaves the defender's cost
 * roughly unchanged while handing an attacker with many cores a proportional
 * speedup. A hostile server that could set `p` freely would weaken K_wrap
 * without the number ever looking suspicious. Hence a range, not a floor.
 */
const MAX_WEB_KDF_PARALLELISM = 4;

/**
 * Rejects Argon2id parameters that are not a sane, safe cost.
 *
 * The account's parameters travel with the account, on a server this design
 * assumes is HOSTILE. Without this check a server could answer every sign-in
 * with `m = 8 KiB, t = 1` — the client would derive K_wrap under a cost the
 * server can brute-force, and the master-key wrap it is holding would fall to
 * an offline dictionary attack. Weakening K_auth would gain it nothing (it
 * receives K_auth anyway); weakening K_wrap gains it everything.
 *
 * For memory and passes the rule is a floor, so costs can be raised for
 * everyone later without a migration. For lanes it is a range, for the reason
 * on {@link MAX_WEB_KDF_PARALLELISM}. And every value must be a plain positive
 * integer first: `NaN < 65536` is `false`, so a `NaN` would sail through a
 * bare floor comparison and land in the KDF.
 */
function assertAcceptableParams(params: Argon2idParams): void {
  const refuse = (why: string): never => {
    throw new SyncCryptoError(
      "kdf/bad-input",
      `Argon2id parameters refused (m=${String(params.memoryKiB)} KiB, ` +
        `t=${String(params.iterations)}, p=${String(params.parallelism)}): ${why}`,
    );
  };

  for (const [name, value] of [
    ["memoryKiB", params.memoryKiB],
    ["iterations", params.iterations],
    ["parallelism", params.parallelism],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      refuse(`${name} must be a positive integer.`);
    }
  }

  if (params.memoryKiB < WEB_KDF_PARAMS.memoryKiB || params.iterations < WEB_KDF_PARAMS.iterations) {
    refuse(
      `below the floor of m=${WEB_KDF_PARAMS.memoryKiB} KiB, t=${WEB_KDF_PARAMS.iterations}.`,
    );
  }
  if (params.memoryKiB > MAX_WEB_KDF_MEMORY_KIB || params.iterations > MAX_WEB_KDF_ITERATIONS) {
    refuse(`above the ceiling of m=${MAX_WEB_KDF_MEMORY_KIB} KiB, t=${MAX_WEB_KDF_ITERATIONS}.`);
  }
  if (params.parallelism > MAX_WEB_KDF_PARALLELISM) {
    refuse(`parallelism above ${MAX_WEB_KDF_PARALLELISM} lanes.`);
  }
}

/** The Argon2id half, shared by both derivations. The caller owns erasing it. */
async function webPasswordPrk(port: CryptoPort, input: WebPasswordInput): Promise<Uint8Array> {
  assertAcceptableParams(input.params);
  const salt = await webKdfSalt(port, input.email);
  return port.argon2id({
    password: utf8(normalizeWebPassword(input.password)),
    salt,
    params: input.params,
    outputBytes: SHA256_BYTES,
  });
}

/**
 * **The browser's half: K_auth and nothing else.**
 *
 * Signing in needs the password to become one string the identity provider can
 * check, and that is all a browser session is entitled to derive. K_wrap is
 * never computed here, so a browser that only ever calls this function cannot
 * open the server-side master-key wrap even with the wrap in hand — not because
 * it is told not to, but because it never holds the key. See the file header on
 * why that separation is by function rather than by convention.
 */
export async function deriveWebAuthPassword(
  port: CryptoPort,
  input: WebPasswordInput,
): Promise<string> {
  const prk = await webPasswordPrk(port, input);
  const authKey = await port.hkdfSha256({
    ikm: prk,
    salt: EMPTY_SALT,
    info: AUTH_INFO,
    outputBytes: AEAD_KEY_BYTES,
  });
  zeroize(prk);
  return bytesToBase64url(authKey);
}

/**
 * Both halves. **Desktop only** — see the file header.
 *
 * Byte-for-byte identical to {@link deriveWebAuthPassword} in its `authPassword`
 * output, so the two functions are interchangeable for signing in and the
 * desktop does not pay a second Argon2id to do both.
 */
export async function deriveWebPasswordKeys(
  port: CryptoPort,
  input: WebPasswordInput,
): Promise<WebPasswordKeys> {
  const prk = await webPasswordPrk(port, input);

  const [authKey, wrapKeyBytes] = await Promise.all([
    port.hkdfSha256({ ikm: prk, salt: EMPTY_SALT, info: AUTH_INFO, outputBytes: AEAD_KEY_BYTES }),
    port.hkdfSha256({ ikm: prk, salt: EMPTY_SALT, info: WRAP_INFO, outputBytes: AEAD_KEY_BYTES }),
  ]);
  // The PRK is the root of both halves and is of no further use. Erasing it is
  // best-effort in JavaScript (see `zeroize`), but the window in which a heap
  // dump yields the key that opens MK is worth shortening.
  zeroize(prk);

  return { authPassword: bytesToBase64url(authKey), wrapKey: wrapKeyBytes };
}

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
