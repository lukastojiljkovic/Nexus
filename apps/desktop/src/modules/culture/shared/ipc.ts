import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";
import type { MusicLogKind, VisitKind } from "@nexus/core";

/**
 * CULTURE's contract: the channels it answers on, the payload each takes, and
 * the API its page calls - declared once, in its own folder (ADR-090).
 *
 * **Why every mutation answers with the whole view.** The page draws six lists
 * at once (places, visits, plans, tracks, the listening log, playlists) and the
 * groups point at each other: a visit names a place, a plan becomes a visit, a
 * playlist item names a track. A per-op delta would have to say which of those
 * six a caller must re-read, and the one answer that cannot be wrong is "all of
 * them, as main sees them". So `CultureView` is both what `list` answers and
 * what every write answers, and the page has exactly one way to update.
 *
 * **Why the audio bytes are an op of their own.** Playing a track needs the
 * decrypted bytes in the renderer, and there is no `file://` path anywhere in
 * this app to hand it. `readTrackBytes` is that read: the renderer gets the
 * bytes and the mime main sniffed, wraps them in a `Blob` and plays it from an
 * object URL it revokes when the track changes - one track in memory, never the
 * library.
 */

/**
 * One visit's photo, as it crosses the wire. The BYTES never do: they live
 * content-addressed in the blob store, and the renderer reaches them through
 * `nx-blob://<sha256>` exactly as a note's inline image does.
 */
