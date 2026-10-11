/**
 * The day-and-night map's own copy, in Serbian.
 *
 * **Why a component carries a table of its own.** The kit's rule is that a
 * module's page copy lives in `modules/<id>/renderer/copy.sr.ts`, and that file
 * belongs to whoever assembles the module's page. This component is one of three
 * written in parallel (the solar-system view, this map and the Sun-and-Moon
 * panel), so it brings the words IT draws in its own folder and registers them
 * under its own name (`copy.ts`), exactly as a module registers its table with
 * the shell: one live object, rewritten in place when the language changes,
 * arriving with this component's chunk and with nothing else.
 *
 * The statements here are all descriptions of what the picture draws, and each
 * one names the limit it belongs to, because the three twilight lines are told
 * apart by their dash pattern and their label and by nothing else.
 */
export const sr = {
  map: {
    caption:
      "Dan i noć sada: dnevna i noćna slika sveta prelivene preko građanskog, nautičkog i astronomskog sumraka.",
    terminator: "Terminator — Sunce na horizontu (0°)",
    civil: "Građanski sumrak (−6°)",
    nautical: "Nautički sumrak (−12°)",
    astronomical: "Astronomski sumrak (−18°)",
    sunOverhead: "Sunce u zenitu",
    moonOverhead: "Mesec u zenitu",
    observer: "Tvoje mesto",
    noObserver:
      "Mesto još nije izabrano — izaberi grad ili unesi koordinate, pa će se tačka pojaviti na mapi.",
  },
};
