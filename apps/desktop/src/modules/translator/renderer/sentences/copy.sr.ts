/**
 * The sentence translator's copy, in Serbian — the SHAPE the English half is
 * checked against (ADR-090).
 *
 * It is a table of its own rather than a section of the translator module's
 * `copy.ts` because two runs build this module: the word lookup owns
 * `renderer/copy.sr.ts`, this surface owns the file beside it, and
 * `defineModuleCopy` keys tables by id — so this one registers as
 * `translator.sentences` and the two never overwrite each other's live object.
 *
 * Every leaf is a sentence the reader sees; nothing here is a number, a unit or
 * a key. `{done}`/`{total}`/`{pack}`/`{count}` are filled by the component, which
 * is why they are placeholders in the sentence rather than pieces glued together
 * at the call site: a language that orders them differently can rewrite the whole
 * line.
 */
export const sr = {
  heading: "Prevod rečenica",
  subtitle: "Prevod radi na uređaju, bez interneta. Model dolazi iz prevodilačkog paketa.",
  directionLabel: "Smer prevoda",
  direction: {
    "sr-en": "Srpski → Engleski",
    "en-sr": "Engleski → Srpski",
    "hr-en": "Hrvatski → Engleski",
    "en-hr": "Engleski → Hrvatski",
    "bs-en": "Bosanski → Engleski",
    "en-bs": "Engleski → Bosanski",
  },
  sourceLabel: "Tekst",
  sourceHint: "Nalepi ili otkucaj tekst. Prevod kreće kada pauziraš.",
  targetLabel: "Prevod",
  targetEmpty: "Prevod se pojavljuje ovde.",
  machineNotice: "Ovo je mašinski prevod.",
  machineHint: "Mašinski prevod ume da pogreši — proveri ono što je važno.",
  noPacksTitle: "Nema prevodilačkog paketa",
  noPacksBody:
    "Za prevod je potreban paket modela. Instaliraj ga u Podešavanjima, u kartici „Paketi sadržaja“.",
  missingPack: "Za ovaj smer je potreban paket {pack}.",
  progress: "Prevedeno {done} od {total} rečenica.",
  count: "{count} rečenica",
  copy: "Kopiraj",
  copied: "Kopirano",
  errorLoad: "Nije moguće učitati listu paketa.",
  errorTranslate: "Prevod nije uspeo. Pokušaj ponovo.",
};
