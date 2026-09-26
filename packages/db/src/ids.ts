import { randomBytes } from "node:crypto";

const UUID_BYTES = 16;

/** The largest value the 12-bit `rand_a` field can carry as a sequence. */
const MAX_SEQUENCE = 0xfff;

/**
 * The millisecond the last id was stamped with, and how many ids have been
 * stamped with it before this one. Module state on purpose: ids are minted in
 * one process (main), and monotonicity is a property of the generator, not of
 * any one caller.
 */
let lastMs = -1;
let sequence = 0;

/**
 * Generates a UUIDv7 (RFC 9562): a 48-bit big-endian Unix-millisecond timestamp
 * in the high bytes, version nibble `7`, a 12-bit sequence in `rand_a`, variant
 * bits `10`, and 62 bits from a CSPRNG (SEC-CR-05). Canonical lowercase
 * hyphenated form. No external dependency.
 *
 * **Strictly increasing within this process** — RFC 9562 §6.2, method 1 (a
 * fixed-length counter in `rand_a`). Until 2026-09-26 those twelve bits were
 * random as well, which made ids time-sortable only BETWEEN milliseconds.
 * Stores list rows by a timestamp and then by id, so for everything written in
 * one millisecond — and a batch writes a great deal in one — the id was the
 * order, and the order was a shuffle: the demo profile's circuit parts, wires
 * and same-day transactions came back differently on every seed, and every
 * screenshot sweep with them. Now an id minted later sorts later: a new
 * millisecond starts the sequence at zero, the same millisecond counts up, a
 * clock that steps BACK keeps counting on the last millisecond rather than
 * minting ids that sort before ones already written, and the 4 097th id in one
 * millisecond borrows the next millisecond, as the RFC allows.
 *
 * The sequence is not a secret and does not need to be; what makes an id
 * unguessable is the 62 CSPRNG bits after it, which every id still carries.
 */
export function uuidv7(): string {
  const bytes = randomBytes(UUID_BYTES);
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    sequence = 0;
  } else {
    sequence += 1;
    if (sequence > MAX_SEQUENCE) {
      lastMs += 1;
      sequence = 0;
    }
  }
  const timestamp = BigInt(lastMs);

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f); // version 7, then the sequence's high nibble
  bytes[7] = sequence & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
