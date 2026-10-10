// Where every byte of this pack comes from, and what permits it to be shipped.
//
// The licence is not a note beside the source; it is the reason the source is
// here at all. Each entry therefore carries the URL of the page that states the
// licence and the sentence on that page, quoted exactly, and the build fetches
// that page and checks the sentence is on it. A source whose evidence does not
// check out fails the build rather than shipping with a citation nobody read.
//
// WHAT IS DELIBERATELY NOT HERE. The National Center for Home Food Preservation
// (the University of Georgia's home-canning centre) is all rights reserved, the
// Sphere Handbook allows free reproduction for educational use only, WHO's
// default licence is non-commercial, and UNHCR, Solar Cookers International and
// Aprovecho assert copyright with no open licence. Their pages are read by
// people, so the pack links to them — see `furtherReading` — and links are not
// reproduction.

/**
 * The licence statements the pack relies on, each with the page that says it
 * and the sentence quoted from that page.
 */
export const LICENCES = {
  "us-government-work": {
    name: "US Government work — not subject to copyright (17 U.S.C. §105(a))",
    url: "https://www.copyright.gov/title17/92chap1.html",
    quotes: [
      "(a) In General.—Copyright protection under this title is not available for any work of the United States Government, but the United States Government is not precluded from receiving and holding copyrights transferred to it by assignment, bequest, or otherwise.",
    ],
  },
  "usda-reuse": {
    name: "USDA web material — public domain, credit requested",
    url: "https://www.usda.gov/about-usda/policies-and-links",
    quotes: [
      "Most information presented on the USDA Web site is considered public domain information. Public domain information may be freely distributed or copied, but use of appropriate byline/photo/image credits is requested.",
      "Some materials on the USDA Web site are protected by copyright, trademark, or patent, and/or are provided for personal use only.",
    ],
  },
  "fema-reuse": {
    name: "FEMA.gov material — free of copyright, licensed photos and graphics excluded",
    url: "https://www.fema.gov/about/website-information",
    quotes: [
      "Most material on FEMA.gov is free of copyright and may be copied and distributed without permission.",
      "We sometimes use photos or graphics that we licensed or that are restricted.",
    ],
  },
  "cdc-reuse": {
    name: "CDC/ATSDR web information — public domain, with attribution, a non-endorsement disclaimer and no substantive changes",
    url: "https://www.cdc.gov/other/agencymaterials.html",
    quotes: [
      "Most of the information on the CDC and ATSDR websites is not subject to copyright, is in the public domain, and may be freely used or reproduced without obtaining copyright permission.",
      "1) Attribution to the agency that developed the material must be provided in your use of the materials.",
      "2) You must utilize a disclaimer which clearly indicates that your use of the material, including any links to the materials on the CDC, ATSDR or HHS websites, does not imply endorsement by CDC, ATSDR, HHS or the United States Government of you, your company, product, facility, service or enterprise.",
      "3) You may not change the substantive content of the materials; and",
      "Images other than those in the PHIL may have been licensed for use by CDC from a stock photography service or other copyright holder and the license holder may prohibit republication, retransmission, reproduction or other use of the images.",
    ],
  },
  "public-domain-mark": {
    name: "Public Domain Mark 1.0 (as tagged by the Internet Archive item)",
    url: "https://archive.org/metadata/TM10-405",
    quotes: ['"licenseurl":"http://creativecommons.org/publicdomain/mark/1.0/"'],
  },
  "not-in-copyright": {
    name: "Not in copyright (as tagged by the Internet Archive item; US Government Printing Office imprint)",
    url: "https://archive.org/metadata/manualforarmyco00statgoog",
    quotes: ['"possible-copyright-status":"NOT_IN_COPYRIGHT"'],
  },
};

/**
 * The licence statements the pack LINKS to and never reproduces, with the page
 * that says so. These exist so the "Further reading" article can name each
 * source's licence on evidence rather than on recall.
 */
