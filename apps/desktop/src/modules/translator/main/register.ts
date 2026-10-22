import { randomUUID } from "node:crypto";

import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import { packVersionDir, readInstalled } from "../../../main/packs/registry.js";
import {
  NLLB_PACK_IDS,
  TRANSLATOR_DIRECTION_CHOICES,
  TRANSLATOR_TEXT_MAX_CHARS,
  contract,
  type NllbPackId,
  type TranslatorDirectionChoice,
  type TranslatorPacksView,
} from "../shared/ipc.js";
import { languageByCode, type NllbLanguage } from "../shared/languages.js";
import { createDictionaryReader } from "./dictionary.js";
import { createNllbHost, type NllbHost } from "./nllb/host.js";
import { TranslationJobs } from "./nllb/jobs.js";
import { NLLB_WORKER_ENTRY } from "./nllb/workerEntry.js";
import { installedPacksRoot } from "./packDir.js";

/**
 * TRANSLATOR in the main process (ADR-090): three reads over a content pack, and
 * the list of installed packs the Translate tab's models come from.
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
  // Started on the first translation, not at registration: most sessions never
  // open the translator, and the worker costs a process.
  let worker: NllbHost | null = null;
  const jobs = new TranslationJobs(() => (worker ??= createNllbHost(NLLB_WORKER_ENTRY)), randomUUID);

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
   * The installed packs, for the Translate tab's model lookup.
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

  /**
   * A translation with an installed NLLB pack. The page names the pack by id,
   * and main finds its folder in the registry: a path never crosses the wire.
   */
  ctx.handle("translate", (payload, call) => {
    const record = call.as.asRecord(payload);
    const packId = nllbPackOf(record["packId"]);
    const text = call.as.asCappedChars(
      call.as.asNonEmptyString(record["text"], "text"),
      "text",
      TRANSLATOR_TEXT_MAX_CHARS,
    );
    if (text.trim() === "") throw new Error('Invalid IPC payload: "text" must not be blank.');
    const source = languageOf(call, record["source"], "source");
    const target = languageOf(call, record["target"], "target");
    if (source.code === target.code) {
      throw new Error('Invalid IPC payload: "source" and "target" must be two languages.');
    }
    const access = ctx.packs();
    const installed = readInstalled(access.userData(), access.publicKeyPem).find(
      (entry) => entry.manifest.id === packId,
    );
    if (installed === undefined) throw new Error(`The translator model "${packId}" is not installed.`);
    const directory = packVersionDir(access.userData(), packId, installed.manifest.version);
    return { jobId: jobs.start({ directory, text, source, target }) };
  });

  ctx.handle("translation", (payload, call) => {
    const record = call.as.asRecord(payload);
    return jobs.poll(call.as.asId(record["jobId"], "jobId"));
  });

  ctx.handle("cancelTranslation", (payload, call) => {
    const record = call.as.asRecord(payload);
    jobs.cancel(call.as.asId(record["jobId"], "jobId"));
    return null;
  });
}

function nllbPackOf(value: unknown): NllbPackId {
  if (typeof value === "string" && (NLLB_PACK_IDS as readonly string[]).includes(value)) {
    return value as NllbPackId;
  }
  throw new Error(`Invalid IPC payload: "packId" must be one of ${NLLB_PACK_IDS.join(", ")}.`);
}

/** One of NLLB's 202 languages, by its code; anything else is refused by name. */
function languageOf(call: { as: ModuleCall["as"] }, value: unknown, field: string): NllbLanguage {
  const language = languageByCode(call.as.asString(value, field));
  if (language === undefined) throw new Error(`Invalid IPC payload: "${field}" must be an NLLB language code.`);
  return language;
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
