import { MAX_CULTURE_RATING, MIN_CULTURE_RATING, sniffMime, type VisitKind } from "@nexus/core";
import {
  CultureStore,
  MAX_CULTURE_CITY_LENGTH,
  MAX_CULTURE_COMPANIONS_LENGTH,
  MAX_CULTURE_LINK_LENGTH,
  MAX_CULTURE_NAME_LENGTH,
  MAX_CULTURE_NOTES_LENGTH,
  MAX_CULTURE_PHOTO_BYTES,
  MAX_CULTURE_PLAYLIST_NAME_LENGTH,
  MAX_CULTURE_TITLE_LENGTH,
  MAX_CULTURE_TRACK_BYTES,
  MAX_CULTURE_TRACK_NUMBER,
  MAX_CULTURE_VENUE_LENGTH,
  type CultureExport,
  type CultureMusicEntry,
  type CulturePlan,
  type CultureVisit,
  type CultureVenue,
  type CultureTrack,
} from "@nexus/db";
import type { ModuleCall, ModuleHostSurface, ModuleSession } from "../../../main/moduleIpc.js";
import {
  contract,
  type CultureArtView,
  type CultureEntryView,
  type CulturePlanView,
  type CultureSettingsView,
  type CultureTrackView,
  type CultureVenueView,
  type CultureView,
  type CultureVisitView,
} from "../shared/ipc.js";
import { readAudioTags } from "./audio.js";
import { readArtDatasets } from "./art.js";
import { cultureSectionOrDefault, parseCultureSection } from "./imex.js";
import { cultureServices } from "./services.js";

/**
 * CULTURE in the main process (ADR-090): its handlers, its archive section, and
 * the two files it needs a path or a key for.
 *
 * **The arithmetic is not here.** Every rule about what a visit, a place, a
 * plan, a track, an entry or a playlist may be lives in `CultureStore`, which is
 * where it is tested. This file validates the wire (SEC-EL-02), reads the store,
 * maps rows onto the wire shapes, and does the two things the store cannot:
 * sniff a file's type (SEC-FILE-02) and garbage-collect a blob whose last row
 * just went away.
 *
 * **A blob is written first and the row second, and a row that fails takes the
 * blob with it.** That is `note-attachments:add`'s arrangement one module over,
 * and the count it consults is main's own union across every table that names a
 * hash - so a failed import cannot orphan a file, and a file another module
 * still shows cannot be collected by this one.
 *
 * **Every mutation answers with the whole view** (`shared/ipc.ts` says why), so
 * this file has one shape of answer and the page has one way to update.
 */

