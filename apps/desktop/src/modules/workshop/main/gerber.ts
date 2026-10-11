import gerberToSvg from "gerber-to-svg";
import { gerberBoxMm } from "@nexus/core";

/**
 * Gerber and Excellon as SVG, through `gerber-to-svg` - in MAIN, and that is the
 * one place this module's Gerber half differs from the shape the brief sketched.
 *
 * **Why not the parse worker.** `gerber-to-svg` is a Node-first CommonJS library:
 * its own code and the whole of `readable-stream` behind it need Node's `events`
 * and `buffer` builtins, and a browser bundle has neither. Measured, not assumed:
 * a Vite build with this import prints
 * `Module "events" has been externalized for browser compatibility` for
 * `readable-stream/lib/_stream_readable.js` and
 * `Module "buffer" has been externalized for browser compatibility` for
 * `readable-stream/lib/internal/streams/buffer_list.js` and for
 * `safe-buffer/index.js`, and Vite replaces each with a module that throws on
 * first property access - so the build stays green and the first Gerber file
 * crashes at run time. The two ways out are installing the polyfills
 * (`events@3`, `buffer@6`) or shipping the library's own prebuilt browser
 * bundle, and neither is available here: this task may not run `pnpm install`
 * (the sandbox forbids it), and adding a dependency without updating the
 * lockfile would break the frozen install in CI.
 *
 * **What that costs.** The conversion runs on main's thread rather than off the
 * UI thread, so it is bounded by the file cap `GERBER_MAX_BYTES` (8 MiB) - a
 * Gerber file is kilobytes to hundreds of kilobytes in practice, and the cap is
 * what guarantees a picked file cannot make the app stutter. The model and
 * toolpath halves of this module, which are the ones a maker opens megabytes of,
 * DO run in the worker exactly as the brief requires; only this library-bound
 * path is main's.
 *
 * **What this file is.** The library call and its three answers in one place:
 * the SVG, the size in millimetres, and where the layer's box starts. Classifying
 * a file and measuring a board from its layers are pure and live in
 * `@nexus/core` (`workshop/gerber.ts`), tested on their own.
 */

/** One converted layer: what the page draws, and the box the board's size is measured from. */
export interface ConvertedLayer {
  readonly svg: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly originXmm: number;
  readonly originYmm: number;
}

/**
 * Converts one file, or answers `null` when the library will not read it.
 *
 * The library reports a malformed file through its callback's error and
 * sometimes by throwing, so both are turned into the one `null` the caller maps
 * onto its `not-gerber` refusal: a viewer's job is to say "this is not a board
 * file I can read" in the reader's language, not to forward a parser's sentence.
 *
 * `id` is the SVG's internal id prefix, and it has to differ per layer: the
 * library's own documentation says the ids it assigns reference each other, so
 * two layers sharing a prefix would have one layer's definitions answered by the
 * other's. The layer's index is that prefix, which is why it is a parameter.
 */
export async function convertLayer(source: string, id: string): Promise<ConvertedLayer | null> {
  try {
    let converter: ReturnType<typeof gerberToSvg> | null = null;
    const svg = await new Promise<string>((resolve, reject) => {
      converter = gerberToSvg(source, { id }, (error: Error | null, rendered: string) => {
        if (error) reject(error);
        else resolve(rendered);
      });
    });
    if (converter === null) return null;
    // Read AFTER the callback fires, which is the moment the parse is complete:
    // the converter's own viewBox, width and height are what its API documents
    // as the finished answers, and before then they are unset.
    const finished = (
      converter as unknown as {
        viewBox: number[];
        width: number;
        height: number;
      }
    );
    const box = gerberBoxMm("other", finished.viewBox, finished.width, finished.height);
    // A file with no geometry in it renders without complaint and measures zero:
    // the library will happily hand back a 0 x 0 mm SVG for prose. A layer with
    // no size is nothing to show, so it is refused with the rest of the files
    // that could not be read rather than opening an empty board.
    if (!(finished.width > 0) || !(finished.height > 0)) return null;
    return {
      svg,
      widthMm: finished.width,
      heightMm: finished.height,
      originXmm: box.originXmm,
      originYmm: box.originYmm,
    };
  } catch {
    return null;
  }
}
