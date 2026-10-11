/**
 * „Radio-amaterizam" — the arithmetic behind the radio toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains.
 *
 * **These are pure functions and they refuse rather than repair.** No clock, no
 * I/O, no locale, no formatting: the surface owns its state and asks here for
 * every number it prints.
 *
 * **Nothing here is a licence, a band plan or a power limit.** Which band the
 * licence permits, how much power may be run and whether an antenna needs
 * planning consent are the regulator's answers and the operator's
 * responsibility; every one of them is either the user's own figure or absent
 * from this file. What is here is the arithmetic a radio amateur does anyway:
 * wavelength, antennas, matching, path loss, Fresnel clearance and a link
 * budget.
 *
 * **The speed of light is the SI's exact value**, 299 792 458 m/s, and the
 * reference impedance of the voltage figures is 50 Ω — the coaxial system every
 * amateur installation is built on, and therefore a figure the tools state
 * rather than one they hide.
 */

import {
  fail,
  isInRange,
  isOneOf,
  isPositive,
  quotient,
  type ProResult,
} from "./result.js";

/** The speed of light in vacuum, m/s — exact by the SI definition (BIPM, 1983). */
const C_MS = 299792458;

/** The reference impedance of an amateur coaxial system, Ω. */
const REFERENCE_OHMS = 50;

/* ---------------------------------------------------------------------------
 * frequency-wavelength — „Frekvencija i talasna dužina"
 * ------------------------------------------------------------------------ */

export interface FrequencyWavelengthInput {
  /** Exactly one of the two is given; the other is the answer. */
  readonly frequencyHz?: number | undefined;
  readonly wavelengthM?: number | undefined;
}

export interface FrequencyWavelengthResult {
  readonly frequencyHz: number;
  readonly frequencyKhz: number;
  readonly frequencyMhz: number;
  /** The wavelength in free space. */
  readonly wavelengthM: number;
  /** Half of it — the dipole's electrical length, before the velocity factor. */
  readonly halfWavelengthM: number;
  readonly quarterWavelengthM: number;
}

/**
 * Frequency and wavelength in free space, by the defining relation `λ = c/f`.
 *
 * The two free-space halves are returned because they are what a wavelength is
 * FOR: an amateur asks what 7,1 MHz is in metres in order to cut an antenna, and
 * an answer without its halves is a figure they then halve by hand. The PHYSICAL
 * element is this divided further by the velocity factor, which is not a
 * property of space and therefore lives in `antennaLengths`, where the user
 * supplies it.
 *
 * Two fields is not „one is optional": both given is a contradiction the tool
 * cannot arbitrate, and neither leaves nothing at all to answer.
 */
export function frequencyWavelength(
  input: FrequencyWavelengthInput,
): ProResult<FrequencyWavelengthResult> {
  const { frequencyHz, wavelengthM } = input;
  if ((frequencyHz === undefined) === (wavelengthM === undefined)) return fail("pair");

  let frequency: number;
  if (frequencyHz !== undefined) {
    // 1 Hz to 1 THz: below that nothing radiates usefully, above it is light.
    if (!isInRange(frequencyHz, 1, 1e12)) return fail("frequency");
    frequency = frequencyHz;
  } else {
    if (wavelengthM === undefined || !isPositive(wavelengthM) || wavelengthM > 1e6) {
      return fail("wavelength");
    }
    const derived = quotient(C_MS, wavelengthM);
    if (derived === undefined) return fail("wavelength");
    frequency = derived;
  }
  const wavelength = quotient(C_MS, frequency);
  if (wavelength === undefined) return fail("frequency");
  return {
    ok: true,
    frequencyHz: frequency,
    frequencyKhz: frequency / 1000,
    frequencyMhz: frequency / 1e6,
    wavelengthM: wavelength,
    halfWavelengthM: wavelength / 2,
    quarterWavelengthM: wavelength / 4,
  };
}

/* ---------------------------------------------------------------------------
 * antenna-lengths — „Dužine antena"
 * ------------------------------------------------------------------------ */

