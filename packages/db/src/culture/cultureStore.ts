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

/**
 * The longest address a plan may paste. A URL is not a note: 2000 characters is
 * past any ticket page, event page or map link, and it is the same bound the
 * notes column has, so a plan cannot hold a body-sized "link".
 */
export const MAX_CULTURE_LINK_LENGTH = 2000;

/**
 * A plan's own kind: the ten visit kinds. A plan is a visit that has not
 * happened, so it is the same closed list rather than a second one that agrees
 * with it today - which is also what makes `completePlan` able to turn one into
 * the other without a translation table.
 */
export type CulturePlanKind = VisitKind;

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
  /**
   * The remembered venue this visit belongs to, or null. The `venue`/`city`
   * strings above stay the visit's own record of where it was (migration 073) -
   * this is only the link, so a venue renamed or deleted leaves the visit
   * saying exactly what the user typed.
   */
  venueId: string | null;
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

/**
 * A place, remembered once: `Museum of Contemporary Art`, `Beograd`, a kind,
 * and the module's own notes about it (which are the venue's, not a visit's -
 * "sit in the balcony" is true of every evening there).
 *
 * Two spellings of one name are one venue, folded the way `summarizeCulture`
 * counts one (`trim`, collapse inner whitespace, lowercase) at the store's own
 * find-or-create, so a visit typed `narodni muzej` yesterday points at the same
 * row as one typed `Narodni muzej` today.
 */
