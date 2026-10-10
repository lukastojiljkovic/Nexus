import { describe, expect, it, vi } from "vitest";

import {
  externalLinkLabel,
  followExternalLink,
  linkStateAfter,
  type ExternalLinkOutcome,
} from "./externalLinkRule.js";

/**
 * The kit's external link (ADR-107), as the two decisions the component makes.
 *
 * The component itself is not rendered here: this package has no DOM library,
 * and the point of `externalLink.ts` is that the parts worth pinning are pure.
 * What is asserted is (a) what a link READS, which is the host a person judges
 * an address by, and (b) what a press MEANS — an address main opens, an address
 * main refuses (the state the control goes inert in), and a channel that failed,
 * which is a different thing and must not be painted as a refusal.
 */

describe("what an external link reads", () => {
  it("shows the host, which is the part a reader judges an address by", () => {
    expect(externalLinkLabel("https://en.wiktionary.org/wiki/kafa")).toBe("en.wiktionary.org");
    expect(externalLinkLabel("https://creativecommons.org/licenses/by-sa/4.0/")).toBe(
      "creativecommons.org",
    );
    // A port is part of the authority a person is trusting, so it stays.
    expect(externalLinkLabel("https://example.org:8443/a/b")).toBe("example.org:8443");
  });

  it("shows an unparseable address as it came, rather than inventing a host for it", () => {
    expect(externalLinkLabel("not a url")).toBe("not a url");
    expect(externalLinkLabel("")).toBe("");
  });
});

describe("what a press means", () => {
  it("is `opened` when main handed the address to the OS", async () => {
    const open = vi.fn(async () => true);
    await expect(followExternalLink("https://example.org/", open)).resolves.toBe("opened");
    expect(open).toHaveBeenCalledWith("https://example.org/");
  });

  it("is `refused` when the rule in main said no, which is what makes the control inert", async () => {
    // The three refusals the rule actually makes, driven through the one answer
    // the renderer ever gets: `false`.
    for (const url of ["http://example.org/", "file:///C:/Windows/calc.exe", "ms-settings:privacy"]) {
      await expect(followExternalLink(url, async () => false)).resolves.toBe("refused");
    }
  });

  it("is NOT a refusal when the channel itself failed, because a wiring bug is not a decision", async () => {
    const failure = new Error("No handler registered for external:open");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const outcome: ExternalLinkOutcome = await followExternalLink("https://example.org/", async () => {
        throw failure;
      });
      expect(outcome).toBe("channel-failed");
      expect(quiet).toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
    }
  });
});

/**
 * What the control becomes, which is the half of `ExternalLink` this package can
 * pin: the component itself needs a DOM (see `vitest.config.ts`), but the
 * decision it makes on the answer does not.
 *
 * The distinction is the whole point of the third outcome. An address main
 * refuses becomes the address as text — the control really does go away — while
 * a channel that failed leaves the button a button, so a broken channel cannot
 * be mistaken for a security decision by the person pressing it.
 */
describe("what the control is after a press", () => {
  it("is the address itself when main refused it, so a refusal is visible", () => {
    expect(linkStateAfter("refused")).toBe("address");
  });

  it("is still a control when the address opened, and when the channel failed", () => {
    expect(linkStateAfter("opened")).toBe("control");
    expect(linkStateAfter("channel-failed")).toBe("control");
  });
});
