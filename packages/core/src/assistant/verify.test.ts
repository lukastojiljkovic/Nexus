import { describe, expect, it } from "vitest";
import { claimsCompletion, verifyAnswer } from "./verify.js";
import type { VerifiedCall, VerifyAnswerInput } from "./verify.js";

const SR_LATIN = { language: "sr", script: "latin" } as const;
const EN = { language: "en", script: "latin" } as const;

const wrote: VerifiedCall = {
  name: "tasks.create",
  effect: "write",
  result: { ok: true, content: "created" },
};
const refused: VerifiedCall = {
  name: "tasks.create",
  effect: "write",
  result: { ok: false, content: "The user declined." },
};
const read: VerifiedCall = {
  name: "tasks.list",
  effect: "read",
  result: { ok: true, content: "two tasks" },
};

/** A turn's check with the parts a test does not care about filled in. */
function check(parts: Partial<VerifyAnswerInput>): readonly string[] {
  return verifyAnswer({
    answer: "Gotovo.",
    results: [],
    citations: [],
    reply: SR_LATIN,
    ...parts,
  }).map((finding) => finding.kind);
}

describe("claimsCompletion", () => {
  it("reads a claim of a write in Serbian and in English, folded", () => {
    expect(claimsCompletion("Dodao sam zadatak.")).toBe(true);
    expect(claimsCompletion("Zabeležio sam to.")).toBe(true);
    expect(claimsCompletion("I have added the task to your list.")).toBe(true);
    expect(claimsCompletion("I've saved it.")).toBe(true);
  });

  it("does not read a refusal as a claim, because a bare participle is not a marker", () => {
    expect(claimsCompletion("Nisam dodao zadatak, jer si predlog odbio.")).toBe(false);
    expect(claimsCompletion("I did not add the task: the store is locked.")).toBe(false);
    expect(claimsCompletion("Nije dodat nijedan zadatak.")).toBe(false);
  });
});

describe("verifyAnswer: a completion claim", () => {
  it("passes when a write this turn succeeded", () => {
    expect(check({ answer: "Dodao sam zadatak.", results: [wrote] })).toEqual([]);
  });

  it("fails when the only write was refused", () => {
    expect(check({ answer: "Dodao sam zadatak.", results: [refused] })).toEqual(["completion-claim"]);
  });

  it("fails when no write ran at all, however successful the reads", () => {
    expect(check({ answer: "I added the task.", results: [read], reply: EN })).toEqual([
      "completion-claim",
    ]);
  });
});

describe("verifyAnswer: the language", () => {
  it("passes an answer in the reply's language", () => {
    expect(check({ answer: "I cannot add the task: the store is locked.", reply: EN })).toEqual([]);
  });

  it("fails an answer in the other language", () => {
    expect(check({ answer: "Nije moguće otvoriti listu.", reply: EN })).toEqual(["language"]);
  });

  it("does not judge a text with no evidence either way", () => {
    expect(check({ answer: "112", reply: EN })).toEqual([]);
  });
});

describe("verifyAnswer: the script", () => {
  it("passes an answer in the decided script", () => {
    expect(check({ answer: "Nikola Tesla je rođen u Smiljanu." })).toEqual([]);
  });

  it("fails a Serbian answer in the other script", () => {
    expect(check({ answer: "Никола Тесла је рођен у Смиљану." })).toEqual(["script"]);
  });

  it("names every finding, in the order the loop reads them", () => {
    expect(
      check({
        answer: "Dodao sam. Никола Тесла је рођен у Смиљану.",
        reply: EN,
      }),
    ).toEqual(["completion-claim", "language", "script"]);
  });
});