/** The attachment types a visit's ticket may be: a photograph or a PDF, and nothing else. */
const PHOTO_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function store(call: { profileDb: ModuleCall["profileDb"] }, profileId: string): CultureStore {
    return call.profileDb(profileId, (db, id) => new CultureStore(db, id));
  }

  /**
   * The rows as the wire declares them. One mapping, so a column renamed in a
   * migration is a compile error here rather than `undefined` in the renderer.
   *
   * A visit's photos are read one visit at a time: a visit carries a handful
   * (the ticket, maybe a programme page), the read is a prepared statement on an
   * indexed column, and the alternative - a second store method returning every
   * photo grouped by visit - would exist only to save loops over lists this
   * profile's size keeps small.
   */
  function viewOf(call: { profileDb: ModuleCall["profileDb"] }, profileId: string): CultureView {
    const culture = store(call, profileId);
    return {
      visits: culture.listVisits().map(toVisitView(culture)),
      venues: culture.listVenues().map(toVenueView),
      plans: culture.listPlans().map(toPlanView),
      tracks: culture.listTracks().map(toTrackView),
      entries: culture.listEntries().map(toEntryView),
      playlists: culture.listPlaylists().map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        items: culture.listPlaylistItems(playlist.id).map((item) => ({
          id: item.id,
          playlistId: item.playlistId,
          trackId: item.trackId,
          rank: item.rank,
          createdAt: item.createdAt,
        })),
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt,
      })),
      settings: culture.settings() as CultureSettingsView,
    };
  }

  function toVisitView(culture: CultureStore) {
    return (visit: CultureVisit): CultureVisitView => ({
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
      photos: culture.listVisitPhotos(visit.id).map((photo) => ({
        id: photo.id,
        visitId: photo.visitId,
        fileName: photo.fileName,
        mime: photo.mime,
        sizeBytes: photo.sizeBytes,
        sha256: photo.sha256,
        createdAt: photo.createdAt,
      })),
      createdAt: visit.createdAt,
      updatedAt: visit.updatedAt,
    });
  }

  function toVenueView(venue: CultureVenue): CultureVenueView {
    return {
      id: venue.id,
      name: venue.name,
      city: venue.city,
      kind: venue.kind,
      notes: venue.notes,
      createdAt: venue.createdAt,
      updatedAt: venue.updatedAt,
    };
  }

  function toPlanView(plan: CulturePlan): CulturePlanView {
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
  }

  function toTrackView(track: CultureTrack): CultureTrackView {
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
    };
  }

  function toEntryView(entry: CultureMusicEntry): CultureEntryView {
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
  }

  /**
   * Removes one blob now that its last row is gone, counted across every table
   * that names a hash. Called AFTER the store's write, and never before: a count
   * taken before the row went away would say the file is still referenced and
   * quietly keep it forever.
   */
  async function collectBlob(profileId: string, sha256: string): Promise<void> {
    const services = cultureServices();
    await services.deleteBlobIfOrphaned(sha256, services.blobRefCount(profileId, sha256));
  }

  // --- the page's read ------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  // --- visits ---------------------------------------------------------------

  ctx.handle("createVisit", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).createVisit(visitFields(call, payload), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("updateVisit", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).updateVisit(
      call.as.asId(payload.id, "id"),
      visitPatch(call, payload.fields),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("removeVisit", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    // No blob is collected here, and that is the store's rule rather than an
    // omission: a soft-deleted visit KEEPS its photos - their rows stay, and
    // they come back with the visit - so the files are still named and
    // `blobRefCount` still counts them.
    store(call, profileId).softDeleteVisit(
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("addVisitPhoto", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    const fileName = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.fileName, "fileName"),
      "fileName",
      255,
    );
    const bytes = asBytes(payload.bytes, "bytes", MAX_CULTURE_PHOTO_BYTES);
    // SEC-FILE-02: the type is sniffed from the BYTES, never taken from the
    // file name the renderer wrote, and only a picture or a PDF is a ticket.
    const mime = sniffMime(bytes);
    if (!PHOTO_MIMES.has(mime)) {
      throw new Error(
        'Invalid IPC payload: "bytes" must be a PNG, JPEG, GIF, WebP or PDF file.',
      );
    }
    const culture = store(call, profileId);
    const services = cultureServices();
    const { sha256 } = await services.saveBlob(bytes);
    try {
      culture.addVisitPhoto(
        id,
        { fileName, mime, sizeBytes: bytes.byteLength, sha256 },
        instant(call.now()),
      );
    } catch (error) {
      // The blob was already written (write-if-absent); a row that failed to
      // insert must not leave it behind, but only if nothing else names it.
      await collectBlob(profileId, sha256);
      throw error;
    }
    return viewOf(call, profileId);
  });

  ctx.handle("removeVisitPhoto", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const removed = store(call, profileId).removeVisitPhoto(
      call.as.asId(payload.id, "id"),
      call.as.asId(payload.photoId, "photoId"),
    );
    await collectBlob(profileId, removed.sha256);
    return viewOf(call, profileId);
  });

  // --- venues ---------------------------------------------------------------

  ctx.handle("createVenue", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).createVenue(venueFields(call, payload), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("updateVenue", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).updateVenue(
      call.as.asId(payload.id, "id"),
      venuePatch(call, payload.fields),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("removeVenue", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).softDeleteVenue(call.as.asId(payload.id, "id"), instant(call.now()));
    return viewOf(call, profileId);
  });

  // --- the programme --------------------------------------------------------

  ctx.handle("createPlan", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).createPlan(planFields(call, payload), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("updatePlan", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).updatePlan(
      call.as.asId(payload.id, "id"),
      planPatch(call, payload.fields),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("removePlan", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).softDeletePlan(call.as.asId(payload.id, "id"), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("completePlan", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).completePlan(
      call.as.asId(payload.id, "id"),
      completionPatch(call, payload.fields),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  // --- the library ----------------------------------------------------------

  ctx.handle("importTrack", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const fileName = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.fileName, "fileName"),
      "fileName",
      255,
    );
    const bytes = asBytes(payload.bytes, "bytes", MAX_CULTURE_TRACK_BYTES);
    const tags = await readAudioTags(bytes, fileName, {
      title: MAX_CULTURE_TITLE_LENGTH,
      name: MAX_CULTURE_NAME_LENGTH,
      trackNumber: MAX_CULTURE_TRACK_NUMBER,
    });
    const culture = store(call, profileId);
    const services = cultureServices();
    const { sha256 } = await services.saveBlob(bytes);
    try {
      culture.createTrack(
        {
          title: tags.title,
          artist: tags.artist,
          album: tags.album,
          trackNumber: tags.trackNumber,
          releaseYear: tags.releaseYear,
          durationMs: tags.durationMs,
          fileName,
          mime: tags.mime,
          sizeBytes: bytes.byteLength,
          sha256,
        },
        instant(call.now()),
      );
    } catch (error) {
      await collectBlob(profileId, sha256);
      throw error;
    }
    return viewOf(call, profileId);
  });

  ctx.handle("updateTrack", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).updateTrack(
      call.as.asId(payload.id, "id"),
      trackPatch(call, payload.fields),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("removeTrack", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    const culture = store(call, profileId);
    // Read the hash BEFORE the delete: the row is what names it, and a soft
    // delete removes the track from the log's pointers and from every playlist
    // in the same transaction (the store's own rule).
    const track = culture.track(id);
    if (track === null) {
      throw new Error(`No live track "${id}" in this profile.`);
    }
    culture.softDeleteTrack(id, instant(call.now()));
    await collectBlob(profileId, track.sha256);
    return viewOf(call, profileId);
  });

  ctx.handle("recordPlay", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).recordPlay(call.as.asId(payload.id, "id"), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("readTrackBytes", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    const track = store(call, profileId).track(id);
    if (track === null) {
      throw new Error(`No live track "${id}" in this profile.`);
    }
    const bytes = await cultureServices().readBlob(track.sha256);
    if (bytes === null) {
      throw new Error(`The audio of "${track.title}" is not in the blob store.`);
    }
    // The mime is the row's, which main sniffed when the file was imported -
    // never the renderer's claim about what it is about to play.
    return { mime: track.mime, bytes };
  });

  // --- the listening log ----------------------------------------------------

  ctx.handle("createEntry", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).createEntry(entryFields(call, payload), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("updateEntry", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).updateEntry(
      call.as.asId(payload.id, "id"),
      entryPatch(call, payload.fields),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("removeEntry", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).softDeleteEntry(call.as.asId(payload.id, "id"), instant(call.now()));
    return viewOf(call, profileId);
  });

  // --- playlists ------------------------------------------------------------

  ctx.handle("createPlaylist", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).createPlaylist(playlistName(call, payload.name), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("renamePlaylist", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).renamePlaylist(
      call.as.asId(payload.id, "id"),
      playlistName(call, payload.name),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("removePlaylist", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).softDeletePlaylist(
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("addPlaylistTrack", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).addPlaylistTrack(
      call.as.asId(payload.id, "id"),
      call.as.asId(payload.trackId, "trackId"),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("movePlaylistItem", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).movePlaylistItem(
      call.as.asId(payload.id, "id"),
      call.as.asId(payload.itemId, "itemId"),
      nullableId(call, payload.beforeId, "beforeId"),
      nullableId(call, payload.afterId, "afterId"),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("removePlaylistItem", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).removePlaylistItem(
      call.as.asId(payload.id, "id"),
      call.as.asId(payload.itemId, "itemId"),
    );
    return viewOf(call, profileId);
  });

  // --- the module's own preference ------------------------------------------

  ctx.handle("setPromptPastPlans", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).setPromptPastPlans(
      call.as.asBoolean(payload.promptPastPlans, "promptPastPlans"),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  // --- the arts guide -------------------------------------------------------

  ctx.handle("listArt", (): CultureArtView => {
    const services = cultureServices();
    // A pure read of installed packs: nothing here is per-profile, which is why
    // this op takes no profile id and writes nothing.
    const reading = readArtDatasets(services.packsRoot(), services.releasePublicKeyPem());
    return { works: [...reading.works], packs: [...reading.packs], skipped: [...reading.skipped] };
  });

  // --- the archive (ADR-090 §5) ---------------------------------------------

  ctx.exportData((session: ModuleSession) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return store(session, profileId).exportData();
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first - and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseCultureSection,
    // The writing half. `undefined` is an archive that says nothing about
    // CULTURE, which for a restore that replaces a profile whole means the
    // module's shipped state: no rows, and the default preference.
    apply: (payload: CultureExport | undefined, session: ModuleSession) => {
      const section = cultureSectionOrDefault(payload);
      for (const profileId of session.profileIds) {
        store(session, profileId).importData(section, instant(session.now()));
      }
    },
  });

  // The blob hook (ADR-108): the count main's union takes from this module's two
  // hash-naming tables, the mime `nx-blob:` serves a photo as, and the hashes one
  // archive section carries. One registration, in the module's own folder - the
  // two hand-written lines that used to name this module in `main/index.ts` are
  // gone, and a run that adds a third table here has one place to say so.
  ctx.blobs({
    refCount: (session, profileId, sha256) => store(session, profileId).refCount(sha256),
    mimeForHash: (session, profileId, sha256) => store(session, profileId).mimeForHash(sha256),
    exportBlobs: (session) => {
      const profileId = soleProfile(session.profileIds);
      return profileId === null ? [] : sectionBlobs(store(session, profileId).exportData());
    },
    // The payload is what this module's own `parse` answered - the host parses
    // before asking - and an absent one means the shipped default, exactly as
    // `apply` reads it.
    importBlobs: (payload) =>
      sectionBlobs(cultureSectionOrDefault(payload as CultureExport | undefined)),
  });
}

/**
 * Every blob one CULTURE section names: each visit's photos and each track's
 * audio, with the sizes the rows state.
 *
 * Read off the EXPORT value rather than the raw tables, so the list is exactly
 * the rows the archive carries - a soft-deleted track is in neither - and so
 * the export and import halves cannot disagree about which rows exist.
 */
function sectionBlobs(section: CultureExport): { sha256: string; sizeBytes: number }[] {
  return [
    ...section.visits.flatMap((visit) =>
      visit.photos.map((photo) => ({ sha256: photo.sha256, sizeBytes: photo.sizeBytes })),
    ),
    ...section.tracks.map((track) => ({ sha256: track.sha256, sizeBytes: track.sizeBytes })),
  ];
}

/** The one profile a session is about, or `null` when it names none or several (an archive is written one profile at a time). */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** The validators a payload reader is handed, as `main/moduleIpc.ts` types them. */
type As = ModuleCall["as"];

/** A mutable partial of one of the store's patch shapes, so a reader can fill in only the keys the caller sent. */
type Draft<T> = { -readonly [K in keyof T]?: T[K] };

/**
 * A `Uint8Array` off the wire, bounded.
 *
 * The shared validator set (`main/ipcValidators.ts`) has no byte reader: notes,
 * tasks and subjects validate theirs beside their own handlers in `index.ts`,
 * and this module does the same in its own folder rather than widening the kit's
 * shared set for one module's sake. The rules are that reader's rules, message
 * for message.
 */
function asBytes(value: unknown, field: string, maxBytes: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(`Invalid IPC payload: "${field}" must be a non-empty Uint8Array.`);
  }
  if (value.byteLength > maxBytes) {
    throw new Error(`Invalid IPC payload: "${field}" must not exceed ${maxBytes} bytes.`);
  }
  return value;
}

function nullableId(call: { as: As }, value: unknown, field: string): string | null {
  return value === null ? null : call.as.asId(value, field);
}

function visitKind(call: { as: As }, value: unknown): VisitKind {
  const kind = call.as.asString(value, "kind");
  if (!(VISIT_KIND_SET as ReadonlySet<string>).has(kind)) {
    throw new Error(`Invalid IPC payload: "kind" is not one of the visit kinds.`);
  }
  return kind as VisitKind;
}

const VISIT_KIND_SET: ReadonlySet<VisitKind> = new Set(
  (
    [
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
    ] as const
  ).map((kind) => kind),
);

function rating(call: { as: As }, value: unknown): number | null {
  if (value === null) return null;
  return call.as.asBoundedInteger(value, "rating", MIN_CULTURE_RATING, MAX_CULTURE_RATING);
}

function price(call: { as: As }, value: unknown): { minorUnits: number; currency: string } | null {
  if (value === null) return null;
  const record = call.as.asRecord(value);
  const minorUnits = call.as.asBoundedInteger(record["minorUnits"], "price.minorUnits", 0, 2 ** 31 - 1);
  const currency = call.as.asString(record["currency"], "price.currency");
  // The three-letter upper-case shape migration 073's CHECK holds; the store
  // revalidates the pair, so this only has to refuse a shape the wire may not
  // carry in the first place.
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error('Invalid IPC payload: "price.currency" must be a three-letter code.');
  }
  return { minorUnits, currency };
}

/**
 * A nullable text field off the wire, capped in CHARACTERS (the store's own
 * unit): `null` passes through as `null`, and anything else has to be a string
 * within its bound. The `null` arm is checked BEFORE the cap, because a field
 * whose whole meaning is "cleared" is not a string.
 */
function optionalText(call: { as: As }, value: unknown, field: string, max: number): string | null {
  const text = call.as.asNullableString(value, field);
  return text === null ? null : call.as.asCappedChars(text, field, max);
}

/** A whole visit off the wire, as `createVisit` takes it. */
function visitFields(call: { as: As }, raw: unknown): Parameters<CultureStore["createVisit"]>[0] {
  const body = call.as.asRecord(raw);
  return {
    kind: visitKind(call, body["kind"]),
    title: call.as.asCappedChars(body["title"], "title", MAX_CULTURE_TITLE_LENGTH),
    venue: call.as.asCappedChars(body["venue"], "venue", MAX_CULTURE_VENUE_LENGTH),
    city: optionalText(call, body["city"], "city", MAX_CULTURE_CITY_LENGTH),
    date: call.as.asString(body["date"], "date"),
    startTime: optionalText(call, body["startTime"], "startTime", 5),
    rating: rating(call, body["rating"]),
    notes: call.as.asCappedChars(body["notes"], "notes", MAX_CULTURE_NOTES_LENGTH),
    price: price(call, body["price"]),
    companions: optionalText(call, body["companions"], "companions", MAX_CULTURE_COMPANIONS_LENGTH),
  };
}

function visitPatch(call: { as: As }, raw: unknown): Draft<Parameters<CultureStore["updateVisit"]>[1]> {
  const body = call.as.asRecord(raw);
  const patch: Draft<Parameters<CultureStore["updateVisit"]>[1]> = {};
  if ("kind" in body) patch.kind = visitKind(call, body["kind"]);
  if ("title" in body) {
    patch.title = call.as.asCappedChars(body["title"], "title", MAX_CULTURE_TITLE_LENGTH);
  }
  if ("venue" in body) {
    patch.venue = call.as.asCappedChars(body["venue"], "venue", MAX_CULTURE_VENUE_LENGTH);
  }
  if ("city" in body) patch.city = optionalText(call, body["city"], "city", MAX_CULTURE_CITY_LENGTH);
  if ("date" in body) patch.date = call.as.asString(body["date"], "date");
  if ("startTime" in body) {
    patch.startTime = optionalText(call, body["startTime"], "startTime", 5);
  }
  if ("rating" in body) patch.rating = rating(call, body["rating"]);
  if ("notes" in body) {
    patch.notes = call.as.asCappedChars(body["notes"], "notes", MAX_CULTURE_NOTES_LENGTH);
  }
  if ("price" in body) patch.price = price(call, body["price"]);
  if ("companions" in body) {
    patch.companions = optionalText(
      call,
      body["companions"],
      "companions",
      MAX_CULTURE_COMPANIONS_LENGTH,
    );
  }
  return patch;
}

function venueFields(call: { as: As }, raw: unknown): Parameters<CultureStore["createVenue"]>[0] {
  const body = call.as.asRecord(raw);
  return {
    name: call.as.asCappedChars(body["name"], "name", MAX_CULTURE_VENUE_LENGTH),
    city: optionalText(call, body["city"], "city", MAX_CULTURE_CITY_LENGTH),
    kind: visitKind(call, body["kind"]),
    notes: call.as.asCappedChars(body["notes"], "notes", MAX_CULTURE_NOTES_LENGTH),
  };
}

function venuePatch(call: { as: As }, raw: unknown): Draft<Parameters<CultureStore["updateVenue"]>[1]> {
  const body = call.as.asRecord(raw);
  const patch: Draft<Parameters<CultureStore["updateVenue"]>[1]> = {};
  if ("name" in body) {
    patch.name = call.as.asCappedChars(body["name"], "name", MAX_CULTURE_VENUE_LENGTH);
  }
  if ("city" in body) patch.city = optionalText(call, body["city"], "city", MAX_CULTURE_CITY_LENGTH);
  if ("kind" in body) patch.kind = visitKind(call, body["kind"]);
  if ("notes" in body) {
    patch.notes = call.as.asCappedChars(body["notes"], "notes", MAX_CULTURE_NOTES_LENGTH);
  }
  return patch;
}

function planFields(call: { as: As }, raw: unknown): Parameters<CultureStore["createPlan"]>[0] {
  const body = call.as.asRecord(raw);
  return {
    kind: visitKind(call, body["kind"]),
    title: call.as.asCappedChars(body["title"], "title", MAX_CULTURE_TITLE_LENGTH),
    venue: call.as.asCappedChars(body["venue"], "venue", MAX_CULTURE_VENUE_LENGTH),
    city: optionalText(call, body["city"], "city", MAX_CULTURE_CITY_LENGTH),
    date: call.as.asString(body["date"], "date"),
    startTime: optionalText(call, body["startTime"], "startTime", 5),
    link: optionalText(call, body["link"], "link", MAX_CULTURE_LINK_LENGTH),
    notes: call.as.asCappedChars(body["notes"], "notes", MAX_CULTURE_NOTES_LENGTH),
  };
}

function planPatch(call: { as: As }, raw: unknown): Draft<Parameters<CultureStore["updatePlan"]>[1]> {
  const body = call.as.asRecord(raw);
  const patch: Draft<Parameters<CultureStore["updatePlan"]>[1]> = {};
  if ("kind" in body) patch.kind = visitKind(call, body["kind"]);
  if ("title" in body) {
    patch.title = call.as.asCappedChars(body["title"], "title", MAX_CULTURE_TITLE_LENGTH);
  }
  if ("venue" in body) {
    patch.venue = call.as.asCappedChars(body["venue"], "venue", MAX_CULTURE_VENUE_LENGTH);
  }
  if ("city" in body) patch.city = optionalText(call, body["city"], "city", MAX_CULTURE_CITY_LENGTH);
  if ("date" in body) patch.date = call.as.asString(body["date"], "date");
  if ("startTime" in body) {
    patch.startTime = optionalText(call, body["startTime"], "startTime", 5);
  }
  if ("link" in body) patch.link = optionalText(call, body["link"], "link", MAX_CULTURE_LINK_LENGTH);
  if ("notes" in body) {
    patch.notes = call.as.asCappedChars(body["notes"], "notes", MAX_CULTURE_NOTES_LENGTH);
  }
  return patch;
}

/** The plan's own "I went", as the page sends it: the visit fields the evening turned out to need, and nothing the plan already is. */
function completionPatch(call: { as: As }, raw: unknown): Draft<Parameters<CultureStore["completePlan"]>[1]> {
  const body = call.as.asRecord(raw);
  const patch: Draft<Parameters<CultureStore["completePlan"]>[1]> = {};
  if ("kind" in body) patch.kind = visitKind(call, body["kind"]);
  if ("title" in body) {
    patch.title = call.as.asCappedChars(body["title"], "title", MAX_CULTURE_TITLE_LENGTH);
  }
  if ("startTime" in body) {
    patch.startTime = optionalText(call, body["startTime"], "startTime", 5);
  }
  if ("rating" in body) patch.rating = rating(call, body["rating"]);
  if ("notes" in body) {
    patch.notes = call.as.asCappedChars(body["notes"], "notes", MAX_CULTURE_NOTES_LENGTH);
  }
  if ("companions" in body) {
    patch.companions = optionalText(
      call,
      body["companions"],
      "companions",
      MAX_CULTURE_COMPANIONS_LENGTH,
    );
  }
  return patch;
}

function trackPatch(call: { as: As }, raw: unknown): Draft<Parameters<CultureStore["updateTrack"]>[1]> {
  const body = call.as.asRecord(raw);
  const patch: Draft<Parameters<CultureStore["updateTrack"]>[1]> = {};
  if ("title" in body) {
    patch.title = call.as.asCappedChars(body["title"], "title", MAX_CULTURE_TITLE_LENGTH);
  }
  if ("artist" in body) {
    patch.artist = optionalText(call, body["artist"], "artist", MAX_CULTURE_NAME_LENGTH);
  }
  if ("album" in body) {
    patch.album = optionalText(call, body["album"], "album", MAX_CULTURE_NAME_LENGTH);
  }
  if ("trackNumber" in body) {
    patch.trackNumber =
      body["trackNumber"] === null
        ? null
        : call.as.asBoundedInteger(body["trackNumber"], "trackNumber", 1, MAX_CULTURE_TRACK_NUMBER);
  }
  if ("releaseYear" in body) {
    patch.releaseYear =
      body["releaseYear"] === null
        ? null
        : call.as.asBoundedInteger(body["releaseYear"], "releaseYear", 1000, 9999);
  }
  if ("durationMs" in body) {
    patch.durationMs = call.as.asBoundedInteger(body["durationMs"], "durationMs", 0, 86_400_000);
  }
  return patch;
}

function entryFields(call: { as: As }, raw: unknown): Parameters<CultureStore["createEntry"]>[0] {
  const body = call.as.asRecord(raw);
  return {
    artist: call.as.asCappedChars(body["artist"], "artist", MAX_CULTURE_NAME_LENGTH),
    title: call.as.asCappedChars(body["title"], "title", MAX_CULTURE_TITLE_LENGTH),
    kind: musicLogKind(call, body["kind"]),
    date: call.as.asString(body["date"], "date"),
    rating: rating(call, body["rating"]),
    notes: call.as.asCappedChars(body["notes"], "notes", MAX_CULTURE_NOTES_LENGTH),
    trackId: nullableId(call, body["trackId"], "trackId"),
  };
}

function entryPatch(call: { as: As }, raw: unknown): Draft<Parameters<CultureStore["updateEntry"]>[1]> {
  const body = call.as.asRecord(raw);
  const patch: Draft<Parameters<CultureStore["updateEntry"]>[1]> = {};
  if ("artist" in body) {
    patch.artist = call.as.asCappedChars(body["artist"], "artist", MAX_CULTURE_NAME_LENGTH);
  }
  if ("title" in body) {
    patch.title = call.as.asCappedChars(body["title"], "title", MAX_CULTURE_TITLE_LENGTH);
  }
  if ("kind" in body) patch.kind = musicLogKind(call, body["kind"]);
  if ("date" in body) patch.date = call.as.asString(body["date"], "date");
  if ("rating" in body) patch.rating = rating(call, body["rating"]);
  if ("notes" in body) {
    patch.notes = call.as.asCappedChars(body["notes"], "notes", MAX_CULTURE_NOTES_LENGTH);
  }
  if ("trackId" in body) patch.trackId = nullableId(call, body["trackId"], "trackId");
  return patch;
}

function musicLogKind(call: { as: As }, value: unknown): Parameters<CultureStore["createEntry"]>[0]["kind"] {
  const kind = call.as.asString(value, "kind");
  if (!MUSIC_LOG_KIND_SET.has(kind)) {
    throw new Error(`Invalid IPC payload: "kind" is not one of the listening kinds.`);
  }
  return kind as Parameters<CultureStore["createEntry"]>[0]["kind"];
}

const MUSIC_LOG_KIND_SET: ReadonlySet<string> = new Set(["album", "track", "live", "other"]);

function playlistName(call: { as: As }, value: unknown): string {
  return call.as.asCappedChars(value, "name", MAX_CULTURE_PLAYLIST_NAME_LENGTH);
}
