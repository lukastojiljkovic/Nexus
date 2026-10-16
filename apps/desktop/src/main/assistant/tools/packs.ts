/**
 * The content packs (ADR-091, ADR-103): what this device has, what can be
 * installed, and the two decisions that change it. Listing is a read; the rest
 * asks first, and says what it will change.
 *
 * **The list comes from the app's own service.** `createPacksIpc(...).list()` is
 * what the Packs card calls: it answers from the signed `installed.json` index
 * or rebuilds it from disk, verifies each manifest's signature the same way, and
 * reports the same fields. The catalogue and the download go through the
 * catalogue service, which is the one place a signed document is read and a
 * pack's bytes are fetched. This tool is handed those objects and calls them, so
 * there is no second reader and no second opinion about what "installed" means.
 *
 * **Licences are stated, never summarised.** The assistant answering „yes, you
 * may use that map" from a pack's own name would be inventing a legal claim; the
 * row therefore carries the manifest's SPDX id, its attribution line and its
 * URL, so the model can point at what the pack says rather than paraphrase it.
 *
 * **A download is long, so the tool starts it and returns.** The download runs
 * in main and its progress is pushed to the Packs card; a tool answer that
 * waited for it would hold the whole turn. The answer therefore says the
 * download has started and where its progress shows, and never that it has
 * finished.
 */

import { foldSearchText, SAFETY_NOTICE, type AssistantLocale, type Tool } from "@nexus/core";
import type {
  InstalledPackView,
  PackCatalogueEntryView,
  PackCatalogueResult,
  PackDownloadResult,
  PackRemoveResult,
  PackText,
} from "../../../shared/ipc.js";
import { asArgs, asText } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  failResult,
  formatBytes,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
} from "./support.js";

/** What the list tool needs of the Packs service — `PacksIpc` satisfies it, and a test can hand in a list. */
export interface PacksLookup {
  list(): Promise<readonly InstalledPackView[]>;
}

/** The Packs service this folder drives: the list, the catalogue, the download and the removal. */
export interface PackManager extends PacksLookup {
  catalogue(reload?: boolean): Promise<PackCatalogueResult>;
  download(id: string): Promise<PackDownloadResult>;
  remove(id: string): Promise<PackRemoveResult>;
  /** Whether this launch's network mode allows downloads. Read from main, never stored here. */
  downloadsAllowed(): boolean;
}

export interface PackToolDeps {
  readonly packs: PackManager;
}

const PACKS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Instalirani paketi (${count}):`,
  en: (count) => `Installed packs (${count}):`,
};

const CATALOGUE_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Paketi u katalogu (${count}):`,
  en: (count) => `Packs in the catalogue (${count}):`,
};

const NO_PACKS: { sr: string; en: string } = {
  sr: "Na ovom uređaju nije instaliran nijedan paket sadržaja.",
  en: "No content pack is installed on this device.",
};

const DOWNLOADS_OFF: { sr: string; en: string } = {
  sr: "Preuzimanje je isključeno. Uključi „Preuzimanja“ u kartici „Mreža i ažuriranja“ u kategoriji Privatnost, pa ponovo pokreni aplikaciju.",
  en: "Downloads are off. Turn on “Downloads” in the “Network and updates” card under Privacy, then restart the app.",
};

const CATALOGUE_REFUSED: AssistantPhrase<[code: string]> = {
  sr: (code) => `katalog nije dostupan (${code}).`,
  en: (code) => `the catalogue is not available (${code}).`,
};

const NO_PACK: AssistantPhrase<[name: string]> = {
  sr: (name) => `nema paketa „${name}“.`,
  en: (name) => `there is no pack “${name}”.`,
};

const AMBIGUOUS_PACK: AssistantPhrase<[name: string, matches: string]> = {
  sr: (name, matches) => `više paketa liči na „${name}“: ${matches}. Navedi tačan identifikator.`,
  en: (name, matches) => `more than one pack matches “${name}”: ${matches}. Name the exact id.`,
};

const REMOVE_FAILED: AssistantPhrase<[code: string]> = {
  sr: (code) => `paket nije uklonjen (${code}).`,
  en: (code) => `the pack was not removed (${code}).`,
};

const CONFIRM_CATALOGUE: { sr: string; en: string } = {
  sr: "Preuzeti katalog paketa sa interneta?",
  en: "Fetch the pack catalogue from the internet?",
};

const CONFIRM_INSTALL: AssistantPhrase<[title: string, size: string]> = {
  sr: (title, size) =>
    `Preuzmi paket „${title}“ (${size}) i instaliraj ga? Preuzimanje može dugo da traje.`,
  en: (title, size) =>
    `Download “${title}” (${size}) and install it? The download may take a long time.`,
};

