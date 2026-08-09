/**
 * The sync recovery code, and the key it derives — the documented way back into
 * an account whose web password is gone.
 *
 * ─── Why this exists at all, given that MK is already wrapped twice ──────────
 *
 * MK lives under `K_wrap` on the server and under `DK` on each desktop. Both of
 * those can be lost at once, and the way it happens is ordinary: the user
 * forgets the web password AND the machine dies. At that point every profile's
 * ciphertext is still sitting on the server, perfectly intact, openable by
 * nobody — including us, which is the point of the product and is exactly why it
 * needs a third door that the user, and only the user, holds.
 *
 * That door is 160 bits of printed entropy. It is not a password: nothing about
 * it is chosen, guessable, reused, or typed twice a day. So the threat model is
 * „someone has the database and wants to guess this", and 2^160 answers it
 * without any help from a KDF.
 *
 * ─── Then why Argon2id over it, and why the same cost as the password ───────
 *
 * Two reasons, neither of them „because passwords get Argon2id".
 *
 * The first is that the code is a HUMAN-HANDLED secret. It is printed, kept in a
 * drawer, photographed, sometimes typed into the wrong box. A memory-hard
 * derivation costs a legitimate user one second, once, in the worst hour of
 * their year — and it means that a partially-compromised code (a photograph at
 * an angle, a smudged digit, a user who wrote down 26 of the 32) does not fall
 * to an instant offline search over the missing digits. That is the case where
 * the KDF actually earns its keep, and it is the likely one.
 *
 * The second is that {@link SYNC_RECOVERY_KDF_PARAMS} must clear the server's
 * `key_wraps_kdf_params_floor` CHECK. A wrap that arrives below it is refused by
 * the database, so „no KDF, the code is strong enough" is not a shape this
 * schema will store — deliberately, because the floor cannot tell a 160-bit code
 * from a four-word passphrase somebody substituted later.
 *
 * ─── The salt IS stored here, unlike the web password's ─────────────────────
 *
 * `kdf.ts` refuses to store or fetch a salt, because the web password's salt is
 * derived from the email and a *fetched* salt would be a per-attempt lever a
 * hostile server holds over a human-chosen secret. Here the conclusion inverts,
 * and migration 009 encodes the difference: this salt has no other source, so it
 * must be stored, and a server that lies about it gains nothing — there is no
 * dictionary to aim a chosen salt at, and a wrong salt fails at `wrapKey`'s
 * commitment tag rather than yielding a plausible key. Same column, opposite
 * answers, because the secrets differ.
 *
 * ─── No HKDF after the Argon2id, and that is not an omission ────────────────
 *
 * `deriveWebPasswordKeys` runs HKDF because it splits one derivation into two
 * independent keys. There is one key here. The domain separation that would
 * otherwise justify an expand step already happens downstream: `wrapKey` derives
 * its encryption and commitment subkeys from this KEK with labels AND the full
 * wrap AAD (purpose, user id, profile, epoch) mixed in. Adding a second expand
 * „for symmetry" would move that boundary without strengthening it.
 *
 * ─── DESKTOP ONLY ───────────────────────────────────────────────────────────
 *
 * {@link deriveSyncRecoveryKey} is absent from `@nexus/sync-crypto/web` for the
 * same reason `deriveWebPasswordKeys` is. `mk_under_src` is deliberately
 * READABLE without a desktop device row — a new desktop recovering an account
 * has none, and obtaining one is what it is doing — so a browser can always
 * fetch that row. If a browser could also derive its opener, then „browser plus
 * the printed code" would be MK in a browser, which is the one outcome this
 * package is arranged to make unreachable. `scripts/web-key-surface.test.mjs`
 * carries the name.
 */

import { normalizeCrockford, encodeCrockford, groupCrockford } from "./crockford.js";
import { SyncCryptoError } from "./errors.js";
import { utf8 } from "./bytes.js";
import { AEAD_KEY_BYTES, type Argon2idParams, type CryptoPort } from "./port.js";

/**
 * Thirty-two Crockford digits in groups of four — byte-for-byte the shape of
 * `@nexus/core`'s LOCAL Recovery Kit code.
 *
 * Identical on purpose. These are two different secrets for two different keys
 * (that one opens `DK` on one machine, this one opens `MK` for the account), and
 * a user who has to tell them apart will do it by the label on the sheet, never
 * by the shape. Making them look like two species of thing would suggest one of
 * them is typed somewhere the other is not, which is false and would be a
 * dangerous thing for someone to conclude while holding both.
 */
export const SYNC_RECOVERY_CODE_DIGITS = 32;
const SYNC_RECOVERY_CODE_BYTES = 20;
const SYNC_RECOVERY_GROUP_SIZE = 4;

/** 16 bytes, exactly what `key_wraps_kdf_salt_presence` requires of this slot. */
export const SYNC_RECOVERY_SALT_BYTES = 16;

/**
 * The same OWASP baseline `WEB_KDF_PARAMS` uses, and the same figures as the
 * local key chain. One cost in the product rather than three, because a second
 * number here would only be a second thing to justify and to raise.
 */
export const SYNC_RECOVERY_KDF_PARAMS: Argon2idParams = {
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
};

