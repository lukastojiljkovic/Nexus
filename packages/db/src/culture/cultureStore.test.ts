import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CultureNotFoundError,
  CultureStore,
  CultureValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { CreateCulturePlanInput, CreateVisitInput, CulturePrice } from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";
const LAST = "2026-06-03T09:00:00.000Z";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

/** A track import as main would describe it after writing the bytes to the blob store. */
const MP3 = { fileName: "01 - Slovenska.mp3", mime: "audio/mpeg", sizeBytes: 4_194_304, sha256: HASH };

let dir: string;
let db: NexusDatabase;

/**
 * Second, independent database files, standing in for FRESH INSTALLS. An
 * export preserves row ids (ADR-023 Â§1: a note's Yjs document embeds other
 * rows' ids inside its own content, so re-minting them would mean rewriting ids
 * inside CRDT documents), and every one of them is a GLOBAL primary key - so
 * the only places an archive can land are the profile it came from and a
 * database that does not already hold its ids. The collision case is pinned
 * below rather than papered over; this helper is how the other tests get a
 * target that is legitimate.
 */
const extraDatabases: NexusDatabase[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-culture-"));
  db = openDatabase({ path: join(dir, "culture.db") });
});

afterEach(() => {
  for (const extra of extraDatabases.splice(0)) extra.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

function storeFor(profileId: string): CultureStore {
  return new CultureStore(db.raw, profileId);
}

function store(): CultureStore {
  return storeFor(createProfile());
}

/** A culture store on a database of its own - a fresh install, and the only kind of target an import can have besides its own source. */
function freshStore(): CultureStore {
  const fresh = openDatabase({ path: join(dir, `fresh-${extraDatabases.length}.db`) });
  extraDatabases.push(fresh);
  const profileId = uuidv7();
  fresh.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
  return new CultureStore(fresh.raw, profileId);
}

/** The exhibition the visits section is built around; Serbian, because that is whose data this is. */
const EXHIBITION: CreateVisitInput = {
  kind: "exhibition",
  title: "Tesla: Čovek budućnosti",
  venue: "Narodni muzej",
  city: "Beograd",
  date: "2026-05-14",
  startTime: "18:30",
  rating: 9,
  notes: "Odlična postavka, druga sala je najbolja.",
  price: { minorUnits: 70_000, currency: "RSD" },
  companions: "Ana, Marko i Jelena",
};

describe("CultureStore visits", () => {
  it("stores a visit and reads it back", () => {
    const profileId = createProfile();
    const culture = storeFor(profileId);
    const visit = culture.createVisit(EXHIBITION, NOW);

    expect(visit).toMatchObject({
      ...EXHIBITION,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(visit.profileId).toBe(profileId);
    expect(culture.listVisits()).toEqual([visit]);
  });

  it("stores the least a visit can be and fills the blanks with null, not with empty strings", () => {
    const culture = store();
    const visit = culture.createVisit(
      { kind: "cinema", title: "Bilo jednom u Beogradu", venue: "Dvorana Kulturnog centra", date: "2026-04-02" },
      NOW,
    );

    expect(visit).toMatchObject({
      city: null,
      startTime: null,
      rating: null,
      notes: "",
      price: null,
      companions: null,
    });
  });

  it("trims text, collapses inner whitespace, and turns a blank into null", () => {
    const culture = store();
    const visit = culture.createVisit(
      {
        kind: "gallery",
        title: "  Izložba   grafike  ",
        venue: "  Galerija  ",
        city: "   ",
        date: "2026-04-03",
        companions: "  Ana,   Marko ",
      },
      NOW,
    );

    expect(visit.title).toBe("Izložba grafike");
    expect(visit.venue).toBe("Galerija");
    expect(visit.city).toBeNull();
    expect(visit.companions).toBe("Ana, Marko");
  });

  it("keeps a note exactly as it was typed", () => {
    const culture = store();
    const notes = "Prva linija.\n\nDruga linija, sa dva razmaka:  ovako.";
    const visit = culture.createVisit(
      { kind: "theatre", title: "Hamlet", venue: "Narodno pozorište", date: "2026-04-04", notes },
      NOW,
    );

    expect(visit.notes).toBe(notes);
  });

  it("stores a price as minor units and its currency, together", () => {
    const culture = store();
    const price: CulturePrice = { minorUnits: 125_000, currency: "RSD" };
    const visit = culture.createVisit(
      { kind: "opera", title: "Karmen", venue: "Narodno pozorište", date: "2026-04-05", price },
      NOW,
    );

    expect(visit.price).toEqual(price);
    expect(culture.listVisits()[0]?.price).toEqual(price);
  });

  it.each([
    ["an unknown kind", { ...EXHIBITION, kind: "muzej" as never }],
    ["an empty title", { ...EXHIBITION, title: "   " }],
    ["an over-long title", { ...EXHIBITION, title: "x".repeat(201) }],
    ["an over-long venue", { ...EXHIBITION, venue: "x".repeat(121) }],
    ["an over-long city", { ...EXHIBITION, city: "x".repeat(81) }],
    ["a day that is not a calendar day", { ...EXHIBITION, date: "2026-02-30" }],
    ["a start time that is not a wall clock", { ...EXHIBITION, startTime: "6pm" }],
    ["a start time past midnight", { ...EXHIBITION, startTime: "24:00" }],
    ["a rating below the scale", { ...EXHIBITION, rating: 0 }],
    ["a rating above the scale", { ...EXHIBITION, rating: 11 }],
    ["a fractional rating", { ...EXHIBITION, rating: 7.5 }],
    ["a currency that is not three letters", { ...EXHIBITION, price: { minorUnits: 100, currency: "din" } }],
    ["a currency in lower case", { ...EXHIBITION, price: { minorUnits: 100, currency: "eur" } }],
    ["an amount that is not whole", { ...EXHIBITION, price: { minorUnits: 99.5, currency: "RSD" } }],
    ["a negative amount", { ...EXHIBITION, price: { minorUnits: -1, currency: "RSD" } }],
    ["a price with no currency", { ...EXHIBITION, price: { minorUnits: 100, currency: "" } }],
    ["an over-long note", { ...EXHIBITION, notes: "x".repeat(2001) }],
    ["over-long companions", { ...EXHIBITION, companions: "x".repeat(201) }],
  ])("refuses %s", (_label, input) => {
    const culture = store();
    // The cast is the point: these are the shapes an untrusted caller can send,
    // and the store is what refuses them (SEC-EL-02).
    expect(() => culture.createVisit(input as CreateVisitInput, NOW)).toThrow(CultureValidationError);
  });

  it("refuses a malformed `now` - main stamps the clock, the renderer never does", () => {
    const culture = store();
    expect(() => culture.createVisit(EXHIBITION, "juče")).toThrow(CultureValidationError);
  });

  it("applies a partial patch and leaves the rest of the visit alone", () => {
    const culture = store();
    const visit = culture.createVisit(EXHIBITION, NOW);
    const updated = culture.updateVisit(visit.id, { rating: 10, notes: "I drugi put." }, LATER);

    expect(updated).toEqual({ ...visit, rating: 10, notes: "I drugi put.", updatedAt: LATER });
    expect(culture.listVisits()[0]).toEqual(updated);
  });

  it("clears a nullable field on an explicit null", () => {
    const culture = store();
    const visit = culture.createVisit(EXHIBITION, NOW);

    expect(culture.updateVisit(visit.id, { city: null, price: null }, LATER)).toMatchObject({
      city: null,
      price: null,
      venue: "Narodni muzej",
    });
  });

  it("refuses an unknown, deleted or another profile's visit", () => {
    const mine = store();
    const theirs = store();
    const visit = mine.createVisit(EXHIBITION, NOW);

    expect(() => mine.updateVisit("nema", { rating: 5 }, LATER)).toThrow(CultureNotFoundError);
    expect(() => theirs.updateVisit(visit.id, { rating: 5 }, LATER)).toThrow(CultureNotFoundError);
    mine.softDeleteVisit(visit.id, LATER);
    expect(() => mine.updateVisit(visit.id, { rating: 5 }, LAST)).toThrow(CultureNotFoundError);
  });

  it("round-trips a soft delete", () => {
    const culture = store();
    const visit = culture.createVisit(EXHIBITION, NOW);
    culture.softDeleteVisit(visit.id, LATER);
    expect(culture.listVisits()).toEqual([]);
    culture.restoreVisit(visit.id, LATER);
    expect(culture.listVisits()).toEqual([{ ...visit, updatedAt: LATER }]);
  });

  it("keeps a visit's PHOTOS through a delete, so undo gives back what was there", () => {
    const culture = store();
    const visit = culture.createVisit(EXHIBITION, NOW);
    const photo = culture.addVisitPhoto(
      visit.id,
      { fileName: "postavka.jpg", mime: "image/jpeg", sizeBytes: 2_048_000, sha256: OTHER_HASH },
      NOW,
    );

    culture.softDeleteVisit(visit.id, LATER);
    culture.restoreVisit(visit.id, LATER);
    expect(culture.listVisitPhotos(visit.id)).toEqual([photo]);
    // And a foreign store still sees none of it.
    expect(() => storeFor(createProfile()).listVisitPhotos(visit.id)).toThrow(CultureNotFoundError);
  });

  it("refuses to delete twice or restore what is not deleted", () => {
    const culture = store();
    const visit = culture.createVisit(EXHIBITION, NOW);
    expect(() => culture.restoreVisit(visit.id, LATER)).toThrow(CultureNotFoundError);
    culture.softDeleteVisit(visit.id, LATER);
    expect(() => culture.softDeleteVisit(visit.id, LATER)).toThrow(CultureNotFoundError);
  });

  it("reads the visits between two dates, both ends inclusive, oldest first", () => {
    const culture = store();
    const first = culture.createVisit(
      { kind: "museum", title: "Prva", venue: "Muzej", date: "2026-05-01" },
      NOW,
    );
    const second = culture.createVisit(
      { kind: "concert", title: "Druga", venue: "Sava Centar", date: "2026-05-15" },
      NOW,
    );
    const third = culture.createVisit(
      { kind: "cinema", title: "Treća", venue: "Bioskop", date: "2026-05-31" },
      NOW,
    );
    const outside = culture.createVisit(
      { kind: "festival", title: "Četvrta", venue: "Egzit", date: "2026-07-10" },
      NOW,
    );

    const may = culture.listVisits({ from: "2026-05-01", to: "2026-05-31" });
    expect(may.map((visit) => visit.id)).toEqual([first.id, second.id, third.id]);

    // One day only, and a window that catches nothing at all.
    expect(culture.listVisits({ from: "2026-05-15", to: "2026-05-15" }).map((v) => v.id)).toEqual([
      second.id,
    ]);
    expect(culture.listVisits({ from: "2026-06-01", to: "2026-06-30" })).toEqual([]);
    expect(culture.listVisits().map((visit) => visit.id)).toEqual([
      first.id,
      second.id,
      third.id,
      outside.id,
    ]);
  });

  it("leaves a deleted visit and another profile's visits out of the window", () => {
    const mine = store();
    const theirs = store();
    const deleted = mine.createVisit(
      { kind: "museum", title: "Brisana", venue: "Muzej", date: "2026-05-02" },
      NOW,
    );
    mine.softDeleteVisit(deleted.id, LATER);
    theirs.createVisit({ kind: "museum", title: "Tuđa", venue: "Muzej", date: "2026-05-03" }, NOW);

    expect(mine.listVisits({ from: "2026-05-01", to: "2026-05-31" })).toEqual([]);
  });

  it.each([
    ["a backwards window", { from: "2026-05-31", to: "2026-05-01" }],
    ["a window that is not a date", { from: "maj", to: "2026-05-31" }],
    ["an impossible day", { from: "2026-02-30", to: "2026-03-01" }],
  ])("refuses %s", (_label, range) => {
    const culture = store();
    expect(() => culture.listVisits(range)).toThrow(CultureValidationError);
  });
});

describe("CultureStore visit photos", () => {
  it("adds photos and lists them in the order they were added", () => {
    const culture = store();
    const visit = culture.createVisit(EXHIBITION, NOW);
    const first = culture.addVisitPhoto(
      visit.id,
      { fileName: "ulaz.jpg", mime: "image/jpeg", sizeBytes: 1024, sha256: HASH },
      NOW,
    );
    const second = culture.addVisitPhoto(
      visit.id,
      { fileName: "postavka.png", mime: "image/png", sizeBytes: 2048, sha256: OTHER_HASH },
      LATER,
    );

    expect(culture.listVisitPhotos(visit.id)).toEqual([first, second]);
    expect(first).toMatchObject({ visitId: visit.id, createdAt: NOW });
  });

  it("returns the removed row so the caller can decide whether the blob is orphaned", () => {
    const culture = store();
    const visit = culture.createVisit(EXHIBITION, NOW);
    const photo = culture.addVisitPhoto(
      visit.id,
      { fileName: "ulaz.jpg", mime: "image/jpeg", sizeBytes: 1024, sha256: HASH },
      NOW,
    );

    expect(culture.removeVisitPhoto(visit.id, photo.id)).toEqual(photo);
    expect(culture.listVisitPhotos(visit.id)).toEqual([]);
    expect(() => culture.removeVisitPhoto(visit.id, photo.id)).toThrow(CultureNotFoundError);
  });

  it.each([
    ["an empty file name", { fileName: "  ", mime: "image/jpeg", sizeBytes: 1024, sha256: HASH }],
    ["a file name with a separator", { fileName: "a/b.jpg", mime: "image/jpeg", sizeBytes: 1024, sha256: HASH }],
    ["a mime that is not a mime", { fileName: "a.jpg", mime: "jpeg", sizeBytes: 1024, sha256: HASH }],
    ["a zero size", { fileName: "a.jpg", mime: "image/jpeg", sizeBytes: 0, sha256: HASH }],
    ["a size past the attachment cap", { fileName: "a.jpg", mime: "image/jpeg", sizeBytes: 52_428_801, sha256: HASH }],
    ["a hash that is not a sha256", { fileName: "a.jpg", mime: "image/jpeg", sizeBytes: 1024, sha256: "nije-hash" }],
  ])("refuses %s", (_label, input) => {
    const culture = store();
    const visit = culture.createVisit(EXHIBITION, NOW);
    expect(() => culture.addVisitPhoto(visit.id, input, NOW)).toThrow(CultureValidationError);
  });

  it("refuses a malformed `now`", () => {
    const culture = store();
    const visit = culture.createVisit(EXHIBITION, NOW);
    expect(() =>
      culture.addVisitPhoto(
        visit.id,
        { fileName: "a.jpg", mime: "image/jpeg", sizeBytes: 1024, sha256: HASH },
        "juče",
      ),
    ).toThrow(CultureValidationError);
  });

  it("refuses an unknown visit, another profile's visit, and a photo that is not on the visit named", () => {
    const mine = store();
    const theirs = store();
    const visit = mine.createVisit(EXHIBITION, NOW);
    const other = mine.createVisit(
      { kind: "museum", title: "Druga", venue: "Muzej", date: "2026-05-20" },
      NOW,
    );
    const photo = mine.addVisitPhoto(
      visit.id,
      { fileName: "ulaz.jpg", mime: "image/jpeg", sizeBytes: 1024, sha256: HASH },
      NOW,
    );

    expect(() => mine.listVisitPhotos("nema")).toThrow(CultureNotFoundError);
    expect(() => theirs.listVisitPhotos(visit.id)).toThrow(CultureNotFoundError);
    expect(() =>
      mine.addVisitPhoto(
        "nema",
        { fileName: "a.jpg", mime: "image/jpeg", sizeBytes: 1024, sha256: HASH },
        NOW,
      ),
    ).toThrow(CultureNotFoundError);
    // A real photo id, but not on the visit the caller addressed it through.
    expect(() => mine.removeVisitPhoto(other.id, photo.id)).toThrow(CultureNotFoundError);
    expect(mine.listVisitPhotos(visit.id)).toEqual([photo]);
  });
});

describe("CultureStore tracks", () => {
  it("imports a track and reads it back with zero plays", () => {
    const culture = store();
    const track = culture.createTrack(
      {
        title: "Slovenska",
        artist: "Đorđe Balašević",
        album: "Pub",
        trackNumber: 3,
        releaseYear: 1982,
        durationMs: 214_000,
        ...MP3,
      },
      NOW,
    );

    expect(track).toMatchObject({
      title: "Slovenska",
      artist: "Đorđe Balašević",
      album: "Pub",
      trackNumber: 3,
      releaseYear: 1982,
      durationMs: 214_000,
      playCount: 0,
      lastPlayedAt: null,
      importedAt: NOW,
      updatedAt: NOW,
    });
    expect(culture.listTracks()).toEqual([track]);
  });

  it("stores an untagged file: no artist, no album, no year, and nothing invented", () => {
    const culture = store();
    const track = culture.createTrack(
      { title: "Snimak probe", durationMs: 0, fileName: "proba.wav", mime: "audio/wav", sizeBytes: 5_000_000, sha256: OTHER_HASH },
      NOW,
    );

    expect(track).toMatchObject({ artist: null, album: null, trackNumber: null, releaseYear: null });
  });

  it.each([
    ["an empty title", { title: "  ", durationMs: 1_000, ...MP3 }],
    ["an over-long artist", { title: "T", artist: "x".repeat(201), durationMs: 1_000, ...MP3 }],
    ["a zero track number", { title: "T", trackNumber: 0, durationMs: 1_000, ...MP3 }],
    ["a fractional track number", { title: "T", trackNumber: 1.5, durationMs: 1_000, ...MP3 }],
    ["a track number past the bound", { title: "T", trackNumber: 1_000, durationMs: 1_000, ...MP3 }],
    ["a year below four digits", { title: "T", releaseYear: 999, durationMs: 1_000, ...MP3 }],
    ["a year above four digits", { title: "T", releaseYear: 10_000, durationMs: 1_000, ...MP3 }],
    ["a negative duration", { title: "T", durationMs: -1, ...MP3 }],
    ["a fractional duration", { title: "T", durationMs: 1_000.5, ...MP3 }],
    ["a duration past a day", { title: "T", durationMs: 86_400_001, ...MP3 }],
    ["a mime the player cannot open", { title: "T", durationMs: 1_000, ...MP3, mime: "application/octet-stream" }],
    ["an image offered as audio", { title: "T", durationMs: 1_000, ...MP3, mime: "image/jpeg" }],
    ["an empty file name", { title: "T", durationMs: 1_000, ...MP3, fileName: "  " }],
    ["a zero size", { title: "T", durationMs: 1_000, ...MP3, sizeBytes: 0 }],
    ["a size past the library cap", { title: "T", durationMs: 1_000, ...MP3, sizeBytes: 209_715_201 }],
    ["a hash that is not a sha256", { title: "T", durationMs: 1_000, ...MP3, sha256: "x".repeat(64) }],
  ])("refuses %s", (_label, input) => {
    const culture = store();
    expect(() => culture.createTrack(input as never, NOW)).toThrow(CultureValidationError);
  });

  it("refuses a malformed `now`", () => {
    const culture = store();
    expect(() => culture.createTrack({ title: "T", durationMs: 1_000, ...MP3 }, "juče")).toThrow(
      CultureValidationError,
    );
  });

  it("reads the library artist, then album, then track number, then title - by the sr-Latn collator", () => {
    const culture = store();
    const untagged = culture.createTrack(
      { title: "Snimak probe", durationMs: 60_000, fileName: "proba.wav", mime: "audio/wav", sizeBytes: 4_000_000, sha256: HASH },
      NOW,
    );
    const lola = culture.createTrack(
      { title: "Sve je isto", artist: "Lola Novaković", durationMs: 120_000, ...MP3 },
      NOW,
    );
    const ljubisa = culture.createTrack(
      { title: "Pesma", artist: "Ljubiša Stojanović", durationMs: 90_000, ...MP3 },
      NOW,
    );
    const balasevicSecond = culture.createTrack(
      { title: "Neki drugi", artist: "Đorđe Balašević", album: "Pub", trackNumber: 5, durationMs: 100_000, ...MP3 },
      NOW,
    );
    const balasevicFirst = culture.createTrack(
      { title: "Slovenska", artist: "Đorđe Balašević", album: "Pub", trackNumber: 3, durationMs: 214_000, ...MP3 },
      NOW,
    );

    // The untagged file leads (a missing artist groups with the empties), then
    // `Đ` - a letter after `d` and before `e`, so Đorđe precedes Lola - then
    // `Lola` before `Ljubiša`, which is the collator at work: `lj` is a single
    // letter after `l`, while a plain sort compares UTF-16 and puts Ljubiša
    // first. Within `Pub`, track 3 comes before track 5.
    expect(culture.listTracks().map((track) => track.id)).toEqual([
      untagged.id,
      balasevicFirst.id,
      balasevicSecond.id,
      lola.id,
      ljubisa.id,
    ]);
  });

  it("counts plays, and refuses to play what is not there", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);

    expect(culture.recordPlay(track.id, NOW)).toEqual({
      ...track,
      playCount: 1,
      lastPlayedAt: NOW,
      updatedAt: NOW,
    });
    expect(culture.recordPlay(track.id, LATER)).toEqual({
      ...track,
      playCount: 2,
      lastPlayedAt: LATER,
      updatedAt: LATER,
    });

    expect(() => culture.recordPlay("nema", NOW)).toThrow(CultureNotFoundError);
    culture.softDeleteTrack(track.id, LATER);
    expect(() => culture.recordPlay(track.id, LATER)).toThrow(CultureNotFoundError);
  });

  it("patches metadata without touching the file, the import date or the play count", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    culture.recordPlay(track.id, NOW);
    const played = culture.listTracks()[0]!;

    const updated = culture.updateTrack(
      track.id,
      { artist: "Đorđe Balašević", album: "Pub", releaseYear: 1982, durationMs: 215_000 },
      LATER,
    );
    expect(updated).toEqual({
      ...played,
      artist: "Đorđe Balašević",
      album: "Pub",
      releaseYear: 1982,
      durationMs: 215_000,
      updatedAt: LATER,
    });

    expect(culture.updateTrack(track.id, { artist: null }, LAST).artist).toBeNull();
    expect(() => culture.updateTrack("nema", { title: "X" }, LATER)).toThrow(CultureNotFoundError);
    expect(() => culture.updateTrack(track.id, { durationMs: -1 }, LATER)).toThrow(
      CultureValidationError,
    );
  });

  it("restores a deleted track with its metadata and its plays", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    culture.recordPlay(track.id, NOW);
    const played = culture.listTracks()[0]!;

    culture.softDeleteTrack(track.id, LATER);
    expect(culture.listTracks()).toEqual([]);
    culture.restoreTrack(track.id, LATER);
    expect(culture.listTracks()).toEqual([{ ...played, updatedAt: LATER }]);
  });

  it("refuses to delete twice or restore what is not deleted", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    expect(() => culture.restoreTrack(track.id, LATER)).toThrow(CultureNotFoundError);
    culture.softDeleteTrack(track.id, LATER);
    expect(() => culture.softDeleteTrack(track.id, LATER)).toThrow(CultureNotFoundError);
  });

  it("deleting a track takes it out of every playlist and clears the log links, and a restore does not undo that", () => {
    const culture = store();
    const gone = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    const kept = culture.createTrack(
      { title: "Pesma", artist: "Ljubiša Stojanović", durationMs: 90_000, ...MP3, sha256: OTHER_HASH },
      NOW,
    );
    const entry = culture.createEntry(
      { artist: "Đorđe Balašević", title: "Slovenska", kind: "track", date: "2026-05-01", rating: 10, trackId: gone.id },
      NOW,
    );
    const playlist = culture.createPlaylist("Za kola", NOW);
    const first = culture.addPlaylistTrack(playlist.id, gone.id, NOW);
    const surviving = culture.addPlaylistTrack(playlist.id, kept.id, NOW);

    culture.softDeleteTrack(gone.id, LATER);

    // The entry keeps every word the user typed; only the pointer goes.
    expect(culture.listEntries()).toEqual([{ ...entry, trackId: null, updatedAt: LATER }]);
    // The playlist loses the slot, and keeps the rest of itself.
    expect(culture.listPlaylistItems(playlist.id)).toEqual([surviving]);
    expect(first.id).not.toBe(surviving.id);

    // And the undo brings the track back, not the arrangement: re-inserting it
    // into a list the user has edited since would be a different edit.
    culture.restoreTrack(gone.id, LAST);
    expect(culture.listTracks().map((track) => track.id)).toContain(gone.id);
    expect(culture.listPlaylistItems(playlist.id)).toEqual([surviving]);
    expect(culture.listEntries()[0]?.trackId).toBeNull();
  });
});

