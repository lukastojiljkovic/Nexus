import type { ModuleManifest } from "@nexus/core";

/**
 * The DRAWINGS module's manifest (ADR-090): everything the shell knows about
 * this module before its page loads.
 *
 * **No optional contract slot is filled, on purpose.** No
 * `widgets`, because a drawing is a FILE on this machine rather than a fact about
 * the profile: a dashboard card would have to remember which file was last open,
 * which is state this module deliberately does not keep (it writes nothing at
 * all - there is no migration, no store and no preference row). No
 * `searchIndexers`, for the same reason: there is nothing here to find. No
 * `settings`, because the viewer's few choices are controls ON the page - how
 * you are looking at the drawing is not a preference about the profile.
 *
 * **ON by default**, like every built module except PRIV and PRO. The module
 * reads files and stores nothing, so there is nothing to opt into.
 */
export const manifest: ModuleManifest = {
  id: "drawings",
  // DRAW is its own PRD entry rather than a second reading of UTIL: a timer and
  // a tool drawer share PRD 29 (Utility Belt), while opening an AutoCAD drawing
  // is a subject of its own.
  prefix: "DRAW",
  // The MAKE group, with Alatke, Tabla, Elektronika and Strucne alatke
  // (ADR-093): a drawing is a surface you MAKE something on, not content you
  // study.
  group: "make",
  defaultEnabled: true,
  // After TIMERS (100) and clear of every other slot, so a later kit module can
  // sort above or below without renumbering this one.
  order: 320,
  copy: {
    name: { sr: "Crteži", en: "Drawings" },
    description: {
      sr: "Otvori AutoCAD crtež: slojevi, mere i štampa u PDF. DXF odmah, DWG uz paket.",
      en: "Open an AutoCAD drawing: layers, measurements and print to PDF. DXF right away, DWG with a pack.",
    },
  },
};
