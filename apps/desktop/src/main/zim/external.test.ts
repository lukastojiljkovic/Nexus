import { describe, expect, it } from "vitest";

import { externalUrlFor, handleFrameNavigation } from "./external.js";

/** A sink that records what the rule did, which is the whole of what the rule decides. */
function sink(): {
  prevented: boolean;
  opened: string[];
  api: { preventDefault(): void; openInBrowser(url: string): void };
} {
  const state = {
    prevented: false,
    opened: [] as string[],
    api: {
      preventDefault(): void {
        state.prevented = true;
      },
      openInBrowser(url: string): void {
        state.opened.push(url);
      },
    },
  };
  return state;
}

describe("the external-link rule", () => {
  it("lets a link inside the ZIM load in the frame", () => {
    const recorder = sink();
    handleFrameNavigation(
      { url: "nx-zim://lib/C/Kafa", frameUrl: "nx-zim://lib/C/Čaj" },
      recorder.api,
    );
    expect(recorder.prevented).toBe(false);
    expect(recorder.opened).toEqual([]);
  });

  it("hands an http(s) link to the browser and does not load it in the frame", () => {
    const recorder = sink();
    handleFrameNavigation(
      { url: "https://sr.wikipedia.org/wiki/Kafa", frameUrl: "nx-zim://lib/C/Kafa" },
      recorder.api,
    );
    expect(recorder.prevented).toBe(true);
    expect(recorder.opened).toEqual(["https://sr.wikipedia.org/wiki/Kafa"]);
  });

  it("refuses everything else without saying anything", () => {
    for (const url of [
      "file:///C:/Users/x/.ssh/id_rsa",
      "mailto:someone@example.com",
      "data:text/html,<b>hi</b>",
      "nx-blob://abc",
      "javascript:alert(1)",
      "not a url",
    ]) {
      const recorder = sink();
      handleFrameNavigation({ url, frameUrl: "nx-zim://lib/C/Kafa" }, recorder.api);
      expect(recorder.prevented, url).toBe(true);
      expect(recorder.opened, url).toEqual([]);
    }
  });

  it("leaves a frame that is not a ZIM page alone", () => {
    const recorder = sink();
    handleFrameNavigation(
      { url: "https://example.com/", frameUrl: "file:///app/index.html" },
      recorder.api,
    );
    expect(recorder.prevented).toBe(false);
    expect(recorder.opened).toEqual([]);
  });

  it("answers the URL to open for exactly the two protocols the user owns", () => {
    expect(externalUrlFor("https://example.com/a")).toBe("https://example.com/a");
    expect(externalUrlFor("http://example.com/a")).toBe("http://example.com/a");
    expect(externalUrlFor("ftp://example.com/a")).toBeNull();
    expect(externalUrlFor("file:///etc/passwd")).toBeNull();
    expect(externalUrlFor("javascript:alert(1)")).toBeNull();
    expect(externalUrlFor("nx-zim://lib/C/Kafa")).toBeNull();
  });
});
