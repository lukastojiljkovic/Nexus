import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CarStore,
  CultureStore,
  LibraryStore,
  RecipeStore,
  RecorderStore,
  openDatabase,
  uuidv7,
  type NexusDatabase,
} from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "./moduleIpc.js";
import { register as registerCar } from "../modules/car/main/register.js";
import { register as registerCookbook } from "../modules/cookbook/main/register.js";
import { register as registerCulture } from "../modules/culture/main/register.js";
import { register as registerLibrary } from "../modules/library/main/register.js";
import { register as registerRecorder } from "../modules/recorder/main/register.js";

/**
 * ADR-108's audit, against the REAL modules: every kit module that keeps bytes
 * in the shared blob store registers them once, and the answer main builds its
 * blob union, its `nx-blob:` mime lookup and the archive's `blobs/` list from is
 * the union of what they registered.
 *
 * **Why the modules themselves, and not a double.** The bug this ADR fixes is a
 * module that FORGOT its line in `main/index.ts`, and a test that registered its
 * own fake source would pass whether or not cookbook, culture, car, recorder and
 * library ever registered theirs. So each of the five is adopted through its own
 * `register(host)` - the discovery glue's only entry point - and each is given
 * one row in a real database.
 *
 * **What is NOT here.** `main/index.ts`'s own union (`blobRefCount` +
 * `blobMimeForHash`) cannot be imported under Vitest, because that file owns the
 * window, `app` and `session`; its two halves are one call each into `ModuleHost`
 * and are pinned here and in `moduleIpc.test.ts`, and the archive's own blob
 * union is pinned in `@nexus/core`'s `exportArchive.test.ts`.
 */

const NOW = "2026-06-01T08:00:00.000Z";

/** The recipe photo, the culture ticket and the three files beside them the seed below stores — each hash distinct, each size the one its row states. */
const COOKBOOK_PHOTO = { sha256: "a".repeat(64), sizeBytes: 40_112 };
const CULTURE_TICKET = { sha256: "b".repeat(64), sizeBytes: 96_512 };
const CAR_RECEIPT = { sha256: "c".repeat(64), sizeBytes: 40_112 };
const RECORDER_MEDIA = { sha256: "d".repeat(64), sizeBytes: 1_048_576 };
const LIBRARY_COVER = { sha256: "e".repeat(64), sizeBytes: 21_504 };

/** Every file this build's five blob modules name, and the module that names it. */
const SEEDED_FILES = [
  { moduleId: "cookbook", ...COOKBOOK_PHOTO },
  { moduleId: "culture", ...CULTURE_TICKET },
  { moduleId: "car", ...CAR_RECEIPT },
  { moduleId: "recorder", ...RECORDER_MEDIA },
  { moduleId: "library", ...LIBRARY_COVER },
] as const;

/** A hash no module's rows name: the one the collector may take, and the one `nx-blob:` must refuse. */
const STRANGER = "f".repeat(64);

let db: NexusDatabase;
let profileId: string;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
});

afterEach(() => {
  db.close();
});

/** The kit's host over this database, with every module that keeps files adopted into it. */
function hostWithEveryBlobModule(): ModuleHost {
  const platform: ModulePlatform = {
    assertTrustedSender: () => undefined,
    database: () => db.raw,
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => Date.parse(NOW),
  };
  const host = new ModuleHost(platform);
  // Registration order is `collectBlobs`' own order; the assertions below sort,
  // so a new module joining this list is a one-line change here.
  registerCookbook(host);
  registerCulture(host);
  registerCar(host);
  registerRecorder(host);
  registerLibrary(host);
  return host;
}