export const LINK_LICENCES = {
  nchfp: {
    title: "National Center for Home Food Preservation (University of Georgia)",
    url: "https://nchfp.uga.edu/",
    licence: "All rights reserved — not shipped",
    evidenceUrl: "https://nchfp.uga.edu/",
    evidenceQuotes: ["Copyright © 2026 National Center for Home Food Preservation, All rights reserved"],
  },
  who: {
    title: "World Health Organization publications",
    url: "https://www.who.int/about/policies/publishing/copyright",
    licence: "CC BY-NC-SA 3.0 IGO (non-commercial) — not shipped",
    evidenceUrl: "https://www.who.int/about/policies/publishing/copyright",
    evidenceQuotes: [
      "The CC BY-NC-SA 3.0 IGO licence allows users to freely copy, reproduce, reprint, distribute, translate and adapt the work for non-commercial purposes, provided WHO is acknowledged as the source using the following suggested citation:",
    ],
  },
  sphere: {
    title: "Sphere Handbook 2018",
    url: "https://spherestandards.org/handbook-2018/",
    licence: "Copyrighted; free reproduction for educational purposes only, written permission for online reuse — not shipped",
    evidenceUrl:
      "https://web.archive.org/web/20181112155649id_/https://spherestandards.org/wp-content/uploads/Sphere-Handbook-2018-EN.pdf",
    evidenceQuotes: [
      "All rights reserved. This material is copyrighted but may be reproduced without fee for educational purposes, including for training, research and programme activities, provided that the copyright holder is acknowledged.",
      "For copying in other circumstances, posting online, reuse in other publications or for translation or adaptation, prior written permission must be obtained by emailing info@spherestandards.org.",
    ],
  },
  solarCookers: {
    title: "Solar Cookers International",
    url: "https://www.solarcookers.org/",
    licence: "© Solar Cookers International — not shipped",
    evidenceUrl: "https://www.solarcookers.org/",
    evidenceQuotes: ["© 2026 Solar Cookers International."],
  },
  aprovecho: {
    title: "Aprovecho Research Center",
    url: "https://aprovecho.org/",
    licence: "© Aprovecho Research Center — not shipped",
    evidenceUrl: "https://aprovecho.org/",
    evidenceQuotes: ["© Copyright - Aprovecho Research Center"],
  },
};

/**
 * The works the pack carries.
 *
 * `reader` names the converter: `pdf` for a PDF text layer, `html` for a page,
 * `text` for a plain-text scan. `section` is what the article's Source line
 * names, because an article is a section of a work and a reader who wants to
 * check it needs to know which part of which edition this is.
 */
