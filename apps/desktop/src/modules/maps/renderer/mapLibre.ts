/**
 * MapLibre's worker, named once for the renderer, before any map is made.
 *
 * **Why it has to be named.** MapLibre finds its worker file beside its own
 * module only when that module was loaded over http(s). The packaged app loads
 * from `file://`, where MapLibre names no worker at all, starts one on the page's
 * own HTML, and every source then waits forever: the map drew nothing in a
 * packaged build, while `pnpm dev` (http) worked. The worker module carries no
 * imports, so the bundle copies it as one file and this names it.
 */
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);
