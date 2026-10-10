/**
 * What CULTURE's main half needs from the process it runs in, injected rather
 * than imported (ADR-090).
 *
 * **Why it cannot be imported.** The blob store lives in
 * `main/attachments.ts` and its roots, its key material and the account
 * selection all belong to `main/index.ts`; `main/packs` needs the same two
 * facts. A module may not reach `app`, `ipcMain` or an account directory
 * (ADR-090 §3), and it must not: a `register.ts` that imported a database path
 * could not be tested, and one that resolved `app.getPath` could not even be
 * imported outside Electron.
 *
 * **One file, so the wiring is one call.** `index.ts` calls
 * `configureCultureServices` once, beside `createModuleHost`, and passes
 * closures over the very functions it already has. Nothing here caches a value
 * that moves with the selected account: every getter is a function, exactly as
 * `registerBlobProtocol`'s are, so a locked session or an account switch cannot
 * be answered with the previous one's paths or keys.
 */

export interface CultureServices {
  /** Writes bytes to the account's content-addressed blob store (write-if-absent). */
  saveBlob(bytes: Uint8Array): Promise<{ sha256: string; created: boolean }>;
  /** Decrypts one blob, or answers null when nothing holds it. */
  readBlob(sha256: string): Promise<Uint8Array | null>;
  /** Unlinks a blob once `refCount` says nothing names it any more. */
  deleteBlobIfOrphaned(sha256: string, refCount: number): Promise<void>;
  /**
   * Main's own union count across EVERY table that names a hash, at the moment
   * it is asked. This module contributes its two tables through the store
   * (`CultureStore.refCount`), and this is the one that also sees notes, tasks,
   * subject materials, a dashboard background and a profile picture - so a file
   * this module stops naming cannot be collected while somebody else still
   * shows it.
   */
  blobRefCount(profileId: string, sha256: string): number;
  /** `<userData>/packs` - where an installed content pack lives (ADR-091 §5). */
  packsRoot(): string;
  /** The pinned release key a pack's manifest is verified against. */
  releasePublicKeyPem(): string;
}

let configured: CultureServices | null = null;

/** Called once by `main/index.ts`. */
export function configureCultureServices(services: CultureServices): void {
  configured = services;
}

/**
 * The services, or a thrown error naming the wiring.
 *
 * Throwing rather than answering a default is deliberate: a handler that ran
 * without them could write a row pointing at bytes nobody stored, and the one
 * place that can cause that is a build where `index.ts` forgot its one call.
 */
export function cultureServices(): CultureServices {
  if (configured === null) {
    throw new Error(
      "Nexus: the culture module's main-process services were never configured.",
    );
  }
  return configured;
}
