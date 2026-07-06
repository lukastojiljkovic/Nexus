import { randomBytes } from "node:crypto";

const UUID_BYTES = 16;

/**
 * Generates a UUIDv7 (RFC 9562): a 48-bit big-endian Unix-millisecond timestamp
 * in the high bytes (making ids lexicographically time-sortable), version nibble
 * `7`, variant bits `10`, and the remaining 74 bits from a CSPRNG (SEC-CR-05).
 * Canonical lowercase hyphenated form. No external dependency.
 */
export function uuidv7(): string {
  const bytes = randomBytes(UUID_BYTES);
  const timestamp = BigInt(Date.now());

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
