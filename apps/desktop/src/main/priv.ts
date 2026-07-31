/**
 * Private notes (PRIV v1, ADR-057): the main-process half of the sealed
 * section. This module owns the ONE piece of state the whole feature turns on
 * — the profile's unwrapped PRIV DEK, held in memory strictly between an
 * unlock and a lock — plus everything that uses it: setup, unlock/lock, the
 * sealed read/write/version paths, the in-memory search index built at unlock,
 * and the sweep that reclaims sealed blob files nothing refers to anymore.
 *
 * The DEK is nulled on FOUR paths, all of which must hold (ADR-057 §5):
 *  - its own idle timer (`auto_lock_minutes`, re-armed by every successful
 *    `priv:*` data call);
 *  - window minimize, when `lock_on_minimize` says so (`privHandleMinimize`,
 *    hooked to the BrowserWindow's 'minimize' event in `main/index.ts`);
 *  - the renderer's explicit `priv:lock` (the panic path — the section
 *    header's „Zaključaj" and the remappable `privLock` shortcut);
 *  - unconditionally inside `performLock()` — an app lock IS a PRIV lock.
 *
 * Every one of them ends at `privLock()`, which is synchronous and
 * unconditional on purpose. What a lock path may do FIRST, when it can afford
 * one await, is seal the close captures the section owes (`privCaptureAndLock`
 * / `privCapturePendingVersions`): those need the very key the lock is about
 * to zero, so ordering them the other way would silently drop the last edits
 * somebody walked away from. Two more things die with the key on every path:
 * the pending-capture marks and the session search index.
 *
 * Wrong-attempt throttling reuses `unlockThrottle`'s state machine
 * (`registerFailedAttempt`/`remainingLockMs`) but keeps its state IN MEMORY,
 * per profile — deliberately NOT the keystore counter: PRIV has no permanent
 * lockout (PRD §7), and the state dying with the process is the design, not
 * a gap.
 *
 * Deliberately Electron-free, mirroring `backup.ts`: every environment
 * dependency arrives through `PrivDeps`, so the whole surface runs under
 * plain Node/Vitest and `main/index.ts` owns the wiring.
 */

import {
  PrivSealError,
  buildPrivIndex,
  derivePrivBlobKey,
  openPrivBlob,
  openPrivNote,
  remapNoteState,
  sealPrivBlob,
  sealPrivNote,
  searchPrivIndex,
  type ExportPrivateNote,
  type ExportPrivateNotes,
  type ExportPrivateNoteVersion,
  type PrivAttachmentRef,
  type PrivIndexEntry,
  type PrivIndexNote,
  type PrivNoteEnvelope,
} from "@nexus/core";
import {
  INITIAL_ATTEMPT_STATE,
  KeyUnwrapError,
  derivePrivCredentialKey,
  generatePrivDek,
  generateSalt,
  normalizeRecoveryCode,
  registerFailedAttempt,
  remainingLockMs,
  unwrapPrivDek,
  validatePasscode,
  wrapPrivDek,
  wrapPrivDekWithKit,
  type AttemptState,
  type KdfParams,
  type WrappedKey,
} from "@nexus/core/auth";
import {
  DEFAULT_PRIV_AUTO_LOCK_MINUTES,
  uuidv7,
  type PrivateNoteStore,
  type PrivateNoteVersionMeta,
  type PrivateSettingsStore,
  type ReplacePrivateWrapsInput,
  type RestoredPrivateNote,
  type RestoredPrivateNoteVersion,
  type RestoredPrivateRows,
} from "@nexus/db";
import { PRIV_ATTACHMENTS_MAX_COUNT } from "../shared/ipc.js";
import type {
  PrivateNotesExportSkip,
  PrivNoteListEntry,
  PrivSetupResult,
  PrivStatus,
  PrivUnlockResult,
} from "../shared/ipc.js";

/** Every Nth successful write of one note (per unlocked session) also captures the replaced state as a sealed version row — the cadence half of the version rule; `privCaptureVersion` is the explicit close-capture half. */
export const PRIV_VERSION_WRITE_CADENCE = 5;

/** Whether write number `writeCount` (1-based, per note per session) is a capturing one. */
export function shouldCaptureVersion(writeCount: number): boolean {
  return writeCount > 0 && writeCount % PRIV_VERSION_WRITE_CADENCE === 0;
}

/** The account-passcode check's outcome, adapted from `main/auth.ts`'s `verifyPasscode` by the deps wiring — this module never imports `auth.ts` (it pulls `electron`, which would end testability under Vitest). */
export type AccountPasscodeCheck =
  | { ok: true }
  | { ok: false; reason: "wrongPasscode" }
  | { ok: false; reason: "throttled"; lockedForMs: number };

/**
 * Everything PRIV needs from the outside, resolved at call time exactly like
 * `BackupRunnerDeps`: the getters reach `requireDb()` when called, so a deps
 * object can never outlive the session that made it — and `stillThisSession`
 * says when it has.
 */
export interface PrivDeps {
  privateNotes(profileId: string): PrivateNoteStore;
  privateSettings(profileId: string): PrivateSettingsStore;
  listProfileIds(): string[];
  /** The account's device secret (`main/auth.ts`'s `readDeviceSecret`) — `derivePrivCredentialKey`'s HKDF salt. */
  deviceSecret(): Uint8Array;
  /** The Argon2id parameters a NEW wrap is derived under (main wires `DEFAULT_KDF_PARAMS`; tests pass fast ones). Unlock always reads the ROW's recorded parameters instead, so raising these never locks anyone out. */
  kdfParams(): KdfParams;
  /** Proves `credential` IS the account passcode against the live session — `main/auth.ts`'s `verifyPasscode` seam, charging the lock screen's own throttle counter. */
  verifyAccountPasscode(credential: string): Promise<AccountPasscodeCheck>;
  /** Mints a fresh Recovery Kit code, re-wrapping the account DATA key under it (the existing `regenerateRecoveryCode` flow); this module adds the PRIV DEK's wrap under the same code. */
  regenerateRecoveryKit(): Promise<string>;
  /** One database transaction around a multi-statement write (`markdownImport`'s seam) — what makes a capturing write's version + live row land or fail together. */
  runInTransaction<T>(write: () => T): T;
  /**
   * The sealed private-attachment files (`<account>/private-blobs/<id>`, one
   * NXPB container per file — random id names, NO content addressing, by
   * design), injected so this module stays Electron/fs-free. `remove` is
   * best-effort by contract: the implementation logs and swallows its own
   * failures, because a blob that outlives its envelope is disk space, never
   * a correctness problem — the bytes stay sealed under a key that no longer
   * names them.
   */
  privBlobs: {
    write(id: string, sealed: Uint8Array): Promise<void>;
    read(id: string): Promise<Uint8Array>;
    remove(id: string): Promise<void>;
    /** Every sealed container currently in the directory, by id — the orphan sweep's left-hand side. Answers an empty list for a directory that does not exist yet (nothing sealed, nothing to sweep). */
    list(): Promise<string[]>;
  };
  /**
   * Whether the one-slot restore/import undo could still put `profileId`'s
   * SEALED private rows back (`restore.ts`'s `privateUndoPending`). The orphan
   * sweep's ordering gate and the whole reason it is safe: rows that can still
   * come back still own the blob files their envelopes name, even though
   * nothing in the live tables references them right now.
   */
  privateUndoPending(profileId: string): boolean;
  /** The `db === session` identity guard (the house idiom for work outliving a lock). */
  stillThisSession(): boolean;
  now(): Date;
}