describe("CultureStore listening entries", () => {
  it("records an entry, with or without one of the user's own tracks", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    const linked = culture.createEntry(
      { artist: "Đorđe Balašević", title: "Slovenska", kind: "track", date: "2026-05-01", rating: 10, trackId: track.id },
      NOW,
    );
    const remembered = culture.createEntry(
      { artist: "Riblja čorba", title: "Kad hodaš", kind: "live", date: "2026-05-02" },
      NOW,
    );

    expect(linked).toMatchObject({ trackId: track.id, rating: 10, notes: "", kind: "track" });
    expect(remembered).toMatchObject({ trackId: null, rating: null, notes: "" });
  });

  it("reads the log newest first", () => {
    const culture = store();
    const may = culture.createEntry(
      { artist: "Lola Novaković", title: "Pesma", kind: "album", date: "2026-05-01" },
      NOW,
    );
    const june = culture.createEntry(
      { artist: "Lola Novaković", title: "Druga", kind: "album", date: "2026-06-01" },
      NOW,
    );

    expect(culture.listEntries().map((entry) => entry.id)).toEqual([june.id, may.id]);
    expect(culture.listEntries({ from: "2026-05-01", to: "2026-05-31" }).map((e) => e.id)).toEqual([
      may.id,
    ]);
  });

  it("refuses a track that is not a live track of this profile", () => {
    const mine = store();
    const theirs = store();
    const track = mine.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    const entry = mine.createEntry(
      { artist: "Đorđe Balašević", title: "Slovenska", kind: "track", date: "2026-05-01", trackId: track.id },
      NOW,
    );

    const line = { artist: "A", title: "T", kind: "track" as const, date: "2026-05-01" };
    expect(() => theirs.createEntry({ ...line, trackId: track.id }, NOW)).toThrow(
      CultureNotFoundError,
    );
    expect(() => mine.createEntry({ ...line, trackId: "nema" }, NOW)).toThrow(
      CultureNotFoundError,
    );
    mine.softDeleteTrack(track.id, LATER);
    expect(() => mine.updateEntry(entry.id, { trackId: track.id }, LATER)).toThrow(
      CultureNotFoundError,
    );
    // The refused update left the entry as it was.
    expect(mine.listEntries()).toEqual([{ ...entry, trackId: null, updatedAt: LATER }]);
  });

  it.each([
    ["an unknown kind", { artist: "A", title: "T", kind: "song" as never, date: "2026-05-01" }],
    ["an empty artist", { artist: "  ", title: "T", kind: "album", date: "2026-05-01" }],
    ["an empty title", { artist: "A", title: " ", kind: "album", date: "2026-05-01" }],
    ["a day that is not a calendar day", { artist: "A", title: "T", kind: "album", date: "2026-02-30" }],
    ["a rating below the scale", { artist: "A", title: "T", kind: "album", date: "2026-05-01", rating: 0 }],
    ["a rating above the scale", { artist: "A", title: "T", kind: "album", date: "2026-05-01", rating: 11 }],
    ["an over-long note", { artist: "A", title: "T", kind: "album", date: "2026-05-01", notes: "x".repeat(2001) }],
  ])("refuses %s", (_label, input) => {
    const culture = store();
    expect(() => culture.createEntry(input as never, NOW)).toThrow(CultureValidationError);
  });

  it("patches an entry, and clears a rating, a note or a link on an explicit null", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    const entry = culture.createEntry(
      {
        artist: "Đorđe Balašević",
        title: "Slovenska",
        kind: "track",
        date: "2026-05-01",
        rating: 8,
        notes: "Sa radija.",
        trackId: track.id,
      },
      NOW,
    );

    expect(culture.updateEntry(entry.id, { rating: 9 }, LATER)).toEqual({
      ...entry,
      rating: 9,
      updatedAt: LATER,
    });
    expect(culture.updateEntry(entry.id, { rating: null, notes: "", trackId: null }, LAST)).toEqual({
      ...entry,
      rating: null,
      notes: "",
      trackId: null,
      updatedAt: LAST,
    });
    expect(() => culture.updateEntry("nema", { rating: 5 }, LATER)).toThrow(CultureNotFoundError);
  });

  it("round-trips a soft delete", () => {
    const culture = store();
    const entry = culture.createEntry(
      { artist: "Lola Novaković", title: "Pesma", kind: "album", date: "2026-05-01" },
      NOW,
    );
    culture.softDeleteEntry(entry.id, LATER);
    expect(culture.listEntries()).toEqual([]);
    culture.restoreEntry(entry.id, LATER);
    expect(culture.listEntries()).toEqual([{ ...entry, updatedAt: LATER }]);
    expect(() => culture.restoreEntry(entry.id, LATER)).toThrow(CultureNotFoundError);
  });
});