export interface AntennaInput {
  readonly frequencyHz: number;
  /**
   * Velocity factor of the conductor, 0,1–1.
   *
   * No default on purpose. It is 1 in free space, about 0,95 for a wire
   * antenna and about 0,66 for a solid-dielectric coaxial cable used as a
   * radiating element, and it is a property of the actual thing being cut — a
   * tool that assumed 0,95 would hand every coax-based design a length 44 % too
   * long with nothing on screen saying why.
   */
  readonly velocityFactor: number;
}

export interface AntennaResult {
  /** The free-space wavelength, before the velocity factor. */
  readonly wavelengthM: number;
  /** The wavelength in the conductor: `λ·VF`. */
  readonly conductorWavelengthM: number;
  /** A half-wave dipole's PHYSICAL length. */
  readonly dipoleM: number;
  /** A quarter-wave element's physical length. */
  readonly quarterWaveM: number;
  readonly dipoleFt: number;
  readonly quarterWaveFt: number;
}

/**
 * The physical lengths of a half-wave dipole and a quarter-wave element.
 *
 * The wavelength in a conductor is `v/f` with `v = VF·c`, and the element is
 * half or a quarter of THAT — an antenna cut to the free-space half wavelength
 * is a few per cent long, which shows up as resonance below the intended
 * frequency, and the few per cent is exactly the velocity factor.
 *
 * **No end-effect correction and no band plan.** A real dipole is trimmed on a
 * bridge, the end effect depends on the conductor's thickness and its height
 * above ground, and the band edges are the regulator's table — all three are
 * outside this file, and the surface says so rather than the answer carrying an
 * invented fudge factor.
 */
export function antennaLengths(input: AntennaInput): ProResult<AntennaResult> {
  const { frequencyHz, velocityFactor } = input;
  if (!isInRange(frequencyHz, 1, 1e12)) return fail("frequency");
  if (!isInRange(velocityFactor, 0.1, 1)) return fail("velocityFactor");
  const wavelength = quotient(C_MS, frequencyHz);
  if (wavelength === undefined) return fail("frequency");
  const conductor = wavelength * velocityFactor;
  const dipole = conductor / 2;
  const quarter = conductor / 4;
  return {
    ok: true,
    wavelengthM: wavelength,
    conductorWavelengthM: conductor,
    dipoleM: dipole,
    quarterWaveM: quarter,
    dipoleFt: dipole / 0.3048,
    quarterWaveFt: quarter / 0.3048,
  };
}

/* ---------------------------------------------------------------------------
 * swr-match — „SWR i prilagođenje"
 * ------------------------------------------------------------------------ */

/** The four names for one fact, in the order the surface offers them. */
export const MATCH_QUANTITIES = ["swr", "returnLoss", "reflection", "mismatchLoss"] as const;

export type MatchQuantity = (typeof MATCH_QUANTITIES)[number];

export type MatchEntry =
  | { readonly kind: "swr"; readonly value: number }
  | { readonly kind: "returnLoss"; readonly value: number }
  | { readonly kind: "reflection"; readonly value: number }
  | { readonly kind: "mismatchLoss"; readonly value: number };

export interface MatchResult {
  readonly swr: number;
  /** Return loss in dB, positive. Absent for a perfect match, which has none. */
  readonly returnLossDb: number | undefined;
  /** The magnitude of the reflection coefficient, 0 to 1. */
  readonly reflectionCoefficient: number;
  readonly reflectedPercent: number;
  /** Power delivered to the load as a fraction of the incident power. */
  readonly powerDelivered: number;
  /** Power lost to the mismatch, dB. */
  readonly mismatchLossDb: number;
}