/**
 * 160 bits, drawn through the port.
 *
 * Twenty bytes for thirty-two digits is exact — 32 × 5 = 160 — so no bits are
 * discarded and none are invented. `encodeCrockford` takes a prefix of a
 * uniformly random bit string, which is itself uniform; a character-at-a-time
 * modulo over random bytes would bias the alphabet toward its low end and
 * quietly cost entropy that nobody would ever measure.
 */
export function generateSyncRecoveryCode(port: CryptoPort): string {
  return encodeCrockford(port.randomBytes(SYNC_RECOVERY_CODE_BYTES), SYNC_RECOVERY_CODE_DIGITS);
}

/** 16 random bytes. Stored beside the wrap; see the header on why, here, that is right. */
export function generateSyncRecoverySalt(port: CryptoPort): Uint8Array {
  return port.randomBytes(SYNC_RECOVERY_SALT_BYTES);
}

/**
 * The canonical upper-case form, or `null` if the input cannot be one.
 *
 * Dashes, spaces and case are cosmetic; `O`/`I`/`L` fold to the digits they are
 * mistaken for. A user reading a printed sheet may type what they think they
 * see. Anything left over is REFUSED rather than guessed at — a code that is
 * silently repaired into a different code derives a different key and fails
 * later, at the unwrap, where the error says „wrong code" about a code the user
 * typed correctly.
 */
export function normalizeSyncRecoveryCode(input: string): string | null {
  return normalizeCrockford(input, SYNC_RECOVERY_CODE_DIGITS);
}

/** The canonical form re-grouped for printing: eight groups of four. */
export function formatSyncRecoveryCode(canonical: string): string {
  return groupCrockford(canonical, SYNC_RECOVERY_GROUP_SIZE);
}

/** What {@link deriveSyncRecoveryKey} needs. `params` is explicit — see the floor check. */
export interface SyncRecoveryInput {
  /** The code as the user typed it. Normalised here, so a caller cannot forget to. */
  readonly code: string;
  /** The 16 bytes stored with the wrap. */
  readonly salt: Uint8Array;
  /**
   * The account's Argon2id cost, READ FROM THE SERVER so it can be raised later
   * without stranding a printed code. That makes it attacker-controlled input,
   * which is why it is bounded rather than trusted.
   */
  readonly params: Argon2idParams;
}

/**
 * The most this client will spend, and the least it will accept.
 *
 * The floor matters less than `kdf.ts`'s — 160 bits is not brute-forced at any
 * cost — but the ceiling matters just as much and for exactly the same reason:
 * the parameters arrive from a server this design assumes is hostile, and
 * `m = 64 GiB` is not a strong derivation, it is a recovery flow that hangs on
 * the one day the user needs it. Refusing to start is a legible failure;
 * freezing is not.
 *
 * Parallelism is a RANGE rather than a floor, per `kdf.ts`: Argon2 divides fixed
 * memory among `p` independent lanes, so raising `p` leaves the defender's cost
 * about where it was while handing a many-core attacker a proportional speedup.
 */
const MIN_MEMORY_KIB = 64 * 1024;
const MIN_ITERATIONS = 3;
const MAX_MEMORY_KIB = 1024 * 1024;
const MAX_ITERATIONS = 16;
const MAX_PARALLELISM = 4;

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
    // Integer-checked FIRST, and not as tidiness: `NaN < 65536` is `false`, so a
    // NaN sails straight through a bare floor comparison and lands in the KDF.
    if (!Number.isSafeInteger(value) || value < 1) refuse(`${name} must be a positive integer.`);
  }

  if (params.memoryKiB < MIN_MEMORY_KIB || params.iterations < MIN_ITERATIONS) {
    refuse(`below the floor of m=${MIN_MEMORY_KIB} KiB, t=${MIN_ITERATIONS}.`);
  }
  if (params.memoryKiB > MAX_MEMORY_KIB || params.iterations > MAX_ITERATIONS) {
    refuse(`above the ceiling of m=${MAX_MEMORY_KIB} KiB, t=${MAX_ITERATIONS}.`);
  }
  if (params.parallelism > MAX_PARALLELISM) refuse(`parallelism above ${MAX_PARALLELISM} lanes.`);
}

/**
 * The 32-byte KEK that opens `mk_under_src`. **Desktop only** — see the header.
 *
 * The code is normalised here rather than by the caller, so „the user typed
 * lower case" and „the user typed the dashes" cannot become two different keys
 * depending on which call site did the work.
 */
export async function deriveSyncRecoveryKey(
  port: CryptoPort,
  input: SyncRecoveryInput,
): Promise<Uint8Array> {
  const canonical = normalizeSyncRecoveryCode(input.code);
  if (canonical === null) {
    throw new SyncCryptoError(
      "kdf/bad-input",
      `A sync recovery code is ${SYNC_RECOVERY_CODE_DIGITS} Crockford base32 characters.`,
    );
  }
  if (input.salt.length !== SYNC_RECOVERY_SALT_BYTES) {
    throw new SyncCryptoError(
      "kdf/bad-input",
      `The recovery salt must be ${SYNC_RECOVERY_SALT_BYTES} bytes, got ${input.salt.length}.`,
    );
  }
  assertAcceptableParams(input.params);

  return port.argon2id({
    password: utf8(canonical),
    salt: input.salt,
    params: input.params,
    outputBytes: AEAD_KEY_BYTES,
  });
}
