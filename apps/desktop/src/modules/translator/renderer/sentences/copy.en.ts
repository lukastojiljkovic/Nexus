import { sr } from "./copy.sr.js";

/**
 * The sentence translator in English — the same shape as `copy.sr.ts`, checked
 * by the compiler. Sentence case, informative, no exclamation marks, and the
 * placeholders spelled exactly as the Serbian file spells them so one composer
 * fills both.
 */
export const en: typeof sr = {
  heading: "Sentence translation",
  subtitle: "Translation runs on this device, offline. The model comes from a translation pack.",
  directionLabel: "Direction",
  direction: {
    "sr-en": "Serbian → English",
    "en-sr": "English → Serbian",
    "hr-en": "Croatian → English",
    "en-hr": "English → Croatian",
    "bs-en": "Bosnian → English",
    "en-bs": "English → Bosnian",
  },
  sourceLabel: "Text",
  sourceHint: "Paste or type text. Translation starts when you pause.",
  targetLabel: "Translation",
  targetEmpty: "The translation appears here.",
  machineNotice: "This is machine translation.",
  machineHint: "Machine translation makes mistakes — check anything that matters.",
  noPacksTitle: "No translation pack installed",
  noPacksBody:
    "Translation needs a model pack. Install one in Settings, on the “Content packs” card.",
  missingPack: "This direction needs the {pack} pack.",
  progress: "Translated {done} of {total} sentences.",
  count: "{count} sentences",
  copy: "Copy",
  copied: "Copied",
  errorLoad: "The pack list could not be loaded.",
  errorTranslate: "The translation failed. Try again.",
};
