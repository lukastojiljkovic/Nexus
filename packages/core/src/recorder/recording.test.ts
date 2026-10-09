import { describe, expect, it } from "vitest";
import {
  RECORDING_KINDS,
  RECORDING_MIME_TYPES,
  isRecordingMime,
  recordingKindForMime,
} from "./recording.js";

describe("the recorder's vocabulary", () => {
  it("has exactly two kinds", () => {
    expect(RECORDING_KINDS).toEqual(["audio", "video"]);
  });

  it("names the four container/codec pairs Chromium's MediaRecorder produces", () => {
    expect(RECORDING_MIME_TYPES).toEqual([
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
    ]);
  });
});

describe("isRecordingMime", () => {
  it.each(RECORDING_MIME_TYPES)("accepts the closed-list member %s", (mime) => {
    expect(isRecordingMime(mime)).toBe(true);
  });

  it.each([
    ["a container with no codecs — MediaRecorder's own default is unchecked here", "audio/webm"],
    ["a codec Chromium does not produce for recordings", "video/webm;codecs=av1"],
    ["an unknown family", "video/mp4"],
    ["the empty string", ""],
    ["a video container in a different codec order", "video/webm;codecs=opus,vp8"],
  ])("refuses %s", (_label, mime) => {
    expect(isRecordingMime(mime)).toBe(false);
  });
});

describe("recordingKindForMime", () => {
  it("reads audio off an audio mime and video off a video one", () => {
    expect(recordingKindForMime("audio/ogg;codecs=opus")).toBe("audio");
    expect(recordingKindForMime("video/webm;codecs=vp9,opus")).toBe("video");
  });

  it("answers null for anything outside the closed list — an unknown mime has no kind", () => {
    expect(recordingKindForMime("audio/mpeg")).toBeNull();
    expect(recordingKindForMime("")).toBeNull();
  });
});
