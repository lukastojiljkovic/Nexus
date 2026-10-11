import { foldPlaces, parsePlacesFile, rankPlaces, type FoldedPlace, type PlaceHit } from "@nexus/core";
import { MAP_PACK_PLACES } from "../shared/packs.js";
import { readPackJson } from "./packFile.js";

/**
 * The place search, off the UI thread.
 *
 * **Why a worker and not a `useMemo`.** The pack's index is every named place
 * in the region — tens of thousands of rows — and a ranking walks all of them
 * per keystroke. On the UI thread that is a stall a person feels while typing,
 * which is the exact failure the project's rule about heavy work exists for
 * ("engines, search and AI moves run in a Web Worker, never on the UI thread").
 * So the index is folded once, here, and every later question is a message.
 *
 * **Why the worker owns the loading as well as the searching.** Folding the
 * index is the expensive half of reading the pack, and it happens exactly once;
 * doing it in the page and posting the folded index across would pay to
 * serialise what the worker is about to build anyway. The page therefore asks
 * one question — "what matches this?" — and is told either an answer or that the
 * index itself could not be read.
 *
 * **A question asked before the index is ready is QUEUED, never dropped.** The
 * page starts the worker when the map does and a person can type into the box
 * during the milliseconds it takes to fold 40 000 names; an answer that never
 * came for the first keystroke would look exactly like a search that found
 * nothing.
 */

/** One question from the page. */
export interface SearchRequest {
  readonly type: "search";
  /** Echoed back with the answer, so a late reply for an older query can be ignored. */
  readonly id: number;
  readonly query: string;
  readonly limit: number;
}

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
  onmessage: ((event: { readonly data: SearchRequest }) => void) | null;
}

const scope = self as unknown as WorkerScope;

/** The folded index, or `null` until the pack has been read. */
let index: readonly FoldedPlace[] | null = null;
/** Whether the pack could not be read at all — a different answer from "no matches". */
let failed = false;
/** Questions asked before the index was ready. */
const queued: SearchRequest[] = [];

function answer(request: SearchRequest): SearchResponse {
  return {
    type: "results",
    id: request.id,
    hits: rankPlaces(index ?? [], request.query, request.limit),
  };
}

scope.onmessage = (event: { readonly data: SearchRequest }) => {
  const request = event.data;
  if (request.type !== "search") return;
  if (index !== null) {
    scope.postMessage(answer(request));
    return;
  }
  if (failed) {
    scope.postMessage({ type: "results", id: request.id, hits: [] });
    return;
  }
  queued.push(request);
};

void (async () => {
  try {
    const file = parsePlacesFile(await readPackJson(MAP_PACK_PLACES));
    index = foldPlaces(file.places);
    scope.postMessage({ type: "ready", count: index.length });
    for (const request of queued.splice(0)) scope.postMessage(answer(request));
  } catch (error) {
    failed = true;
    // Console only: the page draws its own sentence, and a worker's exception
    // reaches nobody (it is not on the page's stack).
    console.error("Nexus: the map pack's place index could not be read:", error);
    scope.postMessage({ type: "failed" });
    for (const request of queued.splice(0)) {
      scope.postMessage({ type: "results", id: request.id, hits: [] });
    }
  }
})();