/**
 * Standing-wave ratio, return loss, reflection coefficient and mismatch loss —
 * four names for one fact, in whichever of the four a meter printed.
 *
 * The relations are the standard ones and each is another's inverse. The
 * reflection coefficient follows from the SWR as `(SWR − 1)/(SWR + 1)`, the
 * return loss is `−20·log₁₀` of it, the power delivered is `1 − |Γ|²`, and the
 * mismatch loss is `−10·log₁₀` of that.
 *
 * **A perfect match has no return loss to report.** A zero reflection makes the
 * return loss infinite, and the tool returns it as `undefined` rather than as a
 * very large number or an em dash dressed up as a figure — an infinite return
 * loss is not something a meter can show, it is the statement that nothing came
 * back. The mismatch loss and the delivered power are finite there and are
 * reported normally.
 *
 * **SWR is an impedance ratio and not a quality score**, so nothing here
 * colours a value or calls one good: which figure an installation tolerates
 * belongs to the transmitter's own manual.
 */
export function swrMatch(entry: MatchEntry): ProResult<MatchResult> {
  if (!isOneOf(entry.kind, MATCH_QUANTITIES)) return fail("kind");
  let reflection: number;
  switch (entry.kind) {
    case "swr":
      // 1:1 is a perfect match; an SWR below 1 does not exist.
      if (!isInRange(entry.value, 1, 1000)) return fail("swr");
      reflection = (entry.value - 1) / (entry.value + 1);
      break;
    case "returnLoss":
      // A return loss of 0 dB is a total reflection, |Γ| = 1.
      if (!isInRange(entry.value, 0, 200)) return fail("returnLoss");
      reflection = 10 ** (-entry.value / 20);
      break;
    case "reflection":
      if (!isInRange(entry.value, 0, 1)) return fail("reflection");
      reflection = entry.value;
      break;
    case "mismatchLoss":
      if (!isInRange(entry.value, 0, 100)) return fail("mismatchLoss");
      reflection = Math.sqrt(1 - 10 ** (-entry.value / 10));
      break;
  }
  if (reflection === 0) {
    // No reflected wave: there is no ratio of nothing to nothing to report.
    return {
      ok: true,
      swr: 1,
      returnLossDb: undefined,
      reflectionCoefficient: 0,
      reflectedPercent: 0,
      powerDelivered: 1,
      mismatchLossDb: 0,
    };
  }
  const powerDelivered = 1 - reflection * reflection;
  return {
    ok: true,
    swr: (1 + reflection) / (1 - reflection),
    returnLossDb: -20 * Math.log10(reflection),
    reflectionCoefficient: reflection,
    reflectedPercent: reflection * 100,
    powerDelivered,
    mismatchLossDb: -10 * Math.log10(powerDelivered),
  };
}

/* ---------------------------------------------------------------------------
 * path-loss — „Slabljenje na putu"
 * ------------------------------------------------------------------------ */

export interface PathLossInput {
  readonly distanceKm: number;
  readonly frequencyHz: number;
}

export interface PathLossResult {
  /** Free-space path loss, dB. */
  readonly lossDb: number;
  /** The input power as a fraction of it. */
  readonly powerFraction: number;
  readonly wavelengthM: number;
}

/**
 * Free-space path loss by the Friis transmission equation's loss term,
 * `L = 20·log₁₀(4πd/λ)` (Friis 1946; ITU-R P.525 states the same expression as
 * the free-space basic transmission loss).
 *
 * **Free space means free space**: no ground reflection, no diffraction, no
 * atmospheric absorption, no rain. The familiar amateur form
 * `32,44 + 20·log₁₀ d(km) + 20·log₁₀ f(MHz)` is this same expression with the
 * constant folded out, which is why the computation is in SI and the surface
 * prints the formula rather than a table.
 *
 * Doubling either the distance or the frequency costs 6,02 dB, and that is the
 * relation this tool exists to make visible.
 */
export function pathLoss(input: PathLossInput): ProResult<PathLossResult> {
  const { distanceKm, frequencyHz } = input;
  if (!isPositive(distanceKm) || distanceKm > 1e9) return fail("distance");
  if (!isInRange(frequencyHz, 1, 1e12)) return fail("frequency");
  const wavelength = quotient(C_MS, frequencyHz);
  if (wavelength === undefined) return fail("frequency");
  const lossDb = 20 * Math.log10((4 * Math.PI * distanceKm * 1000) / wavelength);
  if (!Number.isFinite(lossDb)) return fail("distance");
  return { ok: true, lossDb, powerFraction: 10 ** (-lossDb / 10), wavelengthM: wavelength };
}

