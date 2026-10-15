import { claimsCompletion as coreClaims, detectAnswerLanguage, detectAnswerScript } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { claimsCompletion, detectLanguage, detectScript } from "./language.js";

/**
 * The evals score an answer with their own detectors, and the loop corrects one
 * with core's (`packages/core/src/assistant/language.ts`, `verify.ts`). Two
 * copies, on purpose: the scripted run loads nothing outside the evals, so it can
 * run under Node's strip-only mode, and core's barrel cannot. This test is what
 * keeps them one rule — a turn the loop lets through is one the evals pass.
 */
const SAMPLES = [
  "Otvori Podešavanja i proveri šifru.",
  "Imaš tri zadatka za danas.",
  "Ne znam, nemam taj podatak.",
  "Отвори подешавања и провери шифру.",
  "Open Settings and check the password.",
  "You have three tasks for today.",
  "I don't know that.",
  "Dodao sam zadatak.",
  "I have added the task to your list.",
  "Zakazao sam termin za petak.",
  "Zabeležio sam to u beleške.",
  "Nisam dodao zadatak, jer si predlog odbio.",
  "I did not add the task: the store is locked.",
  "Nije dodat nijedan zadatak.",
  "Додао сам задатак.",
  "112",
  "",
  "OK",
  "Mleko, hleb i jaja.",
  "Milk, bread and eggs.",
];

describe("the eval detectors and the loop's are one rule", () => {
  it.each(SAMPLES)("reads %j the same way", (text) => {
    expect(detectAnswerLanguage(text)).toBe(detectLanguage(text));
    expect(detectAnswerScript(text)).toBe(detectScript(text));
    expect(coreClaims(text)).toBe(claimsCompletion(text));
  });
});
