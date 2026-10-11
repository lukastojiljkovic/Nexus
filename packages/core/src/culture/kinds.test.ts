import { describe, expect, it } from "vitest";
import {
  CULTURE_AUDIO_MIMES,
  MAX_CULTURE_RATING,
  MIN_CULTURE_RATING,
  MUSIC_LOG_KINDS,
  VISIT_KINDS,
  isCultureAudioMime,
  isCultureRating,
  isMusicLogKind,
  isVisitKind,
} from "./kinds.js";

describe("the culture vocabulary", () => {
  it("names the ten visit kinds, in the order they are offered", () => {
    expect(VISIT_KINDS).toEqual([
      "museum",
      "gallery",
      "exhibition",
      "theatre",
      "opera",
      "ballet",
      "concert",
      "cinema",
      "festival",
      "other",
    ]);
  });

  it("names the four listening-entry kinds", () => {
    expect(MUSIC_LOG_KINDS).toEqual(["album", "track", "live", "other"]);
  });

  it("rates on a 1-10 scale", () => {
    expect([MIN_CULTURE_RATING, MAX_CULTURE_RATING]).toEqual([1, 10]);
  });

  it("accepts every visit kind it names and nothing else", () => {
    for (const kind of VISIT_KINDS) expect(isVisitKind(kind)).toBe(true);
    for (const value of ["muzej", "Museum", "", "other ", null, 3, undefined]) {
      expect(isVisitKind(value)).toBe(false);
    }
  });

  it("accepts every listening-entry kind it names and nothing else", () => {
    for (const kind of MUSIC_LOG_KINDS) expect(isMusicLogKind(kind)).toBe(true);
    for (const value of ["song", "Album", "", null, 1]) {
      expect(isMusicLogKind(value)).toBe(false);
    }
  });

  it("refuses a rating outside the scale, or on the wrong side of the decimal point", () => {
    for (const value of [1, 5, 10]) expect(isCultureRating(value)).toBe(true);
    for (const value of [0, 11, -1, 5.5, NaN, Infinity, "7", null, undefined]) {
      expect(isCultureRating(value)).toBe(false);
    }
  });

  it("knows the five audio formats the library accepts, and their common spellings", () => {
    for (const mime of [
      "audio/mpeg",
      "audio/mp4",
      "audio/aac",
      "audio/x-m4a",
      "audio/ogg",
      "audio/opus",
      "audio/flac",
      "audio/x-flac",
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
    ]) {
      expect(isCultureAudioMime(mime)).toBe(true);
    }
    for (const mime of ["application/octet-stream", "image/png", "video/mp4", "AUDIO/MPEG", ""]) {
      expect(isCultureAudioMime(mime)).toBe(false);
    }
  });

  it("lists each of the five formats at least once, and never a duplicate", () => {
    expect(new Set(CULTURE_AUDIO_MIMES).size).toBe(CULTURE_AUDIO_MIMES.length);
    expect(CULTURE_AUDIO_MIMES.filter((mime) => mime.startsWith("audio/"))).toEqual([
      ...CULTURE_AUDIO_MIMES,
    ]);
  });
});
