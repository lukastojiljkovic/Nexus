import type { RecordingKind, RecordingMime } from "@nexus/core";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * RECORDER's contract: the channels it answers on, the payload each one takes,
 * and the API its page calls — declared once, in this module's own folder
 * (ADR-090). `contract.channels` IS the allowlist the preload builds its bridge
 * from and main refuses a foreign op against, so „every channel starts with
 * `recorder:`" is a property of this declaration rather than of anybody's care.
 *
 * **Why every mutation answers with the whole view.** A recording's row is a
 * handful of fields, and the page's storage figures and tag list are DERIVED
 * from the rows — so a mutation that answered a delta would leave this page
 * computing a total main has already computed differently (`@nexus/core`'s
 * `recordingStorageSummary` is the one definition, and main is where it runs).
 * One result type means the page has exactly one way to update: what main just
 * said.
 *
 * **Why the bytes travel on the wire at all.** `MediaRecorder` produces them in
 * the RENDERER, and the blob store lives in main (`apps/desktop/src/main/
 * attachments.ts`, ADR-019) — the database and every path to a key are main's.
 * So a new recording is one call carrying its bytes, and main hashes, encrypts
 * and writes them before its store ever sees a row. The alternative — the
 * renderer naming a file, or main reading a device — does not exist here: the
 * capture is the page's and the storage is main's, which is exactly the seam
 * this channel is.
 */

/**
 * One recording as it crosses the wire.
 *
 * Declared here rather than imported from `@nexus/db`, which is where the row
 * itself lives: no file under `shared/` may reach that package (it is SQLite and
 * therefore Node-only, and the renderer shares this folder). The two shapes are
 * held in step by `main/register.ts`, which is the only thing that maps one onto
 * the other — and by the compiler, since the store's row is what it maps FROM.
 *
 * The fields are the STORE's, one for one, because the page needs all of them:
 * `sha256` is the name `nx-blob:` plays the bytes back by, `mime` is what that
 * protocol announces them as, and the diary pair is what files an entry under a
 * day other than the one it was recorded on.
 */
export interface RecorderEntryView {
  readonly id: string;
  readonly kind: RecordingKind;
  /** Empty when the user gave none; the date-and-time default is the page's copy. */
  readonly title: string;
  /** The ISO instant the recording was made. */
  readonly createdAt: string;
  readonly durationMs: number;
  readonly mime: RecordingMime;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly tags: readonly string[];
  readonly notes: string;
  readonly isDiary: boolean;
  /** A bare `YYYY-MM-DD`, non-null exactly when `isDiary` is true. */
  readonly diaryDate: string | null;
  readonly updatedAt: string;
}

/** One kind's — or all of them — count, size and running time. */
export interface RecorderTotalsView {
  readonly count: number;
  readonly sizeBytes: number;
  readonly durationMs: number;
}

/** What the library costs, split the way a storage line reads it. */
export interface RecorderStorageView {
  readonly audio: RecorderTotalsView;
  readonly video: RecorderTotalsView;
  readonly all: RecorderTotalsView;
}

/**
 * The store's own field caps, in characters and in count.
 *
 * Sent rather than restated, `limitBytes`' reason exactly: `@nexus/db` holds
 * these numbers (they are its columns' CHECKs), no file under `shared/` may
 * import that package, and a form holding its own copy of „200" would refuse
 * text the store would have taken — or accept text it would refuse.
 */
export interface RecorderCapsView {
  readonly titleChars: number;
  readonly notesChars: number;
  readonly tagChars: number;
  readonly tagCount: number;
}

/** Everything one read of this module answers with, and what every mutation answers with too. */
export interface RecorderView {
  /** Newest first — the store's own order, which is the way a diary is read. */
  readonly entries: readonly RecorderEntryView[];
  readonly storage: RecorderStorageView;
  /** Every tag in use, Serbian-collated, for the filter's picker. */
  readonly tags: readonly string[];
  /**
   * The largest recording this build's store will take, in bytes — the number
   * the page's hard size limit and its „remaining time" readout are measured
   * against. Sent rather than restated: `MAX_RECORDING_BYTES` is `@nexus/db`'s,
   * no file under `shared/` may import it, and a page holding its own copy of
   * the cap would refuse a recording main would have stored.
   */
  readonly limitBytes: number;
  /** The store's field caps, for the form's fields. */
  readonly caps: RecorderCapsView;
  /** The module's one preference, which the settings card writes and the capture reads. */
  readonly settings: RecorderSettingsView;
}

/** How long the media permission is armed for, answered to the page that asked. */
export interface RecorderArmView {
  readonly armedForMs: number;
}

/** The module's one preference, as the settings card and the page read it. */
export interface RecorderSettingsView {
  readonly countdown: boolean;
}

/** One read and every row-shaped write: whose recordings are being asked for. */
interface ProfilePayload {
  profileId: string;
}

/** One row of this module's tables, by its own id. The store scopes it to the profile. */
interface RowPayload {
  profileId: string;
  id: string;
}

/**
 * A new recording: the bytes, and everything about them that the store checks.
 *
 * `mime` is the mime `MediaRecorder` ACTUALLY reported after `start()`, never
 * the string the page asked it for: Chromium is free to fall back, and a row
 * announcing a container the bytes are not would be a claim no one could check
 * (see `@nexus/core`'s `recording.ts`). `kind` is what the capture was — a
 * microphone or a camera — and main refuses a pair that disagrees.
 */
interface SavePayload {
  profileId: string;
  kind: RecordingKind;
  mime: string;
  durationMs: number;
  /** The captured bytes. Bounded by the store's cap in main before anything is written. */
  bytes: Uint8Array;
  title: string;
  tags: readonly string[];
  notes: string;
  isDiary: boolean;
  diaryDate: string | null;
}

/**
 * A patch of what a user can change about a recording that exists. The MEDIA is
 * deliberately absent, `UpdateRecordingFields`' own rule one process over:
 * re-encoding produces different bytes, which is a NEW recording, and letting a
 * patch rewrite the hash while the blob store still holds the old bytes would
 * leave a row pointing at nothing.
 */
interface UpdatePayload {
  profileId: string;
  id: string;
  title: string;
  tags: readonly string[];
  notes: string;
  isDiary: boolean;
  diaryDate: string | null;
}

/** The settings card's one write. */
interface CountdownPayload {
  profileId: string;
  countdown: boolean;
}

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.recorder.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type RecorderOps = {
  list: { request: ProfilePayload; response: RecorderView };
  beginCapture: { request: ProfilePayload; response: RecorderArmView };
  save: { request: SavePayload; response: RecorderView };
  update: { request: UpdatePayload; response: RecorderView };
  remove: { request: RowPayload; response: RecorderView };
  restore: { request: RowPayload; response: RecorderView };
  setCountdown: { request: CountdownPayload; response: RecorderView };
};

/** This module's renderer API: one method per op, named after the op. */
export type RecorderApi = ModuleApiOf<RecorderOps>;

/** The contract the preload builds the bridge from and main refuses foreign ops against. */
export const contract = defineModuleContract<"recorder", RecorderOps>("recorder", [
  "list",
  "beginCapture",
  "save",
  "update",
  "remove",
  "restore",
  "setCountdown",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.recorder.list(…)` typed in this
 * module's own page, in the dashboard widget and in the settings card without a
 * line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    recorder: RecorderApi;
  }
}