export const SOURCES = [
  {
    id: "usda-guide-introduction",
    file: "INTRO_HomeCanrev0715.pdf",
    url: "https://nchfp.uga.edu/papers/guide/INTRO_HomeCanrev0715.pdf",
    reader: "pdf",
    licence: "usda-reuse",
    work: "Complete Guide to Home Canning, Revised 2015 (Agriculture Information Bulletin No. 539)",
    publisher: "USDA / National Institute of Food and Agriculture",
    section: "Introduction",
    entry: { id: "usda-introduction", title: "Introduction" },
  },
  ...["1", "2", "3", "4", "5", "6", "7"].map((number) => ({
    id: `usda-guide-${number}`,
    file: `GUIDE0${number}_HomeCan_rev0715.pdf`,
    url: `https://nchfp.uga.edu/papers/guide/GUIDE0${number}_HomeCan_rev0715.pdf`,
    reader: "pdf",
    licence: "usda-reuse",
    work: "Complete Guide to Home Canning, Revised 2015 (Agriculture Information Bulletin No. 539)",
    publisher: "USDA / National Institute of Food and Agriculture",
    section: `Guide ${number} — ${[
      "",
      "Principles of Home Canning",
      "Selecting, Preparing, and Canning Fruit and Fruit Products",
      "Selecting, Preparing, and Canning Tomatoes and Tomato Products",
      "Selecting, Preparing, and Canning Vegetables and Vegetable Products",
      "Preparing and Canning Poultry, Red Meats, and Seafoods",
      "Preparing and Canning Fermented Foods and Pickled Vegetables",
      "Preparing and Canning Jams and Jellies",
    ][Number(number)]}`,
    entry: {
      id: `usda-guide-${number}`,
      title: [
        "",
        "Guide 1 — Principles of home canning",
        "Guide 2 — Fruit and fruit products",
        "Guide 3 — Tomatoes and tomato products",
        "Guide 4 — Vegetables and vegetable products",
        "Guide 5 — Poultry, red meats and seafoods",
        "Guide 6 — Fermented foods and pickled vegetables",
        "Guide 7 — Jams and jellies",
      ][Number(number)],
    },
  })),
  {
    id: "fsis-power-outage",
    file: "fsis-keep-your-food-safe-during-emergencies.html",
    url: "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/emergencies/keep-your-food-safe-during-emergencies",
    reader: "html",
    licence: "usda-reuse",
    work: "Keep Your Food Safe During Emergencies: Power Outages, Floods & Fires",
    publisher: "USDA Food Safety and Inspection Service",
    section: "Power outages",
    entry: { id: "fsis-power-outage", title: "FSIS — keeping food safe in an emergency" },
  },
  {
    id: "cdc-power-outage",
    file: "cdc-keep-food-safe-after-emergency.html",
    url: "https://www.cdc.gov/food-safety/foods/keep-food-safe-after-emergency.html",
    reader: "html",
    licence: "cdc-reuse",
    work: "Keep Food Safe After a Disaster or Emergency",
    publisher: "US Centers for Disease Control and Prevention",
    section: "Power outage",
    entry: { id: "cdc-power-outage", title: "CDC — keep food safe after an emergency" },
  },
  {
    id: "foodsafety-power-outage",
    file: "foodsafetygov-food-safety-during-power-outage.html",
    url: "https://www.foodsafety.gov/food-safety-charts/food-safety-during-power-outage",
    reader: "html",
    licence: "fema-reuse",
    work: "Food Safety During Power Outage",
    publisher: "FoodSafety.gov (US federal food safety portal)",
    section: "Food safety during a power outage",
    entry: { id: "foodsafety-power-outage", title: "FoodSafety.gov — food safety during a power outage" },
  },
  {
    id: "cdc-botulism-about",
    file: "cdc-botulism-about.html",
    url: "https://www.cdc.gov/botulism/about/index.html",
    reader: "html",
    licence: "cdc-reuse",
    work: "About Botulism",
    publisher: "US Centers for Disease Control and Prevention",
    section: "About botulism",
    entry: { id: "cdc-botulism-about", title: "CDC — about botulism" },
  },
  {
    id: "cdc-botulism-prevention",
    file: "cdc-botulism-prevention.html",
    url: "https://www.cdc.gov/botulism/prevention/index.html",
    reader: "html",
    licence: "cdc-reuse",
    work: "Botulism Prevention",
    publisher: "US Centers for Disease Control and Prevention",
    section: "Preventing botulism",
    entry: { id: "cdc-botulism-prevention", title: "CDC — preventing botulism" },
  },
  {
    id: "fsis-jerky",
    file: "fsis-jerky.html",
    url: "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/meat-fish/jerky",
    reader: "html",
    licence: "usda-reuse",
    work: "Jerky and Food Safety",
    publisher: "USDA Food Safety and Inspection Service",
    section: "Jerky and food safety",
    entry: { id: "fsis-jerky", title: "FSIS — jerky and food safety" },
  },
  {
    id: "cdc-carbon-monoxide",
    file: "cdc-carbon-monoxide-about.html",
    url: "https://www.cdc.gov/carbon-monoxide/about/index.html",
    reader: "html",
    licence: "cdc-reuse",
    work: "About Carbon Monoxide Poisoning",
    publisher: "US Centers for Disease Control and Prevention",
    section: "Preventing carbon monoxide poisoning",
    entry: { id: "cdc-carbon-monoxide", title: "CDC — carbon monoxide poisoning" },
  },
  {
    id: "ready-power-outages",
    file: "ready-power-outages.html",
    url: "https://www.ready.gov/power-outages",
    reader: "html",
    licence: "fema-reuse",
    work: "Power Outages",
    publisher: "Ready.gov (FEMA)",
    section: "Power outages — food, heat and carbon monoxide",
    entry: { id: "ready-power-outages", title: "Ready.gov — power outages" },
  },
  {
    id: "ready-food",
    file: "ready-food.html",
    url: "https://www.ready.gov/food",
    reader: "html",
    licence: "fema-reuse",
    work: "Food",
    publisher: "Ready.gov (FEMA)",
    section: "Food supply",
    entry: { id: "ready-food", title: "Ready.gov — food supply" },
  },
  {
    id: "ready-water",
    file: "ready-water.html",
    url: "https://www.ready.gov/water",
    reader: "html",
    licence: "fema-reuse",
    work: "Water",
    publisher: "Ready.gov (FEMA)",
    section: "Water supply and rationing",
    entry: { id: "ready-water", title: "Ready.gov — water supply" },
  },
  {
    id: "tm-10-405",
    file: "tm-10-405.txt",
    url: "https://archive.org/download/TM10-405/TM10-405_djvu.txt",
    reader: "text",
    licence: "public-domain-mark",
    work: "TM 10-405, The Army Cook (War Department technical manual, 1941)",
    publisher: "US War Department, prepared under direction of The Quartermaster General",
    section: "Field cooking (paras 72–78) and the yeast-free breads",
    // Where the article starts: the work's own title, because the scan's head is
    // the Internet Archive's and Google Books' notice rather than the manual's.
    startAt: "TM 10-405",
    entry: { id: "tm-10-405", title: "TM 10-405, The Army Cook (1941)" },
  },
  {
    id: "army-cooks-1914",
    file: "army-cooks-1914.txt",
    url: "https://archive.org/download/manualforarmyco00statgoog/manualforarmyco00statgoog_djvu.txt",
    reader: "text",
    licence: "not-in-copyright",
    work: "Manual for Army Cooks (1914)",
    publisher: "US War Department, Government Printing Office",
    section: "Bread and the ration",
    startAt: "MANUAL FOR ARMY COOKS",
    entry: { id: "army-cooks-1914", title: "Manual for Army Cooks (1914)" },
  },
  {
    id: "army-cooks-1917",
    file: "army-cooks-1917.txt",
    url: "https://archive.org/download/extractsfromman00statgoog/extractsfromman00statgoog_djvu.txt",
    reader: "text",
    licence: "not-in-copyright",
    work: "Extracts from the Manual for Army Cooks (1917)",
    publisher: "US War Department, Government Printing Office",
    section: "Hard bread in the ration",
    startAt: "EXTRACTS FRCM",
    entry: { id: "army-cooks-1917", title: "Extracts from the Manual for Army Cooks (1917)" },
  },
  {
    id: "hardtack-and-coffee",
    file: "hardtack-and-coffee-1887.txt",
    url: "https://archive.org/download/hardtackandcoff00billgoog/hardtackandcoff00billgoog_djvu.txt",
    reader: "text",
    licence: "public-domain-mark",
    work: "Hardtack and Coffee; or, The Unwritten Story of Army Life (John D. Billings, 1887)",
    publisher: "George M. Smith & Co., Boston",
    section: "Hard bread and how the soldiers ate it",
    startAt: "Hardtack and Coffee",
    entry: { id: "hardtack-and-coffee", title: "Hardtack and Coffee (1887)" },
  },
];

/** The pages the "Further reading" article links to, and what each licence says. */
export const FURTHER_READING = [
  "nchfp",
  "sphere",
  "who",
  "solarCookers",
  "aprovecho",
];

/**
 * The lines the CDC's reuse policy obliges every CDC-derived article to carry.
 *
 * Quoted from the licence evidence above rather than paraphrased, because the
 * policy requires the disclaimer itself and a paraphrase is not the disclaimer.
 * `build.mjs` writes them, verbatim and with the policy's own URL, at the foot of
 * each article whose source is CDC material.
 */
export const CDC_NOTICE = {
  url: "https://www.cdc.gov/other/agencymaterials.html",
  quotes: LICENCES["cdc-reuse"].quotes.slice(1, 4),
};
