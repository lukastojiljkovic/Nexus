/**
 * The SQLCipher data key, as the rest of main holds it and as the crypto needs
 * it.
 *
 * One line of arithmetic in its own file, because it has two callers that both
 * wrap the account's master key with what it returns — `service.ts` when sync is
 * turned on, `round.ts` on every round — and a second hand-written copy of a
 * hex parser is the shape a defect is copied in. There is no second copy to
 * disagree with this one.
 */

/**
 * Sixty-four hex characters to thirty-two bytes.
 *
 * Refuses anything else rather than parsing as far as it can. `parseInt` on a
 * bad pair yields `NaN`, a `Uint8Array` stores that as 0, and the result is a
 * KEY THAT LOOKS FINE — thirty-two bytes, the right length, wrapping the master
 * key under bytes nothing will ever reproduce. The failure would arrive later,
 * on another machine, as a wrap that does not open.
 */
export function dataKeyBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new TypeError("sync: the local data key is not 32 bytes of hex.");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
