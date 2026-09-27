import { lazy, type ComponentType } from "react";
import type { ToolCategory, ToolRegistration } from "@nexus/core";

import { PRO_TOOL_GROUPS } from "../../shared/modules.js";

type SurfaceMap = Readonly<Record<string, ComponentType>>;

/** One file of surfaces: which tools it holds, and how to fetch it. */
export interface SurfaceFile {
  /** Where the surfaces are, for a reader and for a failing test. */
  readonly file: string;
  /** The registrations whose surfaces this file must export — no more, no fewer. */
  readonly tools: readonly ToolRegistration[];
  readonly load: () => Promise<SurfaceMap>;
}

/** The developer toolkit is nine files, one per `category`; the registrations are one array. */
function devTools(category: ToolCategory): readonly ToolRegistration[] {
  return PRO_TOOL_GROUPS.dev.filter((tool) => tool.category === category);
}

/**
 * Every file of „Stručne alatke" surfaces, and what each one holds.
 *
 * **The nine `devtools/` files are the developer PACK's tools and keep that
 * name.** The drawer stopped being „Programerske alatke" when the other
 * professions arrived, but those files did not stop being the developer
 * toolkit — renaming them would have said the tools changed, and only their
 * neighbours did.
 *
 * **Each file is fetched the first time one of its tools is opened**, and that
 * is what this table is for. Until 2026-09-26 the files were imported here
 * statically, so opening either drawer loaded every profession's arithmetic —
 * three megabytes, most of the page — to show a list whose names and blurbs come
 * from the registrations, which the shell already holds. The registrations are
 * therefore what says which tools a file has (`PRO_TOOL_GROUPS`), and
 * `proToolSurfaces.test.ts` loads every file and holds each one to exactly that
 * list, so the two cannot drift: a surface added to a file without its
 * registration, or the other way round, fails there by name.
 */