// --- Session state -----------------------------------------------------------

/**
 * The unlocked PRIV section: ONE profile at a time, beside
 * `unlockedDataKeyHex`'s pattern in `main/index.ts` — unlocking another
 * profile's section (or the same one again) replaces this slot through a full
 * `privLock()` first, so two DEKs never coexist in memory.
 */
let privSession: { profileId: string; dek: Uint8Array } | null = null;

/** The idle auto-lock clock; re-armed by every successful data call, cleared by every lock. */
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** In-memory wrong-attempt state per profile — `unlockThrottle`'s shape, dying with the process on purpose (no permanent PRIV lockout, PRD §7). Survives `privLock`, exactly as the account's counter survives an app lock. */
const unlockAttempts = new Map<string, AttemptState>();

/** How many times each note was written THIS unlocked session — the version cadence's counter. Cleared on every lock: a session is the unit the rule names. */
const sessionWriteCounts = new Map<string, number>();

/**
 * Note ids whose LIVE state is not in the version history yet — the explicit
 * close capture's whole condition (`privCaptureVersion`), and what makes it
 * idempotent: only a capture of the live state clears the mark, so closing
 * twice, or locking right after a note switch, writes exactly one version and
 * never two identical adjacent ones. Every write sets it, the cadence capture
 * deliberately does NOT clear it (see `privWrite`). Cleared on every lock,
 * like the write counters: a session is the unit both rules name.
 */
const uncapturedWrites = new Set<string>();

/**
 * The open section's in-memory search index (ADR-057 §5 / SEC-ZK-05): one
 * folded entry per readable note, built ONCE at unlock over decrypted
 * envelopes and kept current by the write path, so a query costs a substring
 * scan rather than re-opening every container. Keyed by note id; the RESULT
 * ORDER comes from the store's own `list()` (newest-touched first) at query
 * time, never from this map's insertion order — which is also why nothing here
 * sorts, and why no collator is involved: ranking is rank-tier then recency,
 * never lexicographic.
 *
 * Dropped at lock, like every other piece of session state. "Zeroed" is not a
 * thing a JavaScript string can be — the folded text is immutable and the
 * engine owns its copies — so dropping the only reference to it IS the whole
 * teardown, exactly as `privIndex.ts` says.
 *
 * This index is registered NOWHERE: not with the global palette, not with the
 * search page, not with FTS. Private notes stay invisible to those by
 * construction (no projection views, migration 045), never by a filter someone
 * could forget.
 */
let sessionIndex: Map<string, PrivIndexEntry> | null = null;

/** Set when sealed rows were replaced OUTSIDE the write path (an archive restore or its undo): the next query rebuilds the index before answering. */
let sessionIndexStale = false;

/**
 * Drops the unwrapped DEK: zeroed first (best effort — the copy inside crypto
 * internals is the platform's business), then unreferenced, plus the idle
 * timer, the per-session write counters, the pending close captures and the
 * search index. Idempotent, and called from every lock path listed in the
 * module header.
 *
 * Deliberately synchronous and unconditional: a lock must never be refused,
 * delayed or argued with. The paths that CAN afford one await go through
 * `privCaptureAndLock` instead, which seals the pending close captures first
 * — a capture that cannot seal is a lost capture.
 */
export function privLock(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (privSession !== null) {
    privSession.dek.fill(0);
    privSession = null;
  }
  sessionWriteCounts.clear();
  uncapturedWrites.clear();
  sessionIndex = null;
  sessionIndexStale = false;
}

/** Test seam: everything `privLock` drops PLUS the throttle map, which production deliberately keeps until the process dies. */
export function resetPrivStateForTests(): void {
  privLock();
  unlockAttempts.clear();
}

/** Adopts a freshly unwrapped DEK for `profileId`, replacing any previous section wholesale, starting its idle clock and building the session's search index (the ONE pass that unseals every note). */
async function adoptPrivDek(deps: PrivDeps, profileId: string, dek: Uint8Array): Promise<void> {
  privLock();
  privSession = { profileId, dek };
  armIdleTimer(deps);
  await rebuildSessionIndex(deps, profileId);
}

/** (Re)arms the idle auto-lock from the profile's own preference. `unref` keeps the timer from holding the process open — a pending auto-lock is not work. */
function armIdleTimer(deps: PrivDeps): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const session = privSession;
  if (session === null) return;
  const minutes =
    deps.privateSettings(session.profileId).get()?.autoLockMinutes ??
    DEFAULT_PRIV_AUTO_LOCK_MINUTES;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    // The app may have locked (performLock already ran privLock) — the guard
    // just spares a redundant wipe; privLock is idempotent either way.
    if (!deps.stillThisSession()) return;
    lockAfterPendingCaptures(deps);
  }, minutes * 60_000);
  idleTimer.unref?.();
}

/**
 * The lock both of main's OWN lock paths (the idle timer and the minimize
 * hook) take: with nothing pending it is the plain synchronous wipe; with a
 * capture owed it seals that first and drops the key immediately after. The
 * key living for the length of one seal is the price of not losing the last
 * edits somebody walked away from — and `privCaptureAndLock` locks in a
 * `finally`, so no failure can leave the section open.
 */
function lockAfterPendingCaptures(deps: PrivDeps): void {
  if (!privHasPendingCaptures()) {
    privLock();
    return;
  }
  void privCaptureAndLock(deps).catch((error: unknown) => {
    console.error("Failed to capture closing private-note versions before locking:", error);
  });
}

/** The gate every data call passes: the section must be unlocked FOR THIS PROFILE. Passing it is activity, so it re-arms the idle clock. */
function requirePrivDek(deps: PrivDeps, profileId: string): Uint8Array {
  if (privSession === null || privSession.profileId !== profileId) {
    throw new Error("Private notes are locked.");
  }
  armIdleTimer(deps);
  return privSession.dek;
}