describe("CultureStore playlists", () => {
  it("names playlists sr-Latn alphabetically, and refuses a name it cannot hold", () => {
    const culture = store();
    const zima = culture.createPlaylist("Zima", NOW);
    const lepota = culture.createPlaylist("Lepota", NOW);
    const djaci = culture.createPlaylist("Đački dani", NOW);

    // `đ` is a letter after `d`, so Đački leads: a plain sort would put it last.
    expect(culture.listPlaylists().map((playlist) => playlist.id)).toEqual([
      djaci.id,
      lepota.id,
      zima.id,
    ]);

    expect(() => culture.createPlaylist("   ", NOW)).toThrow(CultureValidationError);
    expect(() => culture.createPlaylist("x".repeat(101), NOW)).toThrow(CultureValidationError);
    expect(() => culture.renamePlaylist(zima.id, "  Leto  ", LATER)).not.toThrow();
    expect(culture.listPlaylists().map((playlist) => playlist.name)).toContain("Leto");
    expect(() => culture.renamePlaylist("nema", "Leto", LATER)).toThrow(CultureNotFoundError);
  });

  it("appends tracks in the order they were added", () => {
    const culture = store();
    const first = culture.createTrack({ title: "Prva", durationMs: 100_000, ...MP3 }, NOW);
    const second = culture.createTrack({ title: "Druga", durationMs: 200_000, ...MP3, sha256: OTHER_HASH }, NOW);
    const playlist = culture.createPlaylist("Za kola", NOW);

    const itemOne = culture.addPlaylistTrack(playlist.id, first.id, NOW);
    const itemTwo = culture.addPlaylistTrack(playlist.id, second.id, LATER);
    expect(culture.listPlaylistItems(playlist.id)).toEqual([itemOne, itemTwo]);
  });

  it("holds the same track twice, and in two playlists at once", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    const one = culture.createPlaylist("Jedna", NOW);
    const two = culture.createPlaylist("Druga", NOW);

    const firstCopy = culture.addPlaylistTrack(one.id, track.id, NOW);
    const secondCopy = culture.addPlaylistTrack(one.id, track.id, LATER);
    const elsewhere = culture.addPlaylistTrack(two.id, track.id, LAST);

    expect(culture.listPlaylistItems(one.id)).toEqual([firstCopy, secondCopy]);
    expect(firstCopy.id).not.toBe(secondCopy.id);
    expect(culture.listPlaylistItems(two.id)).toEqual([elsewhere]);

    // Removing ONE appearance leaves the other exactly where it was.
    expect(culture.removePlaylistItem(one.id, firstCopy.id)).toEqual(firstCopy);
    expect(culture.listPlaylistItems(one.id)).toEqual([secondCopy]);
  });

  it("moves an item to the front, to the back, and between two others", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    const playlist = culture.createPlaylist("Za kola", NOW);
    const first = culture.addPlaylistTrack(playlist.id, track.id, NOW);
    const second = culture.addPlaylistTrack(playlist.id, track.id, NOW);
    const third = culture.addPlaylistTrack(playlist.id, track.id, NOW);
    const items = () => culture.listPlaylistItems(playlist.id);

    // To the front: nothing before it, `first` after it.
    culture.movePlaylistItem(playlist.id, third.id, null, first.id, LATER);
    expect(items().map((item) => item.id)).toEqual([third.id, first.id, second.id]);
    // `first` was not the row that moved, so its rank is the one to compare against.
    expect(items()[0]!.rank < first.rank).toBe(true);

    // To the back: `second` before it, nothing after it.
    culture.movePlaylistItem(playlist.id, first.id, second.id, null, LATER);
    expect(items().map((item) => item.id)).toEqual([third.id, second.id, first.id]);

    // Between the two: a rank strictly inside the gap it was given.
    // Every rank is re-read here: the rows that moved twice carry new ones, and
    // the object a previous call returned is a snapshot, not a live row.
    const [leading, middle, trailing] = items();
    const moved = culture.movePlaylistItem(
      playlist.id,
      trailing!.id,
      leading!.id,
      middle!.id,
      LAST,
    );
    expect(moved.rank > leading!.rank).toBe(true);
    expect(moved.rank < middle!.rank).toBe(true);
    expect(items().map((item) => item.id)).toEqual([
      leading!.id,
      trailing!.id,
      middle!.id,
    ]);
  });

  it("refuses a move that describes no gap, or names a row that is not in this playlist", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    const playlist = culture.createPlaylist("Za kola", NOW);
    const other = culture.createPlaylist("Druga", NOW);
    const item = culture.addPlaylistTrack(playlist.id, track.id, NOW);
    const stranger = culture.addPlaylistTrack(other.id, track.id, NOW);

    expect(() => culture.movePlaylistItem(playlist.id, item.id, item.id, null, LATER)).toThrow(
      CultureValidationError,
    );
    expect(() => culture.movePlaylistItem(playlist.id, item.id, null, stranger.id, LATER)).toThrow(
      CultureNotFoundError,
    );
    expect(() => culture.movePlaylistItem(other.id, item.id, null, null, LATER)).toThrow(
      CultureNotFoundError,
    );
    expect(() => culture.movePlaylistItem(playlist.id, "nema", null, null, LATER)).toThrow(
      CultureNotFoundError,
    );
    expect(culture.listPlaylistItems(playlist.id)).toEqual([item]);
  });

  it("refuses a track the library does not hold, and reads nothing from a deleted playlist", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    const playlist = culture.createPlaylist("Za kola", NOW);
    const item = culture.addPlaylistTrack(playlist.id, track.id, NOW);

    expect(() => culture.addPlaylistTrack("nema", track.id, NOW)).toThrow(CultureNotFoundError);
    expect(() => culture.addPlaylistTrack(playlist.id, "nema", NOW)).toThrow(CultureNotFoundError);
    culture.softDeleteTrack(track.id, LATER);
    expect(() => culture.addPlaylistTrack(playlist.id, track.id, LATER)).toThrow(
      CultureNotFoundError,
    );
    // And the deleted track's slot went with it: see the track section below.
    expect(culture.listPlaylistItems(playlist.id)).toEqual([]);
    expect(item.trackId).toBe(track.id);
  });

  it("keeps a playlist's items through a delete, so undo gives back what was there", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Slovenska", durationMs: 214_000, ...MP3 }, NOW);
    const playlist = culture.createPlaylist("Za kola", NOW);
    const item = culture.addPlaylistTrack(playlist.id, track.id, NOW);

    culture.softDeletePlaylist(playlist.id, LATER);
    expect(culture.listPlaylists()).toEqual([]);
    expect(() => culture.listPlaylistItems(playlist.id)).toThrow(CultureNotFoundError);
    culture.restorePlaylist(playlist.id, LATER);
    expect(culture.listPlaylistItems(playlist.id)).toEqual([item]);
    expect(() => culture.restorePlaylist(playlist.id, LATER)).toThrow(CultureNotFoundError);
  });
});

