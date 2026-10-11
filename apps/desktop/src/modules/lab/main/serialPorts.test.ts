import { describe, expect, it } from "vitest";

import { chosenPortId, displayNameOf, portButtons } from "./serialPorts.js";

/**
 * The picker's two rules: what the user is offered, and what their answer names.
 *
 * Electron's port objects are `{ portId, portName, displayName }`; the fixtures
 * below are the shapes a real Windows machine produces — a COM name, a device
 * with no display name at all, and two ports the driver describes identically.
 */
describe("portButtons", () => {
  it("offers one button per port, in the order they arrived, and a cancel after them", () => {
    const ports = [
      { portId: "A", portName: "COM3", displayName: "USB Serial Device (COM3)" },
      { portId: "B", portName: "COM7", displayName: "Arduino Uno (COM7)" },
    ];
    expect(portButtons(ports)).toEqual({
      labels: ["USB Serial Device (COM3)", "Arduino Uno (COM7)"],
      cancelId: 2,
    });
  });

  it("names a port by its id when the OS gives it no name", () => {
    expect(displayNameOf({ portId: "COM9" })).toBe("COM9");
    expect(displayNameOf({ portId: "COM9", portName: "  " })).toBe("COM9");
    expect(displayNameOf({ portId: "COM9", displayName: "  " })).toBe("COM9");
  });

  it("tells two identically named ports apart by their ids", () => {
    // Two buttons that read the same are a picker the user cannot answer, and
    // the id is the only thing that distinguishes them.
    const ports = [
      { portId: "USB\\VID_1", displayName: "USB Serial Device" },
      { portId: "USB\\VID_2", displayName: "USB Serial Device" },
    ];
    expect(portButtons(ports).labels).toEqual([
      "USB Serial Device",
      "USB Serial Device (USB\\VID_2)",
    ]);
  });

  it("offers nothing but a cancel when the OS reports no ports", () => {
    expect(portButtons([])).toEqual({ labels: [], cancelId: 0 });
  });
});

describe("chosenPortId", () => {
  const ports = [{ portId: "A" }, { portId: "B" }];

  it("names the port the answer points at", () => {
    expect(chosenPortId(ports, 0)).toBe("A");
    expect(chosenPortId(ports, 1)).toBe("B");
  });

  it("answers null for the cancel button and for anything past the list", () => {
    // `cancelId` is `labels.length`, and Electron answers with it when the user
    // dismisses the dialog: nothing is opened, which is what the page says.
    expect(chosenPortId(ports, 2)).toBeNull();
    expect(chosenPortId(ports, -1)).toBeNull();
    expect(chosenPortId([], 0)).toBeNull();
  });
});