/** One row per module, each naming its own file - the state a user's profile is in after attaching one receipt, photo, recording and cover. */
function seedOneFilePerModule(): void {
  new RecipeStore(db.raw, profileId).create(
    {
      title: "Sarma",
      course: "main",
      servings: 4,
      ingredients: [{ name: "kupus", quantity: 1, unit: "head" }],
      steps: [{ text: "Urolati i kuvati." }],
      source: "own",
      photo: {
        fileName: "sarma.jpg",
        mime: "image/jpeg",
        ...COOKBOOK_PHOTO,
      },
    },
    NOW,
  );

  const visits = new CultureStore(db.raw, profileId);
  const visit = visits.createVisit(
    { kind: "museum", title: "Tesla", venue: "Narodni muzej", date: "2026-05-01" },
    NOW,
  );
  visits.addVisitPhoto(
    visit.id,
    { fileName: "karta.jpg", mime: "image/jpeg", ...CULTURE_TICKET },
    NOW,
  );

  const cars = new CarStore(db.raw, profileId);
  const vehicle = cars.createVehicle(
    {
      name: "Pasat",
      make: "Volkswagen",
      model: "Passat",
      year: 2015,
      fuelType: "diesel",
      distanceUnit: "km",
    },
    NOW,
  );
  const service = cars.createService(
    vehicle.id,
    { date: "2026-05-01", category: "oil", description: "Mali servis" },
    NOW,
  );
  cars.addServiceAttachment(
    service.id,
    { fileName: "racun.pdf", mime: "application/pdf", ...CAR_RECEIPT },
    NOW,
  );

  new RecorderStore(db.raw, profileId).create(
    {
      kind: "audio",
      mime: "audio/webm;codecs=opus",
      durationMs: 65_000,
      ...RECORDER_MEDIA,
    },
    NOW,
  );

  const libraryStore = new LibraryStore(db.raw, profileId);
  const book = libraryStore.createItem({ kind: "book", title: "Na Drini ćuprija" }, NOW);
  libraryStore.setCover(
    book.id,
    { fileName: "korice.jpg", mime: "image/jpeg", ...LIBRARY_COVER },
    NOW,
  );
}

describe("the kit's blob hook, over the modules that use it (ADR-108)", () => {
  it("counts and serves every registered module's file, so none of them is collectable", () => {
    const host = hostWithEveryBlobModule();
    seedOneFilePerModule();

    for (const file of SEEDED_FILES) {
      // One row each: main's union adds this to the built-in tables' counts, and
      // a total of zero is what would let the collector take the file.
      expect(host.blobRefCount(profileId, file.sha256)).toBe(1);
      // And the mime its own row stored is the one `nx-blob:` announces - the
      // protocol asks with no profile, which is why every store's lookup is the
      // database-wide one.
      expect(host.blobMimeForHash(profileId, file.sha256)).not.toBeNull();
    }

    // Nothing names this one, so nothing protects it and nothing serves it.
    expect(host.blobRefCount(profileId, STRANGER)).toBe(0);
    expect(host.blobMimeForHash(profileId, STRANGER)).toBeNull();
  });

  it("hands an export every module's file, with the size its own row states", () => {
    const host = hostWithEveryBlobModule();
    seedOneFilePerModule();

    const declared = new Map(
      host.collectBlobs([profileId]).map((blob) => [blob.sha256, blob.sizeBytes]),
    );
    expect(declared).toEqual(
      new Map(SEEDED_FILES.map((file) => [file.sha256, file.sizeBytes])),
    );
  });

  it("answers a restore's hashes off the modules' own payloads, one entry per file and module", () => {
    const host = hostWithEveryBlobModule();
    seedOneFilePerModule();

    // The real section, produced by the real modules: this is what a restore
    // reads out of `data/modules.ndjson`.
    const section = host.collectExports([profileId]);
    expect(section.map((row) => row.moduleId).sort()).toEqual([
      "car",
      "cookbook",
      "culture",
      "library",
      "recorder",
    ]);

    const found = host
      .collectImportBlobs(section)
      .map((blob) => `${blob.moduleId}:${blob.sha256}`)
      .sort();
    expect(found).toEqual(
      SEEDED_FILES.map((file) => `${file.moduleId}:${file.sha256}`).sort(),
    );
  });

  it("reports no file for a profile whose modules hold none", () => {
    const host = hostWithEveryBlobModule();

    expect(host.collectBlobs([profileId])).toEqual([]);
    expect(host.collectImportBlobs(host.collectExports([profileId]))).toEqual([]);
    expect(host.blobRefCount(profileId, STRANGER)).toBe(0);
  });
});
