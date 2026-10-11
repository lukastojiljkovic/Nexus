import type { Citation, SourceKind } from "@nexus/core";

/**
 * A CITATION TO A PAGE ON THE OPEN WEB, AND THE ONE PLACE THE CONTRACT'S
 * `SourceKind` IS WIDENED (ADR-097).
 *
 * `SourceKind` carries `wiki` - which is Wikipedia, and the web service uses it
 * for exactly that - and no member for „a page on the open web". A SearXNG or
 * Brave result is not a pack, not a note, not a task, not a file and not the
 * app manual, so typing it as any of those would put a WRONG LABEL on a source
 * the user may click: a surface that switches on `kind` to decide where a
 * citation opens would send a news article to the notes view.
 *
 * The contract is not edited (its own header forbids it, and it is shared with
 * seven other parts of the assistant). What happens instead is written down
 * here: the value the service produces is `"web"`, the type it produces it
 * under is this local widening, and the ONE cast below is the boundary where
 * the wider value meets the narrower contract type. When `SourceKind` gains a
 * `"web"` member, this file shrinks to a re-export and the cast disappears.
 *
 * A web citation's ID and locator are both the URL, and that is not redundancy:
 * `id` is what makes two citations the same source, and `locator` is what a
 * surface prints as „where in the source this came from". For a web page the
 * honest answer to both questions is the address - and the address is also what
 * the user needs in hand to open the page themselves, which is why the content
 * of both tools carries it as selectable text. `Citation` has no `url` field,
 * so this is the shape it can be said in.
 */
export type WebSourceKind = SourceKind | "web";

export function webCitation(kind: WebSourceKind, url: string, title: string): Citation {
  const citation = {
    kind,
    id: url,
    title: title.trim() === "" ? url : title.trim(),
    locator: url,
  };
  // See the header: the contract type is narrower than the value by design, and
  // this is the single line where the two meet.
  return citation as Citation;
}
