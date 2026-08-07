import type Database from "better-sqlite3-multiple-ciphers";
import { validateBodyProfile } from "@nexus/core";
import type { ActivityLevel, BodyProblem, BodySex, BodyProfile } from "@nexus/core";
import { FitBodyProfileValidationError } from "../errors.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/**
 * The profile's body facts AS PERSISTED (migration 060): `BodyProfile`'s own
 * four fields plus when they were captured. `get`/`save` return this rather
 * than the bare `BodyProfile` domain type for one reason — the FIT training
 * interchange record (`fit-body-profile`, `@nexus/core`) carries
 * `createdAt`/`updatedAt`, and this is where they live; every in-app caller
 * that only needs the four calculation inputs reads the same four fields
 * either way, so nothing that already works against `BodyProfile` has to
 * change. No `profileId` here, on `CalendarSettingsStore`/`StudySettingsStore`'s
 * terms one module over — a per-profile singleton's CRUD shape carries no id of
 * its own, and the interchange gatherer spreads the profile's own id on at the
 * one call site that needs it.
 */
export interface FitBodyProfile extends BodyProfile {
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface BodyProfileRow {
  sex: string | null;
  birth_date: string;
  height_cm: number;
  activity: string;
  created_at: string;
  updated_at: string;
}

/**
 * The profile's own body facts (FIT training/body, migration 060): sex, birth
 * date, height, activity level — the four inputs `energyTiers` needs and
 * nothing that changes day to day. `@nexus/core`'s `BodyProfile` in every
 * respect; this store is persistence for it and states no rule of its own that
 * `validateBodyProfile` does not already state.
 *
 * **One row per profile, and `get()` answers `null` rather than a
 * default-shaped guess** when it is absent — `FitTargetStore.get`'s
 * get-or-default arrangement, except there is no default worth returning: a
 * profile with a guessed height would hand `energyTiers` a number nobody
 * entered, dressed as one somebody did.
 *
 * **`sex: null` is a legitimate, storable answer meaning „not given"**, never
 * coerced to a value on the way in or the way out — `body.ts`'s own point about
 * the field: its absence closes Mifflin–St Jeor and `energyTiers` reports that
 * rather than guessing a demographic.
 *
 * `today` for the future-date check is derived from `now`'s own date, never
 * read from a clock in this file — `now` is supplied by the caller and
 * validated here, main stamps the clock, the renderer never does.
 */
export class FitBodyProfileStore {
  private readonly selectProfile: Database.Statement;
  private readonly upsertProfile: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectProfile = db.prepare(
      `SELECT sex, birth_date, height_cm, activity, created_at, updated_at
         FROM fit_body_profile WHERE profile_id = ?`,
    );
    this.upsertProfile = db.prepare(
      `INSERT INTO fit_body_profile (profile_id, sex, birth_date, height_cm, activity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         sex = excluded.sex,
         birth_date = excluded.birth_date,
         height_cm = excluded.height_cm,
         activity = excluded.activity,
         updated_at = excluded.updated_at`,
    );
  }

  /** This profile's body facts, or `null` when none were ever entered. Never writes. */
  get(): FitBodyProfile | null {
    const row = this.selectProfile.get(this.profileId) as BodyProfileRow | undefined;
    return row === undefined ? null : toProfile(row);
  }

  /** Writes the profile's body facts in one upsert and answers with what is now stored. */
  save(profile: BodyProfile, now: string): FitBodyProfile {
    const validNow = validateNow(now);
    const validated = validateProfile(profile, validNow.slice(0, 10));
    const existing = this.selectProfile.get(this.profileId) as BodyProfileRow | undefined;
    const createdAt = existing?.created_at ?? validNow;

    this.upsertProfile.run(
      this.profileId,
      validated.sex,
      validated.birthDate,
      validated.heightCm,
      validated.activity,
      createdAt,
      validNow,
    );
    return { ...validated, createdAt, updatedAt: validNow };
  }
}

function toProfile(row: BodyProfileRow): FitBodyProfile {
  return {
    sex: row.sex as BodySex | null,
    birthDate: row.birth_date,
    heightCm: row.height_cm,
    activity: row.activity as ActivityLevel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Runs `@nexus/core`'s own gate and turns its `BodyProblem[]` into one typed error naming every failing field, rather than the caller having to interpret a bare list. */
function validateProfile(profile: BodyProfile, today: string): BodyProfile {
  const problems = validateBodyProfile(profile, today);
  if (problems.length > 0) {
    throw new FitBodyProfileValidationError(describeProblems(problems));
  }
  return {
    sex: profile.sex,
    birthDate: profile.birthDate,
    heightCm: profile.heightCm,
    activity: profile.activity,
  };
}

function describeProblems(problems: readonly BodyProblem[]): string {
  const detail = problems.map((problem) => `"${problem.field}" (${problem.code})`).join(", ");
  return `Body profile is invalid: ${detail}.`;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FitBodyProfileValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
