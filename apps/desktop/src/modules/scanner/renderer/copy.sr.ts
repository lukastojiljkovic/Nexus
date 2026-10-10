import { TESSDATA_PACK_ID } from "./ocrConfig.js";

/**
 * SKENER's own copy, in Serbian - the SHAPE every other locale of this module
 * is checked against (ADR-090).
 *
 * Three sections follow the page's own order: where the picture comes from
 * (`source`), what is done to it before recognition (`edit`), and what comes
 * back (`read`, `result`). A sentence that a state needs (`cameraDenied`,
 * `saved`) sits beside the control it belongs to rather than in a shared
 * `errors` bag, so a reader of this file reads the screen in order.
 *
 * The register is the app's: present tense, no exclamation marks, and no
 * gendered past tense (`check:address` - „pročitan" would have picked the
 * reader's gender, „čita se" does not).
 */
export const sr = {
  page: {
    subtitle: "Pročita tekst sa slike ili kamere i predaje ga belešci - bez interneta.",
  },
  source: {
    title: "Izvor",
    file: "Izaberi sliku",
    fileHint: "PNG, JPEG ili WebP sa ovog uređaja.",
    camera: "Uključi kameru",
    cameraHint: "Kamera se uključuje jednim klikom i radi dok je stranica otvorena.",
    capture: "Snimi kadar",
    stopCamera: "Isključi kameru",
    pasteHint: "Slika iz međuspremnika (Ctrl+V) takođe radi.",
    cameraDenied: "Pristup kameri je odbijen. Dozvoli ga u Windows podešavanjima za kameru.",
    cameraError: "Kamera nije dostupna na ovom uređaju.",
    decodeError: "Slika nije mogla da se pročita. Probaj drugu datoteku.",
    emptyTitle: "Još nema slike",
    emptyBody:
      "Izaberi sliku, nalepi je iz međuspremnika ili uključi kameru - čitanje radi bez interneta.",
  },
  edit: {
    title: "Priprema",
    rotateLeft: "Rotiraj ulevo",
    rotateRight: "Rotiraj udesno",
    cropHint: "Prevuci pravougaonik preko slike ili upiši procente - čita se samo isečak.",
    left: "Levo (%)",
    top: "Gore (%)",
    width: "Širina (%)",
    height: "Visina (%)",
    whole: "Cela slika",
    threshold: "Poboljšaj kontrast",
    thresholdHint: "Sivo, raširen ton i crno-belo - pomaže kod bledih snimaka.",
    reset: "Vrati na početno",
  },
  read: {
    title: "Čitanje",
    latin: "Srpski (latinica)",
    cyrillic: "Srpski (ćirilica)",
    english: "Engleski",
    languageHint: "Izaberi bar jedan jezik. Modeli se čitaju iz paketa koji je instaliran na ovom uređaju.",
    read: "Pročitaj tekst",
    reading: "Prepoznavanje…",
    readError: "Prepoznavanje nije uspelo. Probaj drugu sliku ili drugi jezik.",
    phase: {
      core: "Priprema motora",
      init: "Pokretanje motora",
      languages: "Učitavanje jezika",
      api: "Priprema jezika",
      text: "Prepoznavanje teksta",
      other: "Rad…",
    },
    phaseLabel: "Faza",
    progressLabel: "Napredak",
  },
  result: {
    title: "Tekst",
    emptyTitle: "Još nema teksta",
    emptyBody: "Kada slika bude pročitana, tekst se pojavljuje ovde - red po red.",
    linesLabel: "Pročitani redovi",
    lineLabel: "Red",
    confidenceLabel: "Sigurnost reda",
    lowMark: "Nesigurno",
    lowNote: "Označeni redovi su nesigurni - proveri ih pre upotrebe.",
    confidenceLabelSummary: "Prosečna sigurnost",
    copy: "Kopiraj tekst",
    copied: "Tekst je kopiran.",
    copyError: "Kopiranje nije uspelo.",
    noteTitle: "Naslov beleške",
    noteTitleHint: "Ako ostane prazno, naslov se izvodi iz samog teksta.",
    save: "Sačuvaj kao belešku",
    attach: "Priloži i sliku beleški",
    saved: "Sačuvano u beleškama.",
    saveError: "Beleška nije sačuvana.",
    attachError: "Beleška je sačuvana, ali slika nije priložena.",
  },
  pack: {
    checking: "Provera paketa sa jezicima…",
    missingTitle: "Paket sa jezicima nije instaliran",
    missingBody: `Skener čita tekst modelima iz paketa ${TESSDATA_PACK_ID}. Instaliraj ga u Podešavanja, kategorija Podaci, kartica Paketi sadržaja.`,
    unknownTitle: "Stanje paketa nije poznato",
    unknownBody:
      "Spisak paketa nije mogao da se pročita. Otvori stranicu ponovo ili proveri Podešavanja, kategorija Podaci.",
  },
};
