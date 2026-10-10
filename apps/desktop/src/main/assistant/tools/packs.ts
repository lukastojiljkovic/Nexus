/**
 * The installed content packs (ADR-091): what this device has, and under which
 * licence. A read and nothing else — installing a pack is a decision with a
 * folder dialog in front of it, and it stays where it belongs.
 *
 * **The list comes from the app's own service.** `createPacksIpc(...).list()` is
 * what the Packs card calls: it answers from the signed `installed.json` index
 * or rebuilds it from disk, verifies each manifest's signature the same way, and
 * reports the same fields. This tool is handed that object and calls `list()`,
 * so there is no second reader of the packs directory and no second opinion
 * about what "installed" means.
 *
 * **Licences are stated, never summarised.** The assistant answering „yes, you
 * may use that map" from a pack's own name would be inventing a legal claim; the
 * row therefore carries the manifest's SPDX id, its attribution line and its
 * URL, so the model can point at what the pack says rather than paraphrase it.
 */

import type { AssistantLocale, Tool } from "@nexus/core";
import type { InstalledPackView } from "../../../shared/ipc.js";
import { asArgs } from "./args.js";
import {
  assertLive,
  formatBytes,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
} from "./support.js";

/** What this tool needs of the Packs service — `PacksIpc` satisfies it, and a test can hand in a list. */
export interface PacksLookup {
  list(): Promise<readonly InstalledPackView[]>;
}

export interface PackToolDeps {
  readonly packs: PacksLookup;
}

const PACKS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Instalirani paketi (${count}):`,
  en: (count) => `Installed packs (${count}):`,
};

const NO_PACKS: { sr: string; en: string } = {
  sr: "Na ovom uređaju nije instaliran nijedan paket sadržaja.",
  en: "No content pack is installed on this device.",
};

const PACK_WORDS: {
  readonly kind: { readonly sr: string; readonly en: string };
  readonly licence: { readonly sr: string; readonly en: string };
} = {
  kind: { sr: "vrsta", en: "kind" },
  licence: { sr: "licenca", en: "licence" },
};

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
        return okResult(
          [
            phrase(context.locale, PACKS_HEADING, packs.length),
            ...packs.map((pack) => packLine(context.locale, pack)),
          ].join("\n"),
        );
      }),
  };

  return [list];
}

/**
 * One pack as a line. The licence URL is shown as text rather than as a link:
 * main has no vetted way to open an external page yet.
 *
 * TODO(external-links): when main grows the one vetted `shell.openExternal`
 * wrapper, the licence URL below becomes that link instead of selectable text.
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
  return `- ${pack.id} ${pack.title[locale]} [${parts.join(", ")}]`;
}
