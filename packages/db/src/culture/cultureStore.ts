import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_ID_LENGTH,
  MAX_CULTURE_RATING,
  MIN_CULTURE_RATING,
  isCultureAudioMime,
  isCultureRating,
  isMusicLogKind,
  isRank,
  isVisitKind,
  rankAfter,
  rankBetween,
  type MusicLogKind,
  type VisitKind,
} from "@nexus/core";
import { CultureNotFoundError, CultureValidationError } from "../errors.js";
import { isBareDate, isCurrencyCode, isDateTime } from "../finance/money.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/**
 * The bound on one visit title, and on a listening entry's title: what you saw
 * or heard, named - long enough for `Hamlet, Narodno pozorište u Beogradu`,
 * short enough that a calendar cell can print it.
 */
export const MAX_CULTURE_TITLE_LENGTH = 200;

/** A venue is a name, not an address: 120 characters is a name nobody is still typing. */
export const MAX_CULTURE_VENUE_LENGTH = 120;

/** A city is a name too, and the shortest of the three: `Beograd`, `Novi Sad`, `Niš`. */
export const MAX_CULTURE_CITY_LENGTH = 80;

/** An artist or an album name - `MAX_CULTURE_TITLE_LENGTH`'s bound, because it is the same kind of string. */
export const MAX_CULTURE_NAME_LENGTH = 200;

/** A note is a paragraph or three about what you thought. Past this the input is not a note anybody typed. */
export const MAX_CULTURE_NOTES_LENGTH = 2000;

/** Who you went with, typed as names: `Ana, Marko i Jelena` is a sentence, not a list of rows. */
export const MAX_CULTURE_COMPANIONS_LENGTH = 200;

/** A playlist name, the `MAX_TASK_LIST_NAME_LENGTH` bound: a label, not a body. */
export const MAX_CULTURE_PLAYLIST_NAME_LENGTH = 100;

/** The highest track number a release has - 999 leaves room for a box set, and a CD track number is two digits. */
export const MAX_CULTURE_TRACK_NUMBER = 999;

/** The two ends of a four-digit year. A shape rule rather than a history of recording: a tag with no year is null, never `0`. */
export const MIN_CULTURE_YEAR = 1000;
export const MAX_CULTURE_YEAR = 9999;

/** One day, in milliseconds. Nothing musical reaches it; it is here so `duration_ms` stays a plausible clock. */
export const MAX_CULTURE_DURATION_MS = 86_400_000;

/**
 * The most plays one track may record. Not a product decision - an arithmetic
 * one: `play_count x duration_ms` IS the listening time
 * (`summarizeCulture`), so the product has to stay a JavaScript safe integer.
 * A million plays of a 24-hour track is 8.64e13, three orders of magnitude
 * below 2^53.
 */
export const MAX_CULTURE_PLAY_COUNT = 1_000_000;

/**
 * The largest audio file the library accepts: 200 MiB.
 *
 * Derived rather than picked. Uncompressed stereo 44.1 kHz 16-bit audio is
 * 44 100 x 2 x 2 = 176 400 bytes per second, which is 10.1 MB per minute, so
 * 200 MiB is about twenty minutes of WAV - comfortably more than a track,
 * deliberately less than a whole concert, and every compressed format the
 * library holds is a small fraction of it. The cap exists because the blob
 * store encrypts a file in memory before it writes it: a user importing a
 * two-hour uncompressed recording needs a sentence, not a stalled window.
 */
export const MAX_CULTURE_TRACK_BYTES = 209_715_200;

/**
 * The largest photo a visit may carry: the note/task/subject attachment cap,
 * reused rather than reinvented. A photo is the same kind of file in the same
 * blob store, and a second limit would only mean two answers to "how big may a
 * file be".
 */
export const MAX_CULTURE_PHOTO_BYTES = 52_428_800;

/** The export format's version - the one number `importData` reads first and refuses to guess. */
export const CULTURE_EXPORT_VERSION = 1;

/** Serbian Latin ordering for the lists a person reads (CLAUDE.md's house rule; plain `"sr"` mis-tailors the Latin š, č and ć). */
const CULTURE_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** Wall-clock `HH:MM`, 00:00-23:59 - the shape `habits.reminder_time` holds and `ntf_settings` validates. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_LENGTH = 100;
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** An inclusive span of local days - the window the two range reads and the period statistics answer over. */
export interface CultureDateRange {
  readonly from: string;
  readonly to: string;
}

/** An amount of minor units and the currency it is in, together or not at all (migration 073's pair CHECK). */
export interface CulturePrice {
  readonly minorUnits: number;
  readonly currency: string;
}

