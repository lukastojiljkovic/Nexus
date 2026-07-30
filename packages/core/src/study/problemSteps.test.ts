import { describe, expect, it } from "vitest";
import {
  PROBLEM_STEP_SEPARATOR,
  renderProblemBack,
  splitProblemSteps,
} from "./problemSteps.js";

describe("splitProblemSteps", () => {
  it("splits on a line that is nothing but the separator, in order", () => {
    expect(splitProblemSteps("Nađi izvod.\n--\nPrimeni pravilo.\n--\nSredi izraz.")).toEqual([
      "Nađi izvod.",
      "Primeni pravilo.",
      "Sredi izraz.",
    ]);
  });

  it("accepts one step — a solution that takes a single move is still a problem card", () => {
    expect(splitProblemSteps("Zameni x = 2.")).toEqual(["Zameni x = 2."]);
  });

  it("keeps a step's own line breaks: only the separator line ends a step", () => {
    expect(splitProblemSteps("prvi red\ndrugi red\n--\ntreći red")).toEqual([
      "prvi red\ndrugi red",
      "treći red",
    ]);
  });

  it("trims each step and drops the empty ones a stray separator leaves behind", () => {
    expect(splitProblemSteps("--\n  a  \n--\n--\n\n  b\n--\n")).toEqual(["a", "b"]);
  });

  it("returns nothing for text that holds no step at all", () => {
    expect(splitProblemSteps("")).toEqual([]);
    expect(splitProblemSteps("   \n \n")).toEqual([]);
    expect(splitProblemSteps("--\n--")).toEqual([]);
  });

  it("is not fooled by `--` that is only PART of a line", () => {
    // The boundary is a whole line, so prose containing a dash pair, an em-dash
    // sentence, or a longer rule stays inside the step it was written in.
    expect(splitProblemSteps("a -- b")).toEqual(["a -- b"]);
    expect(splitProblemSteps("a\n---\nb")).toEqual(["a\n---\nb"]);
    expect(splitProblemSteps("a\n-- \tkorak\nb")).toEqual(["a\n-- \tkorak\nb"]);
  });

  it("tolerates whitespace around a separator line, including a CRLF carriage return", () => {
    // A textarea writes `\n`, but an archive or a paste can carry `\r\n`, and a
    // trailing space on the separator line is invisible to whoever typed it.
    expect(splitProblemSteps("a\n  --  \nb")).toEqual(["a", "b"]);
    expect(splitProblemSteps("a\r\n--\r\nb")).toEqual(["a", "b"]);
  });

  it("exposes the separator it splits on, so every reader spells it once", () => {
    expect(PROBLEM_STEP_SEPARATOR).toBe("--");
  });
});

describe("renderProblemBack", () => {
  it("joins the steps with a blank line and strips every marker", () => {
    const back = renderProblemBack("Nađi izvod.\n--\nPrimeni pravilo.\n--\nSredi izraz.");
    expect(back).toBe("Nađi izvod.\n\nPrimeni pravilo.\n\nSredi izraz.");
    expect(back).not.toContain(PROBLEM_STEP_SEPARATOR);
  });

  it("renders one step as itself — no separator, no padding", () => {
    expect(renderProblemBack("  Zameni x = 2.  ")).toBe("Zameni x = 2.");
  });

  it("renders nothing for text that holds no step (the store refuses such a card)", () => {
    expect(renderProblemBack("--\n--")).toBe("");
  });

  it("derives exactly what the steps say — the back is never authored separately", () => {
    const steps = "prvi\n--\ndrugi";
    expect(renderProblemBack(steps)).toBe(splitProblemSteps(steps).join("\n\n"));
  });
});