/* ---------------------------------------------------------------------------
 * fresnel-zone — „Frenelova zona"
 * ------------------------------------------------------------------------ */

export interface FresnelInput {
  /** Total path length, km. */
  readonly pathKm: number;
  /** Distance from one end to the obstruction, km. */
  readonly fromEndKm: number;
  readonly frequencyHz: number;
}

export interface FresnelResult {
  readonly wavelengthM: number;
  /** The first Fresnel zone's radius at the obstruction, m. */
  readonly radiusM: number;
  /** 60 % of it — the clearance usually taken as the design figure (ITU-R P.530). */
  readonly clearance60M: number;
  /** The distance to the far end, km, echoed so the geometry is on the sheet. */
  readonly toEndKm: number;
}

/**
 * The first Fresnel zone's radius at a point along a path —
 * `r₁ = √(λ·d₁·d₂/(d₁ + d₂))`, the standard expression for the first zone
 * (ITU-R P.530 gives the zone geometry; the radius follows from the ellipsoid of
 * revolution whose path difference is half a wavelength).
 *
 * **The 60 % figure is reported and never asserted.** Clearing 60 % of the
 * first zone is the usual design rule for a line-of-sight link, and it is a
 * convention: the surface prints the radius and the 60 % figure side by side and
 * lets the operator decide what their path needs, because „the link is clear"
 * is a judgement about a terrain profile this tool does not have.
 *
 * The obstruction's position matters — the radius is largest at the midpoint and
 * falls to zero at either end — so the distances to both ends are inputs, and a
 * tool that knew only the total would put a hill at the wrong radius on any
 * asymmetric path.
 */
export function fresnelRadius(input: FresnelInput): ProResult<FresnelResult> {
  const { pathKm, fromEndKm, frequencyHz } = input;
  if (!isPositive(pathKm) || pathKm > 1e6) return fail("path");
  if (!isPositive(fromEndKm) || fromEndKm >= pathKm) return fail("fromEnd");
  if (!isInRange(frequencyHz, 1, 1e12)) return fail("frequency");
  const wavelength = quotient(C_MS, frequencyHz);
  if (wavelength === undefined) return fail("frequency");
  const d1 = fromEndKm * 1000;
  const d2 = (pathKm - fromEndKm) * 1000;
  const radius = Math.sqrt((wavelength * d1 * d2) / (d1 + d2));
  if (!Number.isFinite(radius)) return fail("path");
  return {
    ok: true,
    wavelengthM: wavelength,
    radiusM: radius,
    clearance60M: radius * 0.6,
    toEndKm: pathKm - fromEndKm,
  };
}

/* ---------------------------------------------------------------------------
 * coax-loss — „Gubitak u napojnom vodu"
 * ------------------------------------------------------------------------ */

export interface CoaxLossInput {
  /** The cable's attenuation from its own datasheet, dB per 100 m at the frequency used. */
  readonly dbPer100m: number;
  readonly lengthM: number;
  /** Power at the input, W. Optional: without it only the loss is reported. */
  readonly inputWatts?: number | undefined;
}

export interface CoaxLossResult {
  readonly lossDb: number;
  /** The fraction of the input power that reaches the far end. */
  readonly powerFraction: number;
  readonly lossPercent: number;
  readonly outputWatts: number | undefined;
}

/**
 * The loss of a run of coax from the datasheet's dB per 100 m.
 *
 * **The datasheet figure is an input and not a table, and that is the whole
 * design.** Attenuation depends on the cable, the frequency and, on a bad day,
 * the batch; a table of cables embedded here would be a claim about a part
 * number that goes stale the moment the manufacturer revises it, and it would
 * answer for a cable the user does not have. The user reads their own datasheet
 * and the arithmetic is one multiplication.
 *
 * The caveat travels with the figure: dB per 100 m is quoted AT A FREQUENCY,
 * and a number copied out of the 144 MHz column into a 430 MHz installation
 * understates the loss by about half.
 */