describe("CultureStore export and import", () => {
  /** A whole culture corner: two visits (one with a photo), two tracks, two entries and a playlist of three items. */
  function seed(culture: CultureStore): void {
    const exhibition = culture.createVisit(EXHIBITION, NOW);
    culture.addVisitPhoto(
      exhibition.id,
      { fileName: "postavka.jpg", mime: "image/jpeg", sizeBytes: 2_048_000, sha256: HASH },
      NOW,
    );
    culture.createVisit(
      { kind: "theatre", title: "Hamlet", venue: "Narodno pozorište", date: "2026-04-20", rating: 7 },
      NOW,
    );

    const first = culture.createTrack(
      { title: "Slovenska", artist: "Đorđe Balašević", album: "Pub", trackNumber: 3, releaseYear: 1982, durationMs: 214_000, ...MP3 },
      NOW,
    );
    const second = culture.createTrack(
      { title: "Pesma", artist: "Ljubiša Stojanović", durationMs: 90_000, ...MP3, sha256: OTHER_HASH },
      NOW,
    );
    culture.recordPlay(first.id, LATER);
    culture.recordPlay(first.id, LAST);
    culture.recordPlay(second.id, LAST);

    culture.createEntry(
      { artist: "Đorđe Balašević", title: "Slovenska", kind: "track", date: "2026-05-01", rating: 10, notes: "Ceo dan.", trackId: first.id },
      NOW,
    );
    culture.createEntry(
      { artist: "Riblja čorba", title: "Kad hodaš", kind: "live", date: "2026-05-02" },
      NOW,
    );

    const playlist = culture.createPlaylist("Za kola", NOW);
    culture.addPlaylistTrack(playlist.id, first.id, NOW);
    culture.addPlaylistTrack(playlist.id, second.id, NOW);
    culture.addPlaylistTrack(playlist.id, first.id, NOW);
  }

  it("nests each visit's photos and each playlist's items, and carries no profile and no deleted rows", () => {
    const culture = store();
    seed(culture);
    const gone = culture.createVisit(
      { kind: "museum", title: "Brisana", venue: "Muzej", date: "2026-05-30" },
      NOW,
    );
    culture.softDeleteVisit(gone.id, LATER);

    const exported = culture.exportData();
    expect(exported.version).toBe(1);
    expect(exported.visits).toHaveLength(2);
    // Three live places: the two the live visits name, and the one the deleted
    // visit still names - a soft delete keeps its photos AND its place.
    expect(exported.venues).toHaveLength(3);
    expect(exported.tracks).toHaveLength(2);
    expect(exported.entries).toHaveLength(2);
    expect(exported.playlists).toHaveLength(1);
    expect(exported.visits.find((visit) => visit.title === "Tesla: Čovek budućnosti")?.photos).toHaveLength(1);
    expect(exported.playlists[0]?.items).toHaveLength(3);
    // Two plays of one track and one of the other survive the round trip as facts.
    expect(exported.tracks.find((track) => track.title === "Slovenska")).toMatchObject({
      playCount: 2,
      lastPlayedAt: LAST,
    });
    expect(JSON.stringify(exported)).not.toContain("profileId");
  });

  it("round-trips a whole library into another profile, byte for byte", () => {
    const source = store();
    seed(source);
    const exported = source.exportData();

    const target = freshStore();
    const summary = target.importData(exported, LAST);

    expect(summary).toEqual({
      // Two visits, and the two places they were at: a place is remembered by
      // the visit that names it (stage 2), and the seed visits two of them.
      venues: 2,
      visits: 2,
      photos: 1,
      plans: 0,
      tracks: 2,
      entries: 2,
      playlists: 1,
      items: 3,
    });
    // Same ids, same timestamps, same order: the export is canonical, so two
    // exports of the same data are the same JSON.
    expect(target.exportData()).toEqual(exported);
    expect(target.listTracks()).toHaveLength(2);
    expect(target.listVisits()).toHaveLength(2);
    expect(target.listEntries()).toHaveLength(2);
    expect(target.listPlaylists()).toHaveLength(1);
    expect(target.listEntries().some((entry) => entry.trackId !== null)).toBe(true);
  });

  it("replaces what was there rather than adding to it, so a second import changes nothing", () => {
    const source = store();
    seed(source);
    const exported = source.exportData();

    const target = freshStore();
    target.createVisit(
      { kind: "festival", title: "Ostaje samo do uvoza", venue: "Egzit", date: "2026-07-10" },
      NOW,
    );
    target.createTrack({ title: "Stara", durationMs: 1_000, ...MP3 }, NOW);
    target.importData(exported, LAST);
    const once = target.exportData();
    expect(once.visits.some((visit) => visit.title === "Ostaje samo do uvoza")).toBe(false);
    expect(target.listTracks()).toHaveLength(2);

    target.importData(exported, LAST);
    expect(target.exportData()).toEqual(once);
  });

  it("drops rows the export does not carry, a soft delete included", () => {
    const source = store();
    seed(source);
    const deleted = source.listVisits()[0]!;
    source.softDeleteVisit(deleted.id, LATER);
    // The deleted visit is not in the value AND is not in the target afterwards,
    // because an import replaces the module rather than merging into it.
    expect(source.exportData().visits.map((visit) => visit.id)).not.toContain(deleted.id);

    const target = freshStore();
    seed(target);
    target.importData(source.exportData(), LAST);
    expect(target.listVisits().map((visit) => visit.id)).not.toContain(deleted.id);
  });

  it("refuses, atomically, an archive whose row ids already belong to another profile in this database", () => {
    // Restoring an archive BESIDE the profile it came from is the one address a
    // preserved row id cannot have, and the failure has to be loud and whole:
    // `restoreStore.test.ts` pins the same rule for the profile archive itself.
    const source = store();
    seed(source);
    const exported = source.exportData();

    const target = store();
    seed(target);
    const before = target.exportData();

    expect(() => target.importData(exported, LAST)).toThrow(/UNIQUE constraint failed/);
    // The deletes ran inside the same transaction, so they rolled back with the
    // inserts: half an archive is never written.
    expect(target.exportData()).toEqual(before);
  });

  it("refuses any version but 1", () => {
    const culture = store();
    seed(culture);
    const value = broken(culture.exportData());
    value["version"] = 2;
    expect(() => culture.importData(value, LAST)).toThrow(CultureValidationError);
  });

  it.each([["not an object", "kultura"], ["an array", []]])(
    "refuses an archive that is %s",
    (_label, value) => {
      const culture = store();
      culture.createVisit(EXHIBITION, NOW);
      expect(() => culture.importData(value, LAST)).toThrow(CultureValidationError);
      expect(culture.listVisits()).toHaveLength(1);
    },
  );

  it.each([
    ["a missing section", (value: Mutable) => { delete value["playlists"]; }],
    ["an unknown top-level key", (value: Mutable) => { value["paintings"] = []; }],
    ["a row that is not an object", (value: Mutable) => { (value["tracks"] as unknown[])[0] = "x"; }],
    ["an unknown key on a row", (value: Mutable) => { (value["tracks"] as Mutable[])[0]!["deletedAt"] = NOW; }],
    ["a missing key on a row", (value: Mutable) => { delete (value["entries"] as Mutable[])[0]!["notes"]; }],
    ["an unknown visit kind", (value: Mutable) => { (value["visits"] as Mutable[])[0]!["kind"] = "muzej"; }],
    ["a rating above the scale", (value: Mutable) => { (value["entries"] as Mutable[])[0]!["rating"] = 11; }],
    ["a currency in lower case", (value: Mutable) => {
      const visits = value["visits"] as Mutable[];
      const price = visits.find((visit) => visit["price"] !== null)!["price"] as Mutable;
      price["currency"] = "rsd";
    }],
    ["a negative duration", (value: Mutable) => { (value["tracks"] as Mutable[])[0]!["durationMs"] = -1; }],
    ["a play count past the bound", (value: Mutable) => { (value["tracks"] as Mutable[])[0]!["playCount"] = 1_000_001; }],
    ["a mime the player cannot open", (value: Mutable) => { (value["tracks"] as Mutable[])[0]!["mime"] = "application/pdf"; }],
    ["a photo hash that is not a hash", (value: Mutable) => {
      const visits = value["visits"] as Mutable[];
      const photos = visits.find((visit) => (visit["photos"] as unknown[]).length > 0)!["photos"] as Mutable[];
      photos[0]!["sha256"] = "nije-hash";
    }],
    ["an entry naming a track the value does not carry", (value: Mutable) => {
      (value["entries"] as Mutable[])[0]!["trackId"] = "tuđi-track";
    }],
    ["an item naming a track the value does not carry", (value: Mutable) => {
      const playlists = value["playlists"] as Mutable[];
      (playlists[0]!["items"] as Mutable[])[0]!["trackId"] = "tuđi-track";
    }],
    ["an item whose rank is not a rank", (value: Mutable) => {
      const playlists = value["playlists"] as Mutable[];
      (playlists[0]!["items"] as Mutable[])[0]!["rank"] = "prvo";
    }],
    ["two tracks with one id", (value: Mutable) => {
      const tracks = value["tracks"] as Mutable[];
      tracks[1]!["id"] = tracks[0]!["id"];
    }],
    ["two photos with one id", (value: Mutable) => {
      const visits = value["visits"] as Mutable[];
      const photos = visits.find((visit) => (visit["photos"] as unknown[]).length > 0)!["photos"] as Mutable[];
      photos.push({ ...photos[0]!, fileName: "druga.jpg" });
    }],
    ["a timestamp that is not a date-time", (value: Mutable) => {
      (value["visits"] as Mutable[])[0]!["createdAt"] = "juče";
    }],
    ["an id over the one bound", (value: Mutable) => {
      (value["tracks"] as Mutable[])[0]!["id"] = "x".repeat(201);
    }],
  ])("refuses an archive with %s", (_label, mutate) => {
    const culture = store();
    const existing = culture.createVisit(EXHIBITION, NOW);

    expect(() => culture.importData(brokenSection(mutate), LAST)).toThrow(CultureValidationError);
    // Nothing was written and nothing was dropped: the profile is exactly as it
    // was, which is the whole point of validating before the transaction.
    expect(culture.listVisits()).toEqual([existing]);
    expect(culture.listTracks()).toEqual([]);
  });

  it("validates the LAST row too - a value that fails anywhere writes nothing", () => {
    const source = store();
    seed(source);

    const target = store();
    const existing = target.createVisit(EXHIBITION, NOW);
    const value = broken(source.exportData());
    const entries = value["entries"] as Record<string, unknown>[];
    entries[entries.length - 1]!["rating"] = 42;

    expect(() => target.importData(value, LAST)).toThrow(CultureValidationError);
    expect(target.listVisits()).toEqual([existing]);
    expect(target.listPlaylists()).toEqual([]);
  });

  it("accepts an empty library, which is what a profile that never used the module exports", () => {
    const culture = store();
    expect(culture.exportData()).toEqual({
      version: 1,
      venues: [],
      visits: [],
      plans: [],
      tracks: [],
      entries: [],
      playlists: [],
      settings: { promptPastPlans: true },
    });
    expect(culture.importData(culture.exportData(), LAST)).toEqual({
      venues: 0,
      visits: 0,
      photos: 0,
      plans: 0,
      tracks: 0,
      entries: 0,
      playlists: 0,
      items: 0,
    });
  });
});

