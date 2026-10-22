import { describe, expect, it } from "vitest";

import { joinSegments, segmentText } from "./segments.js";

const texts = (text: string, bcp47: string) => segmentText(text, bcp47).sentences.map((sentence) => sentence.text);

describe("segmentText", () => {
  it("cuts at the sentence ends of the language's own script", () => {
    expect(texts("The road is closed. Take the bridge! Is it far?", "en")).toEqual([
      "The road is closed.",
      "Take the bridge!",
      "Is it far?",
    ]);
    expect(texts("今天天气很好。我们去山上。", "zh-Hans")).toEqual(["今天天气很好。", "我们去山上。"]);
    expect(texts("मौसम अच्छा है। हम पहाड़ों पर जा रहे हैं।", "hi")).toEqual([
      "मौसम अच्छा है।",
      "हम पहाड़ों पर जा रहे हैं।",
    ]);
  });

  it("does not cut inside a number", () => {
    expect(texts("Cena je 3.50 dinara. Hvala.", "sr-Latn")).toEqual(["Cena je 3.50 dinara.", "Hvala."]);
  });

  it("puts every space and line break back where it was", () => {
    for (const text of [
      "  Prva rečenica. Druga.\n\nNovi pasus!\n",
      "\n\nOne.\nTwo.   Three.",
      "Bez tačke na kraju",
      "   ",
    ]) {
      const segmented = segmentText(text, "sr-Latn");
      expect(joinSegments(segmented, segmented.sentences.map((sentence) => sentence.text))).toBe(text);
    }
  });

  it("puts each translation in its sentence's place, keeping the paragraphs", () => {
    const segmented = segmentText("Dobar dan. Kako ste?\n\nHvala.", "sr-Latn");
    expect(joinSegments(segmented, ["Good day.", "How are you?", "Thank you."])).toBe(
      "Good day. How are you?\n\nThank you.",
    );
  });
});
