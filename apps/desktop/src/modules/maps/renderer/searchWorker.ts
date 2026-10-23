import { PMTiles } from "pmtiles";

import { isOwnOrigin } from "../../../shared/workerOrigin.js";
import { foldPlaces, rankPlaces, type FoldedPlace, type MapPlace, type PlaceHit } from "@nexus/core";
import { MAP_REGION_DETAILS, type MapRegionDetail } from "../shared/ipc.js";
import { indexTiles, mergePlaces, readRegionPlaces } from "./placeIndex.js";

/**
 * The place search, off the UI thread.
 *
 * **Why a worker and not a `useMemo`.** A region's index is every named place
 * in its tiles — tens of thousands of rows — and a ranking walks all of them
 * per keystroke. On the UI thread that is a stall a person feels while typing,
 * which is the exact failure the project's rule about heavy work exists for
 * ("engines, search and AI moves run in a Web Worker, never on the UI thread").
 * So the index is folded once, here, and every later question is a message.
 *
 * **Why the worker owns the loading as well as the searching.** Reading the
 * places out of a region's tiles is the expensive half, and it happens once per
 * region; doing it in the page and posting the folded index across would pay to
 * serialise what the worker is about to build anyway. The page therefore says
 * which regions are installed and asks one question — "what matches this?" —
 * and is told either an answer or that the index itself could not be read.
 *
 * **A question asked before the index is ready is QUEUED, never dropped.** The
 * page starts the worker when the map does and a person can type into the box
 * during the milliseconds it takes to read a region's tiles; an answer that
 * never came for the first keystroke would look exactly like a search that
 * found nothing.
 */

/** One question from the page. */
export interface SearchRequest {
  readonly type: "search";
  /** Echoed back with the answer, so a late reply for an older query can be ignored. */
  readonly id: number;
  readonly query: string;
  readonly limit: number;
}

/** The installed regions the index is read from, sent whenever they change. */
export interface RegionsMessage {
  readonly type: "regions";
  readonly regions: readonly { readonly id: string; readonly detail: MapRegionDetail; readonly url: string }[];
}

/** Everything the page sends. */
export type SearchMessage = SearchRequest | RegionsMessage;

/** One answer for the page. */
export type SearchResponse =
  | { readonly type: "ready"; readonly count: number }
  | { readonly type: "failed" }
  | { readonly type: "results"; readonly id: number; readonly hits: readonly PlaceHit[] };

/**
 * The worker's own global, typed by hand.
 *
 * `lib` in this project is the standard library of the RENDERER, and a worker's
 * global is not it: `self.postMessage(message)` there takes one argument, where
 * `window.postMessage` takes two. Pulling `WebWorker` into the program would
 * redeclare a few dozen globals the DOM lib already declares, so this file
 * states the two members it uses instead.
 */
interface WorkerScope {
  postMessage(message: SearchResponse): void;
  onmessage: ((event: { readonly data: SearchMessage; readonly origin: string }) => void) | null;
  readonly location: { readonly origin: string };
}

const scope = self as unknown as WorkerScope;

/** Where the index stands: being read (or never asked for), read, or unreadable. */
type IndexState =
  | { readonly kind: "pending" }
  | { readonly kind: "ready"; readonly index: readonly FoldedPlace[] }
  | { readonly kind: "failed" };

let state: IndexState = { kind: "pending" };
/** Questions asked while the index was pending. */
const queued: SearchRequest[] = [];
/**
 * Each region's read, by its url, held while it runs as well as once it is done:
 * two lists that arrive together must not read one file twice. A region's file
 * name is immutable (a new build is a new file), so a region read once is never
 * read again in this worker's life.
 */
const cache = new Map<string, Promise<MapPlace[]>>();
/** Counts the regions messages, so a read still running for an older list drops its answer. */
let generation = 0;

function answer(request: SearchRequest, index: readonly FoldedPlace[]): SearchResponse {
  return { type: "results", id: request.id, hits: rankPlaces(index, request.query, request.limit) };
}

scope.onmessage = (event: { readonly data: SearchMessage; readonly origin: string }) => {
  if (!isOwnOrigin(event.origin, scope.location.origin)) return;
  const message = event.data;
  if (message.type === "regions") {
    void load(message.regions);
    return;
  }
  if (state.kind === "ready") {
    scope.postMessage(answer(message, state.index));
    return;
  }
  if (state.kind === "failed") {
    scope.postMessage({ type: "results", id: message.id, hits: [] });
    return;
  }
  queued.push(message);
};

/** One region's places, read once; see {@link cache}. */
function placesOf(region: RegionsMessage["regions"][number]): Promise<MapPlace[]> {
  let read = cache.get(region.url);
  if (read === undefined) {
    read = readRegionPlaces(new PMTiles(region.url), indexTiles(region.id, region.detail));
    cache.set(region.url, read);
  }
  return read;
}

/** Reads the places of the installed regions, most detailed first, and answers the questions queued meanwhile. */
async function load(regions: RegionsMessage["regions"]): Promise<void> {
  const current = (generation += 1);
  state = { kind: "pending" };
  for (const url of cache.keys()) {
    if (!regions.some((region) => region.url === url)) cache.delete(url);
  }
  // The first list wins a place two regions share, so the more detailed one goes first.
  const detailFirst = [...regions].sort(
    (left, right) => MAP_REGION_DETAILS.indexOf(right.detail) - MAP_REGION_DETAILS.indexOf(left.detail),
  );
  const lists: MapPlace[][] = [];
  for (const region of detailFirst) {
    try {
      lists.push(await placesOf(region));
    } catch (error) {
      // A failed read is not kept, so the next list that names this region reads it again.
      cache.delete(region.url);
      // Console only: the page draws its own sentence, and a worker's exception
      // reaches nobody (it is not on the page's stack). The URL is an argument, not
      // part of the first one, which the console reads as a format string.
      console.error("Nexus: a map region could not be read:", region.url, error);
    }
  }
  // A newer list has started: its answer replaces this one, and the questions stay queued for it.
  if (current !== generation) return;
  if (lists.length === 0 && regions.length > 0) {
    state = { kind: "failed" };
    scope.postMessage({ type: "failed" });
    for (const request of queued.splice(0)) scope.postMessage({ type: "results", id: request.id, hits: [] });
    return;
  }
  const index = foldPlaces(mergePlaces(lists));
  state = { kind: "ready", index };
  scope.postMessage({ type: "ready", count: index.length });
  for (const request of queued.splice(0)) scope.postMessage(answer(request, index));
}