// --- Stage 2: the places, the programme and the module's preference ---------
//
// The three tables the page needed. They are tested here rather than in the
// module's own folder because this is where the store's rules live: what a
// place is, what a plan may carry, what "one place remembered once" means, and
// the two counts main's blob union reads.

const PLAN: CreateCulturePlanInput = {
  kind: "theatre",
  title: "Hamlet",
  venue: "Narodno pozorište",
  city: "Beograd",
  date: "2026-07-01",
  startTime: "19:30",
  link: "https://example.org/hamlet",
  notes: "Loža 4.",
};

describe("CultureStore places", () => {
  it("remembers a place once, folding the spellings of its name", () => {
    const culture = store();
    const first = culture.createVisit(
      { kind: "museum", title: "Tesla", venue: "Narodni muzej", city: "Beograd", date: "2026-05-01" },
      NOW,
    );
    const second = culture.createVisit(
      { kind: "exhibition", title: "Praistorija", venue: "  narodni   MUZEJ ", city: "beograd", date: "2026-05-02" },
      NOW,
    );

    expect(culture.listVenues()).toHaveLength(1);
    expect(first.venueId).toBe(second.venueId);
    // The VISIT keeps the words the user typed; only the link is shared.
    expect(first.venue).toBe("Narodni muzej");
    expect(second.venue).toBe("narodni MUZEJ");
    // The place keeps the spelling it was FIRST seen with.
    expect(culture.listVenues()[0]?.name).toBe("Narodni muzej");
  });

  it("refuses a second place with a name it already remembers, and lets it be renamed", () => {
    const culture = store();
    const venue = culture.createVenue(
      { name: "Narodni muzej", city: "Beograd", kind: "museum", notes: "Loža je najbolja." },
      NOW,
    );
    expect(culture.settings()).toEqual({ promptPastPlans: true });
    expect(() =>
      culture.createVenue({ name: "narodni  MUZEJ", city: "beograd", kind: "museum" }, NOW),
    ).toThrow(CultureValidationError);

    const visit = culture.createVisit(
      { kind: "museum", title: "Tesla", venue: "Narodni muzej", city: "Beograd", date: "2026-05-01" },
      NOW,
    );
    const renamed = culture.updateVenue(venue.id, { name: "Narodni muzej Srbije" }, LATER);
    expect(renamed.name).toBe("Narodni muzej Srbije");
    expect(renamed.updatedAt).toBe(LATER);
    // The visit's own words are untouched: a rename is not a rewrite of memory.
    expect(culture.listVisits()[0]?.venue).toBe("Narodni muzej");
    expect(culture.listVisits()[0]?.venueId).toBe(visit.venueId);
    // The place's notes are the place's, and they survive the rename.
    expect(renamed.notes).toBe("Loža je najbolja.");
  });

  it("brings a deleted place back rather than remembering it twice", () => {
    const culture = store();
    const venue = culture.createVenue({ name: "Muzej savremene umetnosti", kind: "museum" }, NOW);
    culture.softDeleteVenue(venue.id, LATER);
    expect(culture.listVenues()).toEqual([]);

    const visit = culture.createVisit(
      { kind: "museum", title: "Izložba", venue: "Muzej savremene umetnosti", date: "2026-06-01" },
      LAST,
    );
    expect(visit.venueId).toBe(venue.id);
    expect(culture.listVenues()).toHaveLength(1);
    expect(culture.listVenues()[0]?.updatedAt).toBe(LAST);
    expect(() => culture.restoreVenue(venue.id, LAST)).toThrow(CultureNotFoundError);
  });
});