// --- Serialization of the settings row's opaque fields -----------------------
//
// `PrivateSettingsStore` stores strings it never parses; THIS module is the
// one place that reads meaning into them, so the shapes live here.

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/** A row whose opaque fields fail these shapes was hand-edited or corrupted — an unexpected failure, never an expected refusal, hence plain `Error`s. */
function parseKdf(raw: string): KdfParams {
  const parsed = JSON.parse(raw) as Partial<KdfParams>;
  if (
    parsed.algorithm !== "argon2id" ||
    typeof parsed.memoryKiB !== "number" ||
    typeof parsed.iterations !== "number" ||
    typeof parsed.parallelism !== "number"
  ) {
    throw new Error("The private_settings kdf descriptor is not a recognizable shape.");
  }
  return {
    algorithm: "argon2id",
    memoryKiB: parsed.memoryKiB,
    iterations: parsed.iterations,
    parallelism: parsed.parallelism,
  };
}

function parseWrap(raw: string): WrappedKey {
  const parsed = JSON.parse(raw) as Partial<WrappedKey>;
  if (typeof parsed.nonce !== "string" || typeof parsed.ciphertext !== "string") {
    throw new Error("A private_settings key wrap is not a recognizable shape.");
  }
  return { nonce: parsed.nonce, ciphertext: parsed.ciphertext };
}

// --- Status ------------------------------------------------------------------

/** The section's whole visible state. Before setup the lock preferences report the defaults a fresh row would get — there is no row for them to come from. */
export function privStatus(deps: PrivDeps, profileId: string): PrivStatus {
  const settings = deps.privateSettings(profileId).get();
  if (settings === null) {
    return {
      setUp: false,
      unlocked: false,
      usesAccountPasscode: false,
      hasRecoveryKit: false,
      autoLockMinutes: DEFAULT_PRIV_AUTO_LOCK_MINUTES,
      lockOnMinimize: true,
    };
  }
  return {
    setUp: true,
    unlocked: privSession !== null && privSession.profileId === profileId,
    usesAccountPasscode: settings.usesAccountPasscode,
    // The row's CHECK holds salt and wrap both-or-neither, so either column answers.
    hasRecoveryKit: settings.kitSalt !== null,
    autoLockMinutes: settings.autoLockMinutes,
    lockOnMinimize: settings.lockOnMinimize,
  };
}

// --- Setup -------------------------------------------------------------------

export interface PrivSetupInput {
  /** What the user typed, whichever kind it is — Argon2id needs the string either way; `usesAccountPasscode` says which rule gates it. */
  credential: string;
  usesAccountPasscode: boolean;
  regenerateKit: boolean;
}

/**
 * First-time setup (ADR-057 §4): generates the DEK, wraps it under the
 * credential — the account passcode, VERIFIED against the live session first
 * (the renderer's word is never enough, SEC-EL-02), or a separate passphrase
 * gated by the passcode policy's own 8+/letter-digit rule — and, when asked,
 * under a freshly minted Recovery Kit code. `regenerateKit` runs the
 * EXISTING account regenerate flow, so ONE new code (with two salts) opens
 * both the data key and the PRIV DEK independently; opting out leaves
 * `kit_salt`/`kit_wrap` NULL and the code is returned exactly once, held
 * nowhere. Ends with the section unlocked.
 */
export async function privSetup(
  deps: PrivDeps,
  profileId: string,
  input: PrivSetupInput,
): Promise<PrivSetupResult> {
  const store = deps.privateSettings(profileId);
  if (store.get() !== null) return { ok: false, reason: "alreadySetUp" };

  if (input.usesAccountPasscode) {
    const check = await deps.verifyAccountPasscode(input.credential);
    if (!check.ok) {
      return check.reason === "throttled"
        ? { ok: false, reason: "throttled", lockedForMs: check.lockedForMs }
        : { ok: false, reason: "wrongPasscode" };
    }
  } else if (validatePasscode(input.credential) !== null) {
    return { ok: false, reason: "weakCredential" };
  }

  const params = deps.kdfParams();
  const dek = generatePrivDek();
  const passSalt = generateSalt();
  const kek = await derivePrivCredentialKey(input.credential, passSalt, deps.deviceSecret(), params);
  const passWrap = await wrapPrivDek(dek, kek);

  let kitSalt: string | null = null;
  let kitWrap: string | null = null;
  let recoveryCode: string | null = null;
  if (input.regenerateKit) {
    // The account flow first: the new code re-wraps the DATA key and
    // invalidates the old one. Only then does PRIV hang its own wrap off the
    // same code — `deriveRecoveryKey` over PRIV's OWN salt is the domain
    // separation (see `privKeys.ts`'s module header).
    recoveryCode = await deps.regenerateRecoveryKit();
    const canonical = normalizeRecoveryCode(recoveryCode);
    if (canonical === null) {
      throw new Error("Internal error: freshly generated recovery code failed to normalize.");
    }
    const salt = generateSalt();
    kitSalt = toBase64(salt);
    kitWrap = JSON.stringify(await wrapPrivDekWithKit(dek, canonical, salt, params));
  }

  store.create(
    {
      kdf: JSON.stringify(params),
      passSalt: toBase64(passSalt),
      passWrap: JSON.stringify(passWrap),
      kitSalt,
      kitWrap,
      usesAccountPasscode: input.usesAccountPasscode,
      autoLockMinutes: DEFAULT_PRIV_AUTO_LOCK_MINUTES,
      lockOnMinimize: true,
    },
    deps.now().toISOString(),
  );

  await adoptPrivDek(deps, profileId, dek);
  return { ok: true, status: privStatus(deps, profileId), recoveryCode };
}

// --- Unlock / lock -----------------------------------------------------------

/**
 * Derives and unwraps under the row's own recorded KDF parameters, holding
 * the DEK on success. Failures pay `unlockThrottle`'s escalating in-memory
 * delay (checked FIRST, before any Argon2id work — a throttled caller costs
 * nothing); the wrap's AES-GCM tag is the whole verdict on the credential,
 * so a wrong passphrase and an edited row refuse identically.
 */