export function coaxLoss(input: CoaxLossInput): ProResult<CoaxLossResult> {
  const { dbPer100m, lengthM, inputWatts } = input;
  if (!isInRange(dbPer100m, 0, 100)) return fail("dbPer100m");
  if (!isPositive(lengthM) || lengthM > 1e5) return fail("length");
  if (inputWatts !== undefined && (!isPositive(inputWatts) || inputWatts > 1e7)) {
    return fail("power");
  }
  const lossDb = (dbPer100m * lengthM) / 100;
  const powerFraction = 10 ** (-lossDb / 10);
  return {
    ok: true,
    lossDb,
    powerFraction,
    lossPercent: (1 - powerFraction) * 100,
    outputWatts: inputWatts === undefined ? undefined : inputWatts * powerFraction,
  };
}

/* ---------------------------------------------------------------------------
 * link-budget — „Bilans veze"
 * ------------------------------------------------------------------------ */

export interface LinkBudgetInput {
  /** Transmitter output, dBm. */
  readonly txPowerDbm: number;
  /** Loss between the transmitter and its antenna, dB. */
  readonly txLossDb: number;
  readonly txGainDbi: number;
  /** Loss between the receiving antenna and the receiver, dB. */
  readonly rxLossDb: number;
  readonly rxGainDbi: number;
  /** The path loss, dB — `pathLoss` computes the free-space one. */
  readonly pathLossDb: number;
}

export interface LinkBudgetResult {
  /** Effective isotropic radiated power: power less loss plus gain, dBm. */
  readonly eirpDbm: number;
  /** Power at the receiver input, dBm. */
  readonly receivedDbm: number;
  readonly receivedW: number;
  /** The same power as a voltage into the reference impedance, µV. */
  readonly receivedMicrovolts: number;
  /** Antenna gain less cable loss, dB — what the antennas bought and the cables ate. */
  readonly netGainDb: number;
}

/**
 * A link budget: what leaves the transmitter, what the path takes, and what
 * arrives.
 *
 * The Friis equation in decibels, which is what makes it addition instead of
 * multiplication: the EIRP is the transmitter's power less its feed loss plus
 * its antenna gain, and the received power is the EIRP plus the receiving
 * antenna's gain less the receiving feed loss less the path loss. The voltage
 * follows from `V = √(P·R)` into the 50 Ω reference and is reported in
 * microvolts, because that is the unit an S-meter is read in.
 *
 * **Nothing in the answer is a verdict.** Whether the received power is enough
 * is a question about a receiver's sensitivity, its bandwidth and its noise
 * floor, so the tool prints power and volts and never „the link is workable" —
 * a threshold it does not have would be a threshold it invented.
 */
export function linkBudget(input: LinkBudgetInput): ProResult<LinkBudgetResult> {
  const { txPowerDbm, txLossDb, txGainDbi, rxLossDb, rxGainDbi, pathLossDb } = input;
  if (!isInRange(txPowerDbm, -100, 100)) return fail("txPower");
  if (!isInRange(txLossDb, 0, 100)) return fail("txLoss");
  if (!isInRange(rxLossDb, 0, 100)) return fail("rxLoss");
  if (!isInRange(txGainDbi, -20, 60)) return fail("txGain");
  if (!isInRange(rxGainDbi, -20, 60)) return fail("rxGain");
  if (!isInRange(pathLossDb, 0, 400)) return fail("pathLoss");

  const eirpDbm = txPowerDbm - txLossDb + txGainDbi;
  const receivedDbm = eirpDbm + rxGainDbi - rxLossDb - pathLossDb;
  const receivedW = 0.001 * 10 ** (receivedDbm / 10);
  return {
    ok: true,
    eirpDbm,
    receivedDbm,
    receivedW,
    receivedMicrovolts: Math.sqrt(receivedW * REFERENCE_OHMS) * 1e6,
    netGainDb: txGainDbi + rxGainDbi - txLossDb - rxLossDb,
  };
}
