/**
 * `@nexus/sync-crypto/testing` — the deterministic `CryptoPort` fake, and
 * nothing else.
 *
 * A separate export subpath from the package barrel on purpose: the fake's
 * Argon2id has no work factor at all (see the file header), so the one thing
 * that must never happen is a production import reaching it. Keeping it out of
 * `.` means an accidental `import { createFakeCryptoPort } from
 * "@nexus/sync-crypto"` does not compile.
 */

export { createFakeCryptoPort } from "./fakeCryptoPort.js";
export type { FakeCryptoPort, FakeCryptoPortOptions } from "./fakeCryptoPort.js";