export async function privUnlock(
  deps: PrivDeps,
  profileId: string,
  credential: string,
): Promise<PrivUnlockResult> {
  const settings = deps.privateSettings(profileId).get();
  if (settings === null) return { ok: false, reason: "notSetUp" };

  const nowIso = deps.now().toISOString();
  const state = unlockAttempts.get(profileId) ?? INITIAL_ATTEMPT_STATE;
  const lockedForMs = remainingLockMs(state, nowIso);
  if (lockedForMs > 0) return { ok: false, reason: "throttled", lockedForMs };

  const kek = await derivePrivCredentialKey(
    credential,
    fromBase64(settings.passSalt),
    deps.deviceSecret(),
    parseKdf(settings.kdf),
  );
  try {
    const dek = await unwrapPrivDek(parseWrap(settings.passWrap), kek);
    unlockAttempts.delete(profileId);
    await adoptPrivDek(deps, profileId, dek);
    return { ok: true, status: privStatus(deps, profileId) };
  } catch (error) {
    if (!(error instanceof KeyUnwrapError)) throw error;
    unlockAttempts.set(profileId, registerFailedAttempt(state, nowIso));
    return { ok: false, reason: "wrongCredential" };
  }
}

// --- Sealed data paths -------------------------------------------------------
//
// The live container's bound sequence is always `maxVersionSeq + 1` — MAX,
// not COUNT, because eviction shrinks the count while the maximum survives,
// and the AAD arithmetic must stay monotonic (see `privateNoteStore.ts`).

/** One note's decrypted envelope. */
export async function privRead(
  deps: PrivDeps,
  profileId: string,
  id: string,
): Promise<PrivNoteEnvelope> {
  const dek = requirePrivDek(deps, profileId);
  const store = deps.privateNotes(profileId);
  return openPrivNote(dek, id, store.maxVersionSeq(id) + 1, store.readSealed(id));
}

/**
 * Writes one note's envelope; `id: null` mints a new note (uuidv7, main's
 * id). Every `PRIV_VERSION_WRITE_CADENCE`th write of one note per session
 * ALSO captures the state being replaced as a version row — the previous
 * live container, verbatim, at the sequence it was sealed under — inside ONE
 * transaction with the new write, so a crash can never leave the live row's
 * sequence arithmetic pointing past its own bytes.
 *
 * The envelope's `attachments` are renderer-authored references to sealed
 * blobs `privAddAttachment` already wrote — re-capped here (the wire validator
 * holds the same bound, SEC-EL-02) but otherwise carried verbatim: the list
 * lives INSIDE the sealed envelope, so a reference is durable exactly when the
 * envelope that names it is.
 */
export async function privWrite(
  deps: PrivDeps,
  profileId: string,
  id: string | null,
  envelope: PrivNoteEnvelope,
): Promise<{ id: string }> {
  const dek = requirePrivDek(deps, profileId);
  if (envelope.attachments.length > PRIV_ATTACHMENTS_MAX_COUNT) {
    throw new Error(
      `A private note may carry at most ${PRIV_ATTACHMENTS_MAX_COUNT} attachments.`,
    );
  }
  const store = deps.privateNotes(profileId);
  const nowIso = deps.now().toISOString();

  if (id === null) {
    const noteId = uuidv7();
    const sealed = await sealPrivNote(dek, noteId, 1, envelope); // no versions yet → live seq 1
    store.writeSealed(noteId, sealed, nowIso);
    sessionWriteCounts.set(noteId, 1);
    uncapturedWrites.add(noteId);
    indexNote(noteId, envelope);
    return { id: noteId };
  }

  const currentMax = store.maxVersionSeq(id); // also proves the note is this profile's
  const writeCount = (sessionWriteCounts.get(id) ?? 0) + 1;
  sessionWriteCounts.set(id, writeCount);

  if (!shouldCaptureVersion(writeCount)) {
    store.writeSealed(id, await sealPrivNote(dek, id, currentMax + 1, envelope), nowIso);
    uncapturedWrites.add(id);
    indexNote(id, envelope);
    return { id };
  }

  const previous = store.readSealed(id); // the state being replaced, still sealed at currentMax + 1
  const sealed = await sealPrivNote(dek, id, currentMax + 2, envelope);
  deps.runInTransaction(() => {
    store.writeVersion(id, currentMax + 1, previous, nowIso);
    store.writeSealed(id, sealed, nowIso);
  });
  // Still marked, deliberately: what the cadence just captured is the state
  // this write REPLACED, so the state it leaves live is as unrepresented as
  // any other write's — and it is exactly what the next session's first write
  // would overwrite without recording. Only a capture of the LIVE state clears
  // the mark.
  uncapturedWrites.add(id);
  indexNote(id, envelope);
  return { id };
}

// --- Version history and the explicit close capture (ADR-057) ----------------

/**
 * One note's surviving versions, newest first — the TWO cleartext facts a
 * version row has (its bound sequence and when it was captured). No sealed
 * byte crosses this call, ever; the panel that lists them asks
 * `privReadVersion` for one version's contents when the user selects it.
 * Gated on the unlocked section like every other data call, so the history
 * surface is reachable only while the section is open.
 */
export function privListVersions(
  deps: PrivDeps,
  profileId: string,
  id: string,
): PrivateNoteVersionMeta[] {
  requirePrivDek(deps, profileId);
  return deps.privateNotes(profileId).listVersions(id);
}

/**
 * One version's decrypted envelope — CLEARTEXT FOR DISPLAY ONLY, opened at the
 * sequence its own container is bound to (never the live one's). The renderer
 * receives exactly what the unlocked editor already receives for the live
 * note; a sealed container never crosses the bridge in either direction.
 */
export async function privReadVersion(
  deps: PrivDeps,
  profileId: string,
  id: string,
  seq: number,
): Promise<PrivNoteEnvelope> {
  const store = deps.privateNotes(profileId);
  const dek = new Uint8Array(requirePrivDek(deps, profileId));
  try {
    return await openPrivNote(dek, id, seq, store.readVersion(id, seq));
  } finally {
    dek.fill(0);
  }
}

/** Whether the OPEN section owes any close capture — what lets the two synchronous lock paths stay synchronous when they owe nothing. */
export function privHasPendingCaptures(): boolean {
  return privSession !== null && uncapturedWrites.size > 0;
}

/**
 * Captures one note's CURRENT state as a version — the explicit close capture
 * (the surface being left: a note switched away, the section locked, the app
 * locked, the window closed) and the checkpoint a version restore takes before
 * it overwrites anything.
 *
 * Writes only when the note has been written since its last capture, so it is
 * idempotent: closing twice, or locking right after a switch, can never
 * produce two identical adjacent versions. Answers whether anything was
 * written.
 *
 * The live container is copied VERBATIM into the version row at the sequence
 * it was already sealed under, and the live row is re-sealed with the same
 * content at the bumped sequence — both in ONE transaction, because the
 * store's `maxVersionSeq + 1` arithmetic must never point past the live row's
 * own bytes (see `privateNoteStore.ts`). The unseal in between is unavoidable:
 * the sequence is AES-GCM AAD, so re-sealing needs the plaintext.
 */
