/**
 * The proof a desktop gives to be handed a device row: „I hold this account's
 * master key."
 *
 * ─── The problem this exists to solve ───────────────────────────────────────
 *
 * A `devices` row binds one client to one auth session, and its `session_id` is
 * immutable — by column grant and again by the `devices_guard` trigger (NX202),
 * whose hint says what to do instead: „pair the machine again to give it a new
 * session and a new row". But a desktop's session dies on its own. Verifying an
 * MFA factor revokes every OTHER session the account holds, so the moment a
 * second machine so much as attempts to enable sync, the first machine's session
 * is gone; refresh tokens expire; a user signs out everywhere. In every one of
 * those cases the desktop still HOLDS the master key — wrapped under its own data
 * key, on its own disk — and is nevertheless refused every read and every write,
 * because `nexus_session_is_live()` finds no device row for its new session.
 *
 * Without a way back that is exactly what „your data is on this machine and the
 * product will not open it" looks like. So there has to be a route from „a fresh
 * aal1 session on this account" to „a live desktop device row", and the whole
 * question is what it costs.
 *
 * ─── Why the price is MK and not the second factor ──────────────────────────
 *
 * The obvious gate — an `aal2` session, as the mint requires — is wrong twice.
 *
 * It is wrong on SECURITY. A desktop row is what
 * `key_wraps_master_key_is_desktop_only` accepts as authority to read
 * `mk_under_kwrap`, and K_wrap is derived from the web password. So „password +
 * second factor ⇒ a desktop row" would mean „password + second factor ⇒ MK",
 * and the desktop-only policy — the thing that keeps a phished password away
 * from the root of the key hierarchy — would be worth nothing. The policy's own
 * header says the two routes to an existing MK are pairing and the Recovery Kit,
 * *because both are proofs a password thief does not have*. This is the third
 * such proof, and it is the strongest of them: it is MK itself.
 *
 * It is wrong on BEHAVIOUR, and this is the part that is easy to miss. Verifying
 * a factor revokes every other session. If recovering a stranded desktop needed
 * a step-up, then desktop A recovering would strand desktop B, whose recovery
 * would strand A — two machines taking turns, forever, each „fixing" itself by
 * breaking the other. A proof that costs no step-up breaks the loop.
 *
 * ─── Why it is a stored verifier and not a signature ────────────────────────
 *
 * The server cannot check a proof of MK by holding MK. It could hold a public
 * key derived from MK and check a signature over the session id, which is
 * strictly stronger — a leaked verifier is replayable and a leaked public key is
 * not. It is not stronger against the attacker this is actually for.
 *
 * The verifier is readable by `service_role` alone: no grant of any kind reaches
 * `anon` or `authenticated`, so PostgREST cannot see the table exists. The
 * attacker the desktop-only policy defends against is one holding web
 * credentials and ordinary client access — and that attacker cannot read this
 * value at all. The two attackers who could are one who has the whole database
 * (who already has `mk_under_kwrap` and, with the password, MK — no device row
 * required) and one who has the service-role key (who bypasses every policy in
 * the schema anyway). Against neither does a signature buy anything, and it
 * would cost a second key type, a second set of test vectors, and an
 * asymmetric primitive in three runtimes.
 *
 * ─── It must be written by the mint, or the account can never use it ────────
 *
 * `nexus_mk_mint` writes this value in the same transaction that writes the
 * wraps and the first device row, for the same reason it writes `mk_under_src`
 * there: nothing can add it afterwards. The table has no client grants, and the
 * one function that could write it is the one that needs to read it. An account
 * minted without a verifier would be an account that can never recover a
 * stranded desktop, discovered months later, with no way to repair it short of
 * abandoning the account. The mint is a one-shot; everything a later recovery
 * needs is written by it or is never written.
 *
 * ─── What it is ────────────────────────────────────────────────────────────
 *
 * 32 bytes of HKDF over MK, domain-separated by label AND account:
 *
 *   proof = HKDF-SHA256(ikm = MK, salt = "", info = struct("nexus/sync/device-register/v1", user_id))
 *
 * One-way, so presenting it never yields MK — a compromised Edge Function log
 * learns a registration token and not a master key. Bound to the account, so it
 * is meaningless anywhere else. Deterministic, so any machine holding MK can
 * compute it without asking the server for anything, which is what lets a
 * desktop with no live session produce it offline.
 */

import { encodeStruct, utf8 } from "./bytes.js";
import { AEAD_KEY_BYTES, type CryptoPort } from "./port.js";

/** The proof's length. The same 32 bytes the schema's CHECK constraint demands. */
export const DEVICE_REGISTER_PROOF_BYTES = 32;

const DEVICE_REGISTER_LABEL = "nexus/sync/device-register/v1";

/** HKDF over a full-entropy master key legitimately skips the extract salt. */
const EMPTY_SALT = new Uint8Array(0);

/**
 * Derives this account's device-registration proof from its master key.
 *
 * Pure and offline: no clock, no I/O, nothing from the server. A desktop whose
 * session has died computes it from the MK it already has at rest, which is the
 * entire point — the machine that cannot talk to the server is the one that
 * needs to prove something to it.
 */
export async function deriveDeviceRegisterProof(
  port: CryptoPort,
  masterKey: Uint8Array,
  userId: string,
): Promise<Uint8Array> {
  if (masterKey.length !== AEAD_KEY_BYTES) {
    throw new TypeError(`Master key must be ${AEAD_KEY_BYTES} bytes, got ${masterKey.length}`);
  }
  if (userId.length === 0) {
    throw new TypeError("deriveDeviceRegisterProof: userId must not be empty.");
  }
  return port.hkdfSha256({
    ikm: masterKey,
    salt: EMPTY_SALT,
    // `encodeStruct` rather than concatenation: the account id is
    // variable-length, and a label-plus-id built by joining bytes is a
    // construction where two different (label, id) pairs can produce the same
    // info. Length-prefixed framing makes that unrepresentable.
    info: encodeStruct([utf8(DEVICE_REGISTER_LABEL), utf8(userId)]),
    outputBytes: DEVICE_REGISTER_PROOF_BYTES,
  });
}