const CONFIRM_REMOVE: AssistantPhrase<[title: string, version: string, size: string]> = {
  sr: (title, version, size) =>
    `Ukloni paket „${title}“ ${version} (${size})? Da bi se vratio, mora ponovo da se preuzme.`,
  en: (title, version, size) =>
    `Remove the pack “${title}” ${version} (${size})? To get it back, it has to be downloaded again.`,
};

const STATE_WORDS: Record<PackCatalogueEntryView["state"], { sr: string; en: string }> = {
  "not-installed": { sr: "nije instaliran", en: "not installed" },
  installed: { sr: "instaliran", en: "installed" },
  "update-available": { sr: "dostupna novija verzija", en: "update available" },
};

const PACK_WORDS: {
  readonly kind: { readonly sr: string; readonly en: string };
  readonly licence: { readonly sr: string; readonly en: string };
  readonly notice: { readonly sr: string; readonly en: string };
} = {
  kind: { sr: "vrsta", en: "kind" },
  licence: { sr: "licenca", en: "licence" },
  notice: { sr: "obavezno obaveštenje o bezbednosti", en: "safety notice required" },
};

const DOWNLOAD_STARTED: AssistantPhrase<[title: string]> = {
  sr: (title) =>
    `Preuzimanje paketa „${title}“ je pokrenuto. Napredak se prikazuje u kartici Paketi u Podešavanjima; paket je spreman kada tamo piše da je instaliran.`,
  en: (title) =>
    `The download of “${title}” has started. Its progress shows in the Packs card in Settings; the pack is ready when it says installed.`,
};

const REMOVED: AssistantPhrase<[title: string]> = {
  sr: (title) => `Uklonjen je paket „${title}“.`,
  en: (title) => `Removed the pack “${title}”.`,
};

const PACKS_SETTINGS = { module: "settings", settings: "packs" } as const;

export function packTools(deps: PackToolDeps): readonly Tool[] {
  const list: Tool = {
    name: "packs.list",
    description: {
      sr: "Izlistava instalirane pakete sadržaja sa vrstom, verzijom i licencom. Koristi ga pre nego što preporučiš korisniku šta da čita iz paketa, i kada pita koji su paketi dostupni ili pod kojom su licencom.",
      en: "Lists the installed content packs with their kind, version and licence. Use it before recommending what to read from a pack, and when the user asks which packs are available or what their licences are.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        asArgs(rawArgs);
        const packs = await deps.packs.list();
        if (packs.length === 0) {
          return okResult(text(context.locale, NO_PACKS));
        }
        const lines = [
          phrase(context.locale, PACKS_HEADING, packs.length),
          ...packs.map((pack) => packLine(context.locale, pack)),
        ];
        // The notice is printed once, for the whole answer, and only when a listed pack carries one.
        if (packs.some((pack) => pack.notice !== null)) lines.push(text(context.locale, SAFETY_NOTICE));
        return okResult(lines.join("\n"));
      }),
  };

  const catalogue: Tool = {
    name: "packs.catalogue",
    description: {
      sr: "Izlistava pakete koji mogu da se preuzmu i instaliraju, sa veličinom, licencom i stanjem na ovom uređaju. Koristi ga kada korisnik pita šta može da se instalira.",
      en: "Lists the packs that can be downloaded and installed, with size, licence and what this device has. Use it when the user asks what can be installed.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "network",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        asArgs(rawArgs);
        if (!deps.packs.downloadsAllowed()) {
          return failResult(context.locale, text(context.locale, DOWNLOADS_OFF));
        }
        const declined = await confirmOrDecline(
          context,
          "packs.catalogue",
          "network",
          text(context.locale, CONFIRM_CATALOGUE),
        );
        if (declined !== null) return declined;
        const result = await deps.packs.catalogue();
        if (result.outcome === "refused") {
          return failResult(context.locale, phrase(context.locale, CATALOGUE_REFUSED, result.code));
        }
        return okResult(
          [
            phrase(context.locale, CATALOGUE_HEADING, result.entries.length),
            ...result.entries.map((entry) => catalogueLine(context.locale, entry)),
          ].join("\n"),
        );
      }),
  };

  const install: Tool = {
    name: "packs.install",
    description: {
      sr: "Preuzima i instalira paket iz kataloga po identifikatoru ili naslovu. Koristi ga kada korisnik traži da se paket preuzme; prvo proveri katalog.",
      en: "Downloads and installs a catalogue pack by its id or title. Use it when the user asks for a pack to be downloaded; check the catalogue first.",
    },
    parameters: {
      type: "object",
      properties: { pack: { type: "string", maxLength: 120, description: "Pack id or title." } },
      required: ["pack"],
      additionalProperties: false,
    },
    effect: "network",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const name = asText(asArgs(rawArgs).pack, "pack", 120);
        if (!deps.packs.downloadsAllowed()) {
          return failResult(context.locale, text(context.locale, DOWNLOADS_OFF));
        }
        const result = await deps.packs.catalogue();
        if (result.outcome === "refused") {
          return failResult(context.locale, phrase(context.locale, CATALOGUE_REFUSED, result.code));
        }
        const picked = pickPack(result.entries, name, context.locale);
        if ("failure" in picked) return failResult(context.locale, picked.failure);
        const entry = picked.row;
        const title = entry.title[context.locale];
        const declined = await confirmOrDecline(
          context,
          "packs.install",
          "network",
          phrase(context.locale, CONFIRM_INSTALL, title, formatBytes(context.locale, entry.size)),
        );
        if (declined !== null) return declined;
        // Fire and forget: the download reports through the Packs card. A rejection
        // here is a bug in main, which the log records, not a refusal to relay.
        deps.packs.download(entry.id).catch((error: unknown) => {
          console.error("Nexus: the assistant's pack download failed:", error);
        });
        return okResult(phrase(context.locale, DOWNLOAD_STARTED, title), { navigateTo: PACKS_SETTINGS });
      }),
  };

  const remove: Tool = {
    name: "packs.remove",
    description: {
      sr: "Uklanja instalirani paket po identifikatoru ili naslovu. Koristi ga kada korisnik traži da se paket ukloni sa uređaja.",
      en: "Removes an installed pack by its id or title. Use it when the user asks to remove a pack from this device.",
    },
    parameters: {
      type: "object",
      properties: { pack: { type: "string", maxLength: 120, description: "Installed pack id or title." } },
      required: ["pack"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const name = asText(asArgs(rawArgs).pack, "pack", 120);
        const picked = pickPack(await deps.packs.list(), name, context.locale);
        if ("failure" in picked) return failResult(context.locale, picked.failure);
        const pack = picked.row;
        const title = pack.title[context.locale];
        const declined = await confirmOrDecline(
          context,
          "packs.remove",
          "write",
          phrase(
            context.locale,
            CONFIRM_REMOVE,
            title,
            pack.version,
            formatBytes(context.locale, pack.size),
          ),
        );
        if (declined !== null) return declined;
        const outcome = await deps.packs.remove(pack.id);
        if (outcome.outcome === "refused") {
          return failResult(context.locale, phrase(context.locale, REMOVE_FAILED, outcome.code));
        }
        return okResult(phrase(context.locale, REMOVED, title), { navigateTo: PACKS_SETTINGS });
      }),
  };

  return [list, catalogue, install, remove];
}