describe("CultureStore plans", () => {
  it("stores a plan with the address the user pasted", () => {
    const culture = store();
    const plan = culture.createPlan(PLAN, NOW);
    expect(plan).toMatchObject({
      kind: "theatre",
      title: "Hamlet",
      link: "https://example.org/hamlet",
      visitId: null,
      createdAt: NOW,
    });
    // The place it names is remembered, exactly as a visit's is.
    expect(plan.venueId).not.toBeNull();
    expect(culture.listPlans().map((row) => row.title)).toEqual(["Hamlet"]);
  });

  it("reads plans in date order, past and future together", () => {
    const culture = store();
    culture.createPlan({ ...PLAN, title: "Kasnije", date: "2026-09-01" }, NOW);
    culture.createPlan({ ...PLAN, title: "Ranije", date: "2026-06-01" }, NOW);
    expect(culture.listPlans().map((row) => row.date)).toEqual(["2026-06-01", "2026-09-01"]);
  });

  it("refuses an address that is not http(s), and one that is not an address", () => {
    const culture = store();
    for (const link of ["file:///etc/passwd", "javascript:alert(1)", "nije link"]) {
      expect(() => culture.createPlan({ ...PLAN, link }, NOW)).toThrow(CultureValidationError);
    }
    // A blank link is "no link", not a refused one.
    expect(culture.createPlan({ ...PLAN, link: "   " }, NOW).link).toBeNull();
    expect(culture.createPlan({ ...PLAN, link: null }, NOW).link).toBeNull();
  });

  it("turns a plan into a visit once, and refuses the second time", () => {
    const culture = store();
    const plan = culture.createPlan(PLAN, NOW);
    const completion = culture.completePlan(plan.id, { rating: 9, companions: "Ana" }, LATER);

    expect(completion.visit).toMatchObject({
      kind: "theatre",
      title: "Hamlet",
      venue: "Narodno pozorište",
      date: "2026-07-01",
      startTime: "19:30",
      rating: 9,
      companions: "Ana",
    });
    expect(completion.plan.visitId).toBe(completion.visit.id);
    expect(culture.listPlans()[0]?.visitId).toBe(completion.visit.id);
    expect(culture.listVisits()).toHaveLength(1);
    expect(() => culture.completePlan(plan.id, {}, LAST)).toThrow(CultureValidationError);
  });

  it("soft-deletes a plan and restores it", () => {
    const culture = store();
    const plan = culture.createPlan(PLAN, NOW);
    culture.softDeletePlan(plan.id, LATER);
    expect(culture.listPlans()).toEqual([]);
    culture.restorePlan(plan.id, LATER);
    expect(culture.listPlans()).toHaveLength(1);
    expect(() => culture.softDeletePlan(plan.id, LAST)).not.toThrow();
  });
});

