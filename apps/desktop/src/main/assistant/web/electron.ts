import { safeStorage } from "electron";

import type { SecretCipher } from "./secrets.js";

/**
 * The Electron half of the secret store: everything that needs a browser
 * process is here and NOTHING that decides anything. `secrets.ts` owns the file
 * layout, the atomic write, the fail-closed read and the refusal to store an
 * unusable key; this file only turns `safeStorage` into the `SecretCipher` port.
 *
 * The keystore is DEVICE- AND ACCOUNT-BOUND (`DPAPI` on Windows, exactly what
 * `main/auth.ts` wraps the account key with), and that is the point rather than
 * a side effect: a key that cannot be decrypted on another machine or under
 * another Windows account comes back as `null` and the user pastes it again.
 * There is no plaintext fallback, and `secrets.ts` refuses to write at all when
 * `isEncryptionAvailable()` is false.
 *
 * NOBODY CONSTRUCTS THIS YET, deliberately: the module's `main/register.ts` is
 * the next wave's, and the settings card that saves a key arrives with it. It is
 * written now because the alternative is that caller inventing its own call to
 * `safeStorage` - and the one decision here (refuse rather than downgrade) is a
 * decision, not plumbing.
 */
export function createSafeStorageCipher(): SecretCipher {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString("base64"),
    decrypt: (ciphertext) => {
      try {
        return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
      } catch {
        // See the header: another machine's blob is `null`, not an error.
        return null;
      }
    },
  };
}