export async function privCaptureVersion(
  deps: PrivDeps,
  profileId: string,
  id: string,
): Promise<boolean> {
  const dek = new Uint8Array(requirePrivDek(deps, profileId));
  try {
    if (!uncapturedWrites.has(id)) return false;
    const store = deps.privateNotes(profileId);
    const currentMax = store.maxVersionSeq(id); // also proves the note is this profile's
    const previous = store.readSealed(id); // sealed at currentMax + 1
    const envelope = await openPrivNote(dek, id, currentMax + 1, previous);
    const resealed = await sealPrivNote(dek, id, currentMax + 2, envelope);
    const nowIso = deps.now().toISOString();
    deps.runInTransaction(() => {
      store.writeVersion(id, currentMax + 1, previous, nowIso);
      store.writeSealed(id, resealed, nowIso);
    });
    uncapturedWrites.delete(id);
    return true;
  } finally {
    dek.fill(0);
  }
}

/**
 * Captures every close capture the OPEN section still owes. One note's failure
 * is logged and skipped rather than thrown: this runs on the way to a lock,
 * and a lock must never be refused by bookkeeping.
 */
export async function privCapturePendingVersions(deps: PrivDeps): Promise<void> {
  const session = privSession;
  if (session === null) return;
  for (const id of [...uncapturedWrites]) {
    try {
      await privCaptureVersion(deps, session.profileId, id);
    } catch (error) {
      console.error(`Failed to capture a closing version of private note "${id}":`, error);
    }
  }
}

/**
 * The ORDERED lock: seal what is owed FIRST, then drop the key — a capture
 * that cannot seal is a lost capture, and the key it needs is the one the lock
 * is about to zero. `privLock` runs in a `finally`, so no failure anywhere
 * above can leave the section open.
 */
export async function privCaptureAndLock(deps: PrivDeps): Promise<void> {
  try {
    await privCapturePendingVersions(deps);
  } finally {
    privLock();
  }
}

/**
 * HARD delete (ADR-057 — no undo bar; the renderer's typed confirm is the UX
 * gate, this just deletes). The cascade takes the version history, and the
 * note's sealed attachment blobs are unlinked afterwards — best-effort, AFTER
 * the row is gone: a file that outlives a failed unlink is sealed disk space,
 * while a row deleted after a failed envelope read would strand every blob it
 * names, which is why the references are collected FIRST. An envelope that no
 * longer opens (a corrupt row being disposed of) simply has no references to
 * collect — its blobs, if any, stay behind sealed.
 */
export async function privDelete(deps: PrivDeps, profileId: string, id: string): Promise<void> {
  requirePrivDek(deps, profileId);
  const store = deps.privateNotes(profileId);
  let attachments: PrivAttachmentRef[] = [];
  try {
    attachments = (await privRead(deps, profileId, id)).attachments;
  } catch (error) {
    if (!(error instanceof PrivSealError)) throw error;
  }
  store.delete(id);
  sessionWriteCounts.delete(id);
  uncapturedWrites.delete(id); // a deleted note owes no close capture
  sessionIndex?.delete(id);
  for (const ref of attachments) {
    await deps.privBlobs.remove(ref.id); // best-effort by the seam's own contract
  }
}

/**
 * The unlocked section's notes, newest-touched first, each title freshly
 * decrypted (the list CANNOT come cheaper: titles exist nowhere in
 * cleartext, by design). A row whose container fails to open — edited bytes,
 * a foreign magic, a desynced sequence — becomes a named unreadable entry
 * rather than a crash: the other notes are still the user's to read.
 */
export async function privList(deps: PrivDeps, profileId: string): Promise<PrivNoteListEntry[]> {
  const dek = requirePrivDek(deps, profileId);
  const store = deps.privateNotes(profileId);
  const entries: PrivNoteListEntry[] = [];
  for (const meta of store.list()) {
    try {
      const envelope = await openPrivNote(
        dek,
        meta.id,
        store.maxVersionSeq(meta.id) + 1,
        store.readSealed(meta.id),
      );
      entries.push({ id: meta.id, title: envelope.title, updatedAt: meta.updatedAt, unreadable: false });
    } catch (error) {
      if (!(error instanceof PrivSealError)) throw error;
      entries.push({ id: meta.id, title: null, updatedAt: meta.updatedAt, unreadable: true });
    }
  }
  return entries;
}

// --- The unlocked section's search index --------------------------------------

/** Folds one note's title and body through `buildPrivIndex` — the ONE folding grammar public search also uses (ADR-021), so "Đorđe", "djordje" and "Ђорђе" match here exactly as they do there. */
function foldIndexEntry(note: PrivIndexNote): PrivIndexEntry {
  const [entry] = buildPrivIndex([note]).entries;
  if (entry === undefined) {
    throw new Error("Internal error: buildPrivIndex dropped the only note it was given.");
  }
  return entry;
}

/** Records (or replaces) one note's folded text in the open session's index. A no-op while there is no index — every write path calls this, including the ones that run before a section is unlocked in tests. */
function indexNote(id: string, envelope: PrivNoteEnvelope): void {
  sessionIndex?.set(id, foldIndexEntry({ id, title: envelope.title, plaintext: envelope.plaintext }));
}

/**
 * Unseals every note ONCE and installs the folded result as this session's
 * index. A row whose container no longer opens is simply not searchable —
 * `privList` is where it is reported by name — and a lock that lands mid-build
 * discards the whole thing rather than leaving decrypted text behind a closed
 * section.
 */
async function rebuildSessionIndex(deps: PrivDeps, profileId: string): Promise<void> {
  const store = deps.privateNotes(profileId);
  const dek = new Uint8Array(requirePrivDek(deps, profileId));
  const built = new Map<string, PrivIndexEntry>();
  try {
    for (const meta of store.list()) {
      try {
        const envelope = await openPrivNote(
          dek,
          meta.id,
          store.maxVersionSeq(meta.id) + 1,
          store.readSealed(meta.id),
        );
        built.set(
          meta.id,
          foldIndexEntry({ id: meta.id, title: envelope.title, plaintext: envelope.plaintext }),
        );
      } catch (error) {
        if (!(error instanceof PrivSealError)) throw error;
      }
    }
  } finally {
    dek.fill(0);
  }
  // The section may have locked across the awaits above; nothing decrypted may
  // survive that, so the freshly built index is dropped rather than installed.
  if (!privUnlockedFor(profileId)) return;
  sessionIndex = built;
  sessionIndexStale = false;
}

/**
 * Marks the session index as no longer describing the sealed rows — for the
 * two paths that replace them WHOLESALE rather than through `privWrite`: an
 * archive restore's conditional replace and its undo (ADR-057 §6). The next
 * query rebuilds; nothing else can tell the difference.
 */
export function privMarkIndexStale(): void {
  sessionIndexStale = true;
}