describe("CultureStore's own preference and blob counts", () => {
  it("answers the shipped default until a row says otherwise", () => {
    const culture = store();
    expect(culture.settings()).toEqual({ promptPastPlans: true });
    expect(culture.setPromptPastPlans(false, NOW)).toEqual({ promptPastPlans: false });
    expect(culture.settings()).toEqual({ promptPastPlans: false });
    expect(culture.setPromptPastPlans(true, LATER)).toEqual({ promptPastPlans: true });
    expect(culture.settings()).toEqual({ promptPastPlans: true });
  });

  it("counts a hash once per row that names it, across photos and tracks together", () => {
    const culture = store();
    const visit = culture.createVisit(
      { kind: "museum", title: "Tesla", venue: "Narodni muzej", date: "2026-05-01" },
      NOW,
    );
    culture.addVisitPhoto(
      visit.id,
      { fileName: "karta.jpg", mime: "image/jpeg", sizeBytes: 1_024, sha256: HASH },
      NOW,
    );
    culture.createTrack({ title: "Isti bajtovi", durationMs: 1_000, ...MP3, sha256: HASH }, NOW);

    expect(culture.refCount(HASH)).toBe(2);
    expect(culture.refCount(OTHER_HASH)).toBe(0);
    // The photo table is asked first, which is the order main's own mime union
    // asks these two in.
    expect(culture.mimeForHash(HASH)).toBe("image/jpeg");
    expect(culture.mimeForHash(OTHER_HASH)).toBeNull();

    culture.removeVisitPhoto(visit.id, culture.listVisitPhotos(visit.id)[0]?.id ?? "");
    expect(culture.refCount(HASH)).toBe(1);
    expect(culture.mimeForHash(HASH)).toBe("audio/mpeg");
  });

  it("reads one live track, and answers null once it is deleted", () => {
    const culture = store();
    const track = culture.createTrack({ title: "Pesma", durationMs: 90_000, ...MP3 }, NOW);
    expect(culture.track(track.id)?.title).toBe("Pesma");
    culture.softDeleteTrack(track.id, LATER);
    expect(culture.track(track.id)).toBeNull();
  });

  it("refuses a track row whose mime is not one of the five audio formats", () => {
    const culture = store();
    expect(() =>
      culture.createTrack({ title: "Nije audio", durationMs: 1_000, ...MP3, mime: "application/pdf" }, NOW),
    ).toThrow(CultureValidationError);
  });
});

