import { describe, expect, it } from "vitest";

import { mergeNmeaFix, nmeaChecksum, parseNmeaSentence, type NmeaReading } from "./nmea.js";

/**
 * The NMEA sentences below are the two examples the NMEA 0183 standard's own
 * subject matter is published with — a `GGA` fix and an `RMC` fix, as they
 * appear at `https://en.wikipedia.org/wiki/NMEA_0183` and are reproduced by
 * every receiver's manual. The checksums are the arithmetic this file tests and
 * NOT a copy of the examples' own tails: `nmeaChecksum` is asserted to produce
 * `0x47` for the GGA body and `0x6A` for the RMC body, which is what the
 * published sentences carry — so a genuine mismatch between this parser and the
 * standard fails here rather than passing on a copied literal.
 *
 * The XOR is a hand calculation over the body's characters (`G`^`P`^`G`^…),
 * which is why it is worth a test of its own: a checksum function that returned
 * the last byte, or the sum, would still return a plausible two-digit number.
 */
const GGA = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47";
const RMC = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A";

/**
 * A sentence built from its body with the checksum this file's own arithmetic
 * produces, for the cases whose point is a FIELD rather than a checksum. Keeping
 * them separate is what makes the refusal tests mean what they say: a sentence
 * with a wrong tail would be refused for the wrong reason.
 */
function sentence(body: string): string {
  return `$${body}*${nmeaChecksum(body).toString(16).toUpperCase().padStart(2, "0")}`;
}

/** A combined-constellation GGA over Australia — constructed here, with its checksum computed rather than copied. */
const GN_GGA = sentence("GNGGA,081836,3751.6500,S,14507.3600,E,2,10,0.8,45.5,M,10.0,M,,");

function readingOf(line: string): NmeaReading {
  const result = parseNmeaSentence(line);
  if (!result.ok) throw new Error(`Expected a reading, got ${result.problem}.`);
  return result.reading;
}

describe("nmeaChecksum", () => {
  it("is the XOR of the body, and reproduces the published sentences' own tails", () => {
    expect(nmeaChecksum("GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,")).toBe(0x47);
    expect(nmeaChecksum("GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W")).toBe(0x6a);
    // The empty body is the identity: 0. Anything else would mean the loop
    // seeded itself with something.
    expect(nmeaChecksum("")).toBe(0);
  });
});

