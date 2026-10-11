/**
 * The recorder's closed vocabulary — the two kinds of recording and the exact
 * container/codec pairs the renderer's `MediaRecorder` can produce.
 *
 * **Why a closed list rather than a MIME pattern.** A recording is stored by
 * its hash and served back by the `nx-blob:` protocol, which announces the mime
 * it was given and `X-Content-Type-Options: nosniff`. `audio/mpeg` or
 * `video/mp4` would be a claim about bytes no `MediaRecorder` here produced, and
 * a claim nobody can check — the blob store hashes bytes and never parses a
 * container. So the list is exactly what the capture side can hand over, and a
 * value outside it is a refusal rather than a format this module tolerates.
 *
 * **What is on the list, and where it comes from.** Chromium's media stack accepts
 * Opus and Vorbis in `audio/webm` and in `audio/ogg`, and VP8 or VP9 video with Opus
 * audio in `video/webm` (read from `media/base/mime_util_internal.cc` on the
 * Chromium main branch, 2026-10-09: `AddContainerWithCodecs("audio/webm", ...)`,
 * `("video/webm", ...)` and `("audio/ogg", ...)`). These four strings are that
 * support narrowed to what this product actually records - Opus for voice, VP8 or
 * VP9 with Opus for a camera - and the narrowing is half the decision: a codec this
 * app has no way to play back would otherwise be stored under a mime nothing here
 * can serve. A fifth entry is a decision with a migration behind it, because
 * migration 077 CHECKs the same four strings.
 *
 * Stage 2 must call `isRecordingMime` on the actual `MediaRecorder.mimeType`
 * (which the browser reports after `start()`), never on the string it asked
 * for: Chromium is free to fall back, and what is stored has to be what the
 * bytes really are.
 */

export const RECORDING_KINDS = ["audio", "video"] as const;
export type RecordingKind = (typeof RECORDING_KINDS)[number];

export const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
] as const;
export type RecordingMime = (typeof RECORDING_MIME_TYPES)[number];

/**
 * Which kind each mime is, written out rather than derived from the `audio/`
 * prefix: a table cannot drift from the list beside it, and a fifth entry
 * cannot be added without answering the question.
 */
const KIND_BY_MIME: Readonly<Record<RecordingMime, RecordingKind>> = {
  "audio/webm;codecs=opus": "audio",
  "audio/ogg;codecs=opus": "audio",
  "video/webm;codecs=vp8,opus": "video",
  "video/webm;codecs=vp9,opus": "video",
};

export function isRecordingMime(value: string): value is RecordingMime {
  return (RECORDING_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * The kind a mime belongs to, or `null` for anything outside the closed list.
 * This is the pairing rule the store enforces on the way in: an `audio` row
 * carrying a video mime is two answers to one question, and a row the UI would
 * draw as a camera recording that plays as sound.
 */
export function recordingKindForMime(mime: string): RecordingKind | null {
  return isRecordingMime(mime) ? KIND_BY_MIME[mime] : null;
}