describe("the stage 2 archive members", () => {
  it("carries the places, the plans and the preference, and restores them whole", () => {
    const source = store();
    const venue = source.createVenue(
      { name: "Sava centar", city: "Beograd", kind: "concert", notes: "Parking je iza." },
      NOW,
    );
    const plan = source.createPlan(PLAN, NOW);
    const answered = source.createPlan({ ...PLAN, title: "Prošlo", date: "2026-05-01" }, NOW);
    source.completePlan(answered.id, {}, LATER);
    source.setPromptPastPlans(false, LAST);

    const exported = source.exportData();
    expect(exported.venues.map((row) => row.id)).toContain(venue.id);
    expect(exported.plans.map((row) => row.id)).toContain(plan.id);
    expect(exported.plans.find((row) => row.id === answered.id)?.visitId).not.toBeNull();
    expect(exported.settings).toEqual({ promptPastPlans: false });

    const target = freshStore();
    target.importData(exported, LAST);
    const restored = target.exportData();
    expect(restored).toEqual(exported);
    expect(target.settings()).toEqual({ promptPastPlans: false });
    expect(target.listPlans()).toHaveLength(2);
  });

  it("refuses a value whose links dangle, rather than writing half of it", () => {
    const source = store();
    source.createVisit(
      { kind: "museum", title: "Tesla", venue: "Narodni muzej", date: "2026-05-01" },
      NOW,
    );
    source.createPlan(PLAN, NOW);
    const exported = source.exportData();

    const danglingVenue = broken(exported);
    const visits = danglingVenue["visits"] as Mutable[];
    visits[0] = { ...visits[0], venueId: "nema-ovog-mesta" };
    const target = freshStore();
    expect(() => target.importData(danglingVenue, LAST)).toThrow(/does not carry/);
    expect(target.listVisits()).toEqual([]);

    const danglingVisit = broken(exported);
    const plans = danglingVisit["plans"] as Mutable[];
    plans[0] = { ...plans[0], visitId: "nema-ove-posete" };
    expect(() => target.importData(danglingVisit, LAST)).toThrow(/does not carry/);
    expect(target.listPlans()).toEqual([]);
  });

  it("refuses a preference that is not a boolean", () => {
    const source = store();
    const exported = broken(source.exportData());
    exported["settings"] = { promptPastPlans: "da" };
    expect(() => freshStore().importData(exported, LAST)).toThrow(/boolean/);
  });
});

/** A mutable deep copy of a value, so a test can break exactly one thing about it. */
type Mutable = Record<string, unknown>;

function broken(value: unknown): Mutable {
  return JSON.parse(JSON.stringify(value)) as Mutable;
}

/** A broken copy of the module's own export, built by seeding a throwaway store. */
function brokenSection(mutate: (value: Mutable) => void): unknown {
  const culture = store();
  const exhibition = culture.createVisit(EXHIBITION, NOW);
  culture.addVisitPhoto(
    exhibition.id,
    { fileName: "postavka.jpg", mime: "image/jpeg", sizeBytes: 2_048_000, sha256: HASH },
    NOW,
  );
  const track = culture.createTrack(
    { title: "Slovenska", artist: "Đorđe Balašević", album: "Pub", trackNumber: 3, durationMs: 214_000, ...MP3 },
    NOW,
  );
  // A second track and a second entry, so a mutator can break the SECOND row -
  // which is what makes "the last row is validated too" a real test.
  culture.createTrack(
    { title: "Pesma", artist: "Ljubiša Stojanović", durationMs: 90_000, ...MP3, sha256: OTHER_HASH },
    NOW,
  );
  culture.createEntry(
    { artist: "Đorđe Balašević", title: "Slovenska", kind: "track", date: "2026-05-01", rating: 10, trackId: track.id },
    NOW,
  );
  culture.createEntry(
    { artist: "Riblja čorba", title: "Kad hodaš", kind: "live", date: "2026-05-02" },
    NOW,
  );
  const playlist = culture.createPlaylist("Za kola", NOW);
  culture.addPlaylistTrack(playlist.id, track.id, NOW);

  const value = broken(culture.exportData());
  mutate(value);
  return value;
}
