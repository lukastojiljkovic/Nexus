import type { ModuleText } from "@nexus/core";
import { countUnit } from "../../../../renderer/src/strings.js";
import { sentence, text } from "../pdf/text.js";

/**
 * The image tool set's words, as `{ sr, en }` pairs, beside the PDF set's.
 *
 * **Why this file imports the PDF set's helpers rather than copying them.**
 * `fill`-ing a `{name}` slot and asking CLDR for a counted noun are the shell's
 * own rules (`strings.js`), and the PDF tool set already reaches them through
 * `../pdf/text.js`. Two copies of `sentence` would be two places for the `{name}`
 * spelling to drift; the shared piece is three lines of glue, and importing it
 * is the smaller risk than restating it. Nothing here imports the PDF tool's
 * copy: the leaf below is this tool's own.
 *
 * `formatFileSize` is not re-exported either — `fileRows.js` is the shell's, and
 * both tool sets import it directly.
 */
export { sentence, text };

export const copy = {
  files: {
    title: { sr: "Slike", en: "Images" },
    add: { sr: "Dodaj slike", en: "Add images" },
    busyAdd: { sr: "Čitam slike…", en: "Reading the images…" },
    addHint: {
      sr: "Najviše 20 slika, do 50 MB po slici i 200 MB u jednom izboru. Ništa se ne šalje sa računara.",
      en: "At most 20 images, 50 MB per image and 200 MB in one pick. Nothing leaves this computer.",
    },
    empty: { sr: "Nijedna slika nije dodata.", en: "No image has been added yet." },
    gpsYes: { sr: "GPS: ima", en: "GPS: present" },
    gpsNo: { sr: "GPS: nema", en: "GPS: none" },
    camera: { sr: "Kamera: {camera}", en: "Camera: {camera}" },
    date: { sr: "Datum: {date}", en: "Date: {date}" },
    noExif: { sr: "Bez EXIF metapodataka.", en: "No EXIF metadata." },
    dropsExif: {
      sr: "Ponovno kodiranje uklanja EXIF metapodatke — GPS, kameru i datum.",
      en: "Re-encoding removes EXIF metadata — GPS, camera and date.",
    },
    keepsExif: {
      sr: "Kada se veličina i format ne menjaju, fajl se samo kopira i zadržava sve metapodatke.",
      en: "When neither the size nor the format changes, the file is copied and keeps all of its metadata.",
    },
    unsupported: { sr: "Nije PNG, JPEG ili WebP.", en: "Not a PNG, JPEG or WebP image." },
    unreadable: { sr: "Ne može da se pročita kao slika.", en: "This cannot be read as an image." },
    remove: { sr: "Ukloni", en: "Remove" },
  },
  plan: {
    title: { sr: "Šta uraditi", en: "What to do" },
    resize: { sr: "Veličina", en: "Size" },
    resizeNone: { sr: "Bez promene", en: "Leave it alone" },
    resizePercent: { sr: "Procenat", en: "By percent" },
    resizeBox: { sr: "U okvir", en: "Into a box" },
    percent: { sr: "Procenat (%)", en: "Percent (%)" },
    boxWidth: { sr: "Širina okvira (px)", en: "Box width (px)" },
    boxHeight: { sr: "Visina okvira (px)", en: "Box height (px)" },
    boxHint: {
      sr: "Slika se uklapa u okvir i čuva odnos strana; ne uvećava se.",
      en: "The image fits inside the box keeping its aspect ratio, and is never enlarged.",
    },
    format: { sr: "Format", en: "Format" },
    formatKeep: { sr: "Kao u fajlu", en: "As in the file" },
    quality: { sr: "Kvalitet (1–100)", en: "Quality (1–100)" },
    qualityHint: {
      sr: "Kvalitet koriste samo JPEG i WebP; PNG ga ignoriše.",
      en: "Only JPEG and WebP use the quality; PNG ignores it.",
    },
    percentProblem: {
      sr: "Procenat je ceo broj između 1 i 400.",
      en: "A percent is a whole number between 1 and 400.",
    },
    boxProblem: {
      sr: "Strana okvira je ceo broj piksela između 1 i 20000.",
      en: "A box side is a whole number of pixels between 1 and 20000.",
    },
    qualityProblem: {
      sr: "Kvalitet je ceo broj između 1 i 100.",
      en: "A quality is a whole number between 1 and 100.",
    },
  },
  run: {
    title: { sr: "Obrada", en: "Processing" },
    process: { sr: "Obradi", en: "Process" },
    busy: { sr: "Radim… {done}/{total}", en: "Working… {done}/{total}" },
    save: { sr: "Sačuvaj rezultat", en: "Save the result" },
    savedOne: { sr: "Sačuvano: {name}", en: "Saved: {name}" },
    savedBatch: {
      sr: "Sačuvano u fasciklu {folder}: {count}",
      en: "Saved into {folder}: {count}",
    },
    canceled: { sr: "Izbor je otkazan.", en: "The dialog was cancelled." },
    failed: { sr: "Posao nije uspeo: {message}", en: "The job failed: {message}" },
    empty: { sr: "Još nema obrađenih slika.", en: "Nothing has been processed yet." },
    copied: { sr: "kopirano", en: "copied" },
    reencoded: { sr: "ponovo kodirano", en: "re-encoded" },
    tooLarge: {
      sr: "Rezultat je veći nego što alatka ispisuje.",
      en: "The result is larger than this tool writes.",
    },
  },
} satisfies Record<string, Record<string, ModuleText>>;

/** `3 images` / `3 slike`, with the shell's own numeral agreement. */
export function imageCount(count: number): string {
  return `${count} ${countUnit(count, text({ sr: "slika", en: "image" }), text({ sr: "slike", en: "images" }), text({ sr: "slika", en: "images" }))}`;
}
