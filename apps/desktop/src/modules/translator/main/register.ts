import type { ModuleHostSurface } from "../../../main/moduleIpc.js";
import { readInstalled } from "../../../main/packs/registry.js";
import {
  TRANSLATOR_DIRECTION_CHOICES,
  contract,
  type TranslatorDirectionChoice,
  type TranslatorPacksView,
} from "../shared/ipc.js";
import { createDictionaryReader } from "./dictionary.js";
import { installedPacksRoot } from "./packDir.js";

/**
 * TRANSLATOR in the main process (ADR-090): three reads over a content pack, and
 * the list of installed packs the sentence translator's models come from.
 *
 * **Why there is no store here.** The dictionary is not the user's data — it is
 * a signed pack on the machine (ADR-091), the same for every profile — and a
 * lookup writes nothing. So this module has no migration, no table and no
 * archive section: `exportData` is never registered, because a module with
 * nothing to say is omitted from `data/modules.ndjson` rather than written as an
 * empty object. The two things a profile owns (the direction the page opens on,
 * the recents list) are device preferences in the renderer's `localStorage`,
 * which is where a preference that changes no stored row belongs.
 *
 * The reads themselves live in `dictionary.ts`, which the assistant's tools use
 * too; this file validates what the page sends and answers the channels.
 */

/** How long a query may be. A cap on untrusted input, far past the longest headword in either language. */
const MAX_QUERY_CHARS = 80;

/** How many prefix neighbours one search answers with, and the ceiling a caller may ask for. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);
  const dictionary = createDictionaryReader(installedPacksRoot);

  ctx.handle("status", (payload, call) => {
    // The payload is empty by contract, and it is still validated: a channel
    // that accepted anything would accept a renderer's idea of a shape it was
    // never promised, which is the thing SEC-EL-02 asks every handler to refuse.
    call.as.asRecord(payload);
    return dictionary.status();
  });

  ctx.handle("search", (payload, call) => {
    const record = call.as.asRecord(payload);
    const requested = directionChoice(record["direction"]);
    const query = call.as.asCappedChars(call.as.asString(record["query"], "query"), "query", MAX_QUERY_CHARS);
    const limit =
      record["limit"] === undefined
        ? DEFAULT_LIMIT
        : call.as.asBoundedInteger(record["limit"], "limit", 1, MAX_LIMIT);
    return dictionary.search(requested, query, limit);
  });

  ctx.handle("phrases", (payload, call) => {
    call.as.asRecord(payload);
    return dictionary.phrases();
  });

  /**
   * The installed packs, for the sentence translator's model lookup.
   *
   * **Why main lists them rather than the renderer.** A pack is a signed folder
   * on this machine (ADR-091), and the kit's whole point is that a renderer never
   * names one to read: the list comes from the registry — the same
   * `readInstalled` the Packs card draws — and what crosses the wire is an id and
   * a kind, never a path. The sentence surface turns those into `nx-pack://`
   * URLs, which `protocol.handle` answers out of the signed folder.
   *
   * The dictionary this module searches is read through `packDir.ts` (its own
   * `about.json` format, not the ADR-091 manifest), which is why the two readers
   * are different: the *model* packs this answers about are ordinary content
   * packs, and their manifests are the registry's business.
   */
  ctx.handle("packs", (payload, call) => {
    call.as.asRecord(payload);
    const access = ctx.packs();
    const installed = readInstalled(access.userData(), access.publicKeyPem);
    return {
      packs: installed.map((entry) => ({ id: entry.manifest.id, kind: entry.manifest.kind })),
    } satisfies TranslatorPacksView;
  });
}

/** The switch's closed vocabulary, refused by name rather than defaulted. */
function directionChoice(value: unknown): TranslatorDirectionChoice {
  if (typeof value === "string" && (TRANSLATOR_DIRECTION_CHOICES as readonly string[]).includes(value)) {
    return value as TranslatorDirectionChoice;
  }
  throw new Error(
    `Invalid IPC payload: "direction" must be one of ${TRANSLATOR_DIRECTION_CHOICES.join(", ")}.`,
  );
}