export interface CultureVisit {
  id: string;
  profileId: string;
  kind: VisitKind;
  title: string;
  venue: string;
  city: string | null;
  /** The bare local day, `YYYY-MM-DD`. */
  date: string;
  /** Wall-clock `HH:MM` the thing started, or null when nobody recorded it. */
  startTime: string | null;
  rating: number | null;
  /** Never null: "no notes" has exactly one spelling here, the empty string. */
  notes: string;
  price: CulturePrice | null;
  /** Free-text names, as one string - `Ana, Marko i Jelena`. */
  companions: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One photo's index row - never the bytes themselves. They live
 * content-addressed on disk under `sha256`, in the same blob store the note,
 * task and subject attachments use (`apps/desktop/src/main/attachments.ts`),
 * which is why this row carries a name, a mime, a size and a hash and nothing
 * else.
 */
export interface CultureVisitPhoto {
  id: string;
  visitId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface CultureTrack {
  id: string;
  profileId: string;
  title: string;
  artist: string | null;
  album: string | null;
  trackNumber: number | null;
  /** Four digits, or null: a tag with no year is null and never `0`, which is the ID3 parser's sentinel for the same thing. */
  releaseYear: number | null;
  /** Milliseconds, the unit a decoder reports and a player seeks in. `0` means the file was imported before anything could measure it (migration 073). */
  durationMs: number;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  /**
   * When the file entered the library. There is no separate `createdAt`: a
   * track row is created by an import and is never re-created, so the row's
   * creation IS the import, and two names for one fact would eventually
   * disagree about it.
   */
  importedAt: string;
  playCount: number;
  lastPlayedAt: string | null;
  updatedAt: string;
}

export interface CultureMusicEntry {
  id: string;
  profileId: string;
  artist: string;
  title: string;
  kind: MusicLogKind;
  /** The bare local day, `YYYY-MM-DD`. */
  date: string;
  rating: number | null;
  notes: string;
  /** One of this profile's own live tracks, or null. */
  trackId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CulturePlaylist {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One appearance of one track in one playlist. The ITEM is the address, which
 * is what makes a track that appears twice reachable on its own: `remove` names
 * an item, never a track.
 */
export interface CulturePlaylistItem {
  id: string;
  playlistId: string;
  trackId: string;
  /** `@nexus/core`'s fractional rank (migration 062); compared as a string, written one row at a time. */
  rank: string;
  createdAt: string;
}

export interface CreateVisitInput {
  kind: VisitKind;
  title: string;
  venue: string;
  city?: string | null;
  date: string;
  startTime?: string | null;
  rating?: number | null;
  notes?: string;
  price?: CulturePrice | null;
  companions?: string | null;
}

/** A partial patch. An omitted key is left untouched; an explicit `null` clears a nullable field. */
export interface UpdateVisitFields {
  kind?: VisitKind;
  title?: string;
  venue?: string;
  city?: string | null;
  date?: string;
  startTime?: string | null;
  rating?: number | null;
  notes?: string;
  price?: CulturePrice | null;
  companions?: string | null;
}

/** What main knows about a file it has already written to the blob store - all four are its answers, never the renderer's claim (SEC-FILE-02). */
export interface CulturePhotoInput {
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

export interface CreateTrackInput {
  title: string;
  artist?: string | null;
  album?: string | null;
  trackNumber?: number | null;
  releaseYear?: number | null;
  durationMs: number;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

/** The metadata a track's owner may correct. The file itself is not editable here: re-importing a different file is a new track. */
export interface UpdateTrackFields {
  title?: string;
  artist?: string | null;
  album?: string | null;
  trackNumber?: number | null;
  releaseYear?: number | null;
  durationMs?: number;
}

export interface CreateEntryInput {
  artist: string;
  title: string;
  kind: MusicLogKind;
  date: string;
  rating?: number | null;
  notes?: string;
  trackId?: string | null;
}

export interface UpdateEntryFields {
  artist?: string;
  title?: string;
  kind?: MusicLogKind;
  date?: string;
  rating?: number | null;
  notes?: string;
  trackId?: string | null;
}

/** A photo as the archive carries it: the row without the parent it is nested under. */
export interface CultureExportPhoto {
  readonly id: string;
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface CultureExportVisit {
  readonly id: string;
  readonly kind: VisitKind;
  readonly title: string;
  readonly venue: string;
  readonly city: string | null;
  readonly date: string;
  readonly startTime: string | null;
  readonly rating: number | null;
  readonly notes: string;
  readonly price: CulturePrice | null;
  readonly companions: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly photos: readonly CultureExportPhoto[];
}

export interface CultureExportTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string | null;
  readonly album: string | null;
  readonly trackNumber: number | null;
  readonly releaseYear: number | null;
  readonly durationMs: number;
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly importedAt: string;
  readonly playCount: number;
  readonly lastPlayedAt: string | null;
  readonly updatedAt: string;
}

export interface CultureExportEntry {
  readonly id: string;
  readonly artist: string;
  readonly title: string;
  readonly kind: MusicLogKind;
  readonly date: string;
  readonly rating: number | null;
  readonly notes: string;
  readonly trackId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CultureExportItem {
  readonly id: string;
  readonly trackId: string;
  readonly rank: string;
  readonly createdAt: string;
}

export interface CultureExportPlaylist {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: readonly CultureExportItem[];
}

/** The module as one plain JSON value. `version` is read before anything else and any other value is refused. */
export interface CultureExport {
  readonly version: typeof CULTURE_EXPORT_VERSION;
  readonly visits: readonly CultureExportVisit[];
  readonly tracks: readonly CultureExportTrack[];
  readonly entries: readonly CultureExportEntry[];
  readonly playlists: readonly CultureExportPlaylist[];
}

/** What one `importData` wrote, so a caller can report what an archive carried. */
export interface CultureImportSummary {
  readonly visits: number;
  readonly photos: number;
  readonly tracks: number;
  readonly entries: number;
  readonly playlists: number;
  readonly items: number;
}

interface VisitRow {
  id: string;
  profile_id: string;
  kind: string;
  title: string;
  venue: string;
  city: string | null;
  visit_date: string;
  start_time: string | null;
  rating: number | null;
  notes: string;
  price_minor: number | null;
  price_currency: string | null;
  companions: string | null;
  created_at: string;
  updated_at: string;
}

interface PhotoRow {
  id: string;
  visit_id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

interface TrackRow {
  id: string;
  profile_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  track_number: number | null;
  release_year: number | null;
  duration_ms: number;
  file_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  imported_at: string;
  play_count: number;
  last_played_at: string | null;
  updated_at: string;
}

interface EntryRow {
  id: string;
  profile_id: string;
  artist: string;
  title: string;
  kind: string;
  entry_date: string;
  rating: number | null;
  notes: string;
  track_id: string | null;
  created_at: string;
  updated_at: string;
}

interface PlaylistRow {
  id: string;
  profile_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  playlist_id: string;
  track_id: string;
  rank: string;
  created_at: string;
}

const VISIT_COLUMNS =
  "id, profile_id, kind, title, venue, city, visit_date, start_time, rating, notes, " +
  "price_minor, price_currency, companions, created_at, updated_at";

const PHOTO_COLUMNS = "id, visit_id, file_name, mime, size_bytes, sha256, created_at";

const TRACK_COLUMNS =
  "id, profile_id, title, artist, album, track_number, release_year, duration_ms, " +
  "file_name, mime, size_bytes, sha256, imported_at, play_count, last_played_at, updated_at";

const ENTRY_COLUMNS =
  "id, profile_id, artist, title, kind, entry_date, rating, notes, track_id, created_at, updated_at";

const PLAYLIST_COLUMNS = "id, profile_id, name, created_at, updated_at";

const ITEM_COLUMNS = "id, playlist_id, track_id, rank, created_at";

/**
 * The culture corner's whole store: visits with their photos, the listening
 * log, the user's own tracks, and playlists over them.
 *
 * **One store over six tables, because it is one module with one archive
 * entry.** The groups are read together (the period statistics take visits,
 * entries and tracks at once) and they travel together (`exportData` is one
 * versioned value, which is what stage 2 plugs into the profile archive), so
 * splitting them into four stores would mean four constructors per profile and
 * an archive section assembled from four answers. What keeps that from becoming
 * a bag is that each group has its own statement block below and its own
 * section in the tests.
 *
 * **Every statement is scoped by `profile_id`, and a row that carries none is
 * reached through its parent.** `culture_visit_photos` and
 * `culture_playlist_items` are children (the `note_attachments` arrangement,
 * migration 013): a photo is resolved through its visit and an item through its
 * playlist, always in THIS profile, so an id belonging to somebody else's visit
 * is a `CultureNotFoundError` and never a row. `culture_music_entries` DOES
 * carry a profile of its own, but its `track_id` is checked against this
 * profile's live tracks on the way in - an entry pointing at another profile's
 * file would be this store handing main a hash it has no business serving.
 *
 * **A track's delete clears what points at it, deliberately.** `softDeleteTrack`
 * removes the track from every playlist and clears the log links in the same
 * transaction, and neither comes back on `restoreTrack`. This is the one place
 * this module differs from the habit precedent, where a restore brings back
 * every tick, and the difference is the subject: a playlist is a PRESENT-tense
 * arrangement, so re-inserting a track into a list the user has edited since
 * would make the undo of one edit change a different one. A log entry loses
 * only its pointer - its artist, title, date, rating and notes are its own
 * columns and stay exactly as the user typed them.
 *
 * **A soft delete is reversible, and what belongs to the deleted row goes with
 * it**: a deleted visit keeps its photos and a deleted playlist keeps its
 * items, so a restore gives back what was there.
 *
 * `now` is supplied by the caller and validated here - main stamps the clock,
 * the renderer never does.
 *
 * Three parts, in this order: the exported types and bounds (a caller's whole
 * vocabulary), the class over prepared statements, and the module-scope
 * validators, row mappers and archive reader that the class's methods and
 * `importData` share - one definition of what a visit, a track, an entry and a
 * playlist item may be, so the live path and the archive path cannot drift.
 */
export class CultureStore {
  // --- visits ---------------------------------------------------------------
  private readonly insertVisit: Database.Statement;
  private readonly selectVisits: Database.Statement;
  private readonly selectVisitsInRange: Database.Statement;
  private readonly selectVisitById: Database.Statement;
  private readonly updateVisitFields: Database.Statement;
  private readonly markVisitDeleted: Database.Statement;
  private readonly markVisitRestored: Database.Statement;
  // --- visit photos ---------------------------------------------------------
  private readonly insertPhoto: Database.Statement;
  private readonly selectPhotosByVisit: Database.Statement;
  private readonly selectAllPhotos: Database.Statement;
  private readonly selectPhoto: Database.Statement;
  private readonly deletePhoto: Database.Statement;
  // --- tracks ---------------------------------------------------------------
  private readonly insertTrack: Database.Statement;
  private readonly selectTracks: Database.Statement;
  private readonly selectTrackById: Database.Statement;
  private readonly updateTrackFields: Database.Statement;
  private readonly recordTrackPlay: Database.Statement;
  private readonly restoreTrackCounters: Database.Statement;
  private readonly markTrackDeleted: Database.Statement;
  private readonly markTrackRestored: Database.Statement;
  private readonly clearEntryTrackLinks: Database.Statement;
  private readonly deleteItemsOfTrack: Database.Statement;
  // --- listening log --------------------------------------------------------
  private readonly insertEntry: Database.Statement;
  private readonly selectEntries: Database.Statement;
  private readonly selectEntriesInRange: Database.Statement;
  private readonly selectEntryById: Database.Statement;
  private readonly updateEntryFields: Database.Statement;
  private readonly markEntryDeleted: Database.Statement;
  private readonly markEntryRestored: Database.Statement;
  // --- playlists ------------------------------------------------------------
  private readonly insertPlaylist: Database.Statement;
  private readonly selectPlaylists: Database.Statement;
  private readonly selectPlaylistById: Database.Statement;
  private readonly updatePlaylistName: Database.Statement;
  private readonly markPlaylistDeleted: Database.Statement;
  private readonly markPlaylistRestored: Database.Statement;
  private readonly insertItem: Database.Statement;
  private readonly selectItems: Database.Statement;
  private readonly selectAllItems: Database.Statement;
  private readonly selectItem: Database.Statement;
  private readonly maxItemRank: Database.Statement;
  private readonly updateItemRank: Database.Statement;
  private readonly deleteItem: Database.Statement;
  // --- the archive ----------------------------------------------------------
  private readonly deleteVisits: Database.Statement;
  private readonly deleteVisitPhotos: Database.Statement;
  private readonly deleteTracks: Database.Statement;
  private readonly deleteEntries: Database.Statement;
  private readonly deletePlaylists: Database.Statement;
  private readonly deletePlaylistItems: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertVisit = db.prepare(
      `INSERT INTO culture_visits
         (id, profile_id, kind, title, venue, city, visit_date, start_time, rating, notes,
          price_minor, price_currency, companions, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectVisits = db.prepare(
      `SELECT ${VISIT_COLUMNS} FROM culture_visits
        WHERE profile_id = ? AND deleted_at IS NULL
        ORDER BY visit_date, id`,
    );
    // The calendar's read: one profile's live visits inside an inclusive window.
    this.selectVisitsInRange = db.prepare(
      `SELECT ${VISIT_COLUMNS} FROM culture_visits
        WHERE profile_id = ? AND deleted_at IS NULL AND visit_date >= ? AND visit_date <= ?
        ORDER BY visit_date, id`,
    );
    this.selectVisitById = db.prepare(
      `SELECT ${VISIT_COLUMNS} FROM culture_visits
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateVisitFields = db.prepare(
      `UPDATE culture_visits
          SET kind = ?, title = ?, venue = ?, city = ?, visit_date = ?, start_time = ?,
              rating = ?, notes = ?, price_minor = ?, price_currency = ?, companions = ?,
              updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markVisitDeleted = db.prepare(
      `UPDATE culture_visits SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markVisitRestored = db.prepare(
      `UPDATE culture_visits SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );

    this.insertPhoto = db.prepare(
      `INSERT INTO culture_visit_photos
         (id, visit_id, file_name, mime, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectPhotosByVisit = db.prepare(
      `SELECT ${PHOTO_COLUMNS} FROM culture_visit_photos
        WHERE visit_id = ? ORDER BY created_at, id`,
    );
    // The export's read: every photo of every live visit of this profile in ONE
    // query rather than one per visit, grouped by visit for the caller.
    this.selectAllPhotos = db.prepare(
      `SELECT p.id, p.visit_id, p.file_name, p.mime, p.size_bytes, p.sha256, p.created_at
         FROM culture_visit_photos p
         JOIN culture_visits v ON v.id = p.visit_id
        WHERE v.profile_id = ? AND v.deleted_at IS NULL
        ORDER BY p.visit_id, p.created_at, p.id`,
    );
    this.selectPhoto = db.prepare(
      `SELECT ${PHOTO_COLUMNS} FROM culture_visit_photos WHERE id = ? AND visit_id = ?`,
    );
    this.deletePhoto = db.prepare(
      `DELETE FROM culture_visit_photos WHERE id = ? AND visit_id = ?`,
    );

    this.insertTrack = db.prepare(
      `INSERT INTO culture_tracks
         (id, profile_id, title, artist, album, track_number, release_year, duration_ms,
          file_name, mime, size_bytes, sha256, imported_at, play_count, last_played_at,
          updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL)`,
    );
    this.selectTracks = db.prepare(
      `SELECT ${TRACK_COLUMNS} FROM culture_tracks
        WHERE profile_id = ? AND deleted_at IS NULL
        ORDER BY id`,
    );
    this.selectTrackById = db.prepare(
      `SELECT ${TRACK_COLUMNS} FROM culture_tracks
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // The FILE columns are deliberately not here: a track's bytes are what the
    // row IS, and importing a different file is a new track.
    this.updateTrackFields = db.prepare(
      `UPDATE culture_tracks
          SET title = ?, artist = ?, album = ?, track_number = ?, release_year = ?,
              duration_ms = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.recordTrackPlay = db.prepare(
      `UPDATE culture_tracks SET play_count = play_count + 1, last_played_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // The archive's counters, written after the insert that cannot carry them
    // (`insertTrack` starts every track at zero plays).
    this.restoreTrackCounters = db.prepare(
      `UPDATE culture_tracks SET play_count = ?, last_played_at = ?
        WHERE id = ? AND profile_id = ?`,
    );
    this.markTrackDeleted = db.prepare(
      `UPDATE culture_tracks SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markTrackRestored = db.prepare(
      `UPDATE culture_tracks SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    // Both are scoped by the profile even though the id alone would name the
    // rows: an id is unique per table, but a statement that says whose rows it
    // may touch cannot be wrong about that.
    this.clearEntryTrackLinks = db.prepare(
      `UPDATE culture_music_entries SET track_id = NULL, updated_at = ?
        WHERE track_id = ? AND profile_id = ?`,
    );
    this.deleteItemsOfTrack = db.prepare(
      `DELETE FROM culture_playlist_items
        WHERE track_id = ?
          AND playlist_id IN (SELECT id FROM culture_playlists WHERE profile_id = ?)`,
    );

    this.insertEntry = db.prepare(
      `INSERT INTO culture_music_entries
         (id, profile_id, artist, title, kind, entry_date, rating, notes, track_id,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    // A log reads NEWEST first: the last thing listened to is what the reader
    // came for, which is the opposite of the calendar's oldest-first.
    this.selectEntries = db.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM culture_music_entries
        WHERE profile_id = ? AND deleted_at IS NULL
        ORDER BY entry_date DESC, id DESC`,
    );
    this.selectEntriesInRange = db.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM culture_music_entries
        WHERE profile_id = ? AND deleted_at IS NULL AND entry_date >= ? AND entry_date <= ?
        ORDER BY entry_date DESC, id DESC`,
    );
    this.selectEntryById = db.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM culture_music_entries
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateEntryFields = db.prepare(
      `UPDATE culture_music_entries
          SET artist = ?, title = ?, kind = ?, entry_date = ?, rating = ?, notes = ?,
              track_id = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markEntryDeleted = db.prepare(
      `UPDATE culture_music_entries SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markEntryRestored = db.prepare(
      `UPDATE culture_music_entries SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );

    this.insertPlaylist = db.prepare(
      `INSERT INTO culture_playlists (id, profile_id, name, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    );
    this.selectPlaylists = db.prepare(
      `SELECT ${PLAYLIST_COLUMNS} FROM culture_playlists
        WHERE profile_id = ? AND deleted_at IS NULL
        ORDER BY id`,
    );
    this.selectPlaylistById = db.prepare(
      `SELECT ${PLAYLIST_COLUMNS} FROM culture_playlists
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updatePlaylistName = db.prepare(
      `UPDATE culture_playlists SET name = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markPlaylistDeleted = db.prepare(
      `UPDATE culture_playlists SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markPlaylistRestored = db.prepare(
      `UPDATE culture_playlists SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.insertItem = db.prepare(
      `INSERT INTO culture_playlist_items (id, playlist_id, track_id, rank, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.selectItems = db.prepare(
      `SELECT ${ITEM_COLUMNS} FROM culture_playlist_items
        WHERE playlist_id = ? ORDER BY rank, id`,
    );
    this.selectAllItems = db.prepare(
      `SELECT i.id, i.playlist_id, i.track_id, i.rank, i.created_at
         FROM culture_playlist_items i
         JOIN culture_playlists p ON p.id = i.playlist_id
        WHERE p.profile_id = ? AND p.deleted_at IS NULL
        ORDER BY i.playlist_id, i.rank, i.id`,
    );
    this.selectItem = db.prepare(
      `SELECT ${ITEM_COLUMNS} FROM culture_playlist_items WHERE id = ? AND playlist_id = ?`,
    );
    // `max` over the rank TEXT is the rank order itself: ranks are compared as
    // strings everywhere, which is why the alphabet has no upper case.
    this.maxItemRank = db.prepare(
      `SELECT max(rank) AS rank FROM culture_playlist_items WHERE playlist_id = ?`,
    );
    this.updateItemRank = db.prepare(
      `UPDATE culture_playlist_items SET rank = ? WHERE id = ? AND playlist_id = ?`,
    );
    this.deleteItem = db.prepare(
      `DELETE FROM culture_playlist_items WHERE id = ? AND playlist_id = ?`,
    );

    // Children before parents, and never leaning on `ON DELETE CASCADE` to
    // reach a row - `RESTORE_WIPE_TABLES`' own rule. The items and the entries
    // go before the tracks they may name.
    this.deletePlaylistItems = db.prepare(
      `DELETE FROM culture_playlist_items
        WHERE playlist_id IN (SELECT id FROM culture_playlists WHERE profile_id = ?)`,
    );
    this.deletePlaylists = db.prepare(`DELETE FROM culture_playlists WHERE profile_id = ?`);
    this.deleteEntries = db.prepare(`DELETE FROM culture_music_entries WHERE profile_id = ?`);
    this.deleteVisitPhotos = db.prepare(
      `DELETE FROM culture_visit_photos
        WHERE visit_id IN (SELECT id FROM culture_visits WHERE profile_id = ?)`,
    );
    this.deleteVisits = db.prepare(`DELETE FROM culture_visits WHERE profile_id = ?`);
    this.deleteTracks = db.prepare(`DELETE FROM culture_tracks WHERE profile_id = ?`);
  }

  // --- visits ---------------------------------------------------------------

  /** Records a visit and returns the stored row. */
  createVisit(input: CreateVisitInput, now: string): CultureVisit {
    const validNow = validateNow(now);
    const resolved = resolveVisit({
      kind: input.kind,
      title: input.title,
      venue: input.venue,
      city: input.city ?? null,
      date: input.date,
      startTime: input.startTime ?? null,
      rating: input.rating ?? null,
      notes: input.notes ?? "",
      price: input.price ?? null,
      companions: input.companions ?? null,
    });
    const id = uuidv7();

    this.insertVisit.run(
      id, this.profileId, resolved.kind, resolved.title, resolved.venue, resolved.city,
      resolved.date, resolved.startTime, resolved.rating, resolved.notes,
      resolved.price === null ? null : resolved.price.minorUnits,
      resolved.price === null ? null : resolved.price.currency,
      resolved.companions, validNow, validNow,
    );

    return {
      id,
      profileId: this.profileId,
      ...resolved,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /** Applies a partial patch to a live visit. An omitted key is left alone; an explicit `null` clears a nullable field. */
  updateVisit(id: string, fields: UpdateVisitFields, now: string): CultureVisit {
    const validNow = validateNow(now);
    const current = this.requireVisit(id);
    const resolved = resolveVisit({
      kind: fields.kind ?? current.kind,
      title: fields.title ?? current.title,
      venue: fields.venue ?? current.venue,
      city: "city" in fields ? (fields.city ?? null) : current.city,
      date: fields.date ?? current.date,
      startTime: "startTime" in fields ? (fields.startTime ?? null) : current.startTime,
      rating: "rating" in fields ? (fields.rating ?? null) : current.rating,
      notes: fields.notes ?? current.notes,
      price: "price" in fields ? (fields.price ?? null) : current.price,
      companions: "companions" in fields ? (fields.companions ?? null) : current.companions,
    });

    this.updateVisitFields.run(
      resolved.kind, resolved.title, resolved.venue, resolved.city, resolved.date,
      resolved.startTime, resolved.rating, resolved.notes,
      resolved.price === null ? null : resolved.price.minorUnits,
      resolved.price === null ? null : resolved.price.currency,
      resolved.companions, validNow, id, this.profileId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /**
   * This profile's live visits, oldest first (the order a calendar draws them
   * in), or the ones inside `range` when it is given - which is the read a
   * month view and the statistics of a period both make.
   */
  listVisits(range?: CultureDateRange): CultureVisit[] {
    if (range === undefined) {
      return (this.selectVisits.all(this.profileId) as VisitRow[]).map(toVisit);
    }
    const { from, to } = validateRange(range);
    return (this.selectVisitsInRange.all(this.profileId, from, to) as VisitRow[]).map(toVisit);
  }

  /** Soft-deletes a live visit. Its photos stay where they are and come back with the visit - see the class comment. */
  softDeleteVisit(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markVisitDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No live visit "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted visit, with every photo it had. */
  restoreVisit(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markVisitRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No deleted visit "${id}" to restore in this profile.`);
    }
  }

  /**
   * Adds one photo's index row to a live visit. The BYTES never pass through
   * here: main hashes them, writes them to the content-addressed blob store
   * (the same one the note, task and subject attachments use) and hands this
   * only what describes them, which is why every field of `input` is main's
   * answer and never the renderer's claim (SEC-FILE-02).
   */
  addVisitPhoto(visitId: string, input: CulturePhotoInput, now: string): CultureVisitPhoto {
    const validNow = validateNow(now);
    this.requireVisit(visitId);
    const fileName = validateFileName(input.fileName);
    const mime = validateMime(input.mime);
    const sizeBytes = validateSizeBytes(input.sizeBytes, MAX_CULTURE_PHOTO_BYTES, "sizeBytes");
    const sha256 = validateSha256(input.sha256);

    const id = uuidv7();
    this.insertPhoto.run(id, visitId, fileName, mime, sizeBytes, sha256, validNow);
    return { id, visitId, fileName, mime, sizeBytes, sha256, createdAt: validNow };
  }

  /** A live visit's photos, oldest first - the order they were added in. */
  listVisitPhotos(visitId: string): CultureVisitPhoto[] {
    this.requireVisit(visitId);
    return (this.selectPhotosByVisit.all(visitId) as PhotoRow[]).map(toPhoto);
  }

  /**
   * Removes one photo row and RETURNS it. The caller uses the returned `sha256`
   * to decide whether the blob on disk is now orphaned, which is
   * `NoteAttachmentStore.remove`'s arrangement one module over - and the reason
   * this returns the row rather than nothing.
   */
  removeVisitPhoto(visitId: string, photoId: string): CultureVisitPhoto {
    this.requireVisit(visitId);
    const row = this.selectPhoto.get(photoId, visitId) as PhotoRow | undefined;
    if (row === undefined) {
      throw new CultureNotFoundError(`No photo "${photoId}" on visit "${visitId}".`);
    }
    this.deletePhoto.run(photoId, visitId);
    return toPhoto(row);
  }

  // --- the library ----------------------------------------------------------

  /** Imports one audio file's metadata into the library and returns the stored track. */
  createTrack(input: CreateTrackInput, now: string): CultureTrack {
    const validNow = validateNow(now);
    const resolved = resolveTrack({
      title: input.title,
      artist: input.artist ?? null,
      album: input.album ?? null,
      trackNumber: input.trackNumber ?? null,
      releaseYear: input.releaseYear ?? null,
      durationMs: input.durationMs,
      fileName: input.fileName,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
    });
    const id = uuidv7();

    this.insertTrack.run(
      id, this.profileId, resolved.title, resolved.artist, resolved.album, resolved.trackNumber,
      resolved.releaseYear, resolved.durationMs, resolved.fileName, resolved.mime,
      resolved.sizeBytes, resolved.sha256, validNow, validNow,
    );
    return {
      id,
      profileId: this.profileId,
      ...resolved,
      importedAt: validNow,
      playCount: 0,
      lastPlayedAt: null,
      updatedAt: validNow,
    };
  }

  /** Applies a partial patch to a live track's METADATA - see `UpdateTrackFields` for why the file is not in it. */
  updateTrack(id: string, fields: UpdateTrackFields, now: string): CultureTrack {
    const validNow = validateNow(now);
    const current = this.requireTrack(id);
    const resolved = resolveTrack({
      title: fields.title ?? current.title,
      artist: "artist" in fields ? (fields.artist ?? null) : current.artist,
      album: "album" in fields ? (fields.album ?? null) : current.album,
      trackNumber: "trackNumber" in fields ? (fields.trackNumber ?? null) : current.trackNumber,
      releaseYear: "releaseYear" in fields ? (fields.releaseYear ?? null) : current.releaseYear,
      durationMs: fields.durationMs ?? current.durationMs,
      fileName: current.fileName,
      mime: current.mime,
      sizeBytes: current.sizeBytes,
      sha256: current.sha256,
    });

    this.updateTrackFields.run(
      resolved.title, resolved.artist, resolved.album, resolved.trackNumber,
      resolved.releaseYear, resolved.durationMs, validNow, id, this.profileId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /**
   * Every live track in this profile, ordered the way a library is read: artist,
   * then album, then track number, then title - each name by the sr-Latn
   * collator (CLAUDE.md's house rule; the default sort compares UTF-16 code
   * units, which puts `Ljubiša` before `Lola` where a Serbian reader expects the
   * opposite). A missing artist, album or track number groups with the empties,
   * at the TOP: a library sorted the other way would hide the files that still
   * need tagging behind everything that is finished.
   */
  listTracks(): CultureTrack[] {
    return (this.selectTracks.all(this.profileId) as TrackRow[])
      .map(toTrack)
      .sort(compareTracks);
  }

  /**
   * Counts one play of a live track: `play_count` up by one and `last_played_at`
   * stamped. There is deliberately no way to SET a play count - the statistics
   * derive listening time from this pair, so a count written by hand would be a
   * number nobody played.
   */
  recordPlay(id: string, now: string): CultureTrack {
    const validNow = validateNow(now);
    const { changes } = this.recordTrackPlay.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No live track "${id}" to play in this profile.`);
    }
    return this.requireTrack(id);
  }

  /**
   * Deletes a track from the library and, in the same transaction, takes it out
   * of every playlist and clears every log entry's pointer to it - see the class
   * comment for why that is a delete rather than something a restore undoes.
   */
  softDeleteTrack(id: string, now: string): void {
    const validNow = validateNow(now);
    this.db.transaction((): void => {
      const { changes } = this.markTrackDeleted.run(validNow, validNow, id, this.profileId);
      if (changes === 0) {
        throw new CultureNotFoundError(`No live track "${id}" to delete in this profile.`);
      }
      this.clearEntryTrackLinks.run(validNow, id, this.profileId);
      this.deleteItemsOfTrack.run(id, this.profileId);
    })();
  }

  /** Restores a deleted track. Its metadata and play count come back; its playlists and log links do not (see the class comment). */
  restoreTrack(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markTrackRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No deleted track "${id}" to restore in this profile.`);
    }
  }

  // --- the listening log ----------------------------------------------------

  /** Records one listening entry. `trackId` names one of this profile's own live tracks, or nothing. */
  createEntry(input: CreateEntryInput, now: string): CultureMusicEntry {
    const validNow = validateNow(now);
    const trackId = input.trackId ?? null;
    if (trackId !== null) this.requireTrack(trackId);
    const resolved = resolveEntry({
      artist: input.artist,
      title: input.title,
      kind: input.kind,
      date: input.date,
      rating: input.rating ?? null,
      notes: input.notes ?? "",
      trackId,
    });
    const id = uuidv7();

    this.insertEntry.run(
      id, this.profileId, resolved.artist, resolved.title, resolved.kind, resolved.date,
      resolved.rating, resolved.notes, resolved.trackId, validNow, validNow,
    );
    return {
      id,
      profileId: this.profileId,
      ...resolved,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /** Applies a partial patch to a live listening entry, re-checking any track it points at. */
  updateEntry(id: string, fields: UpdateEntryFields, now: string): CultureMusicEntry {
    const validNow = validateNow(now);
    const current = this.requireEntry(id);
    const trackId = "trackId" in fields ? (fields.trackId ?? null) : current.trackId;
    if (trackId !== null) this.requireTrack(trackId);
    const resolved = resolveEntry({
      artist: fields.artist ?? current.artist,
      title: fields.title ?? current.title,
      kind: fields.kind ?? current.kind,
      date: fields.date ?? current.date,
      rating: "rating" in fields ? (fields.rating ?? null) : current.rating,
      notes: fields.notes ?? current.notes,
      trackId,
    });

    this.updateEntryFields.run(
      resolved.artist, resolved.title, resolved.kind, resolved.date, resolved.rating,
      resolved.notes, resolved.trackId, validNow, id, this.profileId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /** This profile's live listening entries, newest first, or the ones inside `range` when it is given. */
  listEntries(range?: CultureDateRange): CultureMusicEntry[] {
    if (range === undefined) {
      return (this.selectEntries.all(this.profileId) as EntryRow[]).map(toEntry);
    }
    const { from, to } = validateRange(range);
    return (this.selectEntriesInRange.all(this.profileId, from, to) as EntryRow[]).map(toEntry);
  }

  softDeleteEntry(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markEntryDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No live entry "${id}" to delete in this profile.`);
    }
  }

  restoreEntry(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markEntryRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No deleted entry "${id}" to restore in this profile.`);
    }
  }

  // --- playlists ------------------------------------------------------------

  createPlaylist(name: string, now: string): CulturePlaylist {
    const validNow = validateNow(now);
    const validName = validateText(name, "name", MAX_CULTURE_PLAYLIST_NAME_LENGTH);
    const id = uuidv7();
    this.insertPlaylist.run(id, this.profileId, validName, validNow, validNow);
    return {
      id,
      profileId: this.profileId,
      name: validName,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  renamePlaylist(id: string, name: string, now: string): CulturePlaylist {
    const validNow = validateNow(now);
    const validName = validateText(name, "name", MAX_CULTURE_PLAYLIST_NAME_LENGTH);
    const current = this.requirePlaylist(id);
    this.updatePlaylistName.run(validName, validNow, id, this.profileId);
    return { ...current, name: validName, updatedAt: validNow };
  }

  /** This profile's live playlists, sr-Latn alphabetical with an id tiebreak (`HabitStore.listActive`'s rule). */
  listPlaylists(): CulturePlaylist[] {
    return (this.selectPlaylists.all(this.profileId) as PlaylistRow[])
      .map(toPlaylist)
      .sort(
        (left, right) =>
          CULTURE_COLLATOR.compare(left.name, right.name) || left.id.localeCompare(right.id),
      );
  }

  /** Soft-deletes a playlist. Its items stay where they are and come back with it - the class comment's rule. */
  softDeletePlaylist(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markPlaylistDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No live playlist "${id}" to delete in this profile.`);
    }
  }

  restorePlaylist(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markPlaylistRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No deleted playlist "${id}" to restore in this profile.`);
    }
  }

  /** A live playlist's items, in the order the user put them in. A track that appears twice appears twice. */
  listPlaylistItems(playlistId: string): CulturePlaylistItem[] {
    this.requirePlaylist(playlistId);
    return (this.selectItems.all(playlistId) as ItemRow[]).map(toItem);
  }

  /**
   * Appends one track to the END of a live playlist. Appending rather than
   * inserting is the whole of the common case ("add this to the list"), and an
   * insert elsewhere is `movePlaylistItem` afterwards - one write, and the rank
   * an appender was given is never wrong for a gap that moved underneath it. The
   * same track may be appended twice; the item, not the track, is the row.
   */
  addPlaylistTrack(playlistId: string, trackId: string, now: string): CulturePlaylistItem {
    const validNow = validateNow(now);
    this.requirePlaylist(playlistId);
    this.requireTrack(trackId);

    const { rank: maxRank } = this.maxItemRank.get(playlistId) as { rank: string | null };
    const rank = rankAfter(maxRank);
    const id = uuidv7();
    this.insertItem.run(id, playlistId, trackId, rank, validNow);
    return { id, playlistId, trackId, rank, createdAt: validNow };
  }

  /**
   * Moves one item between two live neighbours of its own playlist - either may
   * be null at an end of the list, and the pair has to describe a gap (the same
   * row twice, or the two the wrong way round, is `TaskStore.reorder`'s refusal
   * one module over). The read of the neighbours and the write that depends on
   * them are one transaction: a concurrent move must not slip between them.
   */
  movePlaylistItem(
    playlistId: string,
    itemId: string,
    beforeId: string | null,
    afterId: string | null,
    now: string,
  ): CulturePlaylistItem {
    // `now` is validated and not stored: an item has no `updated_at` of its own
    // (it is a slot in a list, not a record with a history), and a caller that
    // sends a malformed clock has made the same mistake here as everywhere else.
    validateNow(now);
    this.requirePlaylist(playlistId);
    const current = this.requireItem(playlistId, itemId);
    if (beforeId === itemId || afterId === itemId) {
      throw new CultureValidationError("An item cannot be ordered against itself.");
    }

    return this.db.transaction((): CulturePlaylistItem => {
      const rankOf = (neighbourId: string): string => {
        const row = this.selectItem.get(neighbourId, playlistId) as ItemRow | undefined;
        if (row === undefined) {
          throw new CultureNotFoundError(
            `No item "${neighbourId}" to order against in playlist "${playlistId}".`,
          );
        }
        return row.rank;
      };
      const rank = rankBetween(
        beforeId === null ? null : rankOf(beforeId),
        afterId === null ? null : rankOf(afterId),
      );
      if (rank === null) {
        throw new CultureValidationError(
          '"beforeId" and "afterId" do not describe a gap in this playlist.',
        );
      }
      this.updateItemRank.run(rank, itemId, playlistId);
      return { ...current, rank };
    })();
  }

  /**
   * Removes ONE appearance of a track from a playlist and returns the item row.
   * Addressed by the ITEM rather than by the track, because a playlist may hold
   * the same track twice: "remove this one" is a question only the item answers.
   */
  removePlaylistItem(playlistId: string, itemId: string): CulturePlaylistItem {
    this.requirePlaylist(playlistId);
    const current = this.requireItem(playlistId, itemId);
    this.deleteItem.run(itemId, playlistId);
    return current;
  }

  // --- the archive ----------------------------------------------------------

  /**
   * The module as one versioned plain JSON value: every live row, with each
   * visit's photos nested inside it and each playlist's items inside it.
   *
   * **Deleted rows are deliberately NOT carried.** This value is the profile
   * archive's section, and the archive holds what the user can see - the rule
   * every other module's section keeps (no archive row carries `deleted_at` at
   * all). A soft delete is a local, reversible act, and what it hid is not part
   * of the picture somebody exports. `importData` is the other half of the same
   * rule: it replaces the whole module, so an import drops whatever was deleted
   * here too.
   *
   * `profileId` is not in the value either. Which profile this is, is decided by
   * the store that imports it, and a section that named a profile could be
   * pasted into another one.
   *
   * **The order is TOTAL, so the value is canonical**: every array this returns
   * is ordered by a key the data itself carries (a date and an id, a rank and an
   * id, or the id alone), never by whatever order SQLite happened to emit rows
   * in. Two exports of the same unchanged profile are therefore the same JSON,
   * which is what makes an archive diffable and what the round-trip test
   * asserts; the playlist items keep RANK order, because that order is data.
   */
  exportData(): CultureExport {
    const photosByVisit = new Map<string, CultureExportPhoto[]>();
    for (const row of this.selectAllPhotos.all(this.profileId) as PhotoRow[]) {
      const list = photosByVisit.get(row.visit_id) ?? [];
      list.push(toExportPhoto(row));
      photosByVisit.set(row.visit_id, list);
    }

    const itemsByPlaylist = new Map<string, CultureExportItem[]>();
    for (const row of this.selectAllItems.all(this.profileId) as ItemRow[]) {
      const list = itemsByPlaylist.get(row.playlist_id) ?? [];
      list.push({ id: row.id, trackId: row.track_id, rank: row.rank, createdAt: row.created_at });
      itemsByPlaylist.set(row.playlist_id, list);
    }

    return {
      version: CULTURE_EXPORT_VERSION,
      visits: (this.selectVisits.all(this.profileId) as VisitRow[]).map((row) => {
        const visit = toVisit(row);
        return {
          id: visit.id,
          kind: visit.kind,
          title: visit.title,
          venue: visit.venue,
          city: visit.city,
          date: visit.date,
          startTime: visit.startTime,
          rating: visit.rating,
          notes: visit.notes,
          price: visit.price,
          companions: visit.companions,
          createdAt: visit.createdAt,
          updatedAt: visit.updatedAt,
          photos: photosByVisit.get(visit.id) ?? [],
        };
      }),
      tracks: (this.selectTracks.all(this.profileId) as TrackRow[]).map((row) => {
        const track = toTrack(row);
        return {
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          trackNumber: track.trackNumber,
          releaseYear: track.releaseYear,
          durationMs: track.durationMs,
          fileName: track.fileName,
          mime: track.mime,
          sizeBytes: track.sizeBytes,
          sha256: track.sha256,
          importedAt: track.importedAt,
          playCount: track.playCount,
          lastPlayedAt: track.lastPlayedAt,
          updatedAt: track.updatedAt,
        };
      }),
      entries: (this.selectEntries.all(this.profileId) as EntryRow[]).map((row) => {
        const entry = toEntry(row);
        return {
          id: entry.id,
          artist: entry.artist,
          title: entry.title,
          kind: entry.kind,
          date: entry.date,
          rating: entry.rating,
          notes: entry.notes,
          trackId: entry.trackId,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        };
      }),
      playlists: (this.selectPlaylists.all(this.profileId) as PlaylistRow[]).map((row) => {
        const playlist = toPlaylist(row);
        return {
          id: playlist.id,
          name: playlist.name,
          createdAt: playlist.createdAt,
          updatedAt: playlist.updatedAt,
          items: itemsByPlaylist.get(playlist.id) ?? [],
        };
      }),
    };
  }

  /**
   * Replaces this profile's whole culture corner with an exported value, after
   * validating ALL of it: the version, every field of every row, every id, and
   * every reference BETWEEN rows (a log entry or a playlist item that names a
   * track the archive does not carry is refused, exactly as the archive parser
   * reference-checks the tasks an edge names). Nothing is written until the
   * whole value has passed, so a section that fails anywhere leaves the profile
   * exactly as it was - the only behaviour an archive import can have and still
   * be safe to retry.
   *
   * **The archive's row ids are PRESERVED, never re-minted** (ADR-023 §1's rule:
   * other rows' ids live inside the data they describe, so re-minting them would
   * mean rewriting references that have nothing to do with this store). Every id
   * is a global primary key, so an import lands in a profile that does not
   * already hold them - the profile the archive came from, or a fresh install.
   * Importing a copy of one profile's culture beside its own source is refused
   * by the primary keys: loudly, inside the transaction, with both profiles left
   * exactly as they were. `restoreStore.test.ts` pins the same rule for the
   * profile archive itself.
   */
  importData(value: unknown): CultureImportSummary {
    const parsed = parseCultureExport(value);

    return this.db.transaction((): CultureImportSummary => {
      this.deletePlaylistItems.run(this.profileId);
      this.deletePlaylists.run(this.profileId);
      this.deleteEntries.run(this.profileId);
      this.deleteVisitPhotos.run(this.profileId);
      this.deleteVisits.run(this.profileId);
      this.deleteTracks.run(this.profileId);

      for (const visit of parsed.visits) {
        this.insertVisit.run(
          visit.id, this.profileId, visit.kind, visit.title, visit.venue, visit.city,
          visit.date, visit.startTime, visit.rating, visit.notes,
          visit.price === null ? null : visit.price.minorUnits,
          visit.price === null ? null : visit.price.currency,
          visit.companions, visit.createdAt, visit.updatedAt,
        );
        for (const photo of visit.photos) {
          this.insertPhoto.run(
            photo.id, visit.id, photo.fileName, photo.mime, photo.sizeBytes, photo.sha256,
            photo.createdAt,
          );
        }
      }
      for (const track of parsed.tracks) {
        this.insertTrack.run(
          track.id, this.profileId, track.title, track.artist, track.album, track.trackNumber,
          track.releaseYear, track.durationMs, track.fileName, track.mime, track.sizeBytes,
          track.sha256, track.importedAt, track.updatedAt,
        );
        // Plays and the last play are facts the archive carries and the insert's
        // own defaults would flatten, so they are written straight after the row.
        if (track.playCount > 0 || track.lastPlayedAt !== null) {
          this.restoreTrackCounters.run(
            track.playCount, track.lastPlayedAt, track.id, this.profileId,
          );
        }
      }
      for (const entry of parsed.entries) {
        this.insertEntry.run(
          entry.id, this.profileId, entry.artist, entry.title, entry.kind, entry.date,
          entry.rating, entry.notes, entry.trackId, entry.createdAt, entry.updatedAt,
        );
      }
      for (const playlist of parsed.playlists) {
        this.insertPlaylist.run(
          playlist.id, this.profileId, playlist.name, playlist.createdAt, playlist.updatedAt,
        );
        for (const item of playlist.items) {
          this.insertItem.run(item.id, playlist.id, item.trackId, item.rank, item.createdAt);
        }
      }

      return {
        visits: parsed.visits.length,
        photos: parsed.visits.reduce((sum, visit) => sum + visit.photos.length, 0),
        tracks: parsed.tracks.length,
        entries: parsed.entries.length,
        playlists: parsed.playlists.length,
        items: parsed.playlists.reduce((sum, playlist) => sum + playlist.items.length, 0),
      };
    })();
  }

  // --- the gates ------------------------------------------------------------

  /** Reads a live visit in this profile or throws - the gate every photo statement runs first. */
  private requireVisit(id: string): CultureVisit {
    const row = this.selectVisitById.get(id, this.profileId) as VisitRow | undefined;
    if (row === undefined) {
      throw new CultureNotFoundError(`No live visit "${id}" in this profile.`);
    }
    return toVisit(row);
  }

  /** Reads a live track in this profile or throws - the gate a log entry's and a playlist item's `trackId` both pass. */
  private requireTrack(id: string): CultureTrack {
    const row = this.selectTrackById.get(id, this.profileId) as TrackRow | undefined;
    if (row === undefined) {
      throw new CultureNotFoundError(`No live track "${id}" in this profile.`);
    }
    return toTrack(row);
  }

  private requireEntry(id: string): CultureMusicEntry {
    const row = this.selectEntryById.get(id, this.profileId) as EntryRow | undefined;
    if (row === undefined) {
      throw new CultureNotFoundError(`No live entry "${id}" in this profile.`);
    }
    return toEntry(row);
  }

  private requirePlaylist(id: string): CulturePlaylist {
    const row = this.selectPlaylistById.get(id, this.profileId) as PlaylistRow | undefined;
    if (row === undefined) {
      throw new CultureNotFoundError(`No live playlist "${id}" in this profile.`);
    }
    return toPlaylist(row);
  }

  private requireItem(playlistId: string, itemId: string): CulturePlaylistItem {
    const row = this.selectItem.get(itemId, playlistId) as ItemRow | undefined;
    if (row === undefined) {
      throw new CultureNotFoundError(`No item "${itemId}" in playlist "${playlistId}".`);
    }
    return toItem(row);
  }
}

function toVisit(row: VisitRow): CultureVisit {
  return {
    id: row.id,
    profileId: row.profile_id,
    kind: row.kind as VisitKind,
    title: row.title,
    venue: row.venue,
    city: row.city,
    date: row.visit_date,
    startTime: row.start_time,
    rating: row.rating,
    notes: row.notes,
    price:
      row.price_minor === null || row.price_currency === null
        ? null
        : { minorUnits: row.price_minor, currency: row.price_currency },
    companions: row.companions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPhoto(row: PhotoRow): CultureVisitPhoto {
  return {
    id: row.id,
    visitId: row.visit_id,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

function toExportPhoto(row: PhotoRow): CultureExportPhoto {
  return {
    id: row.id,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

function toTrack(row: TrackRow): CultureTrack {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    trackNumber: row.track_number,
    releaseYear: row.release_year,
    durationMs: row.duration_ms,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    importedAt: row.imported_at,
    playCount: row.play_count,
    lastPlayedAt: row.last_played_at,
    updatedAt: row.updated_at,
  };
}

function toEntry(row: EntryRow): CultureMusicEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    artist: row.artist,
    title: row.title,
    kind: row.kind as MusicLogKind,
    date: row.entry_date,
    rating: row.rating,
    notes: row.notes,
    trackId: row.track_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPlaylist(row: PlaylistRow): CulturePlaylist {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toItem(row: ItemRow): CulturePlaylistItem {
  // A stored rank that is not a rank is corruption, never input to coerce: the
  // only ways it can happen are a hand-edited file and a bad restore, and a
  // playlist ordered by a string that is not a rank is ordered by nothing.
  if (!isRank(row.rank)) {
    throw new CultureValidationError(
      `Playlist item "${row.id}" carries a stored rank that is not a rank.`,
    );
  }
  return {
    id: row.id,
    playlistId: row.playlist_id,
    trackId: row.track_id,
    rank: row.rank,
    createdAt: row.created_at,
  };
}

/** The library's order: artist, album, track number, title, id - `listTracks`' contract in one place, so two reads of the same library cannot disagree. */
function compareTracks(left: CultureTrack, right: CultureTrack): number {
  return (
    CULTURE_COLLATOR.compare(left.artist ?? "", right.artist ?? "") ||
    CULTURE_COLLATOR.compare(left.album ?? "", right.album ?? "") ||
    (left.trackNumber ?? 0) - (right.trackNumber ?? 0) ||
    CULTURE_COLLATOR.compare(left.title, right.title) ||
    left.id.localeCompare(right.id)
  );
}

/** The visit's own fields, minus the ones the row rather than the caller decides. */
type ResolvedVisit = Omit<CultureVisit, "id" | "profileId" | "createdAt" | "updatedAt">;

/** The track's own fields, minus the ones the row rather than the caller decides. */
type ResolvedTrack = Omit<
  CultureTrack,
  "id" | "profileId" | "importedAt" | "playCount" | "lastPlayedAt" | "updatedAt"
>;

/** The entry's own fields, minus the ones the row rather than the caller decides. */
type ResolvedEntry = Omit<CultureMusicEntry, "id" | "profileId" | "createdAt" | "updatedAt">;

/**
 * Validates and resolves a whole visit - the ONE place every refusal lives, so
 * `createVisit`, `updateVisit` and `importData` cannot drift on what a visit is
 * allowed to be.
 */
function resolveVisit(fields: ResolvedVisit): ResolvedVisit {
  return {
    kind: validateVisitKind(fields.kind),
    title: validateText(fields.title, "title", MAX_CULTURE_TITLE_LENGTH),
    venue: validateText(fields.venue, "venue", MAX_CULTURE_VENUE_LENGTH),
    city: validateOptionalText(fields.city, "city", MAX_CULTURE_CITY_LENGTH),
    date: validateDay(fields.date, "date"),
    startTime: validateStartTime(fields.startTime),
    rating: validateRating(fields.rating),
    notes: validateNotes(fields.notes),
    price: validatePrice(fields.price),
    companions: validateOptionalText(
      fields.companions,
      "companions",
      MAX_CULTURE_COMPANIONS_LENGTH,
    ),
  };
}

function resolveTrack(fields: ResolvedTrack): ResolvedTrack {
  return {
    title: validateText(fields.title, "title", MAX_CULTURE_TITLE_LENGTH),
    artist: validateOptionalText(fields.artist, "artist", MAX_CULTURE_NAME_LENGTH),
    album: validateOptionalText(fields.album, "album", MAX_CULTURE_NAME_LENGTH),
    trackNumber: validateTrackNumber(fields.trackNumber),
    releaseYear: validateYear(fields.releaseYear),
    durationMs: validateDuration(fields.durationMs),
    fileName: validateFileName(fields.fileName),
    mime: validateAudioMime(fields.mime),
    sizeBytes: validateSizeBytes(fields.sizeBytes, MAX_CULTURE_TRACK_BYTES, "sizeBytes"),
    sha256: validateSha256(fields.sha256),
  };
}

function resolveEntry(fields: ResolvedEntry): ResolvedEntry {
  return {
    artist: validateText(fields.artist, "artist", MAX_CULTURE_NAME_LENGTH),
    title: validateText(fields.title, "title", MAX_CULTURE_TITLE_LENGTH),
    kind: validateMusicLogKind(fields.kind),
    date: validateDay(fields.date, "date"),
    rating: validateRating(fields.rating),
    notes: validateNotes(fields.notes),
    trackId: fields.trackId,
  };
}

function validateVisitKind(value: VisitKind): VisitKind {
  if (!isVisitKind(value)) {
    throw new CultureValidationError(`"kind" is not one of the visit kinds.`);
  }
  return value;
}

function validateMusicLogKind(value: MusicLogKind): MusicLogKind {
  if (!isMusicLogKind(value)) {
    throw new CultureValidationError(`"kind" is not one of the listening kinds.`);
  }
  return value;
}

/**
 * A required text: trimmed, inner whitespace collapsed, and refused rather than
 * truncated when it is empty or past its bound. Collapsing is what makes one
 * venue typed with a double space the same string as the same name typed with
 * one - and it is the same fold `summarizeCulture` counts by, so a stored name
 * and a counted name cannot disagree.
 */
function validateText(value: string, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new CultureValidationError(`"${field}" must be a string.`);
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new CultureValidationError(`"${field}" must be 1-${max} characters after trimming.`);
  }
  return trimmed;
}

/**
 * An optional text. Absent, empty and whitespace-only all collapse to null -
 * one spelling of "not said" - and an over-long one is refused rather than
 * truncated, because a name quietly cut in half is a name the user did not
 * write.
 */
function validateOptionalText(value: string | null, field: string, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new CultureValidationError(`"${field}" must be a string or null.`);
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new CultureValidationError(`"${field}" must be at most ${max} characters after trimming.`);
  }
  return trimmed;
}

/**
 * A note is stored VERBATIM - leading spaces and line breaks included - because
 * it is prose the user wrote and this store has no business reformatting it.
 * The length is the one rule, counted in characters rather than bytes, the
 * measure `MAX_HABIT_NAME_LENGTH` uses.
 */
function validateNotes(value: string): string {
  if (typeof value !== "string") {
    throw new CultureValidationError(`"notes" must be a string.`);
  }
  if (value.length > MAX_CULTURE_NOTES_LENGTH) {
    throw new CultureValidationError(
      `"notes" must be at most ${MAX_CULTURE_NOTES_LENGTH} characters.`,
    );
  }
  return value;
}

function validateRating(value: number | null): number | null {
  if (value === null) return null;
  if (!isCultureRating(value)) {
    throw new CultureValidationError(
      `"rating" must be a whole number between ${MIN_CULTURE_RATING} and ${MAX_CULTURE_RATING}.`,
    );
  }
  return value;
}

/**
 * A price is an amount AND its currency, or neither. Half a price is refused
 * here rather than repaired by filling in the other half, because only the
 * caller knows which of the two they meant to say - the `habits.unit` rule
 * (migration 055) applied to money.
 */
function validatePrice(value: CulturePrice | null): CulturePrice | null {
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    !Number.isSafeInteger(value.minorUnits) ||
    value.minorUnits < 0
  ) {
    throw new CultureValidationError(
      '"price.minorUnits" must be a non-negative whole number of minor units.',
    );
  }
  if (!isCurrencyCode(value.currency)) {
    throw new CultureValidationError(
      '"price.currency" must be a three-letter upper-case ISO-4217 code.',
    );
  }
  return { minorUnits: value.minorUnits, currency: value.currency };
}

function validateTrackNumber(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > MAX_CULTURE_TRACK_NUMBER) {
    throw new CultureValidationError(
      `"trackNumber" must be a whole number between 1 and ${MAX_CULTURE_TRACK_NUMBER}.`,
    );
  }
  return value;
}

/** A four-digit year, the shape a release year has - `0` is the ID3 parser's "unknown" and belongs in the null. */
function validateYear(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < MIN_CULTURE_YEAR || value > MAX_CULTURE_YEAR) {
    throw new CultureValidationError(
      `"releaseYear" must be a whole number between ${MIN_CULTURE_YEAR} and ${MAX_CULTURE_YEAR}.`,
    );
  }
  return value;
}

function validateDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CULTURE_DURATION_MS) {
    throw new CultureValidationError(
      `"durationMs" must be a whole number of milliseconds between 0 and ${MAX_CULTURE_DURATION_MS}.`,
    );
  }
  return value;
}

/** The five audio formats and nothing else: a track row holding a PDF would be a row the player cannot open. */
function validateAudioMime(value: string): string {
  if (typeof value !== "string" || !isCultureAudioMime(value)) {
    throw new CultureValidationError('"mime" is not one of the audio formats this library holds.');
  }
  return value;
}

function validateFileName(value: string): string {
  if (typeof value !== "string") {
    throw new CultureValidationError(`"fileName" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CultureValidationError("A file name must not be empty.");
  }
  if (trimmed.length > MAX_FILE_NAME_LENGTH) {
    throw new CultureValidationError(
      `A file name must not exceed ${MAX_FILE_NAME_LENGTH} characters after trimming.`,
    );
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new CultureValidationError("A file name must not contain path separators.");
  }
  return trimmed;
}

function validateMime(value: string): string {
  if (typeof value !== "string" || value.length > MAX_MIME_LENGTH || !MIME_PATTERN.test(value)) {
    throw new CultureValidationError(
      `"mime" must be a valid MIME type of at most ${MAX_MIME_LENGTH} characters.`,
    );
  }
  return value;
}

function validateSizeBytes(value: number, max: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new CultureValidationError(
      `"${field}" must be a positive integer of at most ${max} bytes.`,
    );
  }
  return value;
}

function validateSha256(value: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new CultureValidationError('"sha256" must be a 64-character lowercase hex string.');
  }
  return value;
}

function validateStartTime(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !HH_MM.test(value)) {
    throw new CultureValidationError(`"startTime" must be a wall-clock HH:MM.`);
  }
  return value;
}

function validateDay(value: string, field: string): string {
  if (typeof value !== "string" || !isBareDate(value)) {
    throw new CultureValidationError(`"${field}" must be a real bare date (YYYY-MM-DD).`);
  }
  return value;
}

function validateRange(range: CultureDateRange): CultureDateRange {
  const from = validateDay(range.from, "from");
  const to = validateDay(range.to, "to");
  if (from > to) {
    throw new CultureValidationError(`"from" must not be after "to".`);
  }
  return { from, to };
}

function validateNow(value: string): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new CultureValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

/**
 * The keys each exported row carries, spelled out rather than derived from a
 * type. `importData` refuses a row with a key this version does not define
 * (`habitSchedule.ts`'s exact-keys rule): a value carrying an extra key was not
 * produced by this version, and reading it as if it were is how an archive
 * written by another build is silently misinterpreted. A shape change is a
 * version bump, so there is nothing legitimate on the other side of this rule.
 */
const VISIT_KEYS = [
  "id", "kind", "title", "venue", "city", "date", "startTime", "rating", "notes", "price",
  "companions", "createdAt", "updatedAt", "photos",
] as const;

const PHOTO_KEYS = ["id", "fileName", "mime", "sizeBytes", "sha256", "createdAt"] as const;

const TRACK_KEYS = [
  "id", "title", "artist", "album", "trackNumber", "releaseYear", "durationMs", "fileName",
  "mime", "sizeBytes", "sha256", "importedAt", "playCount", "lastPlayedAt", "updatedAt",
] as const;

const ENTRY_KEYS = [
  "id", "artist", "title", "kind", "date", "rating", "notes", "trackId", "createdAt", "updatedAt",
] as const;

const PLAYLIST_KEYS = ["id", "name", "createdAt", "updatedAt", "items"] as const;

const ITEM_KEYS = ["id", "trackId", "rank", "createdAt"] as const;

const PRICE_KEYS = ["minorUnits", "currency"] as const;

const EXPORT_KEYS = ["version", "visits", "tracks", "entries", "playlists"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One exported row, checked for being a record with EXACTLY `keys` - no extras,
 * none missing - and handed back for the per-field validators below. Every
 * refusal names the row it is about: an archive section is read by whoever is
 * restoring it, and `"rating" is out of range` says nothing about which of four
 * hundred rows was refused.
 */
function exportRow(
  value: unknown,
  keys: readonly string[],
  where: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CultureValidationError(`${where} must be an object.`);
  }
  const own = Object.keys(value);
  const unknown = own.filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !own.includes(key));
  if (unknown.length > 0) {
    throw new CultureValidationError(
      `${where} carries ${unknown.map((key) => `"${key}"`).join(", ")}, which version ${CULTURE_EXPORT_VERSION} does not define.`,
    );
  }
  if (missing.length > 0) {
    throw new CultureValidationError(
      `${where} is missing ${missing.map((key) => `"${key}"`).join(", ")}.`,
    );
  }
  return value;
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new CultureValidationError(`${where} must be an array.`);
  }
  return value as unknown[];
}

function asString(value: unknown, where: string): string {
  if (typeof value !== "string") {
    throw new CultureValidationError(`${where} must be a string.`);
  }
  return value;
}

function asNullableString(value: unknown, where: string): string | null {
  return value === null ? null : asString(value, where);
}

function asNumber(value: unknown, where: string): number {
  if (typeof value !== "number") {
    throw new CultureValidationError(`${where} must be a number.`);
  }
  return value;
}

function asNullableNumber(value: unknown, where: string): number | null {
  return value === null ? null : asNumber(value, where);
}

/** An id as the archive carries it: non-empty and under the one bound every identifier in this product lives under (`@nexus/core`'s `MAX_ID_LENGTH`). */
function asId(value: unknown, where: string): string {
  const id = asString(value, where);
  if (id.length === 0 || id.length > MAX_ID_LENGTH) {
    throw new CultureValidationError(
      `${where} must be a non-empty id of at most ${MAX_ID_LENGTH} characters.`,
    );
  }
  return id;
}

function asTimestamp(value: unknown, where: string): string {
  const timestamp = asString(value, where);
  if (!isDateTime(timestamp)) {
    throw new CultureValidationError(`${where} must be an ISO-8601 date-time.`);
  }
  return timestamp;
}

function asNullableTimestamp(value: unknown, where: string): string | null {
  return value === null ? null : asTimestamp(value, where);
}

function asPrice(value: unknown, where: string): CulturePrice | null {
  if (value === null) return null;
  const row = exportRow(value, PRICE_KEYS, where);
  return validatePrice({
    minorUnits: asNumber(row["minorUnits"], `${where}.minorUnits`),
    currency: asString(row["currency"], `${where}.currency`),
  });
}

/**
 * Refuses two rows of one collection with the same id. The schema would refuse
 * them too (a primary key is a primary key), but only AFTER the transaction had
 * begun, and the promise of `importData` is that a value is either wholly good
 * or wholly refused - so the check belongs in the validation pass, where the
 * failure can name the second row.
 */
function assertUniqueIds(rows: readonly { readonly id: string }[], what: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new CultureValidationError(`${what} carries the id "${row.id}" twice.`);
    }
    seen.add(row.id);
  }
}

function parseExportPhoto(value: unknown, where: string): CultureExportPhoto {
  const row = exportRow(value, PHOTO_KEYS, where);
  return {
    id: asId(row["id"], `${where}.id`),
    fileName: validateFileName(asString(row["fileName"], `${where}.fileName`)),
    mime: validateMime(asString(row["mime"], `${where}.mime`)),
    sizeBytes: validateSizeBytes(
      asNumber(row["sizeBytes"], `${where}.sizeBytes`),
      MAX_CULTURE_PHOTO_BYTES,
      `${where}.sizeBytes`,
    ),
    sha256: validateSha256(asString(row["sha256"], `${where}.sha256`)),
    createdAt: asTimestamp(row["createdAt"], `${where}.createdAt`),
  };
}

function parseExportVisit(value: unknown, where: string): CultureExportVisit {
  const row = exportRow(value, VISIT_KEYS, where);
  const resolved = resolveVisit({
    kind: asString(row["kind"], `${where}.kind`) as VisitKind,
    title: asString(row["title"], `${where}.title`),
    venue: asString(row["venue"], `${where}.venue`),
    city: asNullableString(row["city"], `${where}.city`),
    date: asString(row["date"], `${where}.date`),
    startTime: asNullableString(row["startTime"], `${where}.startTime`),
    rating: asNullableNumber(row["rating"], `${where}.rating`),
    notes: asString(row["notes"], `${where}.notes`),
    price: asPrice(row["price"], `${where}.price`),
    companions: asNullableString(row["companions"], `${where}.companions`),
  });
  return {
    id: asId(row["id"], `${where}.id`),
    ...resolved,
    createdAt: asTimestamp(row["createdAt"], `${where}.createdAt`),
    updatedAt: asTimestamp(row["updatedAt"], `${where}.updatedAt`),
    photos: asArray(row["photos"], `${where}.photos`).map((photo, index) =>
      parseExportPhoto(photo, `${where}.photos[${index}]`),
    ),
  };
}

function parseExportTrack(value: unknown, where: string): CultureExportTrack {
  const row = exportRow(value, TRACK_KEYS, where);
  const resolved = resolveTrack({
    title: asString(row["title"], `${where}.title`),
    artist: asNullableString(row["artist"], `${where}.artist`),
    album: asNullableString(row["album"], `${where}.album`),
    trackNumber: asNullableNumber(row["trackNumber"], `${where}.trackNumber`),
    releaseYear: asNullableNumber(row["releaseYear"], `${where}.releaseYear`),
    durationMs: asNumber(row["durationMs"], `${where}.durationMs`),
    fileName: asString(row["fileName"], `${where}.fileName`),
    mime: asString(row["mime"], `${where}.mime`),
    sizeBytes: asNumber(row["sizeBytes"], `${where}.sizeBytes`),
    sha256: asString(row["sha256"], `${where}.sha256`),
  });
  const playCount = asNumber(row["playCount"], `${where}.playCount`);
  if (!Number.isInteger(playCount) || playCount < 0 || playCount > MAX_CULTURE_PLAY_COUNT) {
    throw new CultureValidationError(
      `${where}.playCount must be a whole number between 0 and ${MAX_CULTURE_PLAY_COUNT}.`,
    );
  }
  return {
    id: asId(row["id"], `${where}.id`),
    ...resolved,
    importedAt: asTimestamp(row["importedAt"], `${where}.importedAt`),
    playCount,
    lastPlayedAt: asNullableTimestamp(row["lastPlayedAt"], `${where}.lastPlayedAt`),
    updatedAt: asTimestamp(row["updatedAt"], `${where}.updatedAt`),
  };
}

function parseExportEntry(
  value: unknown,
  where: string,
  trackIds: ReadonlySet<string>,
): CultureExportEntry {
  const row = exportRow(value, ENTRY_KEYS, where);
  const resolved = resolveEntry({
    artist: asString(row["artist"], `${where}.artist`),
    title: asString(row["title"], `${where}.title`),
    kind: asString(row["kind"], `${where}.kind`) as MusicLogKind,
    date: asString(row["date"], `${where}.date`),
    rating: asNullableNumber(row["rating"], `${where}.rating`),
    notes: asString(row["notes"], `${where}.notes`),
    trackId: asNullableString(row["trackId"], `${where}.trackId`),
  });
  // The reference is checked against the ARCHIVE's own tracks, the rule the
  // archive parser applies to a task dependency's two ends: a value naming
  // something it does not carry describes a link the import cannot make.
  if (resolved.trackId !== null && !trackIds.has(resolved.trackId)) {
    throw new CultureValidationError(
      `${where}.trackId names the track "${resolved.trackId}", which this value does not carry.`,
    );
  }
  return {
    id: asId(row["id"], `${where}.id`),
    ...resolved,
    createdAt: asTimestamp(row["createdAt"], `${where}.createdAt`),
    updatedAt: asTimestamp(row["updatedAt"], `${where}.updatedAt`),
  };
}

function parseExportPlaylist(
  value: unknown,
  where: string,
  trackIds: ReadonlySet<string>,
): CultureExportPlaylist {
  const row = exportRow(value, PLAYLIST_KEYS, where);
  const items = asArray(row["items"], `${where}.items`).map((item, index) => {
    const itemWhere = `${where}.items[${index}]`;
    const fields = exportRow(item, ITEM_KEYS, itemWhere);
    const trackId = asId(fields["trackId"], `${itemWhere}.trackId`);
    if (!trackIds.has(trackId)) {
      throw new CultureValidationError(
        `${itemWhere}.trackId names the track "${trackId}", which this value does not carry.`,
      );
    }
    const rank = asString(fields["rank"], `${itemWhere}.rank`);
    if (!isRank(rank)) {
      throw new CultureValidationError(`${itemWhere}.rank is not a rank.`);
    }
    return {
      id: asId(fields["id"], `${itemWhere}.id`),
      trackId,
      rank,
      createdAt: asTimestamp(fields["createdAt"], `${itemWhere}.createdAt`),
    };
  });
  return {
    id: asId(row["id"], `${where}.id`),
    name: validateText(
      asString(row["name"], `${where}.name`),
      "name",
      MAX_CULTURE_PLAYLIST_NAME_LENGTH,
    ),
    createdAt: asTimestamp(row["createdAt"], `${where}.createdAt`),
    updatedAt: asTimestamp(row["updatedAt"], `${where}.updatedAt`),
    items,
  };
}

/**
 * The archive reader: validates a whole exported value and returns it in the
 * form `importData` writes. Nothing here touches the database, which is what
 * makes "validate the whole value, then write" a property of the code rather
 * than a habit - there is no statement in this function to call.
 */
function parseCultureExport(value: unknown): CultureExport {
  const row = exportRow(value, EXPORT_KEYS, "A culture export");
  if (row["version"] !== CULTURE_EXPORT_VERSION) {
    throw new CultureValidationError(
      `A culture export must carry version ${CULTURE_EXPORT_VERSION}; this value says ` +
        `${JSON.stringify(row["version"])}.`,
    );
  }

  const tracks = asArray(row["tracks"], "tracks").map((track, index) =>
    parseExportTrack(track, `tracks[${index}]`),
  );
  assertUniqueIds(tracks, "The export's tracks");
  const trackIds = new Set(tracks.map((track) => track.id));

  const visits = asArray(row["visits"], "visits").map((visit, index) =>
    parseExportVisit(visit, `visits[${index}]`),
  );
  assertUniqueIds(visits, "The export's visits");
  // Photos are one table, so their ids have to be unique across the WHOLE
  // export and not merely within one visit's own array.
  assertUniqueIds(
    visits.flatMap((visit) => visit.photos),
    "The export's visit photos",
  );

  const entries = asArray(row["entries"], "entries").map((entry, index) =>
    parseExportEntry(entry, `entries[${index}]`, trackIds),
  );
  assertUniqueIds(entries, "The export's listening entries");

  const playlists = asArray(row["playlists"], "playlists").map((playlist, index) =>
    parseExportPlaylist(playlist, `playlists[${index}]`, trackIds),
  );
  assertUniqueIds(playlists, "The export's playlists");
  assertUniqueIds(
    playlists.flatMap((playlist) => playlist.items),
    "The export's playlist items",
  );

  return { version: CULTURE_EXPORT_VERSION, visits, tracks, entries, playlists };
}