/**
 * Ranked note ids for a query, over the session index built at unlock.
 *
 * The channel answers IDS ONLY, deliberately: the private list already holds
 * every title it shows (`privList` decrypts them for the same open section),
 * so a snippet crossing the bridge would be cleartext the renderer does not
 * need — and body text, which the list does NOT show, would be a new leak
 * surface for nothing. The renderer maps the ids onto rows it already has.
 */
export async function privSearch(
  deps: PrivDeps,
  profileId: string,
  query: string,
): Promise<string[]> {
  requirePrivDek(deps, profileId);
  if (sessionIndex === null || sessionIndexStale) await rebuildSessionIndex(deps, profileId);
  const index = sessionIndex;
  if (index === null) return [];
  // Ordered by the store's own newest-touched-first list, so rank tiers break
  // by recency and an id the index has not caught up with is simply not there.
  const entries: PrivIndexEntry[] = [];
  for (const meta of deps.privateNotes(profileId).list()) {
    const entry = index.get(meta.id);
    if (entry !== undefined) entries.push(entry);
  }
  return searchPrivIndex({ entries }, query);
}

// --- Private attachments (sealed blobs) --------------------------------------

/**
 * Seals `bytes` as a new private attachment and writes the container to disk,
 * answering the reference the RENDERER then writes into the envelope (the
 * envelope is renderer-authored content, so the reference's durability is the
 * renderer's next `privWrite` — see `priv:attachment-pick`'s channel comment).
 * The id is random on purpose: it names the file AND is the container's AAD,
 * and NO content addressing means sealing identical bytes twice yields two
 * unrelated files (no existence oracle, `privEnvelope.ts`'s design).
 */
export async function privAddAttachment(
  deps: PrivDeps,
  profileId: string,
  input: { fileName: string; mime: string; bytes: Uint8Array },
): Promise<{ id: string; fileName: string; mime: string; sizeBytes: number }> {
  const dek = requirePrivDek(deps, profileId);
  const id = crypto.randomUUID();
  const blobKey = await derivePrivBlobKey(dek);
  await deps.privBlobs.write(id, await sealPrivBlob(blobKey, id, input.bytes));
  return { id, fileName: input.fileName, mime: input.mime, sizeBytes: input.bytes.byteLength };
}

/** One private attachment's plaintext bytes — the move-out flow's read half. Throws `PrivSealError` for a swapped, edited, or foreign container. */
export async function privOpenAttachment(
  deps: PrivDeps,
  profileId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const dek = requirePrivDek(deps, profileId);
  const blobKey = await derivePrivBlobKey(dek);
  return openPrivBlob(blobKey, attachmentId, await deps.privBlobs.read(attachmentId));
}

/**
 * The open section's blob key, or null while every section is locked — the
 * `priv-blob:` protocol's whole gate. Deliberately not profile-scoped: the
 * protocol handler cannot know a profile, and a file another profile's key
 * sealed simply fails its AES-GCM tag under this one (a 404, never bytes).
 */
export async function privSessionBlobKey(): Promise<Uint8Array | null> {
  if (privSession === null) return null;
  return derivePrivBlobKey(privSession.dek);
}

/**
 * Removes sealed blob files nothing refers to anymore, and answers how many it
 * asked the store to remove. The residue this exists for: a restore that is
 * never undone leaves the PRE-restore rows' files behind (their rows are gone,
 * their bytes are not), and a crash between `privBlobs.write` and the envelope
 * write that would have named the file leaves the same thing.
 *
 * Three rules make it safe, and each is load-bearing:
 *
 *  - **Never while an undo could bring those rows back.** The restore/import
 *    undo is a one-slot whole-profile snapshot holding the pre-operation
 *    SEALED rows verbatim; the envelopes in it name blob files nothing live
 *    references. Sweeping then would delete exactly the files that undo is
 *    about to need. `privateUndoPending` is that gate, and it is why the app's
 *    own sweeps hang off the moments the slot is discarded (plus one at
 *    unlock, for the crash case where no slot exists at all).
 *  - **Never on an incomplete reference set.** The referenced ids live INSIDE
 *    the sealed envelopes — live and version alike — so a container that does
 *    not open makes its own references unknowable. One such row aborts the
 *    whole sweep: deleting on a partial picture is how a sweep eats a file
 *    somebody still has.
 *  - **Only files this section's key can prove are ours.** `private-blobs` is
 *    per ACCOUNT, not per profile (ADR-058: two profiles share it), and
 *    another profile's ids are unknowable from here — they live under its own
 *    DEK. So an unreferenced file is opened before it is removed: authenticating
 *    under this session's blob key is the proof of ownership, and anything that
 *    fails it (another profile's file, corrupt bytes) is left alone. In the
 *    single-profile case that costs nothing — the candidate set is exactly the
 *    true orphans, normally empty.
 *
 * Every per-file failure is logged and skipped, never thrown: a sweep is
 * housekeeping, and it must not be able to take down the restore, undo or
 * unlock that triggered it.
 */
export async function privSweepOrphanBlobs(deps: PrivDeps, profileId: string): Promise<number> {
  if (!privUnlockedFor(profileId)) return 0; // the references are sealed; no key, no answer
  if (deps.privateUndoPending(profileId)) return 0;

  const store = deps.privateNotes(profileId);
  const dek = new Uint8Array(requirePrivDek(deps, profileId));
  let blobKey: Uint8Array | null = null;
  try {
    const referenced = new Set<string>();
    try {
      for (const meta of store.list()) {
        const live = await openPrivNote(
          dek,
          meta.id,
          store.maxVersionSeq(meta.id) + 1,
          store.readSealed(meta.id),
        );
        for (const ref of live.attachments) referenced.add(ref.id);
        for (const version of store.listVersions(meta.id)) {
          const opened = await openPrivNote(
            dek,
            meta.id,
            version.seq,
            store.readVersion(meta.id, version.seq),
          );
          for (const ref of opened.attachments) referenced.add(ref.id);
        }
      }
    } catch (error) {
      console.error(
        "Private orphan-blob sweep skipped: a sealed container did not open, so its references cannot be enumerated.",
        error,
      );
      return 0;
    }

    blobKey = await derivePrivBlobKey(dek);
    let removed = 0;
    for (const id of await deps.privBlobs.list()) {
      if (referenced.has(id)) continue;
      try {
        // The ownership proof (see the rules above) — and the only reason this
        // read exists at all.
        await openPrivBlob(blobKey, id, await deps.privBlobs.read(id));
      } catch {
        continue; // another profile's file, or bytes no key of ours authenticates
      }
      try {
        await deps.privBlobs.remove(id);
        removed += 1;
      } catch (error) {
        console.error(`Failed to sweep the orphaned private blob "${id}":`, error);
      }
    }
    return removed;
  } catch (error) {
    console.error("Private orphan-blob sweep failed:", error);
    return 0;
  } finally {
    dek.fill(0);
    blobKey?.fill(0);
  }
}