describe("parseNmeaSentence", () => {
  it("reads a GGA fix: UTC time, position, fix quality and satellites", () => {
    const reading = readingOf(GGA);
    expect(reading.kind).toBe("GGA");
    expect(reading.talker).toBe("GP");
    expect(reading.utcTime).toBe("12:35:19");
    // 48° 07.038′ = 48 + 7.038/60, and 011° 31.000′ = 11 + 31/60.
    expect(reading.latitude).toBeCloseTo(48 + 7.038 / 60, 10);
    expect(reading.longitude).toBeCloseTo(11 + 31 / 60, 10);
    expect(reading.fixQuality).toBe(1);
    expect(reading.satellites).toBe(8);
    // GGA carries no date and no speed, and `null` is the answer rather than an
    // invented zero.
    expect(reading.utcDate).toBeNull();
    expect(reading.speedKnots).toBeNull();
    expect(reading.raw).toBe(GGA);
  });

  it("reads an RMC fix: position, validity, speed and the two-digit date", () => {
    const reading = readingOf(RMC);
    expect(reading.kind).toBe("RMC");
    expect(reading.status).toBe("A");
    expect(reading.latitude).toBeCloseTo(48 + 7.038 / 60, 10);
    expect(reading.longitude).toBeCloseTo(11 + 31 / 60, 10);
    expect(reading.speedKnots).toBeCloseTo(22.4, 10);
    // `230394` is the 23rd of March 1994; the pivot in `nmea.ts` reads `94` as
    // 1994 and `26` as 2026, and the raw stamp is kept beside it.
    expect(reading.dateStamp).toBe("230394");
    expect(reading.utcDate).toBe("1994-03-23");
    expect(reading.fixQuality).toBeNull();
  });

  it("reads a combined-constellation talker and a southern, eastern hemisphere", () => {
    const reading = readingOf(GN_GGA);
    expect(reading.talker).toBe("GN");
    expect(reading.fixQuality).toBe(2);
    expect(reading.satellites).toBe(10);
    // 37° 51.65′ S = −(37 + 51.65/60); 145° 07.36′ E = +(145 + 7.36/60).
    expect(reading.latitude).toBeCloseTo(-(37 + 51.65 / 60), 10);
    expect(reading.longitude).toBeCloseTo(145 + 7.36 / 60, 10);
  });

  it("accepts a line without an ending and one with CRLF, trimming both the same way", () => {
    expect(parseNmeaSentence(`  ${GGA}\r\n`).ok).toBe(true);
    expect(readingOf(`\t${GGA}`).raw).toBe(GGA);
  });

  it("refuses a corrupt byte rather than reporting a position", () => {
    // One digit changed, checksum untouched: exactly the failure that has to be
    // caught, because the position it would report is a real place.
    const corrupted = GGA.replace("4807.038", "4808.038");
    expect(parseNmeaSentence(corrupted)).toEqual({ ok: false, problem: "bad-checksum" });
  });

  it("refuses a sentence that carries no checksum at all", () => {
    expect(parseNmeaSentence(GGA.slice(0, GGA.indexOf("*")))).toEqual({
      ok: false,
      problem: "missing-checksum",
    });
    expect(parseNmeaSentence(`${GGA}ZZ`)).toEqual({ ok: false, problem: "missing-checksum" });
  });

  it("refuses what is not a sentence, and what is a sentence it does not parse", () => {
    expect(parseNmeaSentence("hello")).toEqual({ ok: false, problem: "not-nmea" });
    // GSV is a real sentence shape with a valid checksum, and it is deliberately
    // not this parser's subject — the refusal is the sentence NAME, not the tail.
    const gsv = sentence("GPGSV,3,1,11,03,03,111,00,04,15,270,00,06,01,010,00,13,06,292,00");
    expect(parseNmeaSentence(gsv)).toEqual({ ok: false, problem: "unknown-sentence" });
  });

  it("refuses a field that is not the shape the sentence puts there", () => {
    // A latitude with no hemisphere, and one that is not `ddmm.mmm`.
    const noHemisphere = sentence("GPGGA,123519,4807.038,,01131.000,E,1,08,0.9,545.4,M,46.9,M,,");
    expect(parseNmeaSentence(noHemisphere)).toEqual({ ok: false, problem: "bad-field" });
    const shortLatitude = sentence("GPGGA,123519,480,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,");
    expect(parseNmeaSentence(shortLatitude)).toEqual({ ok: false, problem: "bad-field" });
    // An hour that is not one, and a fix quality outside the code set.
    expect(parseNmeaSentence(sentence("GPGGA,256099,4807.038,N,01131.000,E,1,08,,,,,")).ok).toBe(false);
    expect(parseNmeaSentence(sentence("GPGGA,123519,4807.038,N,01131.000,E,9,08,,,,,")).ok).toBe(false);
  });

  it("reads an RMC before the receiver has a lock as no position rather than a refusal", () => {
    // The published example sentence with an empty position and `V` — what a
    // receiver sends while it is still acquiring, and a page that called this an
    // error would report a working receiver as broken.
    const result = parseNmeaSentence(sentence("GPRMC,123519,V,,,,,000.0,000.0,230394,003.1,W"));
    expect(result.ok).toBe(true);
    expect(result.ok && result.reading.latitude).toBeNull();
    expect(result.ok && result.reading.status).toBe("V");
  });
});

describe("mergeNmeaFix", () => {
  const at = "2026-10-10T00:00:00.000Z";

  it("keeps each field from the sentence that carried it", () => {
    const gga = mergeNmeaFix(null, readingOf(GGA), at);
    expect(gga.satellites).toBe(8);
    expect(gga.utcDate).toBeNull();
    const both = mergeNmeaFix(gga, readingOf(RMC), at);
    // The RMC carried position, speed and date and no fix quality; the merge
    // keeps what the GGA said about satellites and takes the date from the RMC.
    expect(both.satellites).toBe(8);
    expect(both.fixQuality).toBe(1);
    expect(both.utcDate).toBe("1994-03-23");
    expect(both.speedKnots).toBeCloseTo(22.4, 10);
  });

  it("never mixes half a position from a sentence that had none", () => {
    const start = mergeNmeaFix(null, readingOf(GGA), at);
    const noFix = readingOf(sentence("GPRMC,123519,V,,,,,000.0,000.0,230394,003.1,W"));
    const merged = mergeNmeaFix(start, noFix, at);
    expect(merged.latitude).toBe(start.latitude);
    expect(merged.longitude).toBe(start.longitude);
  });
});