export interface CultureVenue {
  id: string;
  profileId: string;
  name: string;
  city: string | null;
  kind: VisitKind;
  /** Never null: "no notes" has exactly one spelling here, the empty string. */
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Something to see that has not happened yet. `visitId` is null while it is
 * still a plan and set once `completePlan` answered "I went" - which is what
 * makes the question askable exactly once.
 */
export interface CulturePlan {
  id: string;
  profileId: string;
  kind: VisitKind;
  title: string;
  venue: string;
  venueId: string | null;
  city: string | null;
  /** The bare local day, `YYYY-MM-DD`. */
  date: string;
  /** Wall-clock `HH:MM` it starts, or null when nobody recorded it. */
  startTime: string | null;
  /**
   * The address the user pasted, already checked to be `http:`/`https:`. Kept
   * verbatim (a URL is data, never prose): never trimmed, never folded.
   */
  link: string | null;
  notes: string;
  visitId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The module's one preference, as the settings card and the page read it. */
export interface CultureSettings {
  /**
   * Whether the programme asks about plans whose date has passed. True when no
   * row has been written, which is what the module shipped with.
   */
  promptPastPlans: boolean;
}

/** What one `completePlan` wrote: the linked plan and the visit it became. */
export interface CulturePlanCompletion {
  plan: CulturePlan;
  visit: CultureVisit;
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

export interface CreateVenueInput {
  name: string;
  city?: string | null;
  kind: VisitKind;
  notes?: string;
}

/** A partial patch. An omitted key is left untouched; an explicit `null` clears a nullable field. */
export interface UpdateVenueFields {
  name?: string;
  city?: string | null;
  kind?: VisitKind;
  notes?: string;
}

export interface CreateCulturePlanInput {
  kind: VisitKind;
  title: string;
  venue: string;
  city?: string | null;
  date: string;
  startTime?: string | null;
  link?: string | null;
  notes?: string;
}

/** A partial patch. An omitted key is left untouched; an explicit `null` clears a nullable field. */
export interface UpdateCulturePlanFields {
  kind?: VisitKind;
  title?: string;
  venue?: string;
  city?: string | null;
  date?: string;
  startTime?: string | null;
  link?: string | null;
  notes?: string;
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
  readonly venueId: string | null;
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

/** One remembered place, as the archive carries it: the row's own fields, and no count. */
export interface CultureExportVenue {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly kind: VisitKind;
  readonly notes: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One plan, as the archive carries it. `visitId` rides along, so a restored profile does not ask again about a plan it already answered. */
export interface CultureExportPlan {
  readonly id: string;
  readonly kind: VisitKind;
  readonly title: string;
  readonly venue: string;
  readonly venueId: string | null;
  readonly city: string | null;
  readonly date: string;
  readonly startTime: string | null;
  readonly link: string | null;
  readonly notes: string;
  readonly visitId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
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
  readonly venues: readonly CultureExportVenue[];
  readonly visits: readonly CultureExportVisit[];
  readonly plans: readonly CultureExportPlan[];
  readonly tracks: readonly CultureExportTrack[];
  readonly entries: readonly CultureExportEntry[];
  readonly playlists: readonly CultureExportPlaylist[];
  readonly settings: CultureSettings;
}

/** What one `importData` wrote, so a caller can report what an archive carried. */
export interface CultureImportSummary {
  readonly venues: number;
  readonly visits: number;
  readonly photos: number;
  readonly plans: number;
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
  venue_id: string | null;
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

interface VenueRow {
  id: string;
  profile_id: string;
  name: string;
  city: string | null;
  kind: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface PlanRow {
  id: string;
  profile_id: string;
  title: string;
  kind: string;
  venue: string;
  venue_id: string | null;
  city: string | null;
  planned_date: string;
  start_time: string | null;
  link: string | null;
  notes: string;
  visit_id: string | null;
  created_at: string;
  updated_at: string;
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
  "id, profile_id, kind, title, venue, venue_id, city, visit_date, start_time, rating, notes, " +
  "price_minor, price_currency, companions, created_at, updated_at";

const PHOTO_COLUMNS = "id, visit_id, file_name, mime, size_bytes, sha256, created_at";

const VENUE_COLUMNS = "id, profile_id, name, city, kind, notes, created_at, updated_at";

const PLAN_COLUMNS =
  "id, profile_id, title, kind, venue, venue_id, city, planned_date, start_time, link, notes, " +
  "visit_id, created_at, updated_at";

const TRACK_COLUMNS =
  "id, profile_id, title, artist, album, track_number, release_year, duration_ms, " +
  "file_name, mime, size_bytes, sha256, imported_at, play_count, last_played_at, updated_at";

const ENTRY_COLUMNS =
  "id, profile_id, artist, title, kind, entry_date, rating, notes, track_id, created_at, updated_at";

const PLAYLIST_COLUMNS = "id, profile_id, name, created_at, updated_at";

const ITEM_COLUMNS = "id, playlist_id, track_id, rank, created_at";

/**
 * The culture corner's whole store: the places (venues), what went to see
 * (visits with their photos), what is planned (plans), the listening log, the
 * user's own tracks, and playlists over them.
 *
 * **One store over nine tables, because it is one module with one archive
 * entry.** The groups are read together (the period statistics take visits,
 * entries and tracks at once) and they travel together (`exportData` is one
 * versioned value), so splitting them into four stores would mean four
 * constructors per profile and an archive section assembled from four answers.
 * What keeps that from becoming a bag is that each group has its own statement
 * block below and its own section in the tests.
 *
 * **A visit's `venue` text and its `venue_id` are not two answers to one
 * question.** The text is what the user wrote and what the archive carries; the
 * id is the link to a remembered place, and `findOrCreateVenue` is the ONE
 * place the two are written together. Everything else (`updateVisit` with a
 * venue id, `updateVenue`'s rename) deliberately leaves the other where it is,
 * so a renamed or deleted place can never rewrite a memory.
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
  // --- venues ---------------------------------------------------------------
  private readonly insertVenue: Database.Statement;
  private readonly selectVenues: Database.Statement;
  private readonly selectDeletedVenues: Database.Statement;
  private readonly selectAllVenues: Database.Statement;
  private readonly selectVenueById: Database.Statement;
  private readonly updateVenueFields: Database.Statement;
  private readonly markVenueDeleted: Database.Statement;
  private readonly markVenueRestored: Database.Statement;
  // --- plans ----------------------------------------------------------------
  private readonly insertPlan: Database.Statement;
  private readonly selectPlans: Database.Statement;
  private readonly selectAllPlans: Database.Statement;
  private readonly selectPlanById: Database.Statement;
  private readonly updatePlanFields: Database.Statement;
  private readonly linkPlanToVisit: Database.Statement;
  private readonly markPlanDeleted: Database.Statement;
  private readonly markPlanRestored: Database.Statement;
  // --- settings -------------------------------------------------------------
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;
  // --- blobs ----------------------------------------------------------------
  private readonly countBlobReferences: Database.Statement;
  private readonly selectBlobMime: Database.Statement;
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
  private readonly deletePlans: Database.Statement;
  private readonly deleteVenues: Database.Statement;
  private readonly deleteSettings: Database.Statement;
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
         (id, profile_id, kind, title, venue, venue_id, city, visit_date, start_time, rating,
          notes, price_minor, price_currency, companions, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
          SET kind = ?, title = ?, venue = ?, venue_id = ?, city = ?, visit_date = ?,
              start_time = ?, rating = ?, notes = ?, price_minor = ?, price_currency = ?,
              companions = ?, updated_at = ?
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

    this.insertVenue = db.prepare(
      `INSERT INTO culture_venues
         (id, profile_id, name, city, kind, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectVenues = db.prepare(
      `SELECT ${VENUE_COLUMNS} FROM culture_venues
        WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    // The second half of `rememberVenue`: a place the user deleted and then
    // visited again comes BACK rather than becoming a second row with the same
    // name, so one place stays one row for as long as the profile exists.
    this.selectDeletedVenues = db.prepare(
      `SELECT ${VENUE_COLUMNS} FROM culture_venues
        WHERE profile_id = ? AND deleted_at IS NOT NULL`,
    );
    // The export's read: every live venue in one query, ordered by the key the
    // archive's own canonical order uses.
    this.selectAllVenues = db.prepare(
      `SELECT ${VENUE_COLUMNS} FROM culture_venues
        WHERE profile_id = ? AND deleted_at IS NULL ORDER BY id`,
    );
    this.selectVenueById = db.prepare(
      `SELECT ${VENUE_COLUMNS} FROM culture_venues
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateVenueFields = db.prepare(
      `UPDATE culture_venues SET name = ?, city = ?, kind = ?, notes = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markVenueDeleted = db.prepare(
      `UPDATE culture_venues SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markVenueRestored = db.prepare(
      `UPDATE culture_venues SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );

    this.insertPlan = db.prepare(
      `INSERT INTO culture_plans
         (id, profile_id, title, kind, venue, venue_id, city, planned_date, start_time, link,
          notes, visit_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    );
    this.selectPlans = db.prepare(
      `SELECT ${PLAN_COLUMNS} FROM culture_plans
        WHERE profile_id = ? AND deleted_at IS NULL
        ORDER BY planned_date, id`,
    );
    this.selectAllPlans = db.prepare(
      `SELECT ${PLAN_COLUMNS} FROM culture_plans
        WHERE profile_id = ? AND deleted_at IS NULL ORDER BY id`,
    );
    this.selectPlanById = db.prepare(
      `SELECT ${PLAN_COLUMNS} FROM culture_plans
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updatePlanFields = db.prepare(
      `UPDATE culture_plans
          SET title = ?, kind = ?, venue = ?, venue_id = ?, city = ?, planned_date = ?,
              start_time = ?, link = ?, notes = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // The plan's own "I went": the pointer is written once, and a second
    // `completePlan` refuses rather than minting a second visit.
    this.linkPlanToVisit = db.prepare(
      `UPDATE culture_plans SET visit_id = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND visit_id IS NULL AND deleted_at IS NULL`,
    );
    this.markPlanDeleted = db.prepare(
      `UPDATE culture_plans SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markPlanRestored = db.prepare(
      `UPDATE culture_plans SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );

    this.selectSettings = db.prepare(
      `SELECT prompt_past_plans AS prompt FROM culture_settings WHERE profile_id = ?`,
    );
    this.upsertSettings = db.prepare(
      `INSERT INTO culture_settings (profile_id, prompt_past_plans, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (profile_id)
       DO UPDATE SET prompt_past_plans = excluded.prompt_past_plans,
                     updated_at = excluded.updated_at`,
    );

    // The ONE place this module's blob references are counted, across its two
    // hash-naming tables - a photo and a track may hold byte-identical content,
    // so the count has to see both before main's union can be asked whether a
    // file on disk is orphaned.
    //
    // Deliberately PROFILE-AGNOSTIC, like every other member of that union: the
    // blob store is content-addressed across the whole database, so a count
    // scoped to one profile would report zero for a file another profile's row
    // still names and the collector would delete it under that row's feet. The
    // join to `culture_visits` existed only to reach `profile_id`; the photo
    // table's own `visit_id` is the reference, so it is gone with it.
    this.countBlobReferences = db.prepare(
      `SELECT
         (SELECT count(*) FROM culture_visit_photos p WHERE p.sha256 = ?) +
         (SELECT count(*) FROM culture_tracks t
           WHERE t.sha256 = ?) AS n`,
    );
    // What the bytes are served as. The photo table is asked first, which is the
    // order main's own mime union asks these two in - and the track table is the
    // fallback, because a hash may be named by a track alone, or by both (in
    // which case the photo's mime is the one the served bytes are). Read with NO
    // profile, on the count's own rule: `nx-blob:` asks for a hash and has no
    // profile to ask with.
    this.selectBlobMime = db.prepare(
      `SELECT COALESCE(
         (SELECT p.mime FROM culture_visit_photos p
           WHERE p.sha256 = ? LIMIT 1),
         (SELECT t.mime FROM culture_tracks t
           WHERE t.sha256 = ? LIMIT 1)
       ) AS mime`,
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
    // go before the tracks they may name; the plans go before the visits and
    // venues they point at, and the tracks before nothing that names them here.
    this.deletePlans = db.prepare(`DELETE FROM culture_plans WHERE profile_id = ?`);
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
    // AFTER the visits and plans that name them: a venue is a parent, and this
    // list never leans on its `ON DELETE SET NULL` to reach a row.
    this.deleteVenues = db.prepare(`DELETE FROM culture_venues WHERE profile_id = ?`);
    this.deleteSettings = db.prepare(`DELETE FROM culture_settings WHERE profile_id = ?`);
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
      // A visit REMEMBERS the place it was at: the venue row is found by the
      // folded name and city, or written, in the same transaction as the visit
      // that names it. That is the whole of "a venue is remembered once" - the
      // page has no second step to forget.
      venueId: null,
      city: input.city ?? null,
      date: input.date,
      startTime: input.startTime ?? null,
      rating: input.rating ?? null,
      notes: input.notes ?? "",
      price: input.price ?? null,
      companions: input.companions ?? null,
    });
    return this.db.transaction((): CultureVisit => {
      const linked: ResolvedVisit = {
        ...resolved,
        venueId: this.rememberVenue(resolved.venue, resolved.city, resolved.kind, validNow).id,
      };
      const id = uuidv7();
      this.insertVisit.run(
        id, this.profileId, linked.kind, linked.title, linked.venue, linked.venueId, linked.city,
        linked.date, linked.startTime, linked.rating, linked.notes,
        linked.price === null ? null : linked.price.minorUnits,
        linked.price === null ? null : linked.price.currency,
        linked.companions, validNow, validNow,
      );
      return { id, profileId: this.profileId, ...linked, createdAt: validNow, updatedAt: validNow };
    })();
  }

  /** Applies a partial patch to a live visit. An omitted key is left alone; an explicit `null` clears a nullable field. */
  updateVisit(id: string, fields: UpdateVisitFields, now: string): CultureVisit {
    const validNow = validateNow(now);
    const current = this.requireVisit(id);
    const resolved = resolveVisit({
      kind: fields.kind ?? current.kind,
      title: fields.title ?? current.title,
      venue: fields.venue ?? current.venue,
      venueId: current.venueId,
      city: "city" in fields ? (fields.city ?? null) : current.city,
      date: fields.date ?? current.date,
      startTime: "startTime" in fields ? (fields.startTime ?? null) : current.startTime,
      rating: "rating" in fields ? (fields.rating ?? null) : current.rating,
      notes: fields.notes ?? current.notes,
      price: "price" in fields ? (fields.price ?? null) : current.price,
      companions: "companions" in fields ? (fields.companions ?? null) : current.companions,
    });
    // The place is re-remembered on every edit rather than carried through, and
    // that is deliberate: the text and the link are one fact about the visit, so
    // whichever of them the patch changed, the pair is rewritten together. It is
    // also what gives a visit whose link was never written - an archive from
    // before `venue_id`, a place deleted since - its venue back on the next
    // write.
    return this.db.transaction((): CultureVisit => {
      const linked: ResolvedVisit = {
        ...resolved,
        venueId: this.rememberVenue(resolved.venue, resolved.city, resolved.kind, validNow).id,
      };
      this.updateVisitFields.run(
        linked.kind, linked.title, linked.venue, linked.venueId, linked.city, linked.date,
        linked.startTime, linked.rating, linked.notes,
        linked.price === null ? null : linked.price.minorUnits,
        linked.price === null ? null : linked.price.currency,
        linked.companions, validNow, id, this.profileId,
      );
      return { ...current, ...linked, updatedAt: validNow };
    })();
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

  // --- the places -----------------------------------------------------------

  /**
   * Remembers one place and returns the stored row.
   *
   * `rememberVenue` is the one the visits use (find by folded name and city, or
   * create); this is the explicit "I am adding a place" the Places section
   * offers, where a name that is already remembered is REFUSED rather than
   * quietly merged - a user who typed a name they already have wants to be told
   * which row they mean, and the row is right there in the list.
   */
  createVenue(input: CreateVenueInput, now: string): CultureVenue {
    const validNow = validateNow(now);
    const resolved = resolveVenue({
      name: input.name,
      city: input.city ?? null,
      kind: input.kind,
      notes: input.notes ?? "",
    });
    return this.db.transaction((): CultureVenue => {
      const existing = this.findVenueByName(resolved.name, resolved.city);
      if (existing !== null) {
        throw new CultureValidationError(
          `A venue named "${existing.name}"${existing.city === null ? "" : ` in ${existing.city}`} is already remembered.`,
        );
      }
      const id = uuidv7();
      this.insertVenue.run(
        id, this.profileId, resolved.name, resolved.city, resolved.kind, resolved.notes,
        validNow, validNow,
      );
      return { id, profileId: this.profileId, ...resolved, createdAt: validNow, updatedAt: validNow };
    })();
  }

  /** Applies a partial patch to a live place. An omitted key is left alone; an explicit `null` clears a nullable field. */
  updateVenue(id: string, fields: UpdateVenueFields, now: string): CultureVenue {
    const validNow = validateNow(now);
    const current = this.requireVenue(id);
    const resolved = resolveVenue({
      name: fields.name ?? current.name,
      city: "city" in fields ? (fields.city ?? null) : current.city,
      kind: fields.kind ?? current.kind,
      notes: fields.notes ?? current.notes,
    });
    this.db.transaction((): void => {
      const clash = this.findVenueByName(resolved.name, resolved.city, id);
      if (clash !== null) {
        throw new CultureValidationError(
          `Another venue named "${clash.name}"${clash.city === null ? "" : ` in ${clash.city}`} is already remembered.`,
        );
      }
      this.updateVenueFields.run(
        resolved.name, resolved.city, resolved.kind, resolved.notes, validNow, id, this.profileId,
      );
    })();
    // The visits' own `venue` text is deliberately NOT rewritten: it is what the
    // user wrote on that evening, and a renamed place leaves the memory of it
    // alone (the class comment's rule). What follows the rename is the LINK,
    // which is by id and therefore needs nothing written here.
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /** This profile's live places, sr-Latn alphabetical by name then city, with an id tiebreak. */
  listVenues(): CultureVenue[] {
    return (this.selectVenues.all(this.profileId) as VenueRow[])
      .map(toVenue)
      .sort(
        (left, right) =>
          CULTURE_COLLATOR.compare(left.name, right.name) ||
          CULTURE_COLLATOR.compare(left.city ?? "", right.city ?? "") ||
          left.id.localeCompare(right.id),
      );
  }

  /** Soft-deletes a live place. The visits it gathered keep their own words and their link comes back with it. */
  softDeleteVenue(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markVenueDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No live venue "${id}" to delete in this profile.`);
    }
  }

  restoreVenue(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markVenueRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No deleted venue "${id}" to restore in this profile.`);
    }
  }

  // --- the programme --------------------------------------------------------

  /** Records one plan - something to see that has not happened yet. */
  createPlan(input: CreateCulturePlanInput, now: string): CulturePlan {
    const validNow = validateNow(now);
    const resolved = resolvePlan({
      kind: input.kind,
      title: input.title,
      venue: input.venue,
      venueId: null,
      city: input.city ?? null,
      date: input.date,
      startTime: input.startTime ?? null,
      link: input.link ?? null,
      notes: input.notes ?? "",
    });
    return this.db.transaction((): CulturePlan => {
      const linked: ResolvedPlan = {
        ...resolved,
        venueId: this.rememberVenue(resolved.venue, resolved.city, resolved.kind, validNow).id,
      };
      const id = uuidv7();
      this.insertPlan.run(
        id, this.profileId, linked.title, linked.kind, linked.venue, linked.venueId, linked.city,
        linked.date, linked.startTime, linked.link, linked.notes, validNow, validNow,
      );
      return { id, profileId: this.profileId, ...linked, visitId: null, createdAt: validNow, updatedAt: validNow };
    })();
  }

  /** Applies a partial patch to a live plan. Its `visitId` is not editable here: `completePlan` is the only writer. */
  updatePlan(id: string, fields: UpdateCulturePlanFields, now: string): CulturePlan {
    const validNow = validateNow(now);
    const current = this.requirePlan(id);
    const resolved = resolvePlan({
      kind: fields.kind ?? current.kind,
      title: fields.title ?? current.title,
      venue: fields.venue ?? current.venue,
      venueId: current.venueId,
      city: "city" in fields ? (fields.city ?? null) : current.city,
      date: fields.date ?? current.date,
      startTime: "startTime" in fields ? (fields.startTime ?? null) : current.startTime,
      link: "link" in fields ? (fields.link ?? null) : current.link,
      notes: fields.notes ?? current.notes,
    });
    return this.db.transaction((): CulturePlan => {
      const linked: ResolvedPlan = {
        ...resolved,
        venueId: this.rememberVenue(resolved.venue, resolved.city, resolved.kind, validNow).id,
      };
      this.updatePlanFields.run(
        linked.title, linked.kind, linked.venue, linked.venueId, linked.city, linked.date,
        linked.startTime, linked.link, linked.notes, validNow, id, this.profileId,
      );
      return { ...current, ...linked, updatedAt: validNow };
    })();
  }

  /**
   * This profile's live plans, in date order - the order a programme is read in,
   * past and future alike. One read and no window: the page draws "upcoming" and
   * "went by" from the same list, split against the clock it already has, so a
   * second range statement would be a second answer to a question the caller is
   * better placed to ask.
   */
  listPlans(): CulturePlan[] {
    return (this.selectPlans.all(this.profileId) as PlanRow[]).map(toPlan);
  }

  softDeletePlan(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markPlanDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No live plan "${id}" to delete in this profile.`);
    }
  }

  restorePlan(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markPlanRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new CultureNotFoundError(`No deleted plan "${id}" to restore in this profile.`);
    }
  }

  /**
   * The plan's one question, answered: writes the visit it became and points
   * the plan at it, in one transaction.
   *
   * The visit is built from the plan's OWN fields - the date the plan named is
   * the date the visit happened, which is the whole reason the two rows are one
   * errand - and the caller may correct anything the evening turned out
   * differently about (the title, the rating, the companions, the notes) through
   * `fields`, which is a `CreateVisitInput` minus the two things the plan
   * already is (its venue and its kind are NOT re-asked unless the caller
   * overrides them).
   *
   * A plan that already answered is REFUSED rather than converted twice: the
   * pointer is the answer, and a second visit would be a copy of the evening.
   */
  completePlan(
    id: string,
    fields: Partial<CreateVisitInput>,
    now: string,
  ): CulturePlanCompletion {
    const validNow = validateNow(now);
    const plan = this.requirePlan(id);
    if (plan.visitId !== null) {
      throw new CultureValidationError(`Plan "${id}" has already become a visit.`);
    }
    return this.db.transaction((): CulturePlanCompletion => {
      const visit = this.createVisit(
        {
          kind: fields.kind ?? plan.kind,
          title: fields.title ?? plan.title,
          venue: fields.venue ?? plan.venue,
          city: fields.city ?? plan.city,
          date: fields.date ?? plan.date,
          startTime: fields.startTime ?? plan.startTime,
          rating: fields.rating ?? null,
          notes: fields.notes ?? plan.notes,
          price: fields.price ?? null,
          companions: fields.companions ?? null,
        },
        validNow,
      );
      const { changes } = this.linkPlanToVisit.run(visit.id, validNow, id, this.profileId);
      if (changes === 0) {
        throw new CultureNotFoundError(`No live plan "${id}" to complete in this profile.`);
      }
      return { plan: { ...plan, visitId: visit.id, updatedAt: validNow }, visit };
    })();
  }

  // --- the module's own preference ------------------------------------------

  /** The module's one preference, answered from the profile's row or the shipped default. */
  settings(): CultureSettings {
    const row = this.selectSettings.get(this.profileId) as { prompt: number } | undefined;
    return { promptPastPlans: row === undefined || row.prompt !== 0 };
  }

  /**
   * Writes the module's one preference. True is stored as a row too rather than
   * as the absence of one: the archive carries a boolean, and "this profile
   * answered yes" is a different fact from "this profile has never been asked".
   */
  setPromptPastPlans(value: boolean, now: string): CultureSettings {
    const validNow = validateNow(now);
    this.upsertSettings.run(this.profileId, value ? 1 : 0, validNow);
    return { promptPastPlans: value };
  }

  // --- the blobs ------------------------------------------------------------

  /**
   * How many rows - photos and tracks together, and across EVERY profile - name
   * this blob hash. The store's own count, which main adds to its other tables'
   * before deciding a file on disk is orphaned (`blobRefCount`).
   *
   * Profile-agnostic, like `NoteAttachmentStore.refCount`: the blob store is
   * content-addressed across the whole database, so a count that saw one
   * profile's rows would report zero for a file another profile still names and
   * the collector would take it.
   */
  refCount(sha256: string): number {
    const { n } = this.countBlobReferences.get(sha256, sha256) as { n: number };
    return n;
  }

  /** The mime any row registered for a hash, or null when none of them names it - profile-agnostic, like the count above. */
  mimeForHash(sha256: string): string | null {
    const row = this.selectBlobMime.get(sha256, sha256) as { mime: string | null };
    return row.mime;
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
   * One live track by id, or null. The read main makes when it is about to hand
   * the track's BYTES to the player: it needs the hash and the mime, and it must
   * not ask the page's own (possibly stale) copy of the library for them.
   */
  track(id: string): CultureTrack | null {
    const row = this.selectTrackById.get(id, this.profileId) as TrackRow | undefined;
    return row === undefined ? null : toTrack(row);
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
      // The places first, because every `venueId` below names one: a section a
      // reader walks in order should be able to resolve a link it has already
      // met, which is the rule this store's own `parseCultureExport` enforces.
      venues: (this.selectAllVenues.all(this.profileId) as VenueRow[]).map((row) => {
        const venue = toVenue(row);
        return {
          id: venue.id,
          name: venue.name,
          city: venue.city,
          kind: venue.kind,
          notes: venue.notes,
          createdAt: venue.createdAt,
          updatedAt: venue.updatedAt,
        };
      }),
      visits: (this.selectVisits.all(this.profileId) as VisitRow[]).map((row) => {
        const visit = toVisit(row);
        return {
          id: visit.id,
          kind: visit.kind,
          title: visit.title,
          venue: visit.venue,
          venueId: visit.venueId,
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
      plans: (this.selectAllPlans.all(this.profileId) as PlanRow[]).map((row) => {
        const plan = toPlan(row);
        return {
          id: plan.id,
          kind: plan.kind,
          title: plan.title,
          venue: plan.venue,
          venueId: plan.venueId,
          city: plan.city,
          date: plan.date,
          startTime: plan.startTime,
          link: plan.link,
          notes: plan.notes,
          visitId: plan.visitId,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
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
      settings: this.settings(),
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
  importData(value: unknown, now: string): CultureImportSummary {
    const validNow = validateNow(now);
    const parsed = parseCultureExport(value);

    return this.db.transaction((): CultureImportSummary => {
      this.deletePlans.run(this.profileId);
      this.deletePlaylistItems.run(this.profileId);
      this.deletePlaylists.run(this.profileId);
      this.deleteEntries.run(this.profileId);
      this.deleteVisitPhotos.run(this.profileId);
      this.deleteVisits.run(this.profileId);
      this.deleteVenues.run(this.profileId);
      this.deleteSettings.run(this.profileId);
      this.deleteTracks.run(this.profileId);

      for (const venue of parsed.venues) {
        this.insertVenue.run(
          venue.id, this.profileId, venue.name, venue.city, venue.kind, venue.notes,
          venue.createdAt, venue.updatedAt,
        );
      }
      for (const visit of parsed.visits) {
        this.insertVisit.run(
          visit.id, this.profileId, visit.kind, visit.title, visit.venue, visit.venueId,
          visit.city, visit.date, visit.startTime, visit.rating, visit.notes,
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
      for (const plan of parsed.plans) {
        this.insertPlan.run(
          plan.id, this.profileId, plan.title, plan.kind, plan.venue, plan.venueId, plan.city,
          plan.date, plan.startTime, plan.link, plan.notes, plan.createdAt, plan.updatedAt,
        );
        // The plan's own answer is a fact the archive carries (its `visitId`),
        // and the insert's default would flatten it.
        if (plan.visitId !== null) this.linkPlanToVisit.run(plan.visitId, plan.updatedAt, plan.id, this.profileId);
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
      // The preference is written LAST and unconditionally: an archive says what
      // the profile answered, and a section carrying the shipped default writes
      // the shipped default rather than leaving the target's own answer behind.
      this.upsertSettings.run(this.profileId, parsed.settings.promptPastPlans ? 1 : 0, validNow);

      return {
        venues: parsed.venues.length,
        visits: parsed.visits.length,
        photos: parsed.visits.reduce((sum, visit) => sum + visit.photos.length, 0),
        plans: parsed.plans.length,
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

  /** Reads a live place in this profile or throws - what `updateVenue` and the link resolvers pass. */
  private requireVenue(id: string): CultureVenue {
    const row = this.selectVenueById.get(id, this.profileId) as VenueRow | undefined;
    if (row === undefined) {
      throw new CultureNotFoundError(`No live venue "${id}" in this profile.`);
    }
    return toVenue(row);
  }

  /**
   * The live place whose folded name and city match, or null. Folding is
   * `foldVenueKey`'s (trim, collapse inner whitespace, lowercase) - the same
   * fold `summarizeCulture` counts one venue by, so "one place remembered once"
   * and "one place counted once" cannot disagree.
   */
  private findVenueByName(name: string, city: string | null, exceptId?: string): CultureVenue | null {
    const wanted = foldVenueKey(name, city);
    for (const row of this.selectVenues.all(this.profileId) as VenueRow[]) {
      if (row.id === exceptId) continue;
      if (foldVenueKey(row.name, row.city) === wanted) return toVenue(row);
    }
    return null;
  }

  /**
   * The place a visit or a plan was at: the remembered row, a deleted one
   * brought back, or a new row. Called inside the caller's transaction, so the
   * link and the row it points at are written together or not at all.
   */
  private rememberVenue(
    name: string,
    city: string | null,
    kind: VisitKind,
    now: string,
  ): CultureVenue {
    const live = this.findVenueByName(name, city);
    if (live !== null) return live;

    const wanted = foldVenueKey(name, city);
    const deleted = (this.selectDeletedVenues.all(this.profileId) as VenueRow[]).find(
      (row) => foldVenueKey(row.name, row.city) === wanted,
    );
    if (deleted !== undefined) {
      this.markVenueRestored.run(now, deleted.id, this.profileId);
      return { ...toVenue(deleted), updatedAt: now };
    }

    const id = uuidv7();
    this.insertVenue.run(id, this.profileId, name, city, kind, "", now, now);
    return { id, profileId: this.profileId, name, city, kind, notes: "", createdAt: now, updatedAt: now };
  }

  /** Reads a live plan in this profile or throws. */
  private requirePlan(id: string): CulturePlan {
    const row = this.selectPlanById.get(id, this.profileId) as PlanRow | undefined;
    if (row === undefined) {
      throw new CultureNotFoundError(`No live plan "${id}" in this profile.`);
    }
    return toPlan(row);
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
    venueId: row.venue_id,
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

function toVenue(row: VenueRow): CultureVenue {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    city: row.city,
    kind: row.kind as VisitKind,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPlan(row: PlanRow): CulturePlan {
  return {
    id: row.id,
    profileId: row.profile_id,
    kind: row.kind as VisitKind,
    title: row.title,
    venue: row.venue,
    venueId: row.venue_id,
    city: row.city,
    date: row.planned_date,
    startTime: row.start_time,
    link: row.link,
    notes: row.notes,
    visitId: row.visit_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The key two spellings of one place share: trim, collapse inner whitespace,
 * lowercase, over the name AND the city.
 *
 * The same fold `summarizeCulture`'s `nameKey` applies to a counted venue, and
 * deliberately a second, smaller function rather than a shared one: the
 * statistics fold a single string and this folds a pair, and a helper with a
 * "join these two, then fold" contract would be a shape neither caller needs.
 * A place with no city folds to the name alone, so `Muzej` and `muzej` are one
 * row wherever they were typed.
 */
function foldVenueKey(name: string, city: string | null): string {
  const fold = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();
  return `${fold(name)}\u0000${city === null ? "" : fold(city)}`;
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
    venueId: validateOptionalId(fields.venueId, "venueId"),
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

/** The place's own fields, minus the ones the row rather than the caller decides. */
type ResolvedVenue = Omit<CultureVenue, "id" | "profileId" | "createdAt" | "updatedAt">;

/**
 * Validates a whole place - one home for every refusal, so `createVenue`,
 * `updateVenue` and `importData` cannot drift on what a place may be.
 */
function resolveVenue(fields: ResolvedVenue): ResolvedVenue {
  return {
    name: validateText(fields.name, "name", MAX_CULTURE_VENUE_LENGTH),
    city: validateOptionalText(fields.city, "city", MAX_CULTURE_CITY_LENGTH),
    kind: validateVisitKind(fields.kind),
    notes: validateNotes(fields.notes),
  };
}

/** The plan's own fields, minus the ones the row rather than the caller decides. */
type ResolvedPlan = Omit<CulturePlan, "id" | "profileId" | "visitId" | "createdAt" | "updatedAt">;

/**
 * Validates a whole plan. `visitId` is not here: it is the ANSWER to the plan's
 * question and only `completePlan` and `importData` ever write it.
 */
function resolvePlan(fields: ResolvedPlan): ResolvedPlan {
  return {
    kind: validateVisitKind(fields.kind),
    title: validateText(fields.title, "title", MAX_CULTURE_TITLE_LENGTH),
    venue: validateText(fields.venue, "venue", MAX_CULTURE_VENUE_LENGTH),
    venueId: validateOptionalId(fields.venueId, "venueId"),
    city: validateOptionalText(fields.city, "city", MAX_CULTURE_CITY_LENGTH),
    date: validateDay(fields.date, "date"),
    startTime: validateStartTime(fields.startTime),
    link: validateLink(fields.link),
    notes: validateNotes(fields.notes),
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

/**
 * A foreign key the caller may name, or null. The shape is `@nexus/core`'s
 * `MAX_ID_LENGTH` bound and no outer whitespace - the same rule `asId` applies
 * on the wire, applied again here because a store never assumes its caller
 * validated anything (SEC-EL-02).
 */
function validateOptionalId(value: string | null, field: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value !== value.trim()
  ) {
    throw new CultureValidationError(`"${field}" must be a well-formed id or null.`);
  }
  return value;
}

/**
 * The address a plan pasted, or null. Kept VERBATIM - a URL is data, and
 * trimming or folding one is how a link stops resolving - and refused unless it
 * parses as `http:`/`https:`.
 *
 * The scheme rule is the point: this string becomes an anchor's `href` in the
 * renderer, and `javascript:`, `data:` and `file:` are all one pasted address
 * away from being something other than a link to a page. Only the two schemes
 * that name a document over the network are accepted, and anything else is
 * refused BY NAME rather than normalised into something that happens to be
 * safe.
 */
function validateLink(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new CultureValidationError(`"link" must be a string or null.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_CULTURE_LINK_LENGTH) {
    throw new CultureValidationError(
      `"link" must be at most ${MAX_CULTURE_LINK_LENGTH} characters.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CultureValidationError(`"link" must be an absolute http(s) address.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CultureValidationError(`"link" must be an http(s) address.`);
  }
  return trimmed;
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
  "id", "kind", "title", "venue", "venueId", "city", "date", "startTime", "rating", "notes",
  "price", "companions", "createdAt", "updatedAt", "photos",
] as const;

const PHOTO_KEYS = ["id", "fileName", "mime", "sizeBytes", "sha256", "createdAt"] as const;

const VENUE_KEYS = [
  "id", "name", "city", "kind", "notes", "createdAt", "updatedAt",
] as const;

const PLAN_KEYS = [
  "id", "kind", "title", "venue", "venueId", "city", "date", "startTime", "link", "notes",
  "visitId", "createdAt", "updatedAt",
] as const;

const SETTINGS_KEYS = ["promptPastPlans"] as const;

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

const EXPORT_KEYS = [
  "version", "venues", "visits", "plans", "tracks", "entries", "playlists", "settings",
] as const;

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
    venueId: asNullableString(row["venueId"], `${where}.venueId`),
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

function parseExportVenue(value: unknown, where: string): CultureExportVenue {
  const row = exportRow(value, VENUE_KEYS, where);
  const resolved = resolveVenue({
    name: asString(row["name"], `${where}.name`),
    city: asNullableString(row["city"], `${where}.city`),
    kind: asString(row["kind"], `${where}.kind`) as VisitKind,
    notes: asString(row["notes"], `${where}.notes`),
  });
  return {
    id: asId(row["id"], `${where}.id`),
    ...resolved,
    createdAt: asTimestamp(row["createdAt"], `${where}.createdAt`),
    updatedAt: asTimestamp(row["updatedAt"], `${where}.updatedAt`),
  };
}

function parseExportPlan(
  value: unknown,
  where: string,
  visitIds: ReadonlySet<string>,
): CultureExportPlan {
  const row = exportRow(value, PLAN_KEYS, where);
  const resolved = resolvePlan({
    kind: asString(row["kind"], `${where}.kind`) as VisitKind,
    title: asString(row["title"], `${where}.title`),
    venue: asString(row["venue"], `${where}.venue`),
    venueId: asNullableString(row["venueId"], `${where}.venueId`),
    city: asNullableString(row["city"], `${where}.city`),
    date: asString(row["date"], `${where}.date`),
    startTime: asNullableString(row["startTime"], `${where}.startTime`),
    link: asNullableString(row["link"], `${where}.link`),
    notes: asString(row["notes"], `${where}.notes`),
  });
  const visitId = asNullableString(row["visitId"], `${where}.visitId`);
  // A plan carries the answer to its own question, so the visit it names has to
  // be in the same value - the same reference rule the entries' `trackId` keeps.
  if (visitId !== null && !visitIds.has(visitId)) {
    throw new CultureValidationError(
      `${where}.visitId names the visit "${visitId}", which this value does not carry.`,
    );
  }
  return {
    id: asId(row["id"], `${where}.id`),
    ...resolved,
    visitId,
    createdAt: asTimestamp(row["createdAt"], `${where}.createdAt`),
    updatedAt: asTimestamp(row["updatedAt"], `${where}.updatedAt`),
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
 * The archive reader, as a PUBLIC function: the same validation `importData`
 * runs, reachable on its own.
 *
 * This is what a kit module's `importData.parse` needs (ADR-090 §5): the kit
 * runs `parse` at the restore PREVIEW, where nothing may be written, and again
 * immediately before any module writes, so the reader has to be callable
 * without a store and without a transaction. It is deliberately the same
 * function `importData` calls rather than a second opinion about the same
 * bytes: a preview that accepted what the write then refused would be a
 * promise the module could not keep.
 */
export function parseCultureExportPayload(value: unknown): CultureExport {
  return parseCultureExport(value);
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

  const venues = asArray(row["venues"], "venues").map((venue, index) =>
    parseExportVenue(venue, `venues[${index}]`),
  );
  assertUniqueIds(venues, "The export's venues");
  const venueIds = new Set(venues.map((venue) => venue.id));

  const visits = asArray(row["visits"], "visits").map((visit, index) =>
    parseExportVisit(visit, `visits[${index}]`),
  );
  assertUniqueIds(visits, "The export's visits");
  // A visit's link and a plan's link both name a place this value has to
  // carry, exactly as an entry's `trackId` has to name one of its tracks: a
  // dangling link would be written as-is, because the store's INSERTs are
  // bound statements and the foreign key's `SET NULL` is never leaned on.
  for (const [index, visit] of visits.entries()) {
    if (visit.venueId !== null && !venueIds.has(visit.venueId)) {
      throw new CultureValidationError(
        `visits[${index}].venueId names the venue "${visit.venueId}", which this value does not carry.`,
      );
    }
  }
  // Photos are one table, so their ids have to be unique across the WHOLE
  // export and not merely within one visit's own array.
  assertUniqueIds(
    visits.flatMap((visit) => visit.photos),
    "The export's visit photos",
  );
  const visitIds = new Set(visits.map((visit) => visit.id));

  const plans = asArray(row["plans"], "plans").map((plan, index) =>
    parseExportPlan(plan, `plans[${index}]`, visitIds),
  );
  assertUniqueIds(plans, "The export's plans");
  for (const [index, plan] of plans.entries()) {
    if (plan.venueId !== null && !venueIds.has(plan.venueId)) {
      throw new CultureValidationError(
        `plans[${index}].venueId names the venue "${plan.venueId}", which this value does not carry.`,
      );
    }
  }

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

  const settings = exportRow(row["settings"], SETTINGS_KEYS, "settings");
  if (typeof settings["promptPastPlans"] !== "boolean") {
    throw new CultureValidationError(`"settings.promptPastPlans" must be a boolean.`);
  }

  return {
    version: CULTURE_EXPORT_VERSION,
    venues,
    visits,
    plans,
    tracks,
    entries,
    playlists,
    settings: { promptPastPlans: settings["promptPastPlans"] },
  };
}