// --- Preferences and the minimize hook ---------------------------------------

/** Sets the two lock preferences; a running idle clock adopts the new interval immediately (the store owns the 1..60 bound). */
export function privSetLockPrefs(
  deps: PrivDeps,
  profileId: string,
  prefs: { autoLockMinutes: number; lockOnMinimize: boolean },
): PrivStatus {
  deps
    .privateSettings(profileId)
    .updateLockPrefs(prefs.autoLockMinutes, prefs.lockOnMinimize, deps.now().toISOString());
  if (privSession !== null && privSession.profileId === profileId) armIdleTimer(deps);
  return privStatus(deps, profileId);
}

/** The BrowserWindow 'minimize' hook: locks the open section when its profile's preference says so — through `lockAfterPendingCaptures`, since a minimize IS somebody walking away from the surface. A missing row (unreachable while unlocked) locks defensively — the fail-safe direction. */
export function privHandleMinimize(deps: PrivDeps): void {
  const session = privSession;
  if (session === null) return;
  const settings = deps.privateSettings(session.profileId).get();
  if (settings === null || settings.lockOnMinimize) lockAfterPendingCaptures(deps);
}

// --- Recovery Kit regeneration across the account ----------------------------

/**
 * The PRIV half of `auth:regenerate-recovery` (ADR-057 §4): the account flow
 * just minted `recoveryCode` and re-wrapped the DATA key under it — this
 * walks every profile whose PRIV keeps a kit wrap and settles it against the
 * new code, because a wrap the OLD code still opens would quietly keep a
 * sheet the user was just told to destroy able to open their private notes.
 *
 *  - The profile whose section is UNLOCKED right now: its DEK is in hand, so
 *    the kit wrap is properly re-wrapped under the new canonical code with a
 *    fresh PRIV salt.
 *  - Every other kit-carrying profile: the DEK is sealed away, so the stale
 *    wrap is DROPPED to NULL — honest degradation (the credential still
 *    opens the section; PRIV settings can re-mint a kit wrap on the next
 *    regeneration while unlocked) over a standing lie.
 */
export async function rewrapPrivKitsForNewCode(
  deps: PrivDeps,
  recoveryCode: string,
): Promise<void> {
  const canonical = normalizeRecoveryCode(recoveryCode);
  if (canonical === null) {
    throw new Error("Internal error: the freshly minted recovery code failed to normalize.");
  }
  const nowIso = deps.now().toISOString();
  for (const profileId of deps.listProfileIds()) {
    const store = deps.privateSettings(profileId);
    const settings = store.get();
    if (settings === null || settings.kitSalt === null) continue;

    const unchanged: ReplacePrivateWrapsInput = {
      kdf: settings.kdf,
      passSalt: settings.passSalt,
      passWrap: settings.passWrap,
      kitSalt: null,
      kitWrap: null,
      usesAccountPasscode: settings.usesAccountPasscode,
    };
    if (privSession !== null && privSession.profileId === profileId) {
      const salt = generateSalt();
      const wrap = await wrapPrivDekWithKit(
        privSession.dek,
        canonical,
        salt,
        parseKdf(settings.kdf),
      );
      store.replaceWraps(
        { ...unchanged, kitSalt: toBase64(salt), kitWrap: JSON.stringify(wrap) },
        nowIso,
      );
    } else {
      store.replaceWraps(unchanged, nowIso);
    }
  }
}

// --- Interchange (IMEX, ADR-057 §6) ------------------------------------------
//
// The two functions the export and restore flows reach the sealed section
// through. Both work on a local COPY of the DEK, zeroed in `finally`: a panic
// lock or the idle timer firing between two awaits zeroes `privSession.dek` in
// place, and an operation holding that same buffer would from then on seal (or
// fail to open) under an all-zero key — for a restore's re-seal, that would be
// restored notes nobody can ever open again. The copy makes each call atomic
// with respect to a lock; the section still locks the moment the call returns.

/** Whether `profileId`'s private section is unlocked right now — implies set up. The one gate both a restore preview's `willRestore` fact and the apply's re-seal read (ADR-057 §6). */
export function privUnlockedFor(profileId: string): boolean {
  return privSession !== null && privSession.profileId === profileId;
}

/** What `privCollectForExport` answers: the decrypted section when it rides, or the named reason it does not — both null when there is simply nothing to carry. */
export interface PrivExportOutcome {
  data: ExportPrivateNotes | null;
  skipped: PrivateNotesExportSkip | null;
}

/**
 * Decrypts the whole section for a manual export (ADR-057 §6): every live
 * envelope plus every surviving version, opened under the live DEK, in the
 * interchange's decrypted shape. The gate, in precedence order: nothing to
 * carry (no setup, or zero notes) answers null/null; a PLAINTEXT export
 * excludes with `"plaintext"` — dominant even over a locked section, because
 * unlocking would change nothing about shipping data in the clear; a locked
 * section excludes with `"locked"`. Attachment BYTES are deliberately not
 * collected here: the writer resolves each `private-blobs/<id>` entry one at a
 * time through `ImexArchiveDeps.readPrivateBlob`, the same memory discipline
 * every content-addressed blob already gets.
 *
 * A row (or version) whose container no longer opens is skipped, exactly as
 * `privList` reports it: unreadable everywhere is unreadable here, and one
 * corrupt row must not cost the export of every other.
 */
export async function privCollectForExport(
  deps: PrivDeps,
  profileId: string,
  encrypted: boolean,
): Promise<PrivExportOutcome> {
  if (deps.privateSettings(profileId).get() === null) return { data: null, skipped: null };
  const store = deps.privateNotes(profileId);
  const metas = store.list();
  if (metas.length === 0) return { data: null, skipped: null };
  if (!encrypted) return { data: null, skipped: "plaintext" };
  if (!privUnlockedFor(profileId)) return { data: null, skipped: "locked" };

  const dek = new Uint8Array(requirePrivDek(deps, profileId));
  try {
    const notes: ExportPrivateNote[] = [];
    const versions: ExportPrivateNoteVersion[] = [];
    for (const meta of metas) {
      let envelope: PrivNoteEnvelope;
      try {
        envelope = await openPrivNote(
          dek,
          meta.id,
          store.maxVersionSeq(meta.id) + 1,
          store.readSealed(meta.id),
        );
      } catch (error) {
        if (!(error instanceof PrivSealError)) throw error;
        continue;
      }
      notes.push({
        id: meta.id,
        title: envelope.title,
        yjsState: envelope.yjsState,
        plaintext: envelope.plaintext,
        attachments: envelope.attachments,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      });
      for (const versionMeta of store.listVersions(meta.id)) {
        try {
          const versionEnvelope = await openPrivNote(
            dek,
            meta.id,
            versionMeta.seq,
            store.readVersion(meta.id, versionMeta.seq),
          );
          versions.push({
            noteId: meta.id,
            seq: versionMeta.seq,
            title: versionEnvelope.title,
            yjsState: versionEnvelope.yjsState,
            plaintext: versionEnvelope.plaintext,
            attachments: versionEnvelope.attachments,
            createdAt: versionMeta.createdAt,
          });
        } catch (error) {
          if (!(error instanceof PrivSealError)) throw error;
        }
      }
    }
    return { data: { notes, versions }, skipped: null };
  } finally {
    dek.fill(0);
  }
}