export const PRO_SURFACE_FILES: readonly SurfaceFile[] = [
  {
    file: "devtools/numbers.tsx",
    tools: devTools("numbers"),
    load: () => import("./devtools/numbers.js").then((module) => module.NUMBERS_SURFACES),
  },
  {
    file: "devtools/riscv.tsx",
    tools: devTools("riscv"),
    load: () => import("./devtools/riscv.js").then((module) => module.RISCV_SURFACES),
  },
  {
    file: "devtools/encoding.tsx",
    tools: devTools("encoding"),
    load: () => import("./devtools/encoding.js").then((module) => module.ENCODING_SURFACES),
  },
  {
    file: "devtools/data.tsx",
    tools: devTools("data"),
    load: () => import("./devtools/data.js").then((module) => module.DATA_SURFACES),
  },
  {
    file: "devtools/text.tsx",
    tools: devTools("text"),
    load: () => import("./devtools/text.js").then((module) => module.TEXT_SURFACES),
  },
  {
    file: "devtools/design.tsx",
    tools: devTools("design"),
    load: () => import("./devtools/design.js").then((module) => module.DESIGN_SURFACES),
  },
  {
    file: "devtools/crypto.tsx",
    tools: devTools("crypto"),
    load: () => import("./devtools/crypto.js").then((module) => module.CRYPTO_SURFACES),
  },
  {
    file: "devtools/system.tsx",
    tools: devTools("system"),
    load: () => import("./devtools/system.js").then((module) => module.SYSTEM_SURFACES),
  },
  {
    file: "devtools/time.tsx",
    tools: devTools("time"),
    load: () => import("./devtools/time.js").then((module) => module.TIME_SURFACES),
  },
  // The professional toolkits, one file each — see the header on why these are
  // named after the PACK while the nine above are named after a category.
  {
    file: "pro/gradnja.tsx",
    tools: PRO_TOOL_GROUPS.gradnja,
    load: () => import("./pro/gradnja.js").then((module) => module.GRADNJA_SURFACES),
  },
  {
    file: "pro/inzenjering.tsx",
    tools: PRO_TOOL_GROUPS.inzenjering,
    load: () => import("./pro/inzenjering.js").then((module) => module.INZENJERING_SURFACES),
  },
  {
    file: "pro/dizajn.tsx",
    tools: PRO_TOOL_GROUPS.dizajn,
    load: () => import("./pro/dizajn.js").then((module) => module.DIZAJN_SURFACES),
  },
  {
    file: "pro/foto.tsx",
    tools: PRO_TOOL_GROUPS.foto,
    load: () => import("./pro/foto.js").then((module) => module.FOTO_SURFACES),
  },
  {
    file: "pro/muzika.tsx",
    tools: PRO_TOOL_GROUPS.muzika,
    load: () => import("./pro/muzika.js").then((module) => module.MUZIKA_SURFACES),
  },
  {
    file: "pro/prosveta.tsx",
    tools: PRO_TOOL_GROUPS.prosveta,
    load: () => import("./pro/prosveta.js").then((module) => module.PROSVETA_SURFACES),
  },
  {
    file: "pro/tekst.tsx",
    tools: PRO_TOOL_GROUPS.tekst,
    load: () => import("./pro/tekst.js").then((module) => module.TEKST_SURFACES),
  },
  {
    file: "pro/trening.tsx",
    tools: PRO_TOOL_GROUPS.trening,
    load: () => import("./pro/trening.js").then((module) => module.TRENING_SURFACES),
  },
  {
    file: "pro/kuhinja.tsx",
    tools: PRO_TOOL_GROUPS.kuhinja,
    load: () => import("./pro/kuhinja.js").then((module) => module.KUHINJA_SURFACES),
  },
  {
    file: "pro/pravo.tsx",
    tools: PRO_TOOL_GROUPS.pravo,
    load: () => import("./pro/pravo.js").then((module) => module.PRAVO_SURFACES),
  },
  {
    file: "pro/racunovodstvo.tsx",
    tools: PRO_TOOL_GROUPS.racunovodstvo,
    load: () => import("./pro/racunovodstvo.js").then((module) => module.RACUNOVODSTVO_SURFACES),
  },
  {
    file: "pro/biznis.tsx",
    tools: PRO_TOOL_GROUPS.biznis,
    load: () => import("./pro/biznis.js").then((module) => module.BIZNIS_SURFACES),
  },
  {
    file: "pro/nekretnine.tsx",
    tools: PRO_TOOL_GROUPS.nekretnine,
    load: () => import("./pro/nekretnine.js").then((module) => module.NEKRETNINE_SURFACES),
  },
  {
    file: "pro/transport.tsx",
    tools: PRO_TOOL_GROUPS.transport,
    load: () => import("./pro/transport.js").then((module) => module.TRANSPORT_SURFACES),
  },
  {
    file: "pro/agro.tsx",
    tools: PRO_TOOL_GROUPS.agro,
    load: () => import("./pro/agro.js").then((module) => module.AGRO_SURFACES),
  },
  {
    file: "pro/zanat.tsx",
    tools: PRO_TOOL_GROUPS.zanat,
    load: () => import("./pro/zanat.js").then((module) => module.ZANAT_SURFACES),
  },
  {
    file: "pro/event.tsx",
    tools: PRO_TOOL_GROUPS.event,
    load: () => import("./pro/event.js").then((module) => module.EVENT_SURFACES),
  },
];

/**
 * One lazy component per tool in a file, all sharing the file's one fetch.
 *
 * The fetch is started by whichever of them renders first and remembered, so
 * opening a second tool from the same file costs nothing. A file that fails to
 * load stays failed, on `lazy`'s own terms: on a local disk the file will not be
 * there on the second attempt either, and `PageSlot` in `routes.tsx` is what
 * catches it.
 */
function lazySurfaces({ file, tools, load }: SurfaceFile): Record<string, ComponentType> {
  let loading: Promise<SurfaceMap> | null = null;
  return Object.fromEntries(
    tools.map((tool) => [
      tool.id,
      lazy(async () => {
        loading ??= load();
        const surface = (await loading)[tool.id];
        if (surface === undefined) throw new Error(`Nexus: ${file} has no surface for ${tool.id}`);
        return { default: surface };
      }),
    ]),
  );
}

/**
 * Every „Stručne alatke" surface, by tool id — the renderer half of the
 * `ToolRegistration` contract, and the professional drawer's answer to
 * `TOOL_SURFACES`.
 *
 * **A separate map from `TOOL_SURFACES` on purpose.** The drawers are routed by
 * `toolDrawer`, so one merged map would still render correctly — and would also
 * mean the everyday drawer reaching a RISC-V assembler, a QR encoder and a
 * Reed-Solomon field for a profile that has the professional module switched
 * off. Now that each file is fetched on first use, that separation is what the
 * build does as well as what the source says.
 */
export const PRO_TOOL_SURFACES: SurfaceMap = Object.assign(
  {},
  ...PRO_SURFACE_FILES.map(lazySurfaces),
) as SurfaceMap;