/**
 * The one pack a name stands for: an exact id first, then the title in the
 * active locale, both ignoring case and diacritics. An ambiguous name is refused
 * with the candidates, and a missing one by name; a tool never guesses.
 */
function pickPack<T extends { readonly id: string; readonly title: PackText }>(
  rows: readonly T[],
  name: string,
  locale: AssistantLocale,
): { row: T } | { failure: string } {
  const exact = rows.find((row) => row.id === name);
  if (exact !== undefined) return { row: exact };
  const folded = foldSearchText(name);
  const matches = rows.filter((row) => foldSearchText(row.title[locale]) === folded);
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return { row: only };
  if (matches.length === 0) return { failure: phrase(locale, NO_PACK, name) };
  const ids = matches.map((row) => row.id).join(", ");
  return { failure: phrase(locale, AMBIGUOUS_PACK, name, ids) };
}

/**
 * One pack as a line. The licence URL is shown as text rather than as a link:
 * this is text the MODEL reads, and the chat page is where a link is drawn
 * (ADR-107) — a URL in a tool's answer is a citation, not a control.
 */
function packLine(locale: AssistantLocale, pack: InstalledPackView): string {
  const licence = pack.licence;
  const parts = [
    `${text(locale, PACK_WORDS.kind)} ${pack.kind}`,
    pack.version,
    formatBytes(locale, pack.size),
    `${text(locale, PACK_WORDS.licence)} ${licence.spdx} (${licence.attribution})`,
    licence.url,
  ];
  if (pack.notice !== null) parts.push(text(locale, PACK_WORDS.notice));
  return `- ${pack.id} ${pack.title[locale]} [${parts.join(", ")}]`;
}

/** One catalogue entry: what it is, how big, under which licence, and what this device has of it. */
function catalogueLine(locale: AssistantLocale, entry: PackCatalogueEntryView): string {
  const parts = [
    `${text(locale, PACK_WORDS.kind)} ${entry.kind}`,
    entry.version,
    formatBytes(locale, entry.size),
    `${text(locale, PACK_WORDS.licence)} ${entry.licence.spdx}`,
    text(locale, STATE_WORDS[entry.state]),
  ];
  return `- ${entry.id} ${entry.title[locale]} [${parts.join(", ")}]`;
}