/**
 * One sealed private attachment's plaintext for the ARCHIVE WRITER
 * (`ImexArchiveDeps.readPrivateBlob`): opened under whatever section is open
 * right now, and null for EVERYTHING else — a locked section (the export
 * outlived its unlock), a missing file, a container that fails its tag. Null
 * rather than a throw because the writer's contract for a blob it cannot get
 * is "skip and count", the lost-image tolerance every attachment already has —
 * and never an error, because only ids the collect itself just declared are
 * ever asked for. Deliberately not profile-scoped, on `privSessionBlobKey`'s
 * exact reasoning: a file some other profile's key sealed simply fails
 * authentication under this one.
 */
export async function privReadAttachmentForExport(
  deps: PrivDeps,
  id: string,
): Promise<Uint8Array | null> {
  if (privSession === null) return null;
  const dek = new Uint8Array(privSession.dek);
  try {
    const blobKey = await derivePrivBlobKey(dek);
    try {
      return await openPrivBlob(blobKey, id, await deps.privBlobs.read(id));
    } finally {
      blobKey.fill(0);
    }
  } catch {
    return null;
  } finally {
    dek.fill(0);
  }
}

/** What a successful re-seal hands back: the rows the conditional replace writes, the fresh sealed blob files it created (undo's removal list), and how many attachment files the archive could not supply. */
export interface PrivResealOutcome {
  rows: RestoredPrivateRows;
  addedBlobIds: readonly string[];
  missingBlobs: number;
}

/**
 * Re-seals an archive's private notes under the target's CURRENT DEK for a
 * restore (ADR-057 §6), or answers null while the section is locked or was
 * never set up — the named-skip path, in which the profile's existing sealed
 * rows stand untouched.
 *
 * Every archive attachment id is re-minted: bytes are read through
 * `readArchiveBlob` (one at a time), sealed as fresh NXPB containers under
 * fresh random ids, and written to the sealed store BEFORE the caller's
 * database transaction — the house order, so a failed replace leaves only
 * orphaned sealed files (disk space) rather than rows naming files never
 * written. The envelope's references AND the ids embedded in its Yjs state are
 * remapped onto the fresh ids together (`remapNoteState`, the move flows'
 * companion), one shared map for live and version envelopes alike, so a file
 * two envelopes name lands once. An id the archive cannot supply keeps its
 * fresh-id reference and is counted — the row restores, the file is lost, the
 * preview already warned (`missing-blob`), mirroring the public path exactly.
 *
 * Sequences: each version is re-sealed at its OWN archive `seq`, and the live
 * container at `max(version seq) + 1` — 1 for a note with no versions — so the
 * store's `maxVersionSeq + 1` arithmetic holds from the first read after the
 * restore lands.
 */
export async function privResealForRestore(
  deps: PrivDeps,
  profileId: string,
  data: ExportPrivateNotes,
  readArchiveBlob: (id: string) => Promise<Uint8Array | null>,
): Promise<PrivResealOutcome | null> {
  if (deps.privateSettings(profileId).get() === null) return null;
  if (!privUnlockedFor(profileId)) return null;

  const dek = new Uint8Array(requirePrivDek(deps, profileId));
  let blobKey: Uint8Array | null = null;
  try {
    blobKey = await derivePrivBlobKey(dek);
    const idMap = new Map<string, string>();
    const addedBlobIds: string[] = [];
    let missingBlobs = 0;
    for (const row of [...data.notes, ...data.versions]) {
      for (const ref of row.attachments) {
        if (idMap.has(ref.id)) continue;
        const freshId = crypto.randomUUID();
        idMap.set(ref.id, freshId);
        const bytes = await readArchiveBlob(ref.id);
        if (bytes === null) {
          missingBlobs += 1;
          continue;
        }
        await deps.privBlobs.write(freshId, await sealPrivBlob(blobKey, freshId, bytes));
        addedBlobIds.push(freshId);
      }
    }

    // `idMap.get` always answers below — every reference was just mapped — and
    // the `?? ref.id` is the defensive spelling `noUncheckedIndexedAccess` asks
    // for, never a path data can reach.
    const remapEnvelope = (row: {
      title: string;
      yjsState: string;
      plaintext: string;
      attachments: readonly PrivAttachmentRef[];
    }): PrivNoteEnvelope => ({
      title: row.title,
      yjsState:
        idMap.size === 0
          ? row.yjsState
          : toBase64(remapNoteState(fromBase64(row.yjsState), idMap)),
      plaintext: row.plaintext,
      attachments: row.attachments.map((ref) => ({ ...ref, id: idMap.get(ref.id) ?? ref.id })),
    });

    const maxSeqByNote = new Map<string, number>();
    for (const version of data.versions) {
      maxSeqByNote.set(
        version.noteId,
        Math.max(maxSeqByNote.get(version.noteId) ?? 0, version.seq),
      );
    }

    const notes: RestoredPrivateNote[] = [];
    for (const note of data.notes) {
      const liveSeq = (maxSeqByNote.get(note.id) ?? 0) + 1;
      notes.push({
        id: note.id,
        sealed: await sealPrivNote(dek, note.id, liveSeq, remapEnvelope(note)),
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      });
    }
    const versions: RestoredPrivateNoteVersion[] = [];
    for (const version of data.versions) {
      versions.push({
        noteId: version.noteId,
        seq: version.seq,
        sealed: await sealPrivNote(dek, version.noteId, version.seq, remapEnvelope(version)),
        createdAt: version.createdAt,
      });
    }
    // The caller is about to replace the sealed tables wholesale, so whatever
    // the session index says about them stops being true the moment it does.
    privMarkIndexStale();
    return { rows: { notes, versions }, addedBlobIds, missingBlobs };
  } finally {
    dek.fill(0);
    blobKey?.fill(0);
  }
}