export interface CulturePhotoView {
  readonly id: string;
  readonly visitId: string;
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface CultureVisitView {
  readonly id: string;
  readonly kind: VisitKind;
  readonly title: string;
  readonly venue: string;
  /** The remembered place this visit gathers under, or null - see `CultureVenueView`. */
  readonly venueId: string | null;
  readonly city: string | null;
  /** A bare local day, `YYYY-MM-DD`. */
  readonly date: string;
  readonly startTime: string | null;
  readonly rating: number | null;
  readonly notes: string;
  readonly price: { readonly minorUnits: number; readonly currency: string } | null;
  readonly companions: string | null;
  readonly photos: readonly CulturePhotoView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CultureVenueView {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly kind: VisitKind;
  readonly notes: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CulturePlanView {
  readonly id: string;
  readonly kind: VisitKind;
  readonly title: string;
  readonly venue: string;
  readonly venueId: string | null;
  readonly city: string | null;
  readonly date: string;
  readonly startTime: string | null;
  /** The address the user pasted, already checked to be http(s) in main. */
  readonly link: string | null;
  readonly notes: string;
  /** Set once this plan became a visit - which is what stops the page asking twice. */
  readonly visitId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CultureTrackView {
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
}

export interface CultureEntryView {
  readonly id: string;
  readonly artist: string;
  readonly title: string;
  readonly kind: MusicLogKind;
  readonly date: string;
  readonly rating: number | null;
  readonly notes: string;
  /** One of this profile's own live tracks, or null. */
  readonly trackId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CulturePlaylistItemView {
  readonly id: string;
  readonly playlistId: string;
  readonly trackId: string;
  readonly rank: string;
  readonly createdAt: string;
}

export interface CulturePlaylistView {
  readonly id: string;
  readonly name: string;
  readonly items: readonly CulturePlaylistItemView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The module's one preference, as the settings card and the page read it. */
export interface CultureSettingsView {
  readonly promptPastPlans: boolean;
}

/** Everything one read of this module answers with, and what every mutation answers with too (see the header). */
export interface CultureView {
  readonly visits: readonly CultureVisitView[];
  readonly venues: readonly CultureVenueView[];
  readonly plans: readonly CulturePlanView[];
  readonly tracks: readonly CultureTrackView[];
  readonly entries: readonly CultureEntryView[];
  readonly playlists: readonly CulturePlaylistView[];
  readonly settings: CultureSettingsView;
}

/**
 * One work of the arts guide, as an installed `dataset` pack describes it
 * (`art.json`, layout 1). `packId` and `version` are what the image URL is
 * built from - `nx-pack://<packId>/<version>/<image>` - and never a filesystem
 * path, which the renderer is not given in either direction.
 */
export interface CultureArtWorkView {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly date: string;
  readonly medium: string | null;
  readonly museum: string;
  readonly credit: string;
  readonly licence: string;
  readonly packId: string;
  readonly version: string;
  readonly image: string;
  readonly width: number;
  readonly height: number;
}

/** One installed pack the gallery is reading from, with the attribution its licence asks for. */
export interface CultureArtPackView {
  readonly id: string;
  readonly version: string;
  readonly title: { readonly sr: string; readonly en: string };
  readonly licence: { readonly spdx: string; readonly attribution: string; readonly url: string };
}

/** What `listArt` answers: the works of every readable dataset pack, and the ids of the packs it could not read. */
export interface CultureArtView {
  readonly works: readonly CultureArtWorkView[];
  readonly packs: readonly CultureArtPackView[];
  /** Dataset packs whose `art.json` is missing or malformed. Named rather than thrown: one bad pack must not hide the others. */
  readonly skipped: readonly string[];
}

/** One track's decrypted bytes, with the mime main sniffed from them. */
export interface CultureTrackBytesView {
  readonly mime: string;
  readonly bytes: Uint8Array;
}

interface ListPayload {
  profileId: string;
}

/** One row of this module's tables, by its own id. The store scopes it to the profile. */
interface RowPayload {
  profileId: string;
  id: string;
}

interface RemovePhotoPayload {
  profileId: string;
  id: string;
  photoId: string;
}

/** Removing ONE appearance of a track from a playlist: the playlist, and the item row (a playlist may hold one track twice). */
interface RemoveItemPayload {
  profileId: string;
  id: string;
  itemId: string;
}

interface VisitFields {
  kind: VisitKind;
  title: string;
  venue: string;
  city: string | null;
  date: string;
  startTime: string | null;
  rating: number | null;
  notes: string;
  price: { minorUnits: number; currency: string } | null;
  companions: string | null;
}

interface CreateVisitPayload extends VisitFields {
  profileId: string;
}

interface UpdateVisitPayload {
  profileId: string;
  id: string;
  fields: Partial<VisitFields>;
}

/** Bytes the renderer read from a file input (`type="file"`, never a path) plus the display name. */
interface AttachPhotoPayload {
  profileId: string;
  id: string;
  fileName: string;
  bytes: Uint8Array;
}

interface VenueFields {
  name: string;
  city: string | null;
  kind: VisitKind;
  notes: string;
}

interface CreateVenuePayload extends VenueFields {
  profileId: string;
}

interface UpdateVenuePayload {
  profileId: string;
  id: string;
  fields: Partial<VenueFields>;
}

interface PlanFields {
  kind: VisitKind;
  title: string;
  venue: string;
  city: string | null;
  date: string;
  startTime: string | null;
  link: string | null;
  notes: string;
}

interface CreatePlanPayload extends PlanFields {
  profileId: string;
}

interface UpdatePlanPayload {
  profileId: string;
  id: string;
  fields: Partial<PlanFields>;
}

/** The plan's own "I went", with the corrections the evening turned out to need. */
interface CompletePlanPayload {
  profileId: string;
  id: string;
  fields: Partial<Omit<VisitFields, "venue" | "city" | "date">>;
}

interface ImportTrackPayload {
  profileId: string;
  fileName: string;
  bytes: Uint8Array;
}

interface TrackFields {
  title: string;
  artist: string | null;
  album: string | null;
  trackNumber: number | null;
  releaseYear: number | null;
  durationMs: number;
}

interface UpdateTrackPayload {
  profileId: string;
  id: string;
  fields: Partial<TrackFields>;
}

interface EntryFields {
  artist: string;
  title: string;
  kind: MusicLogKind;
  date: string;
  rating: number | null;
  notes: string;
  trackId: string | null;
}

interface CreateEntryPayload extends EntryFields {
  profileId: string;
}

interface UpdateEntryPayload {
  profileId: string;
  id: string;
  fields: Partial<EntryFields>;
}

interface NamePayload {
  profileId: string;
  name: string;
}

interface RenamePlaylistPayload extends NamePayload {
  id: string;
}

interface PlaylistTrackPayload {
  profileId: string;
  id: string;
  trackId: string;
}

/** Moving one item between two of its neighbours - either may be null at an end of the list. */
interface MoveItemPayload {
  profileId: string;
  id: string;
  itemId: string;
  beforeId: string | null;
  afterId: string | null;
}

interface PromptPayload {
  profileId: string;
  promptPastPlans: boolean;
}

/**
 * The declared ops, as a payload-to-result map. `ModuleApiOf` turns this into
 * the `nexus.modules.culture.*` methods the page calls, and
 * `defineModuleContract` turns the keys into the channels main answers on.
 */
type CultureOps = {
  list: { request: ListPayload; response: CultureView };
  createVisit: { request: CreateVisitPayload; response: CultureView };
  updateVisit: { request: UpdateVisitPayload; response: CultureView };
  removeVisit: { request: RowPayload; response: CultureView };
  addVisitPhoto: { request: AttachPhotoPayload; response: CultureView };
  removeVisitPhoto: { request: RemovePhotoPayload; response: CultureView };
  createVenue: { request: CreateVenuePayload; response: CultureView };
  updateVenue: { request: UpdateVenuePayload; response: CultureView };
  removeVenue: { request: RowPayload; response: CultureView };
  createPlan: { request: CreatePlanPayload; response: CultureView };
  updatePlan: { request: UpdatePlanPayload; response: CultureView };
  removePlan: { request: RowPayload; response: CultureView };
  completePlan: { request: CompletePlanPayload; response: CultureView };
  importTrack: { request: ImportTrackPayload; response: CultureView };
  updateTrack: { request: UpdateTrackPayload; response: CultureView };
  removeTrack: { request: RowPayload; response: CultureView };
  recordPlay: { request: RowPayload; response: CultureView };
  readTrackBytes: { request: RowPayload; response: CultureTrackBytesView };
  createEntry: { request: CreateEntryPayload; response: CultureView };
  updateEntry: { request: UpdateEntryPayload; response: CultureView };
  removeEntry: { request: RowPayload; response: CultureView };
  createPlaylist: { request: NamePayload; response: CultureView };
  renamePlaylist: { request: RenamePlaylistPayload; response: CultureView };
  removePlaylist: { request: RowPayload; response: CultureView };
  addPlaylistTrack: { request: PlaylistTrackPayload; response: CultureView };
  movePlaylistItem: { request: MoveItemPayload; response: CultureView };
  removePlaylistItem: { request: RemoveItemPayload; response: CultureView };
  setPromptPastPlans: { request: PromptPayload; response: CultureView };
  // No payload fields at all: the packs directory is the machine's, not a
  // profile's, so this op reads nothing about whose page is open.
  listArt: { request: Record<string, never>; response: CultureArtView };
};

/** This module's renderer API: one method per op, named after the op. */
export type CultureApi = ModuleApiOf<CultureOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the ONE name the kit's globs
 * agree on (`preload/moduleBridge.ts`).
 */
export const contract = defineModuleContract<"culture", CultureOps>("culture", [
  "list",
  "createVisit",
  "updateVisit",
  "removeVisit",
  "addVisitPhoto",
  "removeVisitPhoto",
  "createVenue",
  "updateVenue",
  "removeVenue",
  "createPlan",
  "updatePlan",
  "removePlan",
  "completePlan",
  "importTrack",
  "updateTrack",
  "removeTrack",
  "recordPlay",
  "readTrackBytes",
  "createEntry",
  "updateEntry",
  "removeEntry",
  "createPlaylist",
  "renamePlaylist",
  "removePlaylist",
  "addPlaylistTrack",
  "movePlaylistItem",
  "removePlaylistItem",
  "setPromptPastPlans",
  "listArt",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.culture.list(...)` typed in this
 * module's own page and in the dashboard widget without a line in
 * `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    culture: CultureApi;
  }
}
